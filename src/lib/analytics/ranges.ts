/** Date ranges, comparison periods and aggregation for analytics views. Pure. */

export function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const PRESETS = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "28d", label: "Last 28 days", days: 28 },
  { key: "90d", label: "Last 3 months", days: 90 },
] as const;

export interface DateRange {
  key: string;
  from: string;
  to: string;
  days: number;
  compare: "previous" | "year" | "none";
  prevFrom: string | null;
  prevTo: string | null;
}

/**
 * Resolve ?range=7d|28d|90d|custom&from=&to=&compare=previous|year|none.
 * Ranges end yesterday (today is incomplete in Google products). Custom ranges
 * are clamped to 1–365 days.
 */
export function resolveRange(params: Record<string, string | string[] | undefined>, today = new Date()): DateRange {
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const yesterday = addDays(today, -1);
  let from: Date;
  let to = yesterday;
  let key = get("range") ?? "28d";
  const preset = PRESETS.find((p) => p.key === key);
  const cf = get("from");
  const ct = get("to");
  if (key === "custom" && cf && ct && DAY.test(cf) && DAY.test(ct) && cf <= ct) {
    from = new Date(`${cf}T00:00:00Z`);
    to = new Date(`${ct}T00:00:00Z`);
    if (to > yesterday) to = yesterday;
    if ((to.getTime() - from.getTime()) / 86_400_000 > 364) from = addDays(to, -364);
    if (from > to) from = to;
  } else {
    key = preset ? preset.key : "28d";
    from = addDays(to, -((preset?.days ?? 28) - 1));
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const c = get("compare");
  const compare = c === "none" || c === "year" ? c : "previous";
  let prevFrom: string | null = null;
  let prevTo: string | null = null;
  if (compare === "previous") {
    prevTo = isoDay(addDays(from, -1));
    prevFrom = isoDay(addDays(from, -days));
  } else if (compare === "year") {
    prevFrom = isoDay(addDays(from, -364));
    prevTo = isoDay(addDays(to, -364));
  }
  return { key, from: isoDay(from), to: isoDay(to), days, compare, prevFrom, prevTo };
}

/** Relative change, null when the base is 0 or missing. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

type Num = Record<string, number | null | undefined>;

/** Sum numeric fields of rows grouped by key (null-safe). */
export function groupSum<T extends Num & Record<string, unknown>>(rows: T[], keyOf: (r: T) => string, fields: (keyof T & string)[]) {
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const k = keyOf(r);
    const acc = out.get(k) ?? Object.fromEntries(fields.map((f) => [f, 0]));
    for (const f of fields) acc[f] += Number(r[f] ?? 0);
    out.set(k, acc);
  }
  return out;
}

export interface SearchTotals {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

/** Totals for Search Console rows; position is impression-weighted, CTR = clicks / impressions. */
export function searchTotals(rows: { clicks: number; impressions: number; position: number | null }[]): SearchTotals {
  let clicks = 0;
  let impressions = 0;
  let posW = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    posW += (r.position ?? 0) * r.impressions;
  }
  return { clicks, impressions, ctr: impressions ? clicks / impressions : null, position: impressions ? posW / impressions : null };
}

export interface KeyedSearchRow extends SearchTotals {
  key: string;
  prev: SearchTotals | null;
}

/** Aggregate Search Console rows by key for current and previous period, sorted by clicks. */
export function searchBreakdown<R extends { clicks: number; impressions: number; position: number | null }>(
  current: R[],
  previous: R[] | null,
  keyOf: (r: R) => string,
  limit = 100,
): KeyedSearchRow[] {
  const group = (rows: R[]) => {
    const m = new Map<string, R[]>();
    for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]);
    return m;
  };
  const cur = group(current);
  const prev = previous ? group(previous) : null;
  return [...cur.entries()]
    .map(([key, rows]) => ({ key, ...searchTotals(rows), prev: prev ? (prev.has(key) ? searchTotals(prev.get(key)!) : null) : null }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/** Fill missing days with zeroes so charts show gaps honestly as 0-traffic days only when data exists. */
export type SeriesPoint = { date: string; [metric: string]: number | string };

export function dailySeries<T extends { date: string }>(rows: T[], from: string, to: string, pick: (r: T[]) => Record<string, number>): SeriesPoint[] {
  const byDate = new Map<string, T[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  const out: SeriesPoint[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); isoDay(d) <= to; d = addDays(d, 1)) {
    const day = isoDay(d);
    const list = byDate.get(day);
    if (list) out.push({ ...pick(list), date: day });
  }
  return out;
}
