/**
 * Resumable, time-boxed crawl engine.
 *
 * One call to `runCrawlTick` advances a crawl as far as its time budget allows
 * and returns the next phase. State lives in the store + CrawlState, so ticks
 * can run in separate short serverless invocations.
 *
 *   discovery  → robots.txt, sitemaps, HTTP→HTTPS check, seed the frontier
 *   crawling   → fetch pending URLs (same site, depth/page limits, robots, excludes, retries)
 *   link_check → optional HEAD checks of external link targets
 *   pagespeed  → (handled by the audit service)
 */
import { blocksEverything, crawlDelaySeconds, isAllowed, parseRobots, type RobotsTxt } from "./robots";
import { parseSitemap } from "./sitemap";
import { parsePage } from "./parse-page";
import { isExcluded, isSameSite, looksLikePage, normalizeUrl } from "./url";
import type { CrawlConfig, CrawlPhase, CrawlState, CrawlStore, Fetcher, FetchSuccess, PendingPage, SavedPage } from "./types";

export interface TickInput {
  phase: CrawlPhase;
  state: CrawlState;
  config: CrawlConfig;
  store: CrawlStore;
  fetcher: Fetcher;
  /** ms available for this tick */
  budgetMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface TickResult {
  phase: CrawlPhase;
  state: CrawlState;
  pagesCrawled: number;
  pagesDiscovered: number;
}

const MAX_SITEMAP_DOCS = 6;
const CONCURRENCY = 3;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isHtml(contentType: string | null) {
  return !contentType || /text\/html|application\/xhtml\+xml/i.test(contentType);
}

let cachedRobots: { text: string; parsed: RobotsTxt } | null = null;
function robotsFromState(state: CrawlState): RobotsTxt | null {
  const text = state.robots?.excerpt;
  if (!state.robots?.found || text === undefined) return null;
  if (cachedRobots?.text !== text) cachedRobots = { text, parsed: parseRobots(text) };
  return cachedRobots.parsed;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
async function discover(input: TickInput): Promise<CrawlState> {
  const { config, fetcher, store } = input;
  const state: CrawlState = { ...input.state };
  const origin = new URL(config.baseUrl).origin;

  // robots.txt
  const robotsUrl = `${origin}/robots.txt`;
  const r = await fetcher(robotsUrl, { accept: "text/plain,*/*;q=0.5" });
  let robots: RobotsTxt | null = null;
  if (r.ok && r.status === 200 && !/text\/html/i.test(r.contentType ?? "")) {
    const excerpt = r.body.slice(0, 20_000);
    robots = parseRobots(excerpt);
    state.robots = {
      url: robotsUrl,
      status: r.status,
      found: true,
      blocksAll: blocksEverything(robots, config.userAgent),
      sitemaps: robots.sitemaps,
      crawlDelaySeconds: crawlDelaySeconds(robots, config.userAgent),
      excerpt,
    };
  } else {
    state.robots = {
      url: robotsUrl,
      status: r.ok ? r.status : null,
      found: false,
      error: r.ok ? (r.status === 200 ? "robots.txt returned HTML instead of plain text" : `HTTP ${r.status}`) : r.error,
      blocksAll: false,
      sitemaps: [],
      crawlDelaySeconds: null,
    };
  }

  // HTTP -> HTTPS
  const siteIsHttps = config.baseUrl.startsWith("https:");
  if (siteIsHttps) {
    const httpUrl = config.baseUrl.replace(/^https:/, "http:");
    const h = await fetcher(httpUrl, { method: "HEAD", timeoutMs: 8000 });
    state.https = h.ok
      ? { siteIsHttps, httpRedirectsToHttps: h.finalUrl.startsWith("https:"), detail: `HTTP version ends at ${h.finalUrl}` }
      : { siteIsHttps, httpRedirectsToHttps: null, detail: h.error };
  } else {
    state.https = { siteIsHttps, httpRedirectsToHttps: null };
  }

  // Sitemaps (robots-declared first, then conventional locations)
  const candidates = [...new Set([...(state.robots.sitemaps ?? []), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])];
  const sitemapUrls: string[] = [];
  const sources: string[] = [];
  const errors: string[] = [];
  const queue = candidates.filter((u) => isSameSite(u, config.siteHost));
  let docs = 0;
  const cap = config.maxPages * 3;
  while (queue.length && docs < MAX_SITEMAP_DOCS && sitemapUrls.length < cap) {
    const url = queue.shift()!;
    if (/\.gz($|\?)/i.test(url)) {
      errors.push(`${url}: gzipped sitemaps are not supported yet`);
      continue;
    }
    docs++;
    const s = await fetcher(url, { accept: "application/xml,text/xml;q=0.9,*/*;q=0.5" });
    if (!s.ok || s.status !== 200) {
      // conventional locations that 404 are not errors worth reporting
      if (state.robots.sitemaps.includes(url)) errors.push(`${url}: ${s.ok ? `HTTP ${s.status}` : s.error}`);
      continue;
    }
    const parsed = parseSitemap(s.body, cap);
    if (parsed.kind === "unknown") {
      if (state.robots.sitemaps.includes(url)) errors.push(`${url}: not a valid XML sitemap`);
      continue;
    }
    sources.push(url);
    if (parsed.kind === "index") {
      for (const child of parsed.urls) if (isSameSite(child, config.siteHost) && !queue.includes(child)) queue.push(child);
    } else {
      for (const u of parsed.urls) {
        const n = normalizeUrl(u);
        if (n && isSameSite(n, config.siteHost)) sitemapUrls.push(n);
      }
    }
  }
  state.sitemap = { found: sources.length > 0, sources, urlCount: sitemapUrls.length, errors };

  // Seed: start URL first (depth 0), then sitemap URLs (depth 1), capped at maxPages.
  const start = normalizeUrl(config.baseUrl)!;
  await store.enqueue([{ url: start, depth: 0 }]);
  const room = Math.max(0, config.maxPages - (await store.countPages()));
  const seeds = [...new Set(sitemapUrls)]
    .filter((u) => u !== start && looksLikePage(u) && !isExcluded(u, config.excludePatterns))
    .slice(0, room)
    .map((url) => ({ url, depth: 1, foundInSitemap: true }));
  if (seeds.length) await store.enqueue(seeds);
  // the start URL may also be listed in the sitemap
  if (sitemapUrls.includes(start)) await store.markFound([start], "sitemap");
  return state;
}

// ---------------------------------------------------------------------------
// Crawling
// ---------------------------------------------------------------------------
function indexability(res: FetchSuccess, parsedNoindex: boolean, canonical: string | null, requested: string): [boolean, string | null] {
  if (res.redirectChain.length > 0) return [false, "redirected"];
  if (res.status !== 200) return [false, `HTTP ${res.status}`];
  if (!isHtml(res.contentType)) return [false, "not HTML"];
  if (parsedNoindex) return [false, "noindex"];
  if (canonical && canonical !== requested && canonical !== normalizeUrl(res.finalUrl)) return [false, "canonicalised to another URL"];
  return [true, null];
}

async function crawlOne(page: PendingPage, input: TickInput, robots: RobotsTxt | null): Promise<void> {
  const { config, fetcher, store } = input;
  const base: Omit<SavedPage, "fetchState"> = {
    statusCode: null,
    finalUrl: null,
    redirectChain: [],
    contentType: null,
    responseTimeMs: null,
    contentLength: null,
    fetchError: null,
    skipReason: null,
    xRobotsTag: null,
    attempts: page.attempts,
    parsed: null,
    isIndexable: null,
    indexabilityReason: null,
  };

  const u = new URL(page.url);
  if (config.respectRobotsTxt && page.depth > 0 && !isAllowed(robots, config.userAgent, u.pathname + u.search)) {
    await store.savePage(page.id, { ...base, fetchState: "skipped", skipReason: "blocked by robots.txt" });
    return;
  }
  if (page.depth > 0 && isExcluded(page.url, config.excludePatterns)) {
    await store.savePage(page.id, { ...base, fetchState: "skipped", skipReason: "matches an exclude pattern" });
    return;
  }

  const attempts = page.attempts + 1;
  const res = await fetcher(page.url);
  if (!res.ok) {
    if (res.retryable && attempts < config.maxAttempts) return store.retryLater(page.id, attempts, res.error);
    await store.savePage(page.id, { ...base, attempts, fetchState: "failed", fetchError: res.error });
    return;
  }
  if ((res.status === 429 || res.status >= 500) && attempts < config.maxAttempts) {
    return store.retryLater(page.id, attempts, `HTTP ${res.status}`);
  }

  const html = isHtml(res.contentType) && res.status === 200 && res.redirectChain.length === 0;
  const parsed = html ? parsePage(res.body, res.finalUrl, { xRobotsTag: res.xRobotsTag }) : null;
  const xNoindex = /\b(noindex|none)\b/i.test(res.xRobotsTag ?? "");
  const [isIndexable, reason] = indexability(res, (parsed?.noindex ?? false) || xNoindex, parsed?.canonical ?? null, page.url);

  await store.savePage(page.id, {
    fetchState: "fetched",
    statusCode: res.redirectChain[0]?.status ?? res.status,
    finalUrl: res.finalUrl,
    redirectChain: res.redirectChain,
    contentType: res.contentType,
    responseTimeMs: res.responseTimeMs,
    contentLength: res.contentLength ?? res.body.length,
    fetchError: res.truncated ? "response truncated at size limit" : null,
    skipReason: null,
    xRobotsTag: res.xRobotsTag,
    attempts,
    parsed,
    isIndexable,
    indexabilityReason: reason,
  });

  // Follow redirects to internal targets as their own pages.
  if (res.redirectChain.length > 0) {
    const target = normalizeUrl(res.finalUrl);
    if (target && isSameSite(target, config.siteHost) && looksLikePage(target)) {
      if ((await store.countPages()) < config.maxPages) await store.enqueue([{ url: target, depth: page.depth, foundViaLink: true }]);
    }
    return;
  }
  if (!parsed) return;

  await store.saveLinks(
    page.id,
    parsed.links.map((l) => ({ targetUrl: l.url, isInternal: l.internal, isNofollow: l.nofollow, anchorText: l.anchor })),
  );

  // Queue new internal pages (respecting nofollow on the page and the depth / page caps).
  if (parsed.nofollowPage || page.depth + 1 > config.maxDepth) return;
  const candidates = parsed.links
    .filter((l) => l.internal && !l.nofollow && looksLikePage(l.url) && !isExcluded(l.url, config.excludePatterns))
    .map((l) => l.url);
  if (!candidates.length) return;
  await store.markFound(candidates, "link");
  const room = config.maxPages - (await store.countPages());
  if (room > 0) {
    await store.enqueue(candidates.slice(0, room).map((url) => ({ url, depth: page.depth + 1, foundViaLink: true })));
  }
}

async function crawl(input: TickInput, deadline: number, now: () => number): Promise<{ done: boolean }> {
  const { config, store } = input;
  const sleep = input.sleep ?? defaultSleep;
  const robots = robotsFromState(input.state);
  // Honour the larger of the configured delay and robots.txt Crawl-delay (capped at 10 s).
  const robotsDelay = (input.state.robots?.crawlDelaySeconds ?? 0) * 1000;
  const delay = Math.min(10_000, Math.max(config.crawlDelayMs, config.respectRobotsTxt ? robotsDelay : 0));
  const concurrency = delay >= 1000 ? 1 : CONCURRENCY;

  while (now() < deadline) {
    if ((await store.countFetched()) >= config.maxPages) return { done: true };
    const batch = await store.nextPending(concurrency);
    if (batch.length === 0) return { done: true };
    await Promise.all(batch.map((p) => crawlOne(p, input, robots)));
    if (delay > 0 && now() + delay < deadline) await sleep(delay);
  }
  return { done: false };
}

// ---------------------------------------------------------------------------
// External link checks
// ---------------------------------------------------------------------------
async function checkExternal(input: TickInput, deadline: number, now: () => number): Promise<{ done: boolean; checked: number }> {
  const { store, fetcher, config } = input;
  let checked = input.state.externalChecked ?? 0;
  while (now() < deadline && checked < config.maxExternalChecks) {
    const targets = await store.uncheckedExternalTargets(Math.min(5, config.maxExternalChecks - checked));
    if (targets.length === 0) return { done: true, checked };
    await Promise.all(
      targets.map(async (t) => {
        let r = await fetcher(t, { method: "HEAD", timeoutMs: 8000 });
        // many servers reject HEAD; retry with GET
        if (r.ok && (r.status === 405 || r.status === 501)) r = await fetcher(t, { method: "GET", timeoutMs: 8000 });
        await store.setExternalStatus(t, r.ok ? r.status : null, r.ok ? null : r.error);
      }),
    );
    checked += targets.length;
  }
  return { done: checked >= config.maxExternalChecks, checked };
}

// ---------------------------------------------------------------------------
export async function runCrawlTick(input: TickInput): Promise<TickResult> {
  const now = input.now ?? Date.now;
  const deadline = now() + input.budgetMs;
  let { phase, state } = input;

  if (phase === "discovery") {
    state = await discover({ ...input, state });
    phase = "crawling";
  }
  if (phase === "crawling" && now() < deadline) {
    const r = await crawl({ ...input, state }, deadline, now);
    if (r.done) phase = input.config.checkExternalLinks ? "link_check" : "pagespeed";
  }
  if (phase === "link_check" && now() < deadline) {
    const r = await checkExternal({ ...input, state }, deadline, now);
    state = { ...state, externalChecked: r.checked };
    if (r.done) phase = "pagespeed";
  }
  return {
    phase,
    state,
    pagesCrawled: await input.store.countFetched(),
    pagesDiscovered: await input.store.countPages(),
  };
}
