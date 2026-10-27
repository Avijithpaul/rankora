import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { selectAll } from "@/lib/supabase/paginate";
import { recordUsage } from "@/lib/billing/usage";
import { searchTotals } from "@/lib/analytics/ranges";
import {
  auditCutoff,
  averagePosition,
  BUCKETS,
  distribution,
  highlights,
  metric,
  movers,
  positionsAt,
  REPORT_LABEL,
  searchMetrics,
  SECTIONS,
  type AuditSection,
  type Period,
  type RankingSection,
  type ReportSnapshot,
  type ReportType,
  type SearchSection,
  type TasksSection,
  type TrafficSection,
  type Unavailable,
} from "./compose";

type Website = Tables<"websites">;
type Reader = SupabaseClient<Database>;
const none = (reason: string): Unavailable => ({ unavailable: true, reason });
const endOf = (day: string) => `${day}T23:59:59.999Z`;

async function auditSection(db: Reader, w: Website, p: Period, now: Date): Promise<AuditSection | Unavailable> {
  const { data: audit } = await db.from("seo_audits").select("*").eq("website_id", w.id).lte("created_at", auditCutoff(p, now)).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!audit) return none("No site audit had been completed by the end of this period.");
  const { data: prev } = p.compareTo
    ? await db.from("seo_audits").select("score, created_at").eq("website_id", w.id).lte("created_at", endOf(p.compareTo)).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const [{ data: open }, { count: created }, { count: fixed }] = await Promise.all([
    db.from("seo_issues").select("title, severity, affected_pages_count").eq("website_id", w.id).eq("status", "open").order("severity").order("affected_pages_count", { ascending: false }).limit(10),
    db.from("seo_issues").select("id", { count: "exact", head: true }).eq("website_id", w.id).gte("first_detected_at", `${p.from}T00:00:00Z`).lte("first_detected_at", endOf(p.to)),
    db.from("seo_issues").select("id", { count: "exact", head: true }).eq("website_id", w.id).gte("fixed_at", `${p.from}T00:00:00Z`).lte("fixed_at", endOf(p.to)),
  ]);
  const breakdown = (audit.score_breakdown ?? {}) as { byCategory?: Record<string, { score: number }> };
  return {
    source: w.is_demo ? "demo" : "crawl",
    audit: {
      score: Number(audit.score),
      pagesAnalyzed: audit.pages_analyzed,
      createdAt: audit.created_at,
      critical: audit.critical_count,
      warning: audit.warning_count,
      opportunity: audit.opportunity_count,
      passed: audit.passed_count,
      categories: Object.fromEntries(Object.entries(breakdown.byCategory ?? {}).map(([k, v]) => [k, Math.round(v.score)])),
    },
    previous: prev && prev.created_at !== audit.created_at ? { score: Number(prev.score), createdAt: prev.created_at } : null,
    openIssues: (open ?? []).map((i) => ({ title: i.title, severity: i.severity, pages: i.affected_pages_count })),
    newIssues: created ?? 0,
    fixedIssues: fixed ?? 0,
  };
}

async function searchSection(db: Reader, w: Website, p: Period): Promise<SearchSection | Unavailable> {
  const daily = (from: string, to: string) =>
    db.from("search_console_daily").select("date, clicks, impressions, position, source").eq("website_id", w.id).eq("device", "all").eq("country", "all").gte("date", from).lte("date", to).order("date").limit(1000);
  const [{ data: cur }, prevRes] = await Promise.all([daily(p.from, p.to), p.compareFrom ? daily(p.compareFrom, p.compareTo!) : Promise.resolve({ data: null })]);
  if (!cur?.length) return none("No Search Console data for this period (not connected or not synced yet).");
  const n = (r: { clicks: number; impressions: number; position: number | string | null }) => ({ clicks: r.clicks, impressions: r.impressions, position: r.position === null ? null : Number(r.position) });
  const top = async (dim: "query" | "page") => {
    const { data } = await db.rpc("gsc_breakdown", { p_site: w.id, p_dim: dim, p_from: p.from, p_to: p.to, p_limit: 10 });
    return (data ?? []).map((r) => ({ key: r.key ?? "", clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0), position: r.avg_position === null ? null : Number(r.avg_position) }));
  };
  const [topQueries, topPages] = await Promise.all([top("query"), top("page")]);
  const prev = prevRes.data?.length ? searchTotals(prevRes.data.map(n)) : null;
  return {
    source: cur.some((r) => r.source === "demo") ? "demo" : "gsc",
    totals: searchMetrics(searchTotals(cur.map(n)), prev),
    daily: cur.map((r) => ({ date: r.date, clicks: r.clicks, impressions: r.impressions })),
    topQueries,
    topPages,
  };
}

