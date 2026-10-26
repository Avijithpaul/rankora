/**
 * Extracts SEO-relevant facts from one HTML document. Pure (no I/O), unit tested
 * with fixture HTML. The analyzer turns these facts into rule results.
 */
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { isSameSite, normalizeUrl } from "./url";

export interface ParsedLink {
  url: string;
  internal: boolean;
  nofollow: boolean;
  anchor: string;
}

export interface ParsedPage {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2Count: number;
  /** heading level sequence in document order, e.g. [1,2,2,3] */
  headingLevels: number[];
  /** number of times a heading level jumps deeper by more than one (h2 -> h4) */
  headingSkips: number;
  canonical: string | null;
  /** raw canonical href when it could not be resolved to a URL */
  canonicalInvalid: boolean;
  robotsMeta: string | null;
  noindex: boolean;
  nofollowPage: boolean;
  lang: string | null;
  hasViewport: boolean;
  wordCount: number;
  contentHash: string | null;
  images: { total: number; missingAlt: number; missingDimensions: number };
  links: ParsedLink[];
  structuredDataTypes: string[];
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  metaRefresh: string | null;
}

const clean = (s: string | undefined | null) => {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v.length ? v : null;
};

function collectJsonLdTypes(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) return node.forEach((n) => collectJsonLdTypes(n, out));
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") out.add(t);
  if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
  if (obj["@graph"]) collectJsonLdTypes(obj["@graph"], out);
}

export function parsePage(html: string, pageUrl: string, headers?: { xRobotsTag?: string | null }): ParsedPage {
  const $ = cheerio.load(html);
  const page = new URL(pageUrl);
  // <base href> changes how relative links resolve.
  const baseHref = $("base[href]").attr("href");
  let base = pageUrl;
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).toString();
    } catch {
      /* ignore invalid base */
    }
  }

  const meta = (name: string) => clean($(`meta[name="${name}" i]`).attr("content"));

  // Robots directives: meta robots, meta googlebot and X-Robots-Tag header.
  const robotsParts = [meta("robots"), meta("googlebot"), headers?.xRobotsTag ?? null].filter(Boolean) as string[];
  const robotsMeta = robotsParts.length ? robotsParts.join(", ").toLowerCase() : null;
  const noindex = /\b(noindex|none)\b/.test(robotsMeta ?? "");
  const nofollowPage = /\b(nofollow|none)\b/.test(robotsMeta ?? "");

  // Canonical
  const canonicalHref = $('link[rel~="canonical" i]').first().attr("href");
  const canonical = canonicalHref ? normalizeUrl(canonicalHref.trim(), base) : null;

  // Headings
  const headingLevels: number[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    headingLevels.push(Number(el.tagName.slice(1)));
  });
  let headingSkips = 0;
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] - headingLevels[i - 1] > 1) headingSkips++;
  }
  // Empty <h1> elements are kept (as "") so they still count as present-but-empty.
  const h1 = $("h1")
    .map((_, el) => clean($(el).text()) ?? "")
    .get();

  // Images
  let missingAlt = 0;
  let missingDimensions = 0;
  const imgs = $("img");
  imgs.each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt === undefined) missingAlt++; // alt="" is valid for decorative images
    if (!$(el).attr("width") || !$(el).attr("height")) missingDimensions++;
  });

  // Links
  const links: ParsedLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript|data|sms|ftp):/i.test(href)) return;
    const url = normalizeUrl(href, base);
    if (!url) return;
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    const key = `${url}|${rel.includes("nofollow")}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({
      url,
      internal: isSameSite(url, page.hostname),
      nofollow: /\b(nofollow|ugc|sponsored)\b/.test(rel),
      anchor: (clean($(el).text()) ?? clean($(el).find("img").attr("alt")) ?? "").slice(0, 200),
    });
  });

  // Structured data
  const types = new Set<string>();
  $('script[type="application/ld+json" i]').each((_, el) => {
    try {
      collectJsonLdTypes(JSON.parse($(el).contents().text()), types);
    } catch {
      types.add("(invalid JSON-LD)");
    }
  });
  $("[itemtype]").each((_, el) => {
    const t = $(el).attr("itemtype");
    if (t) types.add(t.split("/").pop() || t);
  });
  $("[typeof]").each((_, el) => {
    const t = $(el).attr("typeof");
    if (t) types.add(t);
  });

  // Social
  const openGraph: Record<string, string> = {};
  $('meta[property^="og:" i]').each((_, el) => {
    const p = ($(el).attr("property") ?? "").toLowerCase().slice(3);
    const c = clean($(el).attr("content"));
    if (p && c && !(p in openGraph)) openGraph[p] = c;
  });
  const twitterCard: Record<string, string> = {};
  $('meta[name^="twitter:" i], meta[property^="twitter:" i]').each((_, el) => {
    const p = (($(el).attr("name") ?? $(el).attr("property")) || "").toLowerCase().slice(8);
    const c = clean($(el).attr("content"));
    if (p && c && !(p in twitterCard)) twitterCard[p] = c;
  });

  // Visible text
  const body = $("body").clone();
  body.find("script, style, noscript, template, svg, iframe").remove();
  const text = (body.text() || "").replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)) : [];
  const contentHash = words.length ? createHash("sha256").update(text.toLowerCase()).digest("hex") : null;

  return {
    title: clean($("head title").first().text()) ?? clean($("title").first().text()),
    metaDescription: meta("description"),
    h1,
    h2Count: $("h2").length,
    headingLevels,
    headingSkips,
    canonical,
    canonicalInvalid: Boolean(canonicalHref) && !canonical,
    robotsMeta,
    noindex,
    nofollowPage,
    lang: clean($("html").attr("lang")),
    hasViewport: $('meta[name="viewport" i]').length > 0,
    wordCount: words.length,
    contentHash,
    images: { total: imgs.length, missingAlt, missingDimensions },
    links,
    structuredDataTypes: [...types].slice(0, 30),
    openGraph,
    twitterCard,
    metaRefresh: clean($('meta[http-equiv="refresh" i]').attr("content")),
  };
}
