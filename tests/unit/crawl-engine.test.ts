import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { runCrawlTick } from "@/lib/crawler/engine";
import { MemoryCrawlStore } from "@/lib/crawler/memory-store";
import { createSafeFetcher } from "@/lib/crawler/fetcher";
import type { CrawlConfig, CrawlPhase, CrawlState, Fetcher, FetchResult } from "@/lib/crawler/types";
import { analyzeSite } from "@/lib/audit/analyze";
import { fromMemoryStore } from "@/lib/audit/mappers";
import { computeScore } from "@/lib/seo/scoring";

// ---------------------------------------------------------------------------
// A small fake website served by an in-memory fetcher
// ---------------------------------------------------------------------------
const ORIGIN = "https://shop.example";
const page = (title: string, body: string, extraHead = "") =>
  `<html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width">${extraHead}</head><body>${body}</body></html>`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

type Route = { status?: number; body?: string; type?: string; location?: string; fail?: string; failTimes?: number };
function siteFetcher(routes: Record<string, Route>, log: string[] = []): Fetcher {
  const failures = new Map<string, number>();
  return async (url, opts): Promise<FetchResult> => {
    log.push(`${opts?.method ?? "GET"} ${url}`);
    const chain: { url: string; status: number }[] = [];
    let current = url;
    for (let i = 0; i < 6; i++) {
      const r = routes[current] ?? { status: 404, body: "not found" };
      if (r.fail) {
        const n = (failures.get(current) ?? 0) + 1;
        failures.set(current, n);
        if (r.failTimes === undefined || n <= r.failTimes) return { ok: false, error: r.fail, retryable: true };
      }
      if (r.location) {
        chain.push({ url: current, status: r.status ?? 301 });
        current = new URL(r.location, current).toString();
        continue;
      }
      return {
        ok: true,
        status: r.status ?? 200,
        finalUrl: current,
        redirectChain: chain,
        contentType: r.type ?? "text/html; charset=utf-8",
        xRobotsTag: null,
        contentLength: null,
        body: opts?.method === "HEAD" ? "" : (r.body ?? ""),
        truncated: false,
        responseTimeMs: 120,
      };
    }
    return { ok: false, error: "Too many redirects", retryable: false };
  };
}

const ROUTES: Record<string, Route> = {
  [`${ORIGIN}/robots.txt`]: { type: "text/plain", body: `User-agent: *\nDisallow: /private\nSitemap: ${ORIGIN}/sitemap.xml` },
  [`${ORIGIN}/sitemap.xml`]: {
    type: "application/xml",
    body: `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/orphan</loc></url><url><loc>${ORIGIN}/about</loc></url></urlset>`,
  },
  "http://shop.example/": { location: `${ORIGIN}/` },
  [`${ORIGIN}/`]: {
    body: page(
      "Shop Example — Outdoor Gear for Every Trail",
      `<h1>Outdoor gear</h1>${words(300)}
       <a href="/about">About</a> <a href="/old">Old</a> <a href="/missing">Missing</a>
       <a href="/private/area">Private</a> <a href="/files/guide.pdf">PDF</a> <a href="https://ext.example/dead">Ext</a>
       <a href="/flaky">Flaky</a>`,
      '<meta name="description" content="Outdoor gear for hiking, camping and climbing — tents, packs, boots and more at fair prices.">',
    ),
  },
  [`${ORIGIN}/about`]: { body: page("About", "<h1>About us</h1><h3>Skipped level</h3>short page <img src=x.png>") },
  [`${ORIGIN}/old`]: { location: "/older", status: 301 },
  [`${ORIGIN}/older`]: { location: "/new", status: 302 },
  [`${ORIGIN}/new`]: { body: page("About", `<h1>New</h1>${words(260)}`) },
  [`${ORIGIN}/orphan`]: { body: page("Orphan page found only in sitemap", `<h1>Orphan</h1>${words(400)}`) },
  [`${ORIGIN}/private/area`]: { body: page("Private", "secret") },
  [`${ORIGIN}/flaky`]: { fail: "ECONNRESET", failTimes: 1, body: page("Flaky but fine eventually", `<h1>F</h1>${words(300)}`) },
  "https://ext.example/dead": { status: 410 },
};