async function trafficSection(db: Reader, w: Website, p: Period): Promise<TrafficSection | Unavailable> {
  const daily = (channel: string, from: string, to: string) =>
    db
      .from("analytics_daily")
      .select("date, users, sessions, engaged_sessions, page_views, source")
      .eq("website_id", w.id)
      .eq("channel", channel)
      .eq("device", "all")
      .eq("country", "all")
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .limit(1000);
  const [{ data: cur }, prevRes, { data: all }, allPrevRes] = await Promise.all([
    daily("Organic Search", p.from, p.to),
    p.compareFrom ? daily("Organic Search", p.compareFrom, p.compareTo!) : Promise.resolve({ data: null }),
    daily("all", p.from, p.to),
    p.compareFrom ? daily("all", p.compareFrom, p.compareTo!) : Promise.resolve({ data: null }),
  ]);
  if (!cur?.length) return none("No GA4 organic traffic data for this period (not connected or not synced yet).");
  type Row = NonNullable<typeof cur>[number];
  const sum = (rows: Row[] | null | undefined) => {
    if (!rows?.length) return null;
    const s = rows.reduce((a, r) => ({ users: a.users + r.users, sessions: a.sessions + r.sessions, engaged: a.engaged + r.engaged_sessions, views: a.views + r.page_views }), { users: 0, sessions: 0, engaged: 0, views: 0 });
    return { ...s, rate: s.sessions ? s.engaged / s.sessions : null };
  };
  const c = sum(cur)!;
  const pr = sum(prevRes.data);
  const { data: landing } = await db.rpc("ga_breakdown", { p_site: w.id, p_dim: "landing", p_from: p.from, p_to: p.to, p_limit: 10 });
  return {
    source: cur.some((r) => r.source === "demo") ? "demo" : "ga4",
    channel: "Organic Search",
    totals: {
      sessions: metric(c.sessions, pr?.sessions ?? null),
      users: metric(c.users, pr?.users ?? null),
      engagedSessions: metric(c.engaged, pr?.engaged ?? null),
      pageViews: metric(c.views, pr?.views ?? null),
      engagementRate: metric(c.rate, pr?.rate ?? null),
    },
    allSessions: metric(sum(all)?.sessions ?? null, sum(allPrevRes.data)?.sessions ?? null),
    daily: cur.map((r) => ({ date: r.date, sessions: r.sessions, users: r.users })),
    landingPages: (landing ?? []).map((r) => ({ key: r.key ?? "", sessions: Number(r.sessions ?? 0), users: Number(r.users ?? 0) })),
  };
}

