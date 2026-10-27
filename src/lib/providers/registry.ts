import { providerConfig } from "@/lib/env";
import { DataForSeo, DataForSeoBacklinks } from "./dataforseo";
import { demoKeywordProvider } from "./demo";
import type { BacklinkProvider, DomainKeywordProvider, KeywordProvider, RankProvider } from "./types";

export interface ProviderStatus {
  keyword: { connected: boolean; id: string | null; name: string | null };
  rank: { connected: boolean; id: string | null; name: string | null };
}

/**
 * Returns the configured real provider, or null ("Provider Not Connected").
 * Demo data is available only when the caller explicitly asks for a demo website.
 */
export function getKeywordProvider(opts: { isDemoWebsite: boolean }): KeywordProvider | null {
  if (opts.isDemoWebsite) return demoKeywordProvider;
  const cfg = providerConfig().dataForSeo;
  return cfg ? new DataForSeo(cfg) : null;
}

/** Rank checks never use demo data: demo rankings are pre-seeded snapshots only. */
export function getRankProvider(): RankProvider | null {
  const cfg = providerConfig().dataForSeo;
  return cfg ? new DataForSeo(cfg) : null;
}

/** Ranked keywords per domain (competitor overlap and gaps). */
export function getDomainKeywordProvider(): DomainKeywordProvider | null {
  const cfg = providerConfig().dataForSeo;
  return cfg ? new DataForSeo(cfg) : null;
}

/** Backlink data needs its own subscription, so it must be enabled explicitly. Never demo or estimated. */
export function getBacklinkProvider(): BacklinkProvider | null {
  const { dataForSeo, backlinkProvider } = providerConfig();
  return backlinkProvider === "dataforseo" && dataForSeo ? new DataForSeoBacklinks(dataForSeo) : null;
}

export function providerStatus(): ProviderStatus {
  const connected = Boolean(providerConfig().dataForSeo);
  const info = connected ? { connected: true, id: "dataforseo", name: "DataForSEO" } : { connected: false, id: null, name: null };
  return { keyword: info, rank: info };
}
