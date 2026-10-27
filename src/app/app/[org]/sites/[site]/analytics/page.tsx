import type { Metadata } from "next";
import { requireWebsite } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { change, dailySeries, resolveRange } from "@/lib/analytics/ranges";
import { sourceState } from "@/lib/analytics/source";
import { formatNumber } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { DataTable, Delta, fmt, RangeBar, SourceLine, SourceNotice, Tabs, type Column } from "@/components/analytics/controls";

export const metadata: Metadata = { title: "Analytics" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "traffic", label: "Traffic" },
  { key: "pages", label: "Pages" },
  { key: "acquisition", label: "Acquisition" },
  { key: "countries", label: "Countries" },
  { key: "devices", label: "Devices" },
];

type Daily = { date: string; users: number; new_users: number; sessions: number; engaged_sessions: number; page_views: number; engagement_rate: number | null; avg_engagement_time_seconds: number | null };
type BRow = { key: string; users: number; new_users: number; sessions: number; engaged_sessions: number; page_views: number; prev?: BRow | null };

function sum(rows: Daily[]) {
  const t = { users: 0, new_users: 0, sessions: 0, engaged_sessions: 0, page_views: 0, engTime: 0, engDays: 0 };
  for (const r of rows) {
    t.users += r.users;
    t.new_users += r.new_users;
    t.sessions += r.sessions;
    t.engaged_sessions += r.engaged_sessions;
    t.page_views += r.page_views;
    if (r.avg_engagement_time_seconds !== null) {
      t.engTime += Number(r.avg_engagement_time_seconds) * r.users;
      t.engDays += r.users;
    }
  }
  return { ...t, engagementRate: t.sessions ? t.engaged_sessions / t.sessions : null, avgEngagement: t.engDays ? t.engTime / t.engDays : null };
}

const secs = (s: number | null) => (s === null ? "—" : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);

