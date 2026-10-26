/**
 * Single source of truth for application modules: sidebar navigation, the
 * generic module route, and the honest "planned" status of unbuilt modules.
 */
export type ModuleStatus = "live" | "planned";

export interface SiteModule {
  slug: string;
  label: string;
  group: "Overview" | "Research" | "Optimize" | "Manage";
  icon: string; // lucide icon name, resolved in the client sidebar
  status: ModuleStatus;
  phase?: string;
  summary: string;
}

export const SITE_MODULES: SiteModule[] = [
  { slug: "dashboard", label: "Dashboard", group: "Overview", icon: "LayoutDashboard", status: "live", summary: "SEO health, traffic and priorities at a glance." },
  { slug: "analytics", label: "Analytics", group: "Overview", icon: "BarChart3", status: "planned", phase: "Phase 4", summary: "Users, sessions, engagement, channels and landing pages from your connected GA4 property." },
  { slug: "search-performance", label: "Search Performance", group: "Overview", icon: "TrendingUp", status: "planned", phase: "Phase 4", summary: "Clicks, impressions, CTR and average position from Google Search Console, with date comparison." },
  { slug: "keyword-research", label: "Keyword Research", group: "Research", icon: "Search", status: "live", summary: "Related, long-tail and question keywords with volume, CPC and difficulty from a connected keyword data provider." },
  { slug: "keywords", label: "Saved Keywords", group: "Research", icon: "Bookmark", status: "live", summary: "Keyword lists, clusters and target-page mapping, with CSV export." },
  { slug: "rank-tracker", label: "Rank Tracker", group: "Research", icon: "LineChart", status: "live", summary: "Daily rank snapshots by country, device and search engine, with history charts and distribution." },
  { slug: "competitors", label: "Competitors", group: "Research", icon: "Swords", status: "planned", phase: "Phase 6", summary: "Competitor domains, keyword overlap and gaps, ranking and audit comparisons." },
  { slug: "backlinks", label: "Backlinks", group: "Research", icon: "Link2", status: "planned", phase: "Phase 6", summary: "Backlinks, referring domains and anchors — only when a backlink data provider is connected." },
  { slug: "audit", label: "Site Audit", group: "Optimize", icon: "ScanSearch", status: "live", summary: "Crawl the site, evaluate 30+ rules and compute a transparent weighted SEO score." },
  { slug: "technical", label: "Technical SEO", group: "Optimize", icon: "Wrench", status: "live", summary: "Indexability, redirects, canonicals, robots.txt, sitemaps and Core Web Vitals." },
  { slug: "pages", label: "Pages", group: "Optimize", icon: "FileText", status: "live", summary: "Per-URL SEO score, issues, internal links and — once connected — traffic and search metrics." },
  { slug: "content", label: "Content Optimizer", group: "Optimize", icon: "PenLine", status: "planned", phase: "Phase 5", summary: "Analyze a URL or draft against a target keyword: headings, placement, length, readability, metadata." },
  { slug: "tasks", label: "SEO Tasks", group: "Manage", icon: "ListChecks", status: "planned", phase: "Phase 5", summary: "Turn audit issues into assignable tasks with priority, status and due dates." },
  { slug: "reports", label: "Reports", group: "Manage", icon: "FileBarChart", status: "planned", phase: "Phase 6", summary: "Overview, audit, traffic, ranking and monthly reports with comparison periods and print view." },
  { slug: "integrations", label: "Integrations", group: "Manage", icon: "Plug", status: "planned", phase: "Phase 4", summary: "Connect Google Search Console, GA4, PageSpeed Insights and SEO data providers." },
  { slug: "settings", label: "Site Settings", group: "Manage", icon: "Settings2", status: "live", summary: "Website details, crawl configuration and deletion." },
];

export const MODULE_BY_SLUG = new Map(SITE_MODULES.map((m) => [m.slug, m]));

export const ORG_NAV = [
  { href: "websites", label: "Websites", icon: "Globe" },
  { href: "settings", label: "Organization", icon: "Building2" },
  { href: "billing", label: "Plan & Billing", icon: "CreditCard" },
] as const;
