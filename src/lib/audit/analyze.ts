/**
 * Site analyzer: turns stored crawl facts into one RuleEvaluation per rule in
 * the catalog. Pure and deterministic; the scoring engine computes the score.
 * Thresholds here are documented in docs/SEO-SCORING.md.
 */
import type { RuleEvaluation } from "@/lib/seo/scoring";
import { RULES } from "@/lib/seo/rules";
import type { CrawlState, PageSpeedResult } from "@/lib/crawler/types";
import { urlStructureProblems } from "@/lib/crawler/url";

export const THRESHOLDS = {
  titleMin: 30,
  titleMax: 60,
  descriptionMin: 70,
  descriptionMax: 160,
  thinContentWords: 250,
  slowResponseMs: 1000,
  lcpMs: 2500,
  cls: 0.1,
  tbtMs: 300,
  inpMs: 200,
  maxAffectedUrls: 200,
} as const;

export interface AnalyzerPage {
  url: string;
  depth: number;
  fetchState: "pending" | "fetched" | "failed" | "skipped";
  statusCode: number | null;
  /** status of the final response after redirects */
  finalStatus: number | null;
  redirectHops: number;
  contentType: string | null;
  responseTimeMs: number | null;
  isIndexable: boolean | null;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  headingSkips: number;
  canonical: string | null;
  canonicalInvalid: boolean;
  noindex: boolean;
  lang: string | null;
  hasViewport: boolean;
  wordCount: number | null;
  contentHash: string | null;
  imagesTotal: number;
  imagesMissingAlt: number;
  structuredDataTypes: string[];
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  foundInSitemap: boolean;
}

export interface AnalyzerLink {
  sourceUrl: string;
  targetUrl: string;
  isInternal: boolean;
  targetStatus: number | null;
  targetError: string | null;
}

export interface SiteFacts {
  baseUrl: string;
  state: CrawlState;
  checkExternalLinks: boolean;
}

type Eval = RuleEvaluation;

const cap = (urls: string[]) => [...new Set(urls)].slice(0, THRESHOLDS.maxAffectedUrls);
const na = (ruleId: string, reason: string): Eval => ({ ruleId, applicable: false, affected: 0, total: 0, details: { reason } });
function pageRule(ruleId: string, population: AnalyzerPage[], failing: (p: AnalyzerPage) => boolean, details?: Record<string, unknown>): Eval {
  if (population.length === 0) return na(ruleId, "No pages to evaluate");
  const bad = population.filter(failing);
  return { ruleId, applicable: true, affected: bad.length, total: population.length, affectedUrls: cap(bad.map((p) => p.url)), details };
}
const siteRule = (ruleId: string, failed: boolean, details?: Record<string, unknown>): Eval => ({
  ruleId,
  applicable: true,
  affected: failed ? 1 : 0,
  total: 1,
  details,
});

