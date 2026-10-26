/** Pure aggregation helpers for the dashboard. No I/O, fully unit tested. */

export interface SearchRow {
  clicks: number;
  impressions: number;
  position: number | null;
}

export interface Aggregated {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  /** impression-weighted average position */
  position: number | null;
}

/** Sum daily rows per key (query or page) and sort by clicks, then impressions. */
export function aggregateTop<T extends SearchRow>(rows: T[], keyOf: (r: T) => string, limit = 5): Aggregated[] {
  const map = new Map<string, { clicks: number; impressions: number; posWeighted: number; posImpr: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const acc = map.get(k) ?? { clicks: 0, impressions: 0, posWeighted: 0, posImpr: 0 };
    acc.clicks += r.clicks;
    acc.impressions += r.impressions;
    if (r.position !== null) {
      acc.posWeighted += r.position * r.impressions;
      acc.posImpr += r.impressions;
    }
    map.set(k, acc);
  }
  return [...map.entries()]
    .map(([key, a]) => ({
      key,
      clicks: a.clicks,
      impressions: a.impressions,
      ctr: a.impressions > 0 ? a.clicks / a.impressions : null,
      position: a.posImpr > 0 ? a.posWeighted / a.posImpr : null,
    }))
    .sort((x, y) => y.clicks - x.clicks || y.impressions - x.impressions)
    .slice(0, limit);
}

export interface RankSnapshot {
  keyword_id: string;
  checked_on: string;
  position: number | null;
}

export interface RankMovement {
  improved: number;
  dropped: number;
  unchanged: number;
  new: number;
  lost: number;
  distribution: { top3: number; top10: number; top20: number; top100: number; notRanking: number };
}

/**
 * Compare each keyword's latest snapshot with its previous one.
 * Lower position = better. null = not ranking in the checked depth.
 */
export function rankMovement(snapshots: RankSnapshot[]): RankMovement {
  const byKeyword = new Map<string, RankSnapshot[]>();
  for (const s of snapshots) {
    const list = byKeyword.get(s.keyword_id) ?? [];
    list.push(s);
    byKeyword.set(s.keyword_id, list);
  }
  const m: RankMovement = {
    improved: 0,
    dropped: 0,
    unchanged: 0,
    new: 0,
    lost: 0,
    distribution: { top3: 0, top10: 0, top20: 0, top100: 0, notRanking: 0 },
  };
  for (const list of byKeyword.values()) {
    list.sort((a, b) => a.checked_on.localeCompare(b.checked_on));
    const latest = list[list.length - 1];
    const prev = list.length > 1 ? list[list.length - 2] : null;
    const cur = latest.position;
    if (cur === null) m.distribution.notRanking++;
    else if (cur <= 3) m.distribution.top3++;
    else if (cur <= 10) m.distribution.top10++;
    else if (cur <= 20) m.distribution.top20++;
    else m.distribution.top100++;

    if (!prev) continue;
    const before = prev.position;
    if (before === null && cur !== null) m.new++;
    else if (before !== null && cur === null) m.lost++;
    else if (before !== null && cur !== null) {
      if (cur < before) m.improved++;
      else if (cur > before) m.dropped++;
      else m.unchanged++;
    }
  }
  return m;
}

/** Number of keywords ranking in the top N per day, for a trend chart. */
export function topNByDay(snapshots: RankSnapshot[], n = 10) {
  const days = new Map<string, number>();
  for (const s of snapshots) {
    days.set(s.checked_on, (days.get(s.checked_on) ?? 0) + (s.position !== null && s.position <= n ? 1 : 0));
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
}

/** Relative change between two totals; null when the base is 0. */
export function relativeChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}
