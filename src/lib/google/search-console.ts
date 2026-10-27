/** Google Search Console API (webmasters v3, read-only). */
import { googleJson } from "./http";

const API = "https://www.googleapis.com/webmasters/v3";

export interface GscSite {
  siteUrl: string; // "https://example.com/" or "sc-domain:example.com"
  permissionLevel: string;
}

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type GscDimension = "date" | "query" | "page" | "country" | "device";

export function parseSites(json: { siteEntry?: GscSite[] }): GscSite[] {
  return (json.siteEntry ?? [])
    .filter((s) => s.siteUrl && s.permissionLevel !== "siteUnverifiedUser")
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

/** Pick the property that best matches the website: domain property first, then exact URL-prefix. */
export function suggestSite(sites: GscSite[], domain: string, baseUrl: string): string | null {
  const bare = domain.replace(/^www\./, "");
  const domainProp = sites.find((s) => s.siteUrl === `sc-domain:${bare}`);
  if (domainProp) return domainProp.siteUrl;
  const origin = new URL(baseUrl).origin + "/";
  const exact = sites.find((s) => s.siteUrl === origin);
  if (exact) return exact.siteUrl;
  const loose = sites.find((s) => {
    try {
      return new URL(s.siteUrl).hostname.replace(/^www\./, "") === bare;
    } catch {
      return false;
    }
  });
  return loose?.siteUrl ?? null;
}

export function parseRows(json: { rows?: GscRow[] }): GscRow[] {
  return (json.rows ?? []).map((r) => ({
    keys: r.keys ?? [],
    clicks: Math.round(r.clicks ?? 0),
    impressions: Math.round(r.impressions ?? 0),
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));
}

export async function listSites(accessToken: string, fetchImpl?: typeof fetch) {
  return parseSites(await googleJson<{ siteEntry?: GscSite[] }>(`${API}/sites`, accessToken, { api: "Search Console", fetchImpl }));
}

/**
 * searchAnalytics.query with automatic paging (25,000 rows per page).
 * `dataState: "all"` includes the most recent (still-processing) days.
 */
export async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  req: { startDate: string; endDate: string; dimensions: GscDimension[]; maxRows?: number },
  fetchImpl?: typeof fetch,
): Promise<GscRow[]> {
  const url = `${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const pageSize = 25_000;
  const max = req.maxRows ?? 25_000;
  const out: GscRow[] = [];
  for (let startRow = 0; startRow < max; startRow += pageSize) {
    const json = await googleJson<{ rows?: GscRow[] }>(url, accessToken, {
      method: "POST",
      api: "Search Console",
      fetchImpl,
      body: { startDate: req.startDate, endDate: req.endDate, dimensions: req.dimensions, rowLimit: Math.min(pageSize, max - startRow), startRow, dataState: "all", type: "web" },
    });
    const rows = parseRows(json);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
