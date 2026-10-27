/**
 * Turns a fetched HTML page or a pasted draft into one neutral document model
 * that the content analyzer works on. Pure (no I/O) and unit tested.
 */
import * as cheerio from "cheerio";
import { isSameSite, normalizeUrl } from "@/lib/crawler/url";

export interface ContentHeading {
  level: number;
  text: string;
}

export interface ContentLink {
  url: string;
  anchor: string;
  internal: boolean;
}

export interface ContentDocument {
  source: "url" | "draft";
  url: string | null;
  title: string | null;
  metaDescription: string | null;
  headings: ContentHeading[];
  /** block-level text units (paragraphs, list items, table cells collapsed) */
  paragraphs: string[];
  /** all visible body text, whitespace-collapsed */
  text: string;
  links: ContentLink[];
  images: { alt: string | null }[];
  lists: number;
  lang: string | null;
}

export const MAX_DRAFT_CHARS = 100_000;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const orNull = (s: string) => (s.length ? s : null);

function fromCheerio($: cheerio.CheerioAPI, root: ReturnType<cheerio.CheerioAPI>, pageUrl: string | null, siteHost: string | null) {
  root.find("script, style, noscript, template, svg, iframe").remove();
  // .text() concatenates adjacent blocks ("Post</h1><p>Body" → "PostBody"); pad block ends so words stay separate.
  root.find("p, div, li, h1, h2, h3, h4, h5, h6, td, th, dd, dt, br, section, article, blockquote, tr, header, footer, figcaption").append(" ");
  const headings: ContentHeading[] = [];
  root.find("h1, h2, h3, h4, h5, h6").each((_, el) => {
    headings.push({ level: Number(el.tagName.slice(1)), text: clean($(el).text()) });
  });
  const paragraphs: string[] = [];
  root.find("p, li, blockquote, td, dd").each((_, el) => {
    // skip containers whose text is already counted through a nested block
    if ($(el).find("p, li").length) return;
    const t = clean($(el).text());
    if (t) paragraphs.push(t);
  });
  const host = siteHost ?? (pageUrl ? new URL(pageUrl).hostname : null);
  const links: ContentLink[] = [];
  root.find("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript|data|sms):/i.test(href)) return;
    const resolved = pageUrl ? normalizeUrl(href, pageUrl) : /^https?:\/\//i.test(href) ? normalizeUrl(href, href) : null;
    // relative links in a draft cannot be resolved but clearly point to the same site
    const url = resolved ?? (href.startsWith("/") ? href : null);
    if (!url) return;
    links.push({ url, anchor: clean($(el).text()).slice(0, 200), internal: resolved ? (host ? isSameSite(resolved, host) : false) : true });
  });
  const images = root
    .find("img")
    .map((_, el) => ({ alt: $(el).attr("alt") === undefined ? null : clean($(el).attr("alt")) }))
    .get();
  return {
    headings,
    paragraphs,
    text: clean(root.text()),
    links,
    images,
    lists: root.find("ul, ol").length,
  };
}

/** Fetched page (URL mode). */
export function documentFromHtml(html: string, pageUrl: string): ContentDocument {
  const $ = cheerio.load(html);
  const title = orNull(clean($("head title").first().text()) || clean($("title").first().text()));
  const meta = orNull(clean($('meta[name="description" i]').attr("content")));
  const lang = orNull(clean($("html").attr("lang")));
  // Prefer the main content region when the page marks one, so navigation and footers do not dilute the analysis.
  // A single <article> is the content; several (product cards, post lists) are not.
  const articles = $("article");
  const main = $("main, [role=main]").first().length ? $("main, [role=main]").first() : articles.length === 1 ? articles : $([]);
  const root = (main.length ? main : $("body")).clone();
  return { source: "url", url: pageUrl, title, metaDescription: meta, lang, ...fromCheerio($, root, pageUrl, null) };
}

const looksLikeHtml = (s: string) => /<(p|h[1-6]|ul|ol|div|article|section|a)\b[^>]*>/i.test(s);

function markdownInline(s: string) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .trim();
}

/**
 * Pasted draft. Accepts HTML fragments or Markdown / plain text. Title and
 * meta description are given as separate fields because a draft has no <head>.
 */
export function documentFromDraft(
  draft: { title?: string | null; metaDescription?: string | null; body: string },
  siteHost: string | null,
): ContentDocument {
  const body = draft.body.slice(0, MAX_DRAFT_CHARS);
  const base = {
    source: "draft" as const,
    url: null,
    title: orNull(clean(draft.title)),
    metaDescription: orNull(clean(draft.metaDescription)),
    lang: null,
  };
  if (looksLikeHtml(body)) {
    const $ = cheerio.load(`<div id="__draft">${body}</div>`);
    const pseudo = siteHost ? `https://${siteHost}/` : null;
    return { ...base, ...fromCheerio($, $("#__draft").clone(), pseudo, siteHost) };
  }

  const headings: ContentHeading[] = [];
  const paragraphs: string[] = [];
  const links: ContentLink[] = [];
  const images: { alt: string | null }[] = [];
  let lists = 0;
  let inList = false;
  let buffer: string[] = [];
  const flush = () => {
    const t = clean(buffer.join(" "));
    if (t) paragraphs.push(t);
    buffer = [];
  };

  for (const m of body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)) images.push({ alt: clean(m[1]) || null });
  for (const m of body.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g)) {
    const href = m[2];
    const absolute = /^https?:\/\//i.test(href) ? normalizeUrl(href, href) : null;
    if (!absolute && !href.startsWith("/")) continue;
    links.push({ url: absolute ?? href, anchor: clean(m[1]).slice(0, 200), internal: absolute ? (siteHost ? isSameSite(absolute, siteHost) : false) : true });
  }

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    const li = /^([-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (!line) {
      flush();
      inList = false;
    } else if (h) {
      flush();
      inList = false;
      headings.push({ level: h[1].length, text: markdownInline(h[2]) });
    } else if (li) {
      flush();
      if (!inList) lists++;
      inList = true;
      paragraphs.push(markdownInline(li[2]));
    } else {
      inList = false;
      buffer.push(markdownInline(line));
    }
  }
  flush();
  const text = clean([...headings.map((x) => x.text), ...paragraphs].join(" "));
  return { ...base, headings, paragraphs, text, links, images, lists };
}
