/**
 * Catalog of SEO audit rules. Each rule is evaluated by the site analyzer
 * against real crawl data; the scoring engine (scoring.ts) turns results into
 * a weighted, explainable score. See docs/SEO-SCORING.md.
 */

export type Severity = "critical" | "warning" | "opportunity";
export type RuleScope = "site" | "page";
export type RuleCategory =
  | "crawlability"
  | "indexability"
  | "on_page"
  | "content"
  | "links"
  | "performance"
  | "mobile"
  | "structured_data"
  | "social"
  | "security";

export interface RuleDefinition {
  id: string;
  title: string;
  category: RuleCategory;
  /** Severity assigned when the rule fails. */
  severity: Severity;
  scope: RuleScope;
  /** Relative importance. Defaults come from severity (critical 10, warning 5, opportunity 2). */
  weight: number;
  explanation: string;
  recommendation: string;
}

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  warning: 5,
  opportunity: 2,
};

type RuleInput = Omit<RuleDefinition, "weight"> & { weight?: number };

const define = (r: RuleInput): RuleDefinition => ({ ...r, weight: r.weight ?? SEVERITY_WEIGHT[r.severity] });

export const RULES: readonly RuleDefinition[] = [
  // ---- security / crawlability (site-level) ---------------------------------
  define({
    id: "site.https",
    title: "Site is served over HTTPS",
    category: "security",
    severity: "critical",
    scope: "site",
    explanation: "Search engines favour secure pages and browsers warn users on plain HTTP.",
    recommendation: "Install a TLS certificate and redirect all HTTP URLs to HTTPS with a 301.",
  }),
  define({
    id: "site.robots_txt",
    title: "robots.txt is reachable",
    category: "crawlability",
    severity: "warning",
    scope: "site",
    explanation: "A valid robots.txt tells crawlers which areas to crawl and where your sitemap lives.",
    recommendation: "Serve /robots.txt with HTTP 200 and reference your XML sitemap in it.",
  }),
  define({
    id: "site.robots_blocks_all",
    title: "robots.txt does not block the whole site",
    category: "crawlability",
    severity: "critical",
    scope: "site",
    weight: 15,
    explanation: "A `Disallow: /` rule for all user agents prevents search engines from crawling any page.",
    recommendation: "Remove the blanket Disallow rule unless the site is intentionally private.",
  }),
  define({
    id: "site.sitemap",
    title: "XML sitemap is available",
    category: "crawlability",
    severity: "warning",
    scope: "site",
    explanation: "Sitemaps help search engines discover pages, especially deep or new ones.",
    recommendation: "Publish an XML sitemap (e.g. /sitemap.xml) and reference it in robots.txt.",
  }),
  define({
    id: "site.http_redirects_to_https",
    title: "HTTP version redirects to HTTPS",
    category: "security",
    severity: "warning",
    scope: "site",
    explanation: "Without a redirect, duplicate HTTP and HTTPS versions of the site can be indexed.",
    recommendation: "Add a permanent (301) redirect from http:// to https:// for every URL.",
  }),

  // ---- page status / indexability -------------------------------------------
  define({
    id: "page.status_4xx_5xx",
    title: "Pages return a successful status",
    category: "crawlability",
    severity: "critical",
    scope: "page",
    explanation: "Internal pages returning 4xx/5xx errors waste crawl budget and break user journeys.",
    recommendation: "Fix or remove broken pages and update links pointing at them.",
  }),
  define({
    id: "page.redirect_chain",
    title: "No redirect chains",
    category: "crawlability",
    severity: "warning",
    scope: "page",
    explanation: "Chains of two or more redirects slow down users and dilute link signals.",
    recommendation: "Point links and redirects directly at the final destination URL.",
  }),
  define({
    id: "page.noindex",
    title: "Indexable pages are not marked noindex",
    category: "indexability",
    severity: "warning",
    scope: "page",
    explanation: "Pages with a noindex directive will be dropped from search results.",
    recommendation: "Remove noindex from pages that should rank; keep it only on utility pages.",
  }),
  define({
    id: "page.canonical",
    title: "Canonical tag present and valid",
    category: "indexability",
    severity: "warning",
    scope: "page",
    explanation: "A self-referencing canonical consolidates duplicate URL variants into one indexed URL.",
    recommendation: "Add <link rel=\"canonical\"> pointing at the preferred, indexable URL.",
  }),
  define({
    id: "page.canonical_points_elsewhere",
    title: "Canonical does not point to a non-indexable URL",
    category: "indexability",
    severity: "critical",
    scope: "page",
    explanation: "A canonical pointing at a redirected, broken or noindex URL confuses indexing.",
    recommendation: "Make canonicals target a 200, indexable URL.",
  }),

  // ---- on-page metadata -----------------------------------------------------
  define({
    id: "page.title_missing",
    title: "Title tag present",
    category: "on_page",
    severity: "critical",
    scope: "page",
    explanation: "The title is the main headline shown in search results and a strong relevance signal.",
    recommendation: "Write a unique, descriptive <title> for every page.",
  }),
  define({
    id: "page.title_length",
    title: "Title length between 30 and 60 characters",
    category: "on_page",
    severity: "opportunity",
    scope: "page",
    explanation: "Very short titles under-describe the page; long ones get truncated in results.",
    recommendation: "Keep titles roughly 30–60 characters with the main keyword near the start.",
  }),
  define({
    id: "page.title_duplicate",
    title: "Titles are unique",
    category: "on_page",
    severity: "warning",
    scope: "page",
    explanation: "Duplicate titles make it hard for search engines to tell pages apart.",
    recommendation: "Give each page a distinct title reflecting its specific content.",
  }),
  define({
    id: "page.meta_description_missing",
    title: "Meta description present",
    category: "on_page",
    severity: "warning",
    scope: "page",
    explanation: "Descriptions are often used as the search snippet and influence click-through rate.",
    recommendation: "Add a compelling meta description summarising the page.",
  }),
  define({
    id: "page.meta_description_length",
    title: "Meta description between 70 and 160 characters",
    category: "on_page",
    severity: "opportunity",
    scope: "page",
    explanation: "Descriptions outside this range are often rewritten or truncated by search engines.",
    recommendation: "Aim for 70–160 characters that describe the page and invite the click.",
  }),
  define({
    id: "page.meta_description_duplicate",
    title: "Meta descriptions are unique",
    category: "on_page",
    severity: "opportunity",
    scope: "page",
    explanation: "Repeated descriptions reduce snippet relevance across pages.",
    recommendation: "Write a unique description per page.",
  }),
  define({
    id: "page.h1_missing",
    title: "Page has an H1 heading",
    category: "on_page",
    severity: "warning",
    scope: "page",
    explanation: "The H1 communicates the page's main topic to users and search engines.",
    recommendation: "Add exactly one H1 that states the page topic.",
  }),
  define({
    id: "page.h1_multiple",
    title: "Only one H1 per page",
    category: "on_page",
    severity: "opportunity",
    scope: "page",
    explanation: "Multiple H1s blur the main topic of the page.",
    recommendation: "Keep one H1 and demote other headings to H2/H3.",
  }),
  define({
    id: "page.heading_hierarchy",
    title: "Heading levels are not skipped",
    category: "on_page",
    severity: "opportunity",
    scope: "page",
    explanation: "Skipping levels (e.g. H1 → H3) weakens document structure and accessibility.",
    recommendation: "Use headings in order: H1, then H2, then H3.",
  }),
  define({
    id: "page.lang",
    title: "HTML lang attribute set",
    category: "on_page",
    severity: "opportunity",
    scope: "page",
    explanation: "The lang attribute helps search engines and screen readers interpret the language.",
    recommendation: "Set <html lang=\"…\"> to the page's language code.",
  }),

  // ---- content --------------------------------------------------------------
  define({
    id: "page.thin_content",
    title: "Pages have substantial content (≥ 250 words)",
    category: "content",
    severity: "warning",
    scope: "page",
    explanation: "Thin pages rarely satisfy search intent and may be treated as low quality.",
    recommendation: "Expand thin pages with useful, original content, or consolidate them.",
  }),
  define({
    id: "page.duplicate_content",
    title: "No exact duplicate pages",
    category: "content",
    severity: "warning",
    scope: "page",
    explanation: "Identical content on multiple URLs splits ranking signals.",
    recommendation: "Canonicalise or redirect duplicates to one URL.",
  }),
  define({
    id: "page.image_alt",
    title: "Images have ALT text",
    category: "content",
    severity: "opportunity",
    scope: "page",
    explanation: "ALT text makes images accessible and lets them rank in image search.",
    recommendation: "Describe each meaningful image in its alt attribute.",
  }),

  // ---- links ----------------------------------------------------------------
  define({
    id: "page.broken_internal_links",
    title: "No broken internal links",
    category: "links",
    severity: "critical",
    scope: "page",
    explanation: "Links to missing pages frustrate visitors and waste crawl budget.",
    recommendation: "Update or remove links that point to 4xx/5xx URLs.",
  }),
  define({
    id: "page.broken_external_links",
    title: "No broken external links",
    category: "links",
    severity: "opportunity",
    scope: "page",
    explanation: "Dead outbound links hurt user experience and perceived quality.",
    recommendation: "Replace or remove external links that no longer resolve.",
  }),
  define({
    id: "page.orphan",
    title: "Pages are linked internally",
    category: "links",
    severity: "warning",
    scope: "page",
    explanation: "Pages found only in the sitemap with no internal links are hard to discover and rank.",
    recommendation: "Link to important pages from relevant content and navigation.",
  }),
  define({
    id: "page.url_structure",
    title: "Clean URL structure",
    category: "links",
    severity: "opportunity",
    scope: "page",
    explanation: "Short, lower-case, hyphenated URLs without excessive parameters are easier to understand.",
    recommendation: "Use readable slugs; avoid uppercase, underscores and long query strings.",
  }),

  // ---- performance / mobile -------------------------------------------------
  define({
    id: "page.response_time",
    title: "Server responds in under 1 second",
    category: "performance",
    severity: "warning",
    scope: "page",
    explanation: "Slow server responses delay rendering and hurt Core Web Vitals.",
    recommendation: "Add caching, optimise backend queries or use a CDN.",
  }),
  define({
    id: "site.core_web_vitals",
    title: "Core Web Vitals (PageSpeed) are good",
    category: "performance",
    severity: "warning",
    scope: "site",
    weight: 8,
    explanation: "Google uses LCP, INP and CLS field data as page experience signals.",
    recommendation: "Review the PageSpeed Insights diagnostics for the home page and fix the largest opportunities.",
  }),
  define({
    id: "page.viewport",
    title: "Mobile viewport meta tag",
    category: "mobile",
    severity: "critical",
    scope: "page",
    explanation: "Without a viewport tag, pages render as desktop pages on phones.",
    recommendation: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.",
  }),

  // ---- structured data / social ---------------------------------------------
  define({
    id: "page.structured_data",
    title: "Structured data present",
    category: "structured_data",
    severity: "opportunity",
    scope: "page",
    explanation: "Schema.org markup can enable rich results and clarifies page entities.",
    recommendation: "Add relevant JSON-LD (Organization, Article, Product, FAQ, Breadcrumb…).",
  }),
  define({
    id: "page.open_graph",
    title: "Open Graph tags present",
    category: "social",
    severity: "opportunity",
    scope: "page",
    explanation: "Open Graph tags control how pages appear when shared on social platforms.",
    recommendation: "Add og:title, og:description, og:image and og:url.",
  }),
  define({
    id: "page.twitter_card",
    title: "Twitter/X card tags present",
    category: "social",
    severity: "opportunity",
    scope: "page",
    weight: 1,
    explanation: "Twitter card tags improve previews on X.",
    recommendation: "Add twitter:card (and optionally twitter:title / twitter:image).",
  }),
] as const;

export const RULES_BY_ID: ReadonlyMap<string, RuleDefinition> = new Map(RULES.map((r) => [r.id, r]));

export function getRule(id: string): RuleDefinition {
  const rule = RULES_BY_ID.get(id);
  if (!rule) throw new Error(`Unknown SEO rule: ${id}`);
  return rule;
}
