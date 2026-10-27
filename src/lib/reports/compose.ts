/**
 * Report snapshot model and the pure computations behind it. A report freezes
 * the numbers at generation time so it stays reproducible; every section records
 * its data source, and a section without data says so instead of showing zeros.
 */
import { addDays, change, isoDay, type SearchTotals } from "@/lib/analytics/ranges";

export const REPORT_TYPES = ["overview", "site_audit", "keyword_ranking", "traffic", "search_performance", "monthly"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_LABEL: Record<ReportType, string> = {
  overview: "SEO Overview",
  site_audit: "Site Audit",
  keyword_ranking: "Keyword Rankings",
  traffic: "Organic Traffic",
  search_performance: "Search Performance",
  monthly: "Monthly SEO Summary",
};

export const REPORT_DESCRIPTION: Record<ReportType, string> = {
  overview: "Headline numbers from every module: audit score, search, organic traffic, rankings and tasks.",
  site_audit: "Latest audit score, category breakdown, issues by severity, new and fixed issues in the period.",
  keyword_ranking: "Ranking distribution, average position, improved and declined keywords between the two dates.",
  traffic: "Organic sessions, users, engagement and top landing pages from GA4.",
  search_performance: "Clicks, impressions, CTR, average position, top queries and pages from Search Console.",
  monthly: "Everything above for one calendar month vs the previous month, with rule-based highlights.",
};

/** Which sections a report type contains. */
export const SECTIONS: Record<ReportType, SectionKey[]> = {
  overview: ["audit", "search", "traffic", "rankings", "tasks"],
  site_audit: ["audit"],
  keyword_ranking: ["rankings"],
  traffic: ["traffic"],
  search_performance: ["search"],
  monthly: ["audit", "search", "traffic", "rankings", "tasks"],
};

export type SectionKey = "audit" | "search" | "traffic" | "rankings" | "tasks";
export type CompareMode = "previous" | "year" | "none";
export type DataSource = "crawl" | "gsc" | "ga4" | "demo" | "rank_provider" | "tasks";

export interface Period {
  from: string;
  to: string;
  days: number;
  compareFrom: string | null;
  compareTo: string | null;
  compareMode: CompareMode;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Report period from a preset ("7d", "28d", "90d"), a custom range or a calendar month (monthly reports). */
export function resolvePeriod(
  input: { type: ReportType; preset?: string; from?: string; to?: string; month?: string; compare?: string },
  today = new Date(),
): Period | { error: string } {
  const yesterday = addDays(today, -1);
  let from: Date;
  let to: Date;
  let compareMode: CompareMode = input.compare === "year" || input.compare === "none" ? input.compare : "previous";
  if (input.type === "monthly") {
    if (!input.month || !MONTH.test(input.month)) return { error: "Choose a month" };
    from = new Date(`${input.month}-01T00:00:00Z`);
    to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
    if (from > yesterday) return { error: "That month has not started yet" };
    if (to > yesterday) to = yesterday; // month in progress: up to yesterday
    if (compareMode === "previous") {
      const pf = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1));
      const pt = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 0));
      return { from: isoDay(from), to: isoDay(to), days: span(from, to), compareFrom: isoDay(pf), compareTo: isoDay(pt), compareMode };
    }
  } else if (input.preset === "custom") {
    if (!input.from || !input.to || !DAY.test(input.from) || !DAY.test(input.to)) return { error: "Enter both dates" };
    from = new Date(`${input.from}T00:00:00Z`);
    to = new Date(`${input.to}T00:00:00Z`);
    if (from > to) return { error: "The start date must be before the end date" };
    if (to > yesterday) to = yesterday;
    if (from > to) return { error: "The range must end before today" };
    if (span(from, to) > 366) return { error: "Reports cover at most one year" };
  } else {
    const days = input.preset === "7d" ? 7 : input.preset === "90d" ? 90 : 28;
    to = yesterday;
    from = addDays(to, -(days - 1));
  }
  const days = span(from, to);
  if (compareMode === "none") return { from: isoDay(from), to: isoDay(to), days, compareFrom: null, compareTo: null, compareMode };
  if (compareMode === "year") return { from: isoDay(from), to: isoDay(to), days, compareFrom: isoDay(addDays(from, -364)), compareTo: isoDay(addDays(to, -364)), compareMode };
  compareMode = "previous";
  return { from: isoDay(from), to: isoDay(to), days, compareFrom: isoDay(addDays(from, -days)), compareTo: isoDay(addDays(from, -1)), compareMode };
}