const CONFIG: CrawlConfig = {
  siteHost: "shop.example",
  baseUrl: `${ORIGIN}/`,
  maxPages: 50,
  maxDepth: 5,
  crawlDelayMs: 0,
  respectRobotsTxt: true,
  checkExternalLinks: true,
  excludePatterns: [],
  userAgent: "RankoraBot/1.0",
  maxAttempts: 3,
  maxExternalChecks: 20,
};

async function crawlToEnd(config: CrawlConfig, fetcher: Fetcher, store = new MemoryCrawlStore()) {
  let phase: CrawlPhase = "discovery";
  let state: CrawlState = {};
  let ticks = 0;
  while (phase !== "pagespeed" && ticks < 50) {
    const r = await runCrawlTick({ phase, state, config, store, fetcher, budgetMs: 10_000, sleep: async () => {} });
    phase = r.phase;
    state = r.state;
    ticks++;
  }
  return { store, state, phase, ticks };
}

describe("crawl engine on a simulated site", async () => {
  const log: string[] = [];
  const { store, state, phase } = await crawlToEnd(CONFIG, siteFetcher(ROUTES, log));
  const byPath = (p: string) => store.pages.get(`${ORIGIN}${p}`);

  it("finishes the crawl phases", () => {
    expect(phase).toBe("pagespeed");
  });

  it("reads robots.txt, the sitemap and the HTTPS redirect", () => {
    expect(state.robots).toMatchObject({ found: true, blocksAll: false, sitemaps: [`${ORIGIN}/sitemap.xml`] });
    expect(state.sitemap).toMatchObject({ found: true, urlCount: 3 });
    expect(state.https).toMatchObject({ siteIsHttps: true, httpRedirectsToHttps: true });
  });

  it("respects robots.txt and skips assets", () => {
    expect(byPath("/private/area")?.state).toBe("skipped");
    expect(log.some((l) => l.includes("/private/area"))).toBe(false);
    expect(byPath("/files/guide.pdf")).toBeUndefined();
  });

  it("records redirect chains and follows them to the final page", () => {
    const old = byPath("/old")!;
    expect(old.saved?.redirectChain).toHaveLength(2);
    expect(old.saved?.statusCode).toBe(301);
    expect(byPath("/new")?.state).toBe("fetched");
  });

  it("retries transient failures", () => {
    const flaky = byPath("/flaky")!;
    expect(flaky.state).toBe("fetched");
    expect(flaky.attempts).toBe(2);
  });

  it("records 404s and checks external links", () => {
    expect(byPath("/missing")?.saved?.statusCode).toBe(404);
    expect(store.links.find((l) => l.targetUrl === "https://ext.example/dead")?.targetStatus).toBe(410);
  });

  it("never fetches the same URL twice", () => {
    const gets = log.filter((l) => l.startsWith("GET ") && !l.includes("robots") && !l.includes("sitemap") && !l.includes("flaky"));
    expect(new Set(gets).size).toBe(gets.length);
  });

  it("produces audit findings that reflect the site", () => {
    const { pages, links } = fromMemoryStore(store);
    const evals = analyzeSite(pages, links, { baseUrl: CONFIG.baseUrl, state, checkExternalLinks: true });
    const by = Object.fromEntries(evals.map((e) => [e.ruleId, e]));
    expect(by["site.https"].affected).toBe(0);
    expect(by["site.sitemap"].affected).toBe(0);
    expect(by["page.redirect_chain"].affectedUrls).toEqual([`${ORIGIN}/old`]);
    expect(by["page.broken_internal_links"].affectedUrls).toEqual([`${ORIGIN}/`]);
    expect(by["page.broken_external_links"].affectedUrls).toEqual([`${ORIGIN}/`]);
    expect(by["page.title_duplicate"].affectedUrls?.sort()).toEqual([`${ORIGIN}/about`, `${ORIGIN}/new`]);
    expect(by["page.heading_hierarchy"].affectedUrls).toEqual([`${ORIGIN}/about`]);
    expect(by["page.thin_content"].affectedUrls).toContain(`${ORIGIN}/about`);
    expect(by["page.image_alt"].affectedUrls).toEqual([`${ORIGIN}/about`]);
    expect(by["page.orphan"].affectedUrls).toEqual([`${ORIGIN}/orphan`]);
    expect(by["page.meta_description_missing"].affected).toBeGreaterThan(0);
    expect(by["site.core_web_vitals"].applicable).toBe(false);

    const score = computeScore(evals);
    expect(score.score).toBeGreaterThan(0);
    expect(score.score).toBeLessThan(100);
    expect(score.checks).toHaveLength(33);
  });
});

