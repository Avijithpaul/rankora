export interface MarketingFeature {
  slug: "seo-audit" | "keyword-research" | "analytics" | "rank-tracking";
  name: string;
  headline: string;
  intro: string;
  points: { title: string; body: string }[];
  dataNote: string;
}

export const MARKETING_FEATURES: MarketingFeature[] = [
  {
    slug: "seo-audit",
    name: "SEO Audit",
    headline: "A site audit you can actually explain",
    intro:
      "Rankora's crawler follows your internal links, reads robots.txt and sitemaps, and checks every page against 30+ documented rules. The score is a weighted sum of those checks — nothing more, nothing hidden.",
    points: [
      { title: "Technical checks", body: "Status codes, redirect chains, canonicals, robots directives, indexability, HTTPS and response time." },
      { title: "On-page checks", body: "Titles, meta descriptions, headings, duplicates, thin content, image ALT text and structured data." },
      { title: "Transparent score", body: "Every rule stores its weight, result, explanation and recommendation, so you can see exactly why the score moved." },
      { title: "Issues to tasks", body: "Turn any issue into an assignable task with a priority and due date, and track when it was fixed." },
    ],
    dataNote: "Audits run against your live site with a polite, configurable crawler that respects robots.txt.",
  },
  {
    slug: "keyword-research",
    name: "Keyword Research",
    headline: "Keyword ideas backed by real provider data",
    intro:
      "Start from a seed keyword and explore related terms, long-tail variations and questions, grouped into clusters and mapped to the pages that should rank.",
    points: [
      { title: "Related & long-tail", body: "Discover variations and questions people search for in your target country and language." },
      { title: "Metrics that matter", body: "Search volume, CPC, competition and difficulty from a connected SEO data provider." },
      { title: "Lists & clusters", body: "Save keywords, group them, map them to target URLs and export to CSV." },
      { title: "Search intent", body: "Classify keywords as informational, navigational, commercial or transactional." },
    ],
    dataNote: "Volumes and difficulty are only shown when a keyword data provider is connected — never estimated.",
  },
  {
    slug: "analytics",
    name: "Analytics",
    headline: "Search Console and GA4 in one place",
    intro:
      "Connect Google Search Console and Google Analytics 4 with read-only OAuth access. Rankora stores normalised daily history so you can compare periods and see which pages drive organic growth.",
    points: [
      { title: "Search performance", body: "Clicks, impressions, CTR and average position by query, page, country and device." },
      { title: "Traffic & engagement", body: "Users, sessions, engaged sessions, page views and channels from GA4." },
      { title: "Page-level view", body: "Combine audit issues, search metrics and organic traffic for every URL." },
      { title: "Period comparison", body: "Compare any date range to the previous period or the same period last year." },
    ],
    dataNote: "Data is labelled with its source. Nothing is shown as Google data unless it came from your connected account.",
  },
  {
    slug: "rank-tracking",
    name: "Rank Tracking",
    headline: "Know where you rank, every day",
    intro:
      "Track keywords by country, device and search engine. Rankora stores a daily snapshot so you can see history, best positions and movement over time.",
    points: [
      { title: "Daily snapshots", body: "Current, previous and best rank, plus the URL that ranks." },
      { title: "Distribution", body: "Top 3 / Top 10 / Top 20 / Top 100 breakdown and how it changes." },
      { title: "Movers", body: "Improved, dropped, new and lost keywords at a glance." },
      { title: "Groups", body: "Organise keywords by topic, product line or campaign." },
    ],
    dataNote: "Rankings come from a connected SERP data provider.",
  },
];