/**
 * Audits are point-in-time. For a period that runs up to yesterday (the presets), the latest audit at
 * generation time is the current state; for a past period, the latest audit before it ended.
 */
export function auditCutoff(p: Pick<Period, "to">, now = new Date()): string {
  const yesterday = isoDay(addDays(now, -1));
  return p.to >= yesterday ? now.toISOString() : `${p.to}T23:59:59.999Z`;
}

const span = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;

// ---------------------------------------------------------------------------
// Snapshot shape
// ---------------------------------------------------------------------------
export interface Metric {
  current: number | null;
  previous: number | null;
  change: number | null;
}

export const metric = (current: number | null, previous: number | null): Metric => ({ current, previous, change: change(current, previous) });

export interface AuditSection {
  source: "crawl" | "demo";
  audit: { score: number; pagesAnalyzed: number; createdAt: string; critical: number; warning: number; opportunity: number; passed: number; categories: Record<string, number> } | null;
  previous: { score: number; createdAt: string } | null;
  openIssues: { title: string; severity: string; pages: number }[];
  newIssues: number;
  fixedIssues: number;
}

export interface SearchSection {
  source: "gsc" | "demo";
  totals: { clicks: Metric; impressions: Metric; ctr: Metric; position: Metric };
  daily: { date: string; clicks: number; impressions: number }[];
  topQueries: { key: string; clicks: number; impressions: number; position: number | null }[];
  topPages: { key: string; clicks: number; impressions: number; position: number | null }[];
}

export interface TrafficSection {
  source: "ga4" | "demo";
  channel: "Organic Search";
  totals: { sessions: Metric; users: Metric; engagedSessions: Metric; pageViews: Metric; engagementRate: Metric };
  allSessions: Metric;
  daily: { date: string; sessions: number; users: number }[];
  landingPages: { key: string; sessions: number; users: number }[];
}

export interface RankingSection {
  source: string;
  tracked: number;
  checkedAt: string | null;
  comparedAt: string | null;
  distribution: { bucket: string; current: number; previous: number | null }[];
  averagePosition: Metric;
  improved: Mover[];
  declined: Mover[];
}

export interface Mover {
  keyword: string;
  from: number | null;
  to: number | null;
}

export interface TasksSection {
  source: "tasks";
  created: number;
  completed: number;
  open: number;
  overdue: number;
}

export interface ReportSnapshot {
  version: 1;
  type: ReportType;
  generatedAt: string;
  website: { id: string; name: string; domain: string; isDemo: boolean };
  period: Period;
  /** section → data, or a reason it is unavailable */
  audit?: AuditSection | Unavailable;
  search?: SearchSection | Unavailable;
  traffic?: TrafficSection | Unavailable;
  rankings?: RankingSection | Unavailable;
  tasks?: TasksSection | Unavailable;
  highlights: string[];
}

export interface Unavailable {
  unavailable: true;
  reason: string;
}

export const isUnavailable = (s: unknown): s is Unavailable => Boolean(s && typeof s === "object" && "unavailable" in s);

// ---------------------------------------------------------------------------
// Computations
// ---------------------------------------------------------------------------
export function searchMetrics(cur: SearchTotals, prev: SearchTotals | null): SearchSection["totals"] {
  return {
    clicks: metric(cur.clicks, prev?.clicks ?? null),
    impressions: metric(cur.impressions, prev?.impressions ?? null),
    ctr: metric(cur.ctr, prev?.ctr ?? null),
    position: metric(cur.position, prev?.position ?? null),
  };
}

/** Latest known position per keyword on or before `date` (null = checked, not in top 100). */
export function positionsAt(rows: { keyword_id: string; checked_on: string; position: number | null }[], date: string): Map<string, number | null> {
  const best = new Map<string, { on: string; position: number | null }>();
  for (const r of rows) {
    if (r.checked_on > date) continue;
    const cur = best.get(r.keyword_id);
    if (!cur || r.checked_on > cur.on) best.set(r.keyword_id, { on: r.checked_on, position: r.position });
  }
  return new Map([...best].map(([k, v]) => [k, v.position]));
}

export const BUCKETS = [
  { bucket: "Top 3", max: 3 },
  { bucket: "4–10", max: 10 },
  { bucket: "11–20", max: 20 },
  { bucket: "21–100", max: 100 },
] as const;