describe("crawl limits", () => {
  it("never crawls more than maxPages", async () => {
    const { store } = await crawlToEnd({ ...CONFIG, maxPages: 3, checkExternalLinks: false }, siteFetcher(ROUTES));
    expect(store.pages.size).toBeLessThanOrEqual(3);
  });

  it("stops at maxDepth", async () => {
    const { store } = await crawlToEnd({ ...CONFIG, maxDepth: 0, checkExternalLinks: false }, siteFetcher({ ...ROUTES, [`${ORIGIN}/sitemap.xml`]: { status: 404 } }));
    expect([...store.pages.keys()]).toEqual([`${ORIGIN}/`]);
  });

  it("applies exclude patterns", async () => {
    const { store } = await crawlToEnd({ ...CONFIG, excludePatterns: ["/about*"], checkExternalLinks: false }, siteFetcher(ROUTES));
    expect(store.pages.get(`${ORIGIN}/about`)?.state ?? "skipped").toBe("skipped");
  });

  it("gives up after maxAttempts", async () => {
    const routes = { ...ROUTES, [`${ORIGIN}/flaky`]: { fail: "ETIMEDOUT" } };
    const { store } = await crawlToEnd({ ...CONFIG, checkExternalLinks: false }, siteFetcher(routes));
    const flaky = store.pages.get(`${ORIGIN}/flaky`)!;
    expect(flaky.state).toBe("failed");
    expect(flaky.attempts).toBe(3);
  });

  it("resumes across ticks with a tiny time budget", async () => {
    const store = new MemoryCrawlStore();
    let phase: CrawlPhase = "discovery";
    let state: CrawlState = {};
    let t = 0;
    const now = () => (t += 50); // each call advances the clock
    let ticks = 0;
    while (phase !== "pagespeed" && ticks < 200) {
      const r = await runCrawlTick({ phase, state, config: { ...CONFIG, checkExternalLinks: false }, store, fetcher: siteFetcher(ROUTES), budgetMs: 120, now, sleep: async () => {} });
      phase = r.phase;
      state = r.state;
      ticks++;
    }
    expect(phase).toBe("pagespeed");
    expect(ticks).toBeGreaterThan(2);
    expect(store.pages.get(`${ORIGIN}/new`)?.state).toBe("fetched");
  });
});

describe("crawler SSRF protection (real fetcher)", () => {
  it("refuses to crawl a server on localhost / private network", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end("<html><title>internal</title></html>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const fetcher = createSafeFetcher();
      for (const target of [`http://127.0.0.1:${port}/`, "http://localhost/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.1/", "http://[::1]/"]) {
        const r = await fetcher(target);
        expect(r.ok, target).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/Blocked/);
      }
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });

  it("does not follow links to private addresses found on a page", async () => {
    const routes = {
      ...ROUTES,
      [`${ORIGIN}/`]: { body: page("Home page with internal links", '<a href="http://127.0.0.1/admin">x</a><a href="http://192.168.1.1/">y</a>') },
    };
    const log: string[] = [];
    await crawlToEnd({ ...CONFIG, checkExternalLinks: false }, siteFetcher(routes, log));
    expect(log.some((l) => /127\.0\.0\.1|192\.168/.test(l))).toBe(false);
  });
});
