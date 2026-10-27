/**
 * DataForSEO adapter (https://docs.dataforseo.com/v3/).
 *  - Keyword ideas: DataForSEO Labs `related_keywords/live` + `keyword_suggestions/live`
 *  - Metrics:       DataForSEO Labs `keyword_overview/live`
 *  - Rankings:      SERP API `{google|bing}/organic/live/advanced` (own + competitor positions from one SERP)
 *  - Domain keywords: DataForSEO Labs `ranked_keywords/live`
 *  - Backlinks:     Backlinks API `summary/live`, `backlinks/live` (separate subscription)
 * Request building and response parsing are pure functions (unit tested with
 * fixtures); only `call()` performs network I/O.
 */
import { ProviderError, type Backlink, type BacklinkProvider, type BacklinkSummary, type DomainKeywordProvider, type RankedKeyword, type Intent, type KeywordIdea, type KeywordMetrics, type KeywordProvider, type Market, type RankProvider, type RankQuery, type RankResult, type SearchEngine } from "./types";
import { isoNumeric } from "./locations";

const API = "https://api.dataforseo.com/v3";
const OK = 20000;

export interface DataForSeoCredentials {
  login: string;
  password: string;
}

type Task<T> = { status_code: number; status_message: string; result: T[] | null };
type Envelope<T> = { status_code: number; status_message: string; tasks?: Task<T>[] };

/** Google Ads / DataForSEO location code: 2000 + ISO 3166 numeric. */
export function locationCode(countryCode: string): number {
  const n = isoNumeric(countryCode);
  if (!n) throw new ProviderError(`Unsupported country ${countryCode}`, "dataforseo");
  return 2000 + n;
}

export function marketParams(m: Market) {
  return { location_code: locationCode(m.countryCode), language_code: m.languageCode.slice(0, 2).toLowerCase() };
}

/** Unwrap the envelope; throws ProviderError on any non-OK status. */
export function unwrap<T>(json: Envelope<T>): T[] {
  if (json.status_code !== OK) throw new ProviderError(`DataForSEO: ${json.status_message} (${json.status_code})`, "dataforseo", json.status_code >= 50000);
  const task = json.tasks?.[0];
  if (!task) throw new ProviderError("DataForSEO returned no task", "dataforseo");
  if (task.status_code !== OK) throw new ProviderError(`DataForSEO: ${task.status_message} (${task.status_code})`, "dataforseo", task.status_code >= 50000);
  return task.result ?? [];
}

type RawKeywordData = {
  keyword?: string;
  keyword_info?: {
    search_volume?: number | null;
    cpc?: number | null;
    competition?: number | null;
    monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null;
  } | null;
  keyword_properties?: { keyword_difficulty?: number | null } | null;
  search_intent_info?: { main_intent?: string | null } | null;
};

const INTENTS = new Set(["informational", "navigational", "commercial", "transactional"]);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function toMetrics(raw: RawKeywordData): KeywordMetrics | null {
  if (!raw.keyword) return null;
  const info = raw.keyword_info ?? {};
  const monthly = info.monthly_searches
    ?.filter((m) => typeof m.search_volume === "number")
    .map((m) => ({ month: `${m.year}-${String(m.month).padStart(2, "0")}`, volume: m.search_volume as number }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
  const intent = raw.search_intent_info?.main_intent ?? null;
  const diff = num(raw.keyword_properties?.keyword_difficulty);
  const comp = num(info.competition);
  return {
    keyword: raw.keyword,
    searchVolume: num(info.search_volume),
    cpc: num(info.cpc),
    competition: comp === null ? null : Math.max(0, Math.min(1, comp)),
    difficulty: diff === null ? null : Math.round(Math.max(0, Math.min(100, diff))),
    intent: intent && INTENTS.has(intent) ? (intent as Intent) : null,
    monthlySearches: monthly?.length ? monthly : null,
  };
}

export function parseRelated(result: { items?: { keyword_data?: RawKeywordData }[] | null }[]): KeywordIdea[] {
  return (result[0]?.items ?? []).flatMap((i) => {
    const m = i.keyword_data ? toMetrics(i.keyword_data) : null;
    return m ? [{ ...m, source: "related" as const }] : [];
  });
}

export function parseSuggestions(result: { items?: RawKeywordData[] | null }[]): KeywordIdea[] {
  return (result[0]?.items ?? []).flatMap((i) => {
    const m = toMetrics(i);
    return m ? [{ ...m, source: "suggestion" as const }] : [];
  });
}

export function parseOverview(result: { items?: RawKeywordData[] | null }[]): KeywordMetrics[] {
  return (result[0]?.items ?? []).flatMap((i) => {
    const m = toMetrics(i);
    return m ? [m] : [];
  });
}

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

/** Find the first organic result belonging to `domain` (or one of its subdomains). */
export function parseSerp(
  result: { items?: { type?: string; rank_group?: number; url?: string; domain?: string }[] | null; item_types?: string[] | null }[],
  domain: string,
  depth: number,
  competitors: string[] = [],
): RankResult {
  const r = result[0];
  const organic = (r?.items ?? []).filter((i) => i.type === "organic" && typeof i.rank_group === "number");
  const find = (d: string) => {
    const target = bare(d);
    const hit = organic.find((i) => {
      let host = i.domain ?? "";
      if (!host && i.url) {
        try {
          host = new URL(i.url).hostname;
        } catch {
          host = "";
        }
      }
      const h = bare(host);
      return h === target || h.endsWith(`.${target}`);
    });
    return { position: hit && hit.rank_group! <= depth ? hit.rank_group! : null, url: hit && hit.rank_group! <= depth ? (hit.url ?? null) : null };
  };
  const own = find(domain);
  return {
    position: own.position,
    url: own.url,
    serpFeatures: [...new Set((r?.item_types ?? []).filter((t) => t !== "organic"))].slice(0, 20),
    checkedDepth: depth,
    ...(competitors.length ? { competitors: competitors.map((c) => ({ domain: c, ...find(c) })) } : {}),
  };
}

type RawRankedItem = {
  keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number | null; cpc?: number | null } | null } | null;
  ranked_serp_element?: { serp_item?: { type?: string; rank_group?: number; url?: string | null } | null } | null;
};