function duplicates(pages: AnalyzerPage[], key: (p: AnalyzerPage) => string | null) {
  const groups = new Map<string, AnalyzerPage[]>();
  for (const p of pages) {
    const k = key(p);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const dup = new Set<string>();
  for (const g of groups.values()) if (g.length > 1) g.forEach((p) => dup.add(p.url));
  return dup;
}

const isHtml = (p: AnalyzerPage) => !p.contentType || /text\/html|xhtml/i.test(p.contentType);

export function evaluateCoreWebVitals(psi: PageSpeedResult) {
  const failures: string[] = [];
  if (psi.lcpMs !== null && psi.lcpMs > THRESHOLDS.lcpMs) failures.push(`LCP ${(psi.lcpMs / 1000).toFixed(1)} s > 2.5 s`);
  if (psi.cls !== null && psi.cls > THRESHOLDS.cls) failures.push(`CLS ${psi.cls.toFixed(2)} > 0.1`);
  if (psi.inpMs !== null && psi.inpMs > THRESHOLDS.inpMs) failures.push(`INP ${psi.inpMs} ms > 200 ms`);
  else if (psi.inpMs === null && psi.tbtMs !== null && psi.tbtMs > THRESHOLDS.tbtMs) failures.push(`TBT ${psi.tbtMs} ms > 300 ms (lab proxy for INP)`);
  return failures;
}

export function analyzeSite(pages: AnalyzerPage[], links: AnalyzerLink[], site: SiteFacts): Eval[] {
  const fetched = pages.filter((p) => p.fetchState === "fetched" || p.fetchState === "failed");
  // "Content pages": successfully fetched HTML documents that were not redirects.
  const content = pages.filter((p) => p.fetchState === "fetched" && p.redirectHops === 0 && p.finalStatus === 200 && isHtml(p));
  const indexable = content.filter((p) => p.isIndexable);
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const { state } = site;

  const evals: Eval[] = [];

  // ---- site-level ------------------------------------------------------------
  const siteIsHttps = site.baseUrl.startsWith("https:");
  evals.push(siteRule("site.https", !siteIsHttps, { baseUrl: site.baseUrl }));
  evals.push(
    !siteIsHttps
      ? na("site.http_redirects_to_https", "Site is not served over HTTPS")
      : state.https?.httpRedirectsToHttps === null || state.https?.httpRedirectsToHttps === undefined
        ? na("site.http_redirects_to_https", state.https?.detail ?? "HTTP version could not be checked")
        : siteRule("site.http_redirects_to_https", !state.https.httpRedirectsToHttps, { detail: state.https.detail }),
  );
  if (!state.robots) {
    evals.push(na("site.robots_txt", "robots.txt was not checked"), na("site.robots_blocks_all", "robots.txt was not checked"));
  } else {
    evals.push(siteRule("site.robots_txt", !state.robots.found, { status: state.robots.status, error: state.robots.error }));
    evals.push(siteRule("site.robots_blocks_all", state.robots.blocksAll));
  }
  evals.push(
    state.sitemap
      ? siteRule("site.sitemap", !state.sitemap.found, { sources: state.sitemap.sources, urlCount: state.sitemap.urlCount, errors: state.sitemap.errors })
      : na("site.sitemap", "Sitemaps were not checked"),
  );
  const psi = state.pagespeed;
  if (psi && "performanceScore" in psi) {
    const failures = evaluateCoreWebVitals(psi);
    evals.push(siteRule("site.core_web_vitals", failures.length > 0, { ...psi, failures }));
  } else {
    evals.push(na("site.core_web_vitals", psi && "skipped" in psi ? psi.skipped : "PageSpeed Insights not run"));
  }

  // ---- status & redirects ------------------------------------------------------
  evals.push(
    pageRule("page.status_4xx_5xx", fetched, (p) => p.fetchState === "failed" || (p.finalStatus ?? 0) >= 400, {
      note: "Includes pages that could not be fetched (timeouts, DNS or connection errors).",
    }),
  );
  evals.push(pageRule("page.redirect_chain", fetched.filter((p) => p.fetchState === "fetched"), (p) => p.redirectHops >= 2));

  // ---- indexability -----------------------------------------------------------
  evals.push(pageRule("page.noindex", content, (p) => p.noindex));
  evals.push(pageRule("page.canonical", content.filter((p) => !p.noindex), (p) => !p.canonical || p.canonicalInvalid));
  const canonicalElsewhere = content.filter((p) => p.canonical && p.canonical !== p.url && byUrl.has(p.canonical));
  evals.push(
    canonicalElsewhere.length === 0
      ? na("page.canonical_points_elsewhere", "No canonicals point to other crawled URLs")
      : pageRule("page.canonical_points_elsewhere", canonicalElsewhere, (p) => {
          const target = byUrl.get(p.canonical!)!;
          return target.fetchState !== "fetched" || target.redirectHops > 0 || target.finalStatus !== 200 || target.noindex;
        }),
  );

  // ---- metadata ---------------------------------------------------------------
  evals.push(pageRule("page.title_missing", content, (p) => !p.title));
  const titled = content.filter((p) => p.title);
  evals.push(pageRule("page.title_length", titled, (p) => p.title!.length < THRESHOLDS.titleMin || p.title!.length > THRESHOLDS.titleMax));
  const dupTitles = duplicates(indexable, (p) => p.title?.toLowerCase() ?? null);
  evals.push(pageRule("page.title_duplicate", indexable.filter((p) => p.title), (p) => dupTitles.has(p.url)));

  evals.push(pageRule("page.meta_description_missing", content, (p) => !p.metaDescription));
  const described = content.filter((p) => p.metaDescription);
  evals.push(
    pageRule(
      "page.meta_description_length",
      described,
      (p) => p.metaDescription!.length < THRESHOLDS.descriptionMin || p.metaDescription!.length > THRESHOLDS.descriptionMax,
    ),
  );
  const dupDesc = duplicates(indexable, (p) => p.metaDescription?.toLowerCase() ?? null);
  evals.push(pageRule("page.meta_description_duplicate", indexable.filter((p) => p.metaDescription), (p) => dupDesc.has(p.url)));

  evals.push(pageRule("page.h1_missing", content, (p) => !p.h1.some((h) => h.length > 0)));
  evals.push(pageRule("page.h1_multiple", content, (p) => p.h1.length > 1));
  evals.push(pageRule("page.heading_hierarchy", content, (p) => p.headingSkips > 0));
  evals.push(pageRule("page.lang", content, (p) => !p.lang));

  // ---- content ----------------------------------------------------------------
  evals.push(pageRule("page.thin_content", indexable, (p) => (p.wordCount ?? 0) < THRESHOLDS.thinContentWords, { minWords: THRESHOLDS.thinContentWords }));
  const dupContent = duplicates(indexable, (p) => p.contentHash);
  evals.push(pageRule("page.duplicate_content", indexable, (p) => dupContent.has(p.url)));
  evals.push(pageRule("page.image_alt", content.filter((p) => p.imagesTotal > 0), (p) => p.imagesMissingAlt > 0));

  // ---- links ------------------------------------------------------------------
  const brokenTargets = new Set(
    pages.filter((p) => p.fetchState === "failed" || (p.fetchState === "fetched" && (p.statusCode ?? 0) >= 400)).map((p) => p.url),
  );
  const internalBySource = new Map<string, AnalyzerLink[]>();
  const externalBySource = new Map<string, AnalyzerLink[]>();
  for (const l of links) {
    const m = l.isInternal ? internalBySource : externalBySource;
    m.set(l.sourceUrl, [...(m.get(l.sourceUrl) ?? []), l]);
  }
  evals.push(
    pageRule(
      "page.broken_internal_links",
      content.filter((p) => internalBySource.has(p.url)),
      (p) => internalBySource.get(p.url)!.some((l) => brokenTargets.has(l.targetUrl)),
      { note: "Only links to URLs that were crawled can be verified." },
    ),
  );
  const checkedExternal = links.filter((l) => !l.isInternal && (l.targetStatus !== null || l.targetError !== null));
  evals.push(
    !site.checkExternalLinks
      ? na("page.broken_external_links", "External link checking is turned off in crawl settings")
      : checkedExternal.length === 0
        ? na("page.broken_external_links", "No external links were checked")
        : pageRule(
            "page.broken_external_links",
            content.filter((p) => (externalBySource.get(p.url) ?? []).some((l) => l.targetStatus !== null || l.targetError !== null)),
            (p) => externalBySource.get(p.url)!.some((l) => (l.targetStatus ?? 0) >= 400 || l.targetError !== null),
          ),
  );
  // Orphans: pages listed in the sitemap that no crawled page links to.
  const inbound = new Set(links.filter((l) => l.isInternal && l.sourceUrl !== l.targetUrl).map((l) => l.targetUrl));
  const sitemapPages = content.filter((p) => p.foundInSitemap && p.depth > 0);
  evals.push(
    !state.sitemap?.found || sitemapPages.length === 0
      ? na("page.orphan", "Orphan detection needs a sitemap with crawled pages")
      : pageRule("page.orphan", sitemapPages, (p) => !inbound.has(p.url)),
  );
  evals.push(pageRule("page.url_structure", fetched, (p) => urlStructureProblems(p.url).length > 0));

  // ---- performance / mobile -----------------------------------------------------
  evals.push(
    pageRule(
      "page.response_time",
      fetched.filter((p) => p.responseTimeMs !== null),
      (p) => (p.responseTimeMs ?? 0) > THRESHOLDS.slowResponseMs,
      { thresholdMs: THRESHOLDS.slowResponseMs, note: "Measured from Rankora's crawler, including network latency." },
    ),
  );
  evals.push(pageRule("page.viewport", content, (p) => !p.hasViewport));

  // ---- structured data / social -------------------------------------------------
  evals.push(pageRule("page.structured_data", indexable, (p) => p.structuredDataTypes.length === 0));
  evals.push(pageRule("page.open_graph", indexable, (p) => !p.openGraph.title || !p.openGraph.description || !p.openGraph.image));
  evals.push(pageRule("page.twitter_card", indexable, (p) => !p.twitterCard.card));

  // Safety net: every catalog rule must be evaluated exactly once.
  const ids = new Set(evals.map((e) => e.ruleId));
  for (const r of RULES) if (!ids.has(r.id)) throw new Error(`Analyzer did not evaluate rule ${r.id}`);
  return evals;
}
