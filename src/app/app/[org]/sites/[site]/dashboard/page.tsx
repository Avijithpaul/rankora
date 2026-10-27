import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, KeyRound, LineChart, ScanSearch, SearchCheck } from "lucide-react";
import { requireWebsite } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { countryName, languageName } from "@/lib/locales";
import { movementFromKeywords, relativeChange } from "@/lib/dashboard/metrics";
import { selectAll } from "@/lib/supabase/paginate";

type TopRow = { key: string; clicks: number; impressions: number; ctr: number | null; position: number | null };
import { formatDate, formatNumber, formatPercent } from "@/lib/utils";
import { Badge, DemoDataBadge, SeverityBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ScoreRing } from "@/components/ui/score-ring";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { TrendChart } from "@/components/charts/trend-chart";

export const metadata: Metadata = { title: "Dashboard" };

const DAYS = 28;

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);

export default async function DashboardPage({ params }: PageProps<"/app/[org]/sites/[site]/dashboard">) {
  const { org: orgSlug, site: siteId } = await params;
  const { website } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${website.id}`;
  const since = isoDaysAgo(DAYS);
  const prevSince = isoDaysAgo(DAYS * 2);

  const [audit, issues, issueCounts, tracked, integrations, gsc, ga, queries, pages, dist, trackedRows] = await Promise.all([
    supabase
      .from("seo_audits")
      .select("score, pages_analyzed, created_at")
      .eq("website_id", website.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("seo_issues")
      .select("id, title, severity, affected_pages_count")
      .eq("website_id", website.id)
      .eq("status", "open")
      .order("severity", { ascending: true })
      .order("affected_pages_count", { ascending: false })
      .limit(6),
    supabase.from("seo_issues").select("severity").eq("website_id", website.id).eq("status", "open"),
    supabase.from("keywords").select("id", { count: "exact", head: true }).eq("website_id", website.id).eq("is_tracked", true),
    supabase.from("integrations").select("provider, status").eq("website_id", website.id),
    supabase
      .from("search_console_daily")
      .select("date, clicks, impressions, position, source")
      .eq("website_id", website.id)
      .eq("device", "all")
      .eq("country", "all")
      .gte("date", prevSince)
      .order("date"),
    supabase
      .from("analytics_daily")
      .select("date, users, sessions, source")
      .eq("website_id", website.id)
      .eq("channel", "Organic Search")
      .eq("device", "all")
      .eq("country", "all")
      .gte("date", prevSince)
      .order("date"),
    // aggregated in SQL (no Data API row cap)
    supabase.rpc("gsc_breakdown", { p_site: website.id, p_dim: "query", p_from: since, p_to: isoDaysAgo(0), p_limit: 5 }),
    supabase.rpc("gsc_breakdown", { p_site: website.id, p_dim: "page", p_from: since, p_to: isoDaysAgo(0), p_limit: 5 }),
    supabase.rpc("rank_distribution", { p_site: website.id, p_from: isoDaysAgo(30) }),
    selectAll((from, to) =>
      supabase
        .from("keywords")
        .select("current_position, previous_position, last_checked_on, previous_checked_on")
        .eq("website_id", website.id)
        .eq("is_tracked", true)
        .range(from, to),
    ),
  ]);

  const latest = audit.data;
  const status = (p: string) => integrations.data?.find((i) => i.provider === p)?.status ?? "disconnected";
  const openBySeverity = (sev: string) => (issueCounts.data ?? []).filter((i) => i.severity === sev).length;

  // Current vs previous period
  const gscAll = gsc.data ?? [];
  const gscCur = gscAll.filter((r) => r.date >= since);
  const gscPrev = gscAll.filter((r) => r.date < since);
  const gaAll = ga.data ?? [];
  const gaCur = gaAll.filter((r) => r.date >= since);
  const gaPrev = gaAll.filter((r) => r.date < since);
  const hasGsc = gscCur.length > 0;
  const hasGa = gaCur.length > 0;
  const gscDemo = gscAll.some((r) => r.source === "demo");
  const gaDemo = gaAll.some((r) => r.source === "demo");

  const clicks = sum(gscCur, (r) => r.clicks);
  const impressions = sum(gscCur, (r) => r.impressions);
  const prevClicks = sum(gscPrev, (r) => r.clicks);
  const prevImpr = sum(gscPrev, (r) => r.impressions);
  const avgPos = (rows: typeof gscCur) => {
    const impr = sum(rows, (r) => r.impressions);
    return impr > 0 ? sum(rows, (r) => (r.position ?? 0) * r.impressions) / impr : null;
  };
  const position = avgPos(gscCur);
  const prevPosition = avgPos(gscPrev);
  const ctr = impressions ? clicks / impressions : null;
  const prevCtr = prevImpr ? prevClicks / prevImpr : null;
  const users = sum(gaCur, (r) => r.users);
  const sessions = sum(gaCur, (r) => r.sessions);
  const hasPrevGsc = gscPrev.length > 0;
  const hasPrevGa = gaPrev.length > 0;

  const toTop = (rows: { key: string | null; clicks: number | null; impressions: number | null; ctr: number | null; avg_position: number | null }[] | null): TopRow[] =>
    (rows ?? []).map((r) => ({ key: r.key ?? "", clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0), ctr: r.ctr === null ? null : Number(r.ctr), position: r.avg_position === null ? null : Number(r.avg_position) }));
  const topQueries = toTop(queries.data);
  const topPages = toTop(pages.data);
  const distRows = dist.data ?? [];
  const movement = movementFromKeywords(trackedRows);
  const top10Trend = distRows.map((d) => ({ date: d.date ?? "", count: Number(d.top3 ?? 0) + Number(d.top10 ?? 0) }));
  const ranksDemo = distRows.some((r) => r.source === "demo");
  const queriesDemo = (queries.data ?? []).some((r) => r.source === "demo");
  const rankRows = distRows;

  const actions: { title: string; body: string; href: string; icon: typeof ScanSearch }[] = [];
  if (!latest) actions.push({ title: "Run your first site audit", body: "Get a baseline SEO score and a prioritised issue list.", href: `${base}/audit`, icon: ScanSearch });
  if (openBySeverity("critical") > 0)
    actions.push({ title: `Fix ${openBySeverity("critical")} critical issue${openBySeverity("critical") > 1 ? "s" : ""}`, body: "Critical issues have the largest effect on your score.", href: `${base}/audit`, icon: ScanSearch });
  if (!website.is_demo && status("google_search_console") !== "connected")
    actions.push({ title: "Connect Google Search Console", body: "See clicks, impressions, CTR and average position.", href: `${base}/integrations`, icon: SearchCheck });
  if (!website.is_demo && status("google_analytics_4") !== "connected")
    actions.push({ title: "Connect Google Analytics 4", body: "Measure organic users and sessions by landing page.", href: `${base}/integrations`, icon: BarChart3 });
  if (!tracked.count) actions.push({ title: "Add keywords to track", body: "Monitor rankings for the terms that matter.", href: `${base}/rank-tracker`, icon: KeyRound });

  const gscFooter = (text: string) => (hasGsc ? (gscDemo ? <DemoDataBadge /> : text) : <ConnectHint href={`${base}/integrations`} label="Connect Search Console" />);
  const gaFooter = (text: string) => (hasGa ? (gaDemo ? <DemoDataBadge /> : text) : <ConnectHint href={`${base}/integrations`} label="Connect GA4" />);

  return (
    <>
      <PageHeader
        title={website.name}
        badge={website.is_demo ? <DemoDataBadge /> : undefined}
        description={
          <>
            {website.is_demo ? (
              website.domain
            ) : (
              <a href={website.base_url} target="_blank" rel="noopener noreferrer" className="hover:text-brand">
                {website.domain}
              </a>
            )}{" "}
            · {countryName(website.country_code)} · {languageName(website.language_code)} · last {DAYS} days vs previous {DAYS}
          </>
        }
        actions={
          <ButtonLink href={`${base}/audit`} variant="secondary">
            <ScanSearch aria-hidden /> Site audit
          </ButtonLink>
        }
      />

      {/* Health + KPIs */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader
            title="SEO health score"
            description={latest ? `${formatNumber(latest.pages_analyzed)} pages audited · ${formatDate(latest.created_at)}` : "Calculated from your latest site audit"}
            action={website.is_demo && latest ? <DemoDataBadge /> : undefined}
          />
          <CardBody className="flex items-center gap-6">
            <ScoreRing score={latest ? Number(latest.score) : null} size={112} />
            {latest ? (
              <dl className="grid flex-1 grid-cols-2 gap-3 text-sm">
                <div>
                  <dt><SeverityBadge severity="critical" /></dt>
                  <dd className="tabular mt-1 text-lg font-semibold">{openBySeverity("critical")}</dd>
                </div>
                <div>
                  <dt><SeverityBadge severity="warning" /></dt>
                  <dd className="tabular mt-1 text-lg font-semibold">{openBySeverity("warning")}</dd>
                </div>
                <div>
                  <dt><SeverityBadge severity="opportunity" /></dt>
                  <dd className="tabular mt-1 text-lg font-semibold">{openBySeverity("opportunity")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Tracked pages</dt>
                  <dd className="tabular mt-1 text-lg font-semibold">{formatNumber(latest.pages_analyzed)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted">No audit has run yet. The score is never estimated — it is computed only from real crawl checks.</p>
            )}
          </CardBody>
        </Card>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:col-span-2">
          <StatCard label="Clicks" value={hasGsc ? formatNumber(clicks, { compact: true }) : "—"} delta={hasPrevGsc ? relativeChange(clicks, prevClicks) : null} footer={gscFooter("Search Console")} />
          <StatCard label="Impressions" value={hasGsc ? formatNumber(impressions, { compact: true }) : "—"} delta={hasPrevGsc ? relativeChange(impressions, prevImpr) : null} footer={gscFooter("Search Console")} />
          <StatCard label="CTR" value={hasGsc ? formatPercent(ctr) : "—"} delta={hasPrevGsc && ctr !== null && prevCtr ? relativeChange(ctr, prevCtr) : null} footer={gscFooter("Clicks ÷ impressions")} />
          <StatCard
            label="Avg. Google position"
            value={position ? position.toFixed(1) : "—"}
            delta={hasPrevGsc && position && prevPosition ? relativeChange(position, prevPosition) : null}
            deltaGoodWhen="down"
            hint="Impression-weighted. Lower is better."
            footer={gscFooter("Impression-weighted")}
          />
          <StatCard label="Organic traffic (sessions)" value={hasGa ? formatNumber(sessions, { compact: true }) : "—"} delta={hasPrevGa ? relativeChange(sessions, sum(gaPrev, (r) => r.sessions)) : null} footer={gaFooter("Google Analytics 4")} />
          <StatCard label="Organic users" value={hasGa ? formatNumber(users, { compact: true }) : "—"} delta={hasPrevGa ? relativeChange(users, sum(gaPrev, (r) => r.users)) : null} footer={gaFooter("Google Analytics 4")} />
        </div>
      </div>

      {/* Trends */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Search performance trend" description="Daily clicks and impressions" action={gscDemo ? <DemoDataBadge /> : hasGsc ? <Badge>Search Console</Badge> : undefined} />
          <CardBody>
            {hasGsc ? (
              <TrendChart
                data={gscCur.map((r) => ({ date: r.date, clicks: r.clicks, impressions: r.impressions }))}
                series={[
                  { key: "impressions", label: "Impressions", color: "var(--chart-2)" },
                  { key: "clicks", label: "Clicks", color: "var(--chart-1)" },
                ]}
              />
            ) : (
              <EmptyState icon={SearchCheck} title="No search data yet" description="Connect Google Search Console to see real clicks and impressions. This chart is never filled with estimates." className="py-10" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Organic traffic trend" description="Daily organic sessions and users" action={gaDemo ? <DemoDataBadge /> : hasGa ? <Badge>GA4</Badge> : undefined} />
          <CardBody>
            {hasGa ? (
              <TrendChart
                data={gaCur.map((r) => ({ date: r.date, sessions: r.sessions, users: r.users }))}
                series={[
                  { key: "sessions", label: "Sessions", color: "var(--chart-1)" },
                  { key: "users", label: "Users", color: "var(--chart-4)" },
                ]}
              />
            ) : (
              <EmptyState icon={BarChart3} title="No traffic data yet" description="Connect Google Analytics 4 to see organic sessions and users." className="py-10" />
            )}
          </CardBody>
        </Card>
      </div>

      {/* Rankings */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Keyword ranking trend" description="Tracked keywords ranking in Google's top 10, per day" action={ranksDemo ? <DemoDataBadge /> : undefined} />
          <CardBody>
            {top10Trend.length > 0 ? (
              <TrendChart data={top10Trend} series={[{ key: "count", label: "Keywords in top 10", color: "var(--chart-1)" }]} height={200} />
            ) : (
              <EmptyState icon={LineChart} title="No ranking history yet" description="Track keywords to collect daily rank snapshots." className="py-10" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Keyword tracking" description="Latest snapshot vs the previous one" />
          <CardBody>
            <p className="tabular text-3xl font-semibold">{formatNumber(tracked.count ?? 0)}</p>
            <p className="text-sm text-muted">tracked keywords</p>
            {rankRows.length > 0 ? (
              <>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  {(
                    [
                      ["Improved", movement.improved, "text-success"],
                      ["Dropped", movement.dropped, "text-critical"],
                      ["New", movement.new, "text-opportunity"],
                      ["Lost", movement.lost, "text-warning"],
                    ] as const
                  ).map(([label, n, cls]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className={`tabular text-lg font-semibold ${cls}`}>{n}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
                  Top 3: <b className="text-ink">{movement.distribution.top3}</b> · Top 10: <b className="text-ink">{movement.distribution.top10}</b> · Top 20:{" "}
                  <b className="text-ink">{movement.distribution.top20}</b> · Top 100: <b className="text-ink">{movement.distribution.top100}</b>
                </div>
              </>
            ) : (
              <p className="mt-4 text-xs text-muted">Improved / dropped counts appear once rank snapshots are collected.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Top queries + pages */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <TopTable
          title="Top search queries"
          rows={topQueries}
          demo={queriesDemo}
          emptyHint="Query-level data comes from Google Search Console."
          render={(k) => k}
        />
        <TopTable
          title="Top pages"
          rows={topPages}
          demo={queriesDemo}
          emptyHint="Page-level search data comes from Google Search Console."
          render={(k) => {
            try {
              return new URL(k).pathname;
            } catch {
              return k;
            }
          }}
        />
      </div>

      {/* Issues + actions */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent SEO issues" description="Open issues, most severe first" action={website.is_demo && issues.data?.length ? <DemoDataBadge /> : undefined} />
          {issues.data && issues.data.length > 0 ? (
            <ul className="divide-y divide-line">
              {issues.data.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <SeverityBadge severity={i.severity} />
                  <span className="min-w-0 flex-1 truncate text-ink">{i.title}</span>
                  <span className="tabular shrink-0 text-xs text-muted">{formatNumber(i.affected_pages_count)} pages</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={ScanSearch} title="No issues to show" description="Issues appear here after a site audit runs." className="py-10" />
          )}
        </Card>
        <Card>
          <CardHeader title="Recommended actions" />
          <ul className="divide-y divide-line">
            {actions.length === 0 && <li className="px-5 py-4 text-sm text-muted">You&apos;re all set up.</li>}
            {actions.map((a) => (
              <li key={a.title}>
                <Link href={a.href} className="group flex items-start gap-3 px-5 py-3.5 hover:bg-surface-2/60">
                  <a.icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{a.title}</span>
                    <span className="block text-xs text-muted">{a.body}</span>
                  </span>
                  <ArrowRight className="mt-0.5 size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function TopTable({
  title,
  rows,
  demo,
  emptyHint,
  render,
}: {
  title: string;
  rows: TopRow[];
  demo: boolean;
  emptyHint: string;
  render: (key: string) => string;
}) {
  return (
    <Card>
      <CardHeader title={title} description={`Last ${DAYS} days, by clicks`} action={demo ? <DemoDataBadge /> : undefined} />
      {rows.length === 0 ? (
        <EmptyState icon={SearchCheck} title="Nothing to show yet" description={emptyHint} className="py-10" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2 font-medium">{title.includes("pages") ? "Page" : "Query"}</th>
                <th className="px-3 py-2 text-right font-medium">Clicks</th>
                <th className="px-3 py-2 text-right font-medium">Impr.</th>
                <th className="px-3 py-2 text-right font-medium">CTR</th>
                <th className="px-5 py-2 text-right font-medium">Pos.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="max-w-[16rem] truncate px-5 py-2.5 text-ink" title={r.key}>
                    {render(r.key)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{formatNumber(r.clicks)}</td>
                  <td className="tabular px-3 py-2.5 text-right text-muted">{formatNumber(r.impressions, { compact: true })}</td>
                  <td className="tabular px-3 py-2.5 text-right text-muted">{formatPercent(r.ctr)}</td>
                  <td className="tabular px-5 py-2.5 text-right text-muted">{r.position?.toFixed(1) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ConnectHint({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="font-medium text-brand hover:underline">
      {label} →
    </Link>
  );
}
