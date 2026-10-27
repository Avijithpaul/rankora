import type { Metadata } from "next";
import { requireWebsite } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { change, dailySeries, resolveRange, searchTotals } from "@/lib/analytics/ranges";
import { sourceState } from "@/lib/analytics/source";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { DataTable, Delta, fmt, RangeBar, SourceLine, SourceNotice, Tabs, type Column } from "@/components/analytics/controls";

export const metadata: Metadata = { title: "Search Performance" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "queries", label: "Queries" },
  { key: "pages", label: "Pages" },
  { key: "countries", label: "Countries" },
  { key: "devices", label: "Devices" },
];
const DIM: Record<string, string> = { queries: "query", pages: "page", countries: "country", devices: "device" };

type Row = { key: string; clicks: number; impressions: number; ctr: number | null; position: number | null; prev?: { clicks: number; impressions: number; ctr: number | null; position: number | null } | null };

export default async function SearchPerformancePage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/search-performance">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website } = await requireWebsite(orgSlug, siteId);
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as string) : "overview";
  const range = resolveRange(sp);
  const state = await sourceState(website, "google_search_console");
  const href = (t: string) => `${base}/search-performance?${new URLSearchParams({ tab: t, range: range.key, from: range.from, to: range.to, compare: range.compare })}`;

  const header = (
    <PageHeader title="Search Performance" badge={<SourceLine state={state} label="Google Search Console" />} description="Clicks, impressions, CTR and average position in Google Search." />
  );
  if (state.kind !== "ready" && state.kind !== "demo") {
    return (
      <>
        {header}
        <SourceNotice state={state} name="Search Console" integrationsHref={`${base}/integrations`} />
      </>
    );
  }

  const supabase = await createClient();
  const daily = (from: string, to: string) =>
    supabase
      .from("search_console_daily")
      .select("date, clicks, impressions, position, ctr")
      .eq("website_id", website.id)
      .eq("device", "all")
      .eq("country", "all")
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .limit(1000);
  const breakdown = async (dim: string, from: string, to: string, limit: number) => {
    const { data, error } = await supabase.rpc("gsc_breakdown", { p_site: website.id, p_dim: dim, p_from: from, p_to: to, p_limit: limit });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ key: r.key ?? "", clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0), ctr: r.ctr === null ? null : Number(r.ctr), position: r.avg_position === null ? null : Number(r.avg_position) }));
  };
  const withPrev = async (dim: string, limit: number): Promise<Row[]> => {
    const cur = await breakdown(dim, range.from, range.to, limit);
    if (!range.prevFrom) return cur;
    const prev = await breakdown(dim, range.prevFrom, range.prevTo!, 1000);
    const pm = new Map(prev.map((p) => [p.key, p]));
    return cur.map((c) => ({ ...c, prev: pm.get(c.key) ?? null }));
  };

  const [{ data: cur }, { data: prev }] = await Promise.all([daily(range.from, range.to), range.prevFrom ? daily(range.prevFrom, range.prevTo!) : Promise.resolve({ data: null })]);
  const totals = searchTotals((cur ?? []).map((r) => ({ clicks: r.clicks, impressions: r.impressions, position: r.position === null ? null : Number(r.position) })));
  const prevTotals = prev ? searchTotals(prev.map((r) => ({ clicks: r.clicks, impressions: r.impressions, position: r.position === null ? null : Number(r.position) }))) : null;
  const hasData = (cur ?? []).length > 0;

  const cols = (label: string, render?: (k: string) => React.ReactNode): Column<Row>[] => [
    { label, render: (r) => <span className="block max-w-[28rem] truncate text-ink" title={r.key}>{render ? render(r.key) : r.key}</span> },
    { label: "Clicks", align: "right", render: (r) => fmt.n(r.clicks) },
    ...(range.prevFrom ? [{ label: "Δ", align: "right" as const, render: (r: Row) => <Delta value={r.prev ? change(r.clicks, r.prev.clicks) : null} /> }] : []),
    { label: "Impressions", align: "right", render: (r) => fmt.n(r.impressions) },
    { label: "CTR", align: "right", render: (r) => fmt.pct(r.ctr) },
    { label: "Position", align: "right", render: (r) => fmt.pos(r.position) },
    ...(range.prevFrom ? [{ label: "Δ pos.", align: "right" as const, render: (r: Row) => (r.prev?.position && r.position ? <span className={r.position < r.prev.position ? "text-success" : r.position > r.prev.position ? "text-critical" : "text-muted"}>{(r.prev.position - r.position).toFixed(1)}</span> : "—") }] : []),
  ];
  const pathOf = (u: string) => {
    try {
      const x = new URL(u);
      return x.pathname + x.search;
    } catch {
      return u;
    }
  };

  return (
    <>
      {header}
      <div className="space-y-4">
        <RangeBar range={range} tab={tab} action={`${base}/search-performance`} />
        <Tabs tabs={TABS} active={tab} href={href} />

        {tab === "overview" && (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Clicks" value={hasData ? fmt.n(totals.clicks) : "—"} delta={prevTotals ? change(totals.clicks, prevTotals.clicks) : null} />
              <StatCard label="Impressions" value={hasData ? fmt.n(totals.impressions) : "—"} delta={prevTotals ? change(totals.impressions, prevTotals.impressions) : null} />
              <StatCard label="CTR" value={fmt.pct(totals.ctr)} delta={prevTotals ? change(totals.ctr, prevTotals.ctr) : null} />
              <StatCard label="Average position" value={fmt.pos(totals.position)} delta={prevTotals ? change(totals.position, prevTotals.position) : null} deltaGoodWhen="down" hint="Impression-weighted. Lower is better." />
            </div>
            <Card>
              <CardHeader title="Clicks and impressions" description="Per day" />
              <CardBody>
                {hasData ? (
                  <TrendChart
                    data={dailySeries((cur ?? []).map((r) => ({ ...r, position: r.position === null ? null : Number(r.position) })), range.from, range.to, (l) => ({ clicks: l[0].clicks, impressions: l[0].impressions }))}
                    series={[
                      { key: "impressions", label: "Impressions", color: "var(--chart-2)" },
                      { key: "clicks", label: "Clicks", color: "var(--chart-1)" },
                    ]}
                  />
                ) : (
                  <p className="py-10 text-center text-sm text-muted">No Search Console data for this period.</p>
                )}
              </CardBody>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Top queries" />
                <DataTable rows={(await withPrev("query", 10)) as Row[]} columns={cols("Query").slice(0, 4)} rowKey={(r) => r.key} />
              </Card>
              <Card>
                <CardHeader title="Top pages" />
                <DataTable rows={(await withPrev("page", 10)) as Row[]} columns={cols("Page", pathOf).slice(0, 4)} rowKey={(r) => r.key} />
              </Card>
            </div>
          </>
        )}

        {tab !== "overview" && (
          <Card>
            <CardHeader
              title={TABS.find((t) => t.key === tab)!.label}
              description={tab === "countries" ? "ISO 3166 alpha-3 codes as reported by Google" : tab === "queries" ? "Google hides rare (anonymized) queries, so totals here can be lower than the overview" : undefined}
            />
            <DataTable
              rows={await withPrev(DIM[tab], tab === "devices" ? 10 : 500)}
              columns={cols(tab === "queries" ? "Query" : tab === "pages" ? "Page" : tab === "countries" ? "Country" : "Device", tab === "pages" ? pathOf : tab === "countries" || tab === "devices" ? (k) => k.toUpperCase() : undefined)}
              rowKey={(r) => r.key}
              empty={state.kind === "demo" && (tab === "countries" || tab === "devices") ? "The Demo Project's sample dataset has no country or device breakdown." : "No data for this period."}
            />
          </Card>
        )}
      </div>
    </>
  );
}