async function rankingSection(db: Reader, w: Website, p: Period): Promise<RankingSection | Unavailable> {
  const keywords = await selectAll((from, to) => db.from("keywords").select("id, keyword").eq("website_id", w.id).eq("is_tracked", true).order("id").range(from, to));
  if (!keywords.length) return none("No tracked keywords.");
  const since = p.compareTo ?? p.from;
  // look back up to 30 days before the comparison date so the latest snapshot on that day is found
  const lookback = new Date(new Date(`${since}T00:00:00Z`).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const rows = await selectAll((from, to) =>
    db
      .from("keyword_rankings")
      .select("keyword_id, checked_on, position, source, keywords!inner(website_id, is_tracked)")
      .eq("keywords.website_id", w.id)
      .eq("keywords.is_tracked", true)
      .gte("checked_on", lookback)
      .lte("checked_on", p.to)
      .order("checked_on")
      .range(from, to),
  );
  if (!rows.length) return none("No rank checks were recorded for this period (rank provider not connected or keywords not checked yet).");
  const typed = rows.map((r) => ({ keyword_id: r.keyword_id, checked_on: r.checked_on, position: r.position }));
  const after = positionsAt(typed, p.to);
  const before = p.compareTo ? positionsAt(typed, p.compareTo) : null;
  const da = distribution(after);
  const db_ = before ? distribution(before) : null;
  const names = new Map(keywords.map((k) => [k.id, k.keyword]));
  const mv = before ? movers(before, after, names) : { improved: [], declined: [] };
  const lastOn = typed.filter((r) => r.checked_on <= p.to).reduce<string | null>((m, r) => (!m || r.checked_on > m ? r.checked_on : m), null);
  const prevOn = p.compareTo ? typed.filter((r) => r.checked_on <= p.compareTo!).reduce<string | null>((m, r) => (!m || r.checked_on > m ? r.checked_on : m), null) : null;
  return {
    source: w.is_demo ? "demo" : [...new Set(rows.map((r) => r.source))].join(", "),
    tracked: keywords.length,
    checkedAt: lastOn,
    comparedAt: prevOn,
    distribution: [...BUCKETS.map((b) => b.bucket), "Not in top 100"].map((bucket) => ({ bucket, current: da[bucket], previous: db_ ? db_[bucket] : null })),
    averagePosition: metric(averagePosition(after), before ? averagePosition(before) : null),
    improved: mv.improved,
    declined: mv.declined,
  };
}

async function tasksSection(db: Reader, w: Website, p: Period): Promise<TasksSection> {
  const [{ count: created }, { count: completed }, { count: open }, { count: overdue }] = await Promise.all([
    db.from("seo_tasks").select("id", { count: "exact", head: true }).eq("website_id", w.id).gte("created_at", `${p.from}T00:00:00Z`).lte("created_at", endOf(p.to)),
    db.from("seo_tasks").select("id", { count: "exact", head: true }).eq("website_id", w.id).gte("completed_at", `${p.from}T00:00:00Z`).lte("completed_at", endOf(p.to)),
    db.from("seo_tasks").select("id", { count: "exact", head: true }).eq("website_id", w.id).in("status", ["todo", "in_progress"]),
    db.from("seo_tasks").select("id", { count: "exact", head: true }).eq("website_id", w.id).in("status", ["todo", "in_progress"]).lt("due_date", p.to),
  ]);
  return { source: "tasks", created: created ?? 0, completed: completed ?? 0, open: open ?? 0, overdue: overdue ?? 0 };
}

export async function buildSnapshot(type: ReportType, website: Website, period: Period, opts: { reader?: Reader; now?: Date } = {}): Promise<ReportSnapshot> {
  const db = opts.reader ?? (await createClient());
  const now = opts.now ?? new Date();
  const want = new Set(SECTIONS[type]);
  const [audit, search, traffic, rankings, tasks] = await Promise.all([
    want.has("audit") ? auditSection(db, website, period, now) : undefined,
    want.has("search") ? searchSection(db, website, period) : undefined,
    want.has("traffic") ? trafficSection(db, website, period) : undefined,
    want.has("rankings") ? rankingSection(db, website, period) : undefined,
    want.has("tasks") ? tasksSection(db, website, period) : undefined,
  ]);
  const base: Omit<ReportSnapshot, "highlights"> = {
    version: 1,
    type,
    generatedAt: now.toISOString(),
    website: { id: website.id, name: website.name, domain: website.domain, isDemo: website.is_demo },
    period,
    ...(audit && { audit }),
    ...(search && { search }),
    ...(traffic && { traffic }),
    ...(rankings && { rankings }),
    ...(tasks && { tasks }),
  };
  return { ...base, highlights: type === "monthly" || type === "overview" ? highlights(base) : [] };
}

/** Builds and stores a report. Authorization (member of the website's organization) happens in the caller. */
export async function createReport(opts: { type: ReportType; website: Website; period: Period; userId: string; title?: string; reader?: Reader }) {
  const snapshot = await buildSnapshot(opts.type, opts.website, opts.period, { reader: opts.reader });
  const title = (opts.title?.trim() || `${REPORT_LABEL[opts.type]} — ${opts.website.domain} — ${opts.period.from} to ${opts.period.to}`).slice(0, 200);
  const db = createAdminClient();
  const { data, error } = await db
    .from("reports")
    .insert({
      organization_id: opts.website.organization_id,
      website_id: opts.website.id,
      type: opts.type,
      title,
      date_from: opts.period.from,
      date_to: opts.period.to,
      compare_from: opts.period.compareFrom,
      compare_to: opts.period.compareTo,
      compare_mode: opts.period.compareMode,
      status: "ready",
      snapshot: snapshot as unknown as Json,
      snapshot_version: snapshot.version,
      created_by: opts.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not store the report: ${error?.message}`);
  await recordUsage({ orgId: opts.website.organization_id, websiteId: opts.website.id, metric: "reports", quantity: 1, metadata: { type: opts.type } });
  return data.id;
}
