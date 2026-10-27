/** Google Analytics 4: Admin API (property list) + Data API (reports), read-only. */
import { googleJson } from "./http";

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";

export interface Ga4Property {
  property: string; // "properties/123456789"
  displayName: string;
  account: string;
}

type AccountSummaries = {
  accountSummaries?: { account?: string; displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[];
  nextPageToken?: string;
};

export function parseAccountSummaries(json: AccountSummaries): Ga4Property[] {
  return (json.accountSummaries ?? []).flatMap((a) =>
    (a.propertySummaries ?? [])
      .filter((p) => p.property?.startsWith("properties/"))
      .map((p) => ({ property: p.property!, displayName: p.displayName ?? p.property!, account: a.displayName ?? a.account ?? "" })),
  );
}

export async function listProperties(accessToken: string, fetchImpl?: typeof fetch): Promise<Ga4Property[]> {
  const out: Ga4Property[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 10; i++) {
    const json = await googleJson<AccountSummaries>(`${ADMIN}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, accessToken, {
      api: "Analytics Admin",
      fetchImpl,
    });
    out.push(...parseAccountSummaries(json));
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

export interface ReportRequest {
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  limit?: number;
  dimensionFilter?: unknown;
}

export type ReportRow = Record<string, string | number>;

type RunReportResponse = {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  rowCount?: number;
};

/** Flatten a runReport response into objects keyed by dimension/metric name. */
export function parseReport(json: RunReportResponse): ReportRow[] {
  const dims = (json.dimensionHeaders ?? []).map((d) => d.name);
  const mets = (json.metricHeaders ?? []).map((m) => m.name);
  return (json.rows ?? []).map((r) => {
    const row: ReportRow = {};
    dims.forEach((d, i) => (row[d] = r.dimensionValues?.[i]?.value ?? ""));
    mets.forEach((m, i) => {
      const v = Number(r.metricValues?.[i]?.value ?? 0);
      row[m] = Number.isFinite(v) ? v : 0;
    });
    return row;
  });
}

/** GA4 dates come back as YYYYMMDD. */
export function gaDate(v: string | number) {
  const s = String(v);
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

export async function runReport(accessToken: string, property: string, req: ReportRequest, fetchImpl?: typeof fetch): Promise<ReportRow[]> {
  if (!/^properties\/\d+$/.test(property)) throw new Error("Invalid GA4 property id");
  const out: ReportRow[] = [];
  const pageSize = Math.min(req.limit ?? 10_000, 100_000);
  for (let offset = 0; offset < (req.limit ?? 10_000); offset += pageSize) {
    const json = await googleJson<RunReportResponse>(`${DATA}/${property}:runReport`, accessToken, {
      method: "POST",
      api: "Analytics Data",
      fetchImpl,
      body: {
        dateRanges: [{ startDate: req.startDate, endDate: req.endDate }],
        dimensions: req.dimensions.map((name) => ({ name })),
        metrics: req.metrics.map((name) => ({ name })),
        limit: pageSize,
        offset,
        keepEmptyRows: false,
        ...(req.dimensionFilter ? { dimensionFilter: req.dimensionFilter } : {}),
      },
    });
    const rows = parseReport(json);
    out.push(...rows);
    if (rows.length < pageSize || out.length >= (json.rowCount ?? 0)) break;
  }
  return out;
}
