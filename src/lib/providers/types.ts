/**
 * SEO data provider contracts. Any provider (DataForSEO, Semrush API, a
 * self-hosted SERP scraper, ...) can be plugged in by implementing these.
 * Values a provider does not return must be null — never filled in.
 */

export type Device = "desktop" | "mobile";
export type SearchEngine = "google" | "bing";
export type Intent = "informational" | "navigational" | "commercial" | "transactional";

export interface Market {
  countryCode: string; // ISO 3166-1 alpha-2, e.g. "US"
  languageCode: string; // e.g. "en"
}

export interface KeywordMetrics {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  /** advertiser competition 0..1 */
  competition: number | null;
  /** organic difficulty 0..100 */
  difficulty: number | null;
  intent: Intent | null;
  /** last 12 months, oldest first, when the provider supplies it */
  monthlySearches: { month: string; volume: number }[] | null;
}

export type IdeaSource = "related" | "suggestion";

export interface KeywordIdea extends KeywordMetrics {
  source: IdeaSource;
}

export interface KeywordProvider {
  readonly id: string;
  readonly name: string;
  /** Related keywords and long-tail suggestions for a seed. */
  ideas(seed: string, market: Market, opts?: { limit?: number }): Promise<KeywordIdea[]>;
  /** Metrics for known keywords. */
  metrics(keywords: string[], market: Market): Promise<KeywordMetrics[]>;
}

export interface RankQuery extends Market {
  keyword: string;
  device: Device;
  engine: SearchEngine;
  /** registrable domain to look for, e.g. "example.com" */
  domain: string;
  /** results depth to inspect (max 100) */
  depth?: number;
}

export interface RankResult {
  /** 1-based organic position, or null when not found within depth */
  position: number | null;
  url: string | null;
  serpFeatures: string[];
  checkedDepth: number;
}

export interface RankProvider {
  readonly id: string;
  readonly name: string;
  supports(engine: SearchEngine): boolean;
  check(q: RankQuery): Promise<RankResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
