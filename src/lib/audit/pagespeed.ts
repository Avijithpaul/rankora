import "server-only";
import type { PageSpeedResult } from "@/lib/crawler/types";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

type Psi = {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { numericValue?: number }>;
  };
  loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
  error?: { message?: string };
};

/**
 * Google PageSpeed Insights (mobile). Field data (CrUX) is preferred when
 * Google has it for the URL; otherwise Lighthouse lab values are used.
 * The URL sent here is the user's own public website; Google fetches it.
 */
export async function runPageSpeed(url: string, apiKey: string, timeoutMs = 50_000): Promise<PageSpeedResult> {
  const qs = new URLSearchParams({ url, strategy: "mobile", category: "performance", key: apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ENDPOINT}?${qs}`, { signal: controller.signal, cache: "no-store" });
    const json = (await res.json()) as Psi;
    if (!res.ok) throw new Error(json.error?.message ?? `PageSpeed API returned HTTP ${res.status}`);
    return parsePageSpeed(url, json);
  } finally {
    clearTimeout(timer);
  }
}

export function parsePageSpeed(url: string, json: Psi): PageSpeedResult {
  const audits = json.lighthouseResult?.audits ?? {};
  const field = json.loadingExperience?.metrics ?? {};
  const num = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const fieldLcp = num(field.LARGEST_CONTENTFUL_PAINT_MS?.percentile);
  const fieldCls = num(field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile);
  const fieldInp = num(field.INTERACTION_TO_NEXT_PAINT?.percentile);
  const score = json.lighthouseResult?.categories?.performance?.score;
  return {
    url,
    strategy: "mobile",
    performanceScore: typeof score === "number" ? Math.round(score * 100) : null,
    lcpMs: fieldLcp ?? (num(audits["largest-contentful-paint"]?.numericValue) !== null ? Math.round(audits["largest-contentful-paint"]!.numericValue!) : null),
    // CrUX reports CLS ×100
    cls: fieldCls !== null ? fieldCls / 100 : num(audits["cumulative-layout-shift"]?.numericValue),
    tbtMs: num(audits["total-blocking-time"]?.numericValue) !== null ? Math.round(audits["total-blocking-time"]!.numericValue!) : null,
    inpMs: fieldInp,
    fieldDataAvailable: fieldLcp !== null || fieldInp !== null,
    fetchedAt: new Date().toISOString(),
  };
}