/** DataForSEO Labs `ranked_keywords/live`: organic positions only. */
export function parseRankedKeywords(result: { total_count?: number | null; items?: RawRankedItem[] | null }[]): { total: number | null; items: RankedKeyword[] } {
  const r = result[0];
  const items = (r?.items ?? []).flatMap((i): RankedKeyword[] => {
    const kw = i.keyword_data?.keyword;
    const serp = i.ranked_serp_element?.serp_item;
    if (!kw || !serp || (serp.type && serp.type !== "organic") || typeof serp.rank_group !== "number") return [];
    return [{ keyword: kw, position: serp.rank_group, url: serp.url ?? null, searchVolume: num(i.keyword_data?.keyword_info?.search_volume), cpc: num(i.keyword_data?.keyword_info?.cpc) }];
  });
  return { total: num(r?.total_count), items };
}

type RawBacklink = {
  url_from?: string;
  domain_from?: string;
  url_to?: string;
  anchor?: string | null;
  dofollow?: boolean;
  attributes?: string[] | null;
  item_type?: string;
  domain_from_rank?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
  is_new?: boolean;
  is_lost?: boolean;
};

const LINK_TYPES = new Set(["anchor", "image", "redirect", "canonical"]);

export function parseBacklinks(result: { total_count?: number | null; items?: RawBacklink[] | null }[], rankScale = 1000): { total: number | null; items: Backlink[] } {
  const r = result[0];
  const items = (r?.items ?? []).flatMap((b): Backlink[] => {
    if (!b.url_from || !b.url_to) return [];
    const attrs = (b.attributes ?? []).map((a) => a.toLowerCase());
    const rel: Backlink["rel"] = attrs.includes("sponsored") ? "sponsored" : attrs.includes("ugc") ? "ugc" : b.dofollow === false || attrs.includes("nofollow") ? "nofollow" : "follow";
    const rank = num(b.domain_from_rank);
    let domain = b.domain_from ?? "";
    if (!domain) {
      try {
        domain = new URL(b.url_from).hostname;
      } catch {
        return [];
      }
    }
    return [
      {
        sourceUrl: b.url_from.slice(0, 2048),
        sourceDomain: domain.toLowerCase(),
        targetUrl: b.url_to.slice(0, 2048),
        anchor: b.anchor?.trim() ? b.anchor.trim().slice(0, 500) : null,
        rel,
        linkType: b.item_type && LINK_TYPES.has(b.item_type) ? (b.item_type as Backlink["linkType"]) : "other",
        domainRank: rank === null ? null : Math.round((rank / rankScale) * 10000) / 100,
        firstSeen: b.first_seen ?? null,
        lastSeen: b.last_seen ?? null,
        isNew: b.is_new === true,
        isLost: b.is_lost === true,
      },
    ];
  });
  return { total: num(r?.total_count), items };
}

export function parseBacklinkSummary(result: Record<string, unknown>[]): BacklinkSummary {
  const r = result[0] ?? {};
  return {
    backlinks: num(r.backlinks),
    referringDomains: num(r.referring_domains),
    referringMainDomains: num(r.referring_main_domains),
    referringIps: num(r.referring_ips),
    brokenBacklinks: num(r.broken_backlinks),
    rank: num(r.rank),
    spamScore: num(r.backlinks_spam_score),
    firstSeen: typeof r.first_seen === "string" ? r.first_seen : null,
  };
}