export function distribution(positions: Map<string, number | null>) {
  const counts: Record<string, number> = Object.fromEntries([...BUCKETS.map((b) => [b.bucket, 0]), ["Not in top 100", 0]]);
  for (const p of positions.values()) {
    const b = p === null ? undefined : BUCKETS.find((x) => p <= x.max);
    counts[b ? b.bucket : "Not in top 100"]++;
  }
  return counts;
}

export function averagePosition(positions: Map<string, number | null>): number | null {
  const ranked = [...positions.values()].filter((p): p is number => p !== null);
  return ranked.length ? Math.round((ranked.reduce((a, b) => a + b, 0) / ranked.length) * 10) / 10 : null;
}

/** Keywords whose position changed between the two dates (only keywords observed at both dates). */
export function movers(before: Map<string, number | null>, after: Map<string, number | null>, names: Map<string, string>, limit = 10) {
  const rank = (p: number | null) => p ?? 101;
  const moved: (Mover & { delta: number })[] = [];
  for (const [id, to] of after) {
    if (!before.has(id)) continue;
    const from = before.get(id)!;
    const delta = rank(from) - rank(to); // positive = improved
    if (delta !== 0) moved.push({ keyword: names.get(id) ?? id, from, to, delta });
  }
  const strip = ({ keyword, from, to }: Mover) => ({ keyword, from, to });
  return {
    improved: moved.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta || a.keyword.localeCompare(b.keyword)).slice(0, limit).map(strip),
    declined: moved.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta || a.keyword.localeCompare(b.keyword)).slice(0, limit).map(strip),
  };
}

const pctText = (c: number) => `${c > 0 ? "+" : ""}${Math.round(c * 1000) / 10}%`;

/**
 * Rule-based summary lines for the Monthly SEO Summary. Every line is derived
 * from a number in the snapshot; nothing is written when the data is missing.
 */
export function highlights(s: Omit<ReportSnapshot, "highlights">): string[] {
  const out: string[] = [];
  const a = s.audit && !isUnavailable(s.audit) ? s.audit : null;
  if (a?.audit) {
    const prev = a.previous ? ` (previous audit ${Math.round(a.previous.score)})` : "";
    out.push(`SEO health score is ${Math.round(a.audit.score)}/100${prev}, with ${a.audit.critical} critical issue${a.audit.critical === 1 ? "" : "s"}.`);
    if (a.fixedIssues || a.newIssues) out.push(`${a.fixedIssues} issue${a.fixedIssues === 1 ? " was" : "s were"} fixed and ${a.newIssues} new issue${a.newIssues === 1 ? " was" : "s were"} detected in the period.`);
  }
  const q = s.search && !isUnavailable(s.search) ? s.search : null;
  if (q?.totals.clicks.current !== null && q) {
    const c = q.totals.clicks.change;
    out.push(`Search Console recorded ${q.totals.clicks.current?.toLocaleString("en")} clicks${c !== null ? ` (${pctText(c)} vs the comparison period)` : ""}.`);
    if (q.topQueries[0]) out.push(`The top query was “${q.topQueries[0].key}” with ${q.topQueries[0].clicks.toLocaleString("en")} clicks.`);
  }
  const t = s.traffic && !isUnavailable(s.traffic) ? s.traffic : null;
  if (t?.totals.sessions.current !== null && t) {
    const c = t.totals.sessions.change;
    out.push(`Organic sessions: ${t.totals.sessions.current?.toLocaleString("en")}${c !== null ? ` (${pctText(c)})` : ""}.`);
  }
  const r = s.rankings && !isUnavailable(s.rankings) ? s.rankings : null;
  if (r && r.tracked) {
    const top10 = r.distribution.filter((d) => d.bucket === "Top 3" || d.bucket === "4–10").reduce((n, d) => n + d.current, 0);
    // movement is only reported when the comparison date had rank data
    out.push(`${top10} of ${r.tracked} tracked keywords rank in the top 10${r.comparedAt ? `; ${r.improved.length} improved and ${r.declined.length} declined` : ""}.`);
  }
  const k = s.tasks && !isUnavailable(s.tasks) ? s.tasks : null;
  if (k && (k.created || k.completed || k.open)) out.push(`${k.completed} SEO task${k.completed === 1 ? " was" : "s were"} completed; ${k.open} remain open${k.overdue ? `, ${k.overdue} overdue` : ""}.`);
  return out;
}