export default async function AnalyticsPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/analytics">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website } = await requireWebsite(orgSlug, siteId);
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as string) : "overview";
  const range = resolveRange(sp);
  const state = await sourceState(website, "google_analytics_4");
  const href = (t: string) => `${base}/analytics?${new URLSearchParams({ tab: t, range: range.key, from: range.from, to: range.to, compare: range.compare })}`;
  const header = (
    <PageHeader title="Analytics" badge={<SourceLine state={state} label="Google Analytics 4" />} description="Users, sessions, engagement and traffic sources from your GA4 property." />
  );
  if (state.kind !== "ready" && state.kind !== "demo") {
    return (
      <>
        {header}
        <SourceNotice state={state} name="Google Analytics" integrationsHref={`${base}/integrations`} />
      </>
    );
  }

  const supabase = await createClient();
  const daily = async (channel: string, from: string, to: string) => {
    const { data } = await supabase
      .from("analytics_daily")
      .select("date, users, new_users, sessions, engaged_sessions, page_views, engagement_rate, avg_engagement_time_seconds")
      .eq("website_id", website.id)
      .eq("channel", channel)
      .eq("device", "all")
      .eq("country", "all")
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .limit(1000);
    return (data ?? []) as Daily[];
  };
  const breakdown = async (dim: string, limit: number): Promise<BRow[]> => {
    const run = async (from: string, to: string, l: number) => {
      const { data, error } = await supabase.rpc("ga_breakdown", { p_site: website.id, p_dim: dim, p_from: from, p_to: to, p_limit: l });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ key: r.key ?? "", users: Number(r.users ?? 0), new_users: Number(r.new_users ?? 0), sessions: Number(r.sessions ?? 0), engaged_sessions: Number(r.engaged_sessions ?? 0), page_views: Number(r.page_views ?? 0) }));
    };
    const cur = await run(range.from, range.to, limit);
    if (!range.prevFrom) return cur;
    const pm = new Map((await run(range.prevFrom, range.prevTo!, 1000)).map((p) => [p.key, p]));
    return cur.map((c) => ({ ...c, prev: pm.get(c.key) ?? null }));
  };

  const [all, allPrev, organic, organicPrev] = await Promise.all([
    daily("all", range.from, range.to),
    range.prevFrom ? daily("all", range.prevFrom, range.prevTo!) : Promise.resolve(null),
    daily("Organic Search", range.from, range.to),
    range.prevFrom ? daily("Organic Search", range.prevFrom, range.prevTo!) : Promise.resolve(null),
  ]);
  const t = sum(all);
  const tp = allPrev ? sum(allPrev) : null;
  const o = sum(organic);
  const op = organicPrev ? sum(organicPrev) : null;
  const hasAll = all.length > 0;
  const demoOrganicOnly = state.kind === "demo" && !hasAll;
  const usersHint = "GA4 counts unique users per day; across several days these are summed, so a returning person can be counted more than once.";

  const cols = (label: string, metric: "sessions" | "page_views" = "sessions"): Column<BRow>[] => [
    { label, render: (r) => <span className="block max-w-[28rem] truncate text-ink" title={r.key}>{r.key}</span> },
    { label: metric === "sessions" ? "Sessions" : "Views", align: "right", render: (r) => fmt.n(r[metric]) },
    ...(range.prevFrom ? [{ label: "Δ", align: "right" as const, render: (r: BRow) => <Delta value={r.prev ? change(r[metric], r.prev[metric]) : null} /> }] : []),
    { label: "Users", align: "right", render: (r) => fmt.n(r.users) },
    { label: "Engaged sessions", align: "right", render: (r) => fmt.n(r.engaged_sessions) },
    { label: "Engagement rate", align: "right", render: (r) => fmt.pct(r.sessions ? r.engaged_sessions / r.sessions : null) },
    ...(metric === "sessions" ? [] : [{ label: "Sessions", align: "right" as const, render: (r: BRow) => fmt.n(r.sessions) }]),
  ];
  const noBreakdown = state.kind === "demo" ? "The Demo Project's sample dataset contains organic search traffic only." : "No data for this period.";

  return (
    <>
      {header}
      <div className="space-y-4">
        <RangeBar range={range} tab={tab} action={`${base}/analytics`} />
        <Tabs tabs={TABS} active={tab} href={href} />

        {tab === "overview" && (
          <>
            {demoOrganicOnly && <p className="text-sm text-demo">Demo Data: the sample dataset includes organic search traffic only, so site-wide totals are not available.</p>}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Users" hint={usersHint} value={hasAll ? fmt.n(t.users) : "—"} delta={tp && hasAll ? change(t.users, tp.users) : null} />
              <StatCard label="New users" value={hasAll ? fmt.n(t.new_users) : "—"} delta={tp && hasAll ? change(t.new_users, tp.new_users) : null} />
              <StatCard label="Sessions" value={hasAll ? fmt.n(t.sessions) : "—"} delta={tp && hasAll ? change(t.sessions, tp.sessions) : null} />
              <StatCard label="Views" value={hasAll ? fmt.n(t.page_views) : "—"} delta={tp && hasAll ? change(t.page_views, tp.page_views) : null} />
              <StatCard label="Engaged sessions" value={hasAll ? fmt.n(t.engaged_sessions) : "—"} delta={tp && hasAll ? change(t.engaged_sessions, tp.engaged_sessions) : null} />
              <StatCard label="Engagement rate" value={fmt.pct(t.engagementRate)} delta={tp ? change(t.engagementRate, tp.engagementRate) : null} />
              <StatCard label="Avg. engagement time" value={secs(t.avgEngagement)} hint="Per active user" />
              <StatCard label="Organic sessions" value={organic.length ? fmt.n(o.sessions) : "—"} delta={op ? change(o.sessions, op.sessions) : null} footer={organic.length ? `${fmt.n(o.users)} organic users` : "Channel: Organic Search"} />
            </div>
            <Card>
              <CardHeader title={hasAll ? "Sessions and users" : "Organic sessions and users"} description="Per day" />
              <CardBody>
                {(hasAll ? all : organic).length ? (
                  <TrendChart
                    data={dailySeries(hasAll ? all : organic, range.from, range.to, (l) => ({ sessions: l[0].sessions, users: l[0].users }))}
                    series={[
                      { key: "sessions", label: "Sessions", color: "var(--chart-1)" },
                      { key: "users", label: "Users", color: "var(--chart-4)" },
                    ]}
                  />
                ) : (
                  <p className="py-10 text-center text-sm text-muted">No Analytics data for this period.</p>
                )}
              </CardBody>
            </Card>
          </>
        )}

        {tab === "traffic" && (
          <Card>
            <CardHeader title="Daily traffic" description={hasAll ? "All channels" : "Organic Search"} />
            <CardBody>
              {(hasAll ? all : organic).length > 0 && (
                <TrendChart
                  data={dailySeries(hasAll ? all : organic, range.from, range.to, (l) => ({ views: l[0].page_views, sessions: l[0].sessions }))}
                  series={[
                    { key: "views", label: "Views", color: "var(--chart-2)" },
                    { key: "sessions", label: "Sessions", color: "var(--chart-1)" },
                  ]}
                />
              )}
            </CardBody>
            <DataTable
              rows={[...(hasAll ? all : organic)].reverse()}
              rowKey={(r) => r.date}
              columns={[
                { label: "Date", render: (r) => r.date },
                { label: "Users", align: "right", render: (r) => fmt.n(r.users) },
                { label: "New users", align: "right", render: (r) => fmt.n(r.new_users) },
                { label: "Sessions", align: "right", render: (r) => fmt.n(r.sessions) },
                { label: "Engaged", align: "right", render: (r) => fmt.n(r.engaged_sessions) },
                { label: "Views", align: "right", render: (r) => fmt.n(r.page_views) },
                { label: "Engagement rate", align: "right", render: (r) => fmt.pct(r.engagement_rate === null ? null : Number(r.engagement_rate)) },
              ]}
            />
          </Card>
        )}

        {tab === "pages" && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Top pages" description="By views (page path)" />
              <DataTable rows={await breakdown("page", 200)} columns={cols("Page", "page_views")} rowKey={(r) => r.key} empty={noBreakdown} />
            </Card>
            <Card>
              <CardHeader title="Landing pages" description="Where sessions start" />
              <DataTable rows={await breakdown("landing", 200)} columns={cols("Landing page")} rowKey={(r) => r.key} empty={noBreakdown} />
            </Card>
          </div>
        )}

        {tab === "acquisition" && (
          <Card>
            <CardHeader title="Traffic channels" description="GA4 default channel group" />
            <DataTable rows={await breakdown("channel", 50)} columns={cols("Channel")} rowKey={(r) => r.key} empty={noBreakdown} />
          </Card>
        )}

        {(tab === "countries" || tab === "devices") && (
          <Card>
            <CardHeader title={tab === "countries" ? "Countries" : "Devices"} />
            <DataTable rows={await breakdown(tab === "countries" ? "country" : "device", tab === "countries" ? 250 : 10)} columns={cols(tab === "countries" ? "Country" : "Device")} rowKey={(r) => r.key} empty={noBreakdown} />
          </Card>
        )}

        <p className="text-xs text-muted">
          {state.kind === "demo" ? "Demo Data — sample values, not live analytics." : `Source: Google Analytics 4 property ${state.integration.external_account_name ?? ""}. Totals may differ slightly from GA4 because users are summed per day. ${formatNumber(all.length)} days with data in range.`}
        </p>
      </div>
    </>
  );
}