export class DataForSeo implements KeywordProvider, RankProvider, DomainKeywordProvider {
  readonly id = "dataforseo";
  readonly name = "DataForSEO";

  constructor(
    private creds: DataForSeoCredentials,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  /** Low-level call for sibling adapters (same credentials, same error handling). */
  raw<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T[]> {
    return this.call<T>(path, body, timeoutMs);
  }

  private async call<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${API}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.creds.login}:${this.creds.password}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 401) throw new ProviderError("DataForSEO rejected the credentials", this.id);
      if (!res.ok) throw new ProviderError(`DataForSEO HTTP ${res.status}`, this.id, res.status >= 500);
      return unwrap<T>((await res.json()) as Envelope<T>);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(`DataForSEO request failed: ${(e as Error).message}`, this.id, true);
    } finally {
      clearTimeout(timer);
    }
  }

  async ideas(seed: string, market: Market, opts: { limit?: number } = {}): Promise<KeywordIdea[]> {
    const limit = Math.min(opts.limit ?? 100, 500);
    const base = { keyword: seed, ...marketParams(market), limit, include_seed_keyword: true };
    const [related, suggestions] = await Promise.all([
      this.call<Parameters<typeof parseRelated>[0][number]>("/dataforseo_labs/google/related_keywords/live", [{ ...base, depth: 2 }]),
      this.call<Parameters<typeof parseSuggestions>[0][number]>("/dataforseo_labs/google/keyword_suggestions/live", [base]),
    ]);
    const merged = new Map<string, KeywordIdea>();
    for (const i of [...parseSuggestions(suggestions), ...parseRelated(related)]) {
      const k = i.keyword.toLowerCase();
      if (!merged.has(k)) merged.set(k, i);
    }
    return [...merged.values()];
  }

  async metrics(keywords: string[], market: Market): Promise<KeywordMetrics[]> {
    if (keywords.length === 0) return [];
    const result = await this.call<Parameters<typeof parseOverview>[0][number]>("/dataforseo_labs/google/keyword_overview/live", [
      { keywords: keywords.slice(0, 700), ...marketParams(market) },
    ]);
    return parseOverview(result);
  }

  supports(engine: SearchEngine) {
    return engine === "google" || engine === "bing";
  }

  async check(q: RankQuery): Promise<RankResult> {
    const depth = Math.min(q.depth ?? 100, 100);
    const result = await this.call<Parameters<typeof parseSerp>[0][number]>(`/serp/${q.engine}/organic/live/advanced`, [
      { keyword: q.keyword, ...marketParams(q), device: q.device, depth },
    ]);
    return parseSerp(result, q.domain, depth, q.competitors ?? []);
  }

  async rankedKeywords(domain: string, market: Market, opts: { limit?: number } = {}) {
    const result = await this.call<Parameters<typeof parseRankedKeywords>[0][number]>("/dataforseo_labs/google/ranked_keywords/live", [
      { target: domain, ...marketParams(market), limit: Math.min(opts.limit ?? 500, 1000), order_by: ["ranked_serp_element.serp_item.rank_group,asc"] },
    ]);
    return parseRankedKeywords(result);
  }
}

/**
 * DataForSEO Backlinks API (a separate subscription from SERP/Labs, so it is
 * enabled explicitly with BACKLINK_PROVIDER=dataforseo).
 */
export class DataForSeoBacklinks implements BacklinkProvider {
  readonly id = "dataforseo";
  readonly name = "DataForSEO Backlinks";
  private inner: DataForSeo;

  constructor(creds: DataForSeoCredentials, fetchImpl: typeof fetch = fetch) {
    this.inner = new DataForSeo(creds, fetchImpl);
  }

  async summary(target: string) {
    return parseBacklinkSummary(await this.inner.raw<Record<string, unknown>>("/backlinks/summary/live", [{ target, backlinks_status_type: "live", rank_scale: "one_hundred" }]));
  }

  async backlinks(target: string, opts: { limit?: number; status?: "live" | "lost" } = {}) {
    const result = await this.inner.raw<Parameters<typeof parseBacklinks>[0][number]>("/backlinks/backlinks/live", [
      { target, mode: "as_is", backlinks_status_type: opts.status ?? "live", limit: Math.min(opts.limit ?? 500, 1000), order_by: ["domain_from_rank,desc"], rank_scale: "one_hundred" },
    ]);
    return parseBacklinks(result, 100);
  }
}
