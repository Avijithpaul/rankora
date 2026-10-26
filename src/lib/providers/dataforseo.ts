/**
 * DataForSEO adapter (https://docs.dataforseo.com/v3/).
 *  - Keyword ideas: DataForSEO Labs `related_keywords/live` + `keyword_suggestions/live`
 *  - Metrics:       DataForSEO Labs `keyword_overview/live`
 *  - Rankings:      SERP API `{google|bing}/organic/live/advanced`
 * Request building and response parsing are pure functions (unit tested with
 * fixtures); only `call()` performs network I/O.
 */
import { ProviderError, type Intent, type KeywordIdea, type KeywordMetrics, type KeywordProvider, type Market, type RankProvider, type RankQuery, type RankResult, type SearchEngine } from "./types";
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
): RankResult {
  const r = result[0];
  const target = bare(domain);
  const organic = (r?.items ?? []).filter((i) => i.type === "organic" && typeof i.rank_group === "number");
  const hit = organic.find((i) => {
    const d = bare(i.domain ?? (i.url ? new URL(i.url).hostname : ""));
    return d === target || d.endsWith(`.${target}`);
  });
  return {
    position: hit && hit.rank_group! <= depth ? hit.rank_group! : null,
    url: hit?.url ?? null,
    serpFeatures: [...new Set((r?.item_types ?? []).filter((t) => t !== "organic"))].slice(0, 20),
    checkedDepth: depth,
  };
}

export class DataForSeo implements KeywordProvider, RankProvider {
  readonly id = "dataforseo";
  readonly name = "DataForSEO";

  constructor(
    private creds: DataForSeoCredentials,
    private fetchImpl: typeof fetch = fetch,
  ) {}

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
    return parseSerp(result, q.domain, depth);
  }
}
