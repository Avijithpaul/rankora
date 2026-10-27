/**
 * Page Explorer recommendations: combines crawl facts with Search Console and
 * GA4 metrics for one URL. Rule-based and pure; every recommendation states
 * the numbers that triggered it. Metrics are null when a source is not
 * connected, and rules that need them are then skipped (never guessed).
 */
import { THRESHOLDS } from "@/lib/audit/analyze";

export interface PageFacts {
  isIndexable: boolean | null;
  statusCode: number | null;
  depth: number;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  wordCount: number | null;
  inboundLinks: number | null;
  openIssues: number;
  targetKeywords: number;
}

export interface SearchMetrics {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

export interface PageRecommendation {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function pageRecommendations(page: PageFacts, gsc: SearchMetrics | null, views: number | null): PageRecommendation[] {
  const out: PageRecommendation[] = [];
  const add = (r: PageRecommendation) => out.push(r);
  const ok = (page.statusCode ?? 0) >= 200 && (page.statusCode ?? 0) < 300;

  if (page.isIndexable === false && gsc && gsc.impressions > 0) {
    add({ id: "noindex_with_demand", priority: "high", title: "Indexing is blocked on a page that gets impressions", detail: `${gsc.impressions} impressions in the period, but the page is not indexable. Confirm this is intended; otherwise remove the noindex/canonical blocker.` });
  }
  if (gsc && ok && page.isIndexable !== false) {
    if (gsc.impressions >= 100 && gsc.position !== null && gsc.position <= 10 && gsc.ctr !== null && gsc.ctr < 0.02) {
      add({ id: "low_ctr", priority: "high", title: "Low click-through rate for a first-page position", detail: `Average position ${gsc.position.toFixed(1)} with ${gsc.impressions} impressions but only ${pct(gsc.ctr)} CTR. Rewrite the title and meta description to match the searcher's intent.` });
    }
    if (gsc.impressions >= 50 && gsc.position !== null && gsc.position > 8 && gsc.position <= 20) {
      add({ id: "striking_distance", priority: "medium", title: "Close to page one", detail: `Average position ${gsc.position.toFixed(1)} with ${gsc.impressions} impressions. Improving content depth and adding internal links from related pages can move it up.` });
    }
    if (gsc.impressions === 0 && page.isIndexable) {
      add({ id: "no_impressions", priority: "medium", title: "No search impressions in this period", detail: "Search Console recorded no impressions for this exact URL. Check it with the URL Inspection tool and make sure it targets a query people search for." });
    }
  }
  if (page.targetKeywords === 0 && ok && page.isIndexable !== false) {
    add({ id: "no_keyword", priority: "medium", title: "No target keyword mapped", detail: "No saved keyword targets or currently ranks with this URL. Assign one in Saved Keywords so you can track and optimize it." });
  }
  if (page.openIssues > 0) {
    add({ id: "open_issues", priority: page.openIssues >= 3 ? "high" : "medium", title: `${page.openIssues} open audit issue${page.openIssues > 1 ? "s" : ""}`, detail: "Fix the issues listed on this page; they are counted in the site's SEO score." });
  }
  if (ok && page.isIndexable !== false) {
    if (!page.title) add({ id: "title_missing", priority: "high", title: "Missing title tag", detail: "Add a unique title that describes the page and contains its main keyword." });
    else if (page.title.length < THRESHOLDS.titleMin || page.title.length > THRESHOLDS.titleMax)
      add({ id: "title_length", priority: "low", title: "Title length outside the recommended range", detail: `${page.title.length} characters (recommended ${THRESHOLDS.titleMin}–${THRESHOLDS.titleMax}).` });
    if (!page.metaDescription) add({ id: "meta_missing", priority: "medium", title: "Missing meta description", detail: "Write a description that summarises the page; it is often used as the search snippet." });
    if (page.h1Count !== 1) add({ id: "h1", priority: "low", title: page.h1Count === 0 ? "No H1 heading" : "Several H1 headings", detail: `${page.h1Count} H1 headings found; use exactly one for the main topic.` });
    if (page.wordCount !== null && page.wordCount < THRESHOLDS.thinContentWords)
      add({ id: "thin", priority: views !== null && views > 100 ? "high" : "medium", title: "Thin content", detail: `${page.wordCount} words${views !== null ? ` on a page with ${views} views` : ""}. Expand it so it fully answers the visitor's question — use the Content Optimizer.` });
    if (page.depth > 0 && (page.inboundLinks ?? 0) === 0)
      add({ id: "no_inlinks", priority: "medium", title: "No internal links point here", detail: "Crawled pages do not link to this URL, so visitors and search engines rarely reach it. Link to it from related pages." });
    else if (page.depth > 3) add({ id: "deep", priority: "low", title: "Deep in the site structure", detail: `${page.depth} clicks from the start page. Important pages should be reachable within 3 clicks.` });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}
