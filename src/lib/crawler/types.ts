import type { ParsedPage } from "./parse-page";

export type CrawlPhase = "discovery" | "crawling" | "link_check" | "pagespeed" | "analyzing" | "done";

export interface CrawlConfig {
  siteHost: string;
  baseUrl: string;
  maxPages: number;
  maxDepth: number;
  crawlDelayMs: number;
  respectRobotsTxt: boolean;
  checkExternalLinks: boolean;
  excludePatterns: string[];
  userAgent: string;
  /** max fetch attempts per URL (network errors, 429, 5xx) */
  maxAttempts: number;
  /** cap on external link checks per crawl */
  maxExternalChecks: number;
}

/** Site-level facts gathered during discovery; stored in crawl_jobs.state. */
export interface CrawlState {
  robots?: {
    url: string;
    status: number | null;
    found: boolean;
    error?: string;
    blocksAll: boolean;
    sitemaps: string[];
    crawlDelaySeconds: number | null;
    /** first 20 KB, for display */
    excerpt?: string;
  };
  sitemap?: { found: boolean; sources: string[]; urlCount: number; errors: string[] };
  https?: { siteIsHttps: boolean; httpRedirectsToHttps: boolean | null; detail?: string };
  externalChecked?: number;
  pagespeed?: PageSpeedResult | { skipped: string };
}

export interface PageSpeedResult {
  url: string;
  strategy: "mobile";
  performanceScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  inpMs: number | null;
  fieldDataAvailable: boolean;
  fetchedAt: string;
}

export interface PendingPage {
  id: string;
  url: string;
  depth: number;
  attempts: number;
}

export interface FetchSuccess {
  ok: true;
  status: number;
  finalUrl: string;
  redirectChain: { url: string; status: number }[];
  contentType: string | null;
  xRobotsTag: string | null;
  contentLength: number | null;
  body: string;
  truncated: boolean;
  responseTimeMs: number;
}

export interface FetchFailure {
  ok: false;
  error: string;
  retryable: boolean;
  /** blocked by SSRF protection */
  unsafe?: boolean;
}

export type FetchResult = FetchSuccess | FetchFailure;

export type Fetcher = (url: string, opts?: { method?: "GET" | "HEAD"; timeoutMs?: number; accept?: string }) => Promise<FetchResult>;

export interface SavedPage {
  fetchState: "fetched" | "failed" | "skipped";
  statusCode: number | null;
  finalUrl: string | null;
  redirectChain: { url: string; status: number }[];
  contentType: string | null;
  responseTimeMs: number | null;
  contentLength: number | null;
  fetchError: string | null;
  skipReason: string | null;
  xRobotsTag: string | null;
  attempts: number;
  parsed: ParsedPage | null;
  isIndexable: boolean | null;
  indexabilityReason: string | null;
}

export interface NewLink {
  targetUrl: string;
  isInternal: boolean;
  isNofollow: boolean;
  anchorText: string;
}

export interface QueueEntry {
  url: string;
  depth: number;
  foundInSitemap?: boolean;
  foundViaLink?: boolean;
}

/** Persistence used by the engine. Implemented for Supabase and in memory (tests). */
export interface CrawlStore {
  /** rows in the crawl (pending + done), used for the max-pages cap */
  countPages(): Promise<number>;
  countFetched(): Promise<number>;
  /** inserts URLs not yet in this crawl; returns how many were added */
  enqueue(entries: QueueEntry[]): Promise<number>;
  /** marks existing rows as found in sitemap / via link */
  markFound(urls: string[], how: "sitemap" | "link"): Promise<void>;
  nextPending(limit: number): Promise<PendingPage[]>;
  savePage(id: string, page: SavedPage): Promise<void>;
  retryLater(id: string, attempts: number, error: string): Promise<void>;
  saveLinks(pageId: string, links: NewLink[]): Promise<void>;
  uncheckedExternalTargets(limit: number): Promise<string[]>;
  setExternalStatus(targetUrl: string, status: number | null, error: string | null): Promise<void>;
}
