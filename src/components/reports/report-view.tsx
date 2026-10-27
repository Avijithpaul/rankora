import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { CATEGORY_LABEL } from "@/lib/audit/labels";
import { isUnavailable, REPORT_LABEL, type Metric, type ReportSnapshot, type Unavailable } from "@/lib/reports/compose";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { Delta } from "@/components/analytics/controls";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge, DemoDataBadge, SeverityBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

const SOURCE_LABEL: Record<string, string> = { crawl: "Rankora crawl", gsc: "Google Search Console", ga4: "Google Analytics 4", tasks: "Rankora tasks" };

function Source({ source }: { source: string }) {
  return source === "demo" ? <DemoDataBadge /> : <Badge tone="success">{SOURCE_LABEL[source] ?? source}</Badge>;
}

function Section({ title, source, children }: { title: string; source?: string; children: ReactNode }) {
  return (
    <Card className="report-section">
      <CardHeader title={title} action={source ? <Source source={source} /> : undefined} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function Missing({ title, s }: { title: string; s: Unavailable }) {
  return (
    <Card className="report-section">
      <CardHeader title={title} action={<Badge>No data</Badge>} />
      <CardBody className="text-sm text-muted">{s.reason} Nothing is estimated.</CardBody>
    </Card>
  );
}

function Kpi({ label, m, format = (v) => formatNumber(v), goodWhen = "up", compare }: { label: string; m: Metric; format?: (v: number) => string; goodWhen?: "up" | "down"; compare: boolean }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular text-xl font-semibold text-ink">{m.current === null ? "—" : format(m.current)}</div>
      {compare && (
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          <Delta value={m.change} goodWhen={goodWhen} /> <span>vs {m.previous === null ? "—" : format(m.previous)}</span>
        </div>
      )}
    </div>
  );
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const posFmt = (v: number) => v.toFixed(1);

function KeyTable({ rows, cols }: { rows: Record<string, string | number | null>[]; cols: { key: string; label: string; num?: boolean }[] }) {
  if (!rows.length) return <p className="text-sm text-muted">No rows.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted">
        <tr className="border-b border-line">
          {cols.map((c) => (
            <th key={c.key} className={cn("py-1.5 font-medium", c.num && "text-right")}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c.key} className={cn("py-1.5", c.num ? "tabular text-right" : "max-w-[18rem] truncate")}>
                {r[c.key] === null ? "—" : c.num && typeof r[c.key] === "number" ? formatNumber(r[c.key] as number) : r[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Renders a frozen report snapshot. Used on screen and for printing. */
export function ReportView({ title, snapshot: s }: { title: string; snapshot: ReportSnapshot }) {
  const compare = Boolean(s.period.compareFrom);
  return (
    <div className="space-y-4">
      <div className="report-section rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-brand">{REPORT_LABEL[s.type]}</p>
            <h1 className="mt-1 text-xl font-semibold text-ink">{title}</h1>
            <p className="mt-1 text-sm text-muted">
              {s.website.name} · {s.website.domain} · {formatDate(s.period.from)} – {formatDate(s.period.to)} ({s.period.days} days)
              {compare && ` vs ${formatDate(s.period.compareFrom)} – ${formatDate(s.period.compareTo)}`}
            </p>
            <p className="text-xs text-muted">Generated {formatDate(s.generatedAt, { hour: "2-digit", minute: "2-digit" })} · numbers frozen at generation time</p>
          </div>
          {s.website.isDemo && <DemoDataBadge />}
        </div>
        {s.website.isDemo && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-demo-soft px-3 py-2 text-sm text-demo" role="note">
            <FlaskConical className="size-4 shrink-0" aria-hidden /> Demo Data — this report was built from the sample Demo Project, not from live analytics, rankings or audits.
          </p>
        )}
      </div>

      {s.highlights.length > 0 && (
        <Section title="Highlights" source={s.website.isDemo ? "demo" : undefined}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {s.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Generated from the numbers below by fixed rules — not AI.</p>
        </Section>
      )}

      {s.audit &&
        (isUnavailable(s.audit) ? (
          <Missing title="Site audit" s={s.audit} />
        ) : (
          <Section title="Site audit" source={s.audit.source}>
            {s.audit.audit && (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Kpi label="SEO health score" m={{ current: s.audit.audit.score, previous: s.audit.previous?.score ?? null, change: null }} format={(v) => `${Math.round(v)}/100`} compare={Boolean(s.audit.previous)} />
                  <Kpi label="Pages analyzed" m={{ current: s.audit.audit.pagesAnalyzed, previous: null, change: null }} compare={false} />
                  <Kpi label="New issues in period" m={{ current: s.audit.newIssues, previous: null, change: null }} compare={false} />
                  <Kpi label="Issues fixed in period" m={{ current: s.audit.fixedIssues, previous: null, change: null }} compare={false} />
                </div>
                <p className="mt-2 text-xs text-muted">
                  Audit of {formatDate(s.audit.audit.createdAt)}
                  {s.audit.previous && ` compared with ${formatDate(s.audit.previous.createdAt)}`} · {s.audit.audit.critical} critical · {s.audit.audit.warning} warnings · {s.audit.audit.opportunity} opportunities ·{" "}
                  {s.audit.audit.passed} passed
                </p>
                {Object.keys(s.audit.audit.categories).length > 0 && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {Object.entries(s.audit.audit.categories).map(([k, v]) => (
                      <div key={k} className="text-sm">
                        <div className="flex justify-between">
                          <span>{CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] ?? k}</span>
                          <span className="tabular">{v}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                          <div className={cn("animate-grow-x h-full rounded-full", v >= 85 ? "bg-success" : v >= 60 ? "bg-warning" : "bg-critical")} style={{ width: `${Math.max(2, v)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {s.audit.openIssues.length > 0 && (
              <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
                {s.audit.openIssues.map((i) => (
                  <li key={i.title} className="flex items-center gap-2 py-1.5">
                    <SeverityBadge severity={i.severity as "critical"} /> <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <span className="tabular text-xs text-muted">{i.pages} pages</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ))}

      {s.search &&
        (isUnavailable(s.search) ? (
          <Missing title="Search performance" s={s.search} />
        ) : (
          <Section title="Search performance" source={s.search.source}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Clicks" m={s.search.totals.clicks} compare={compare} />
              <Kpi label="Impressions" m={s.search.totals.impressions} compare={compare} />
              <Kpi label="CTR" m={s.search.totals.ctr} format={pct} compare={compare} />
              <Kpi label="Average position" m={s.search.totals.position} format={posFmt} goodWhen="down" compare={compare} />
            </div>
            <div className="mt-4">
              <TrendChart data={s.search.daily} series={[{ key: "clicks", label: "Clicks", color: "var(--chart-1)" }, { key: "impressions", label: "Impressions", color: "var(--chart-2)" }]} height={200} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <KeyTable rows={s.search.topQueries.map((r) => ({ ...r, position: r.position === null ? null : r.position.toFixed(1) }))} cols={[{ key: "key", label: "Top queries" }, { key: "clicks", label: "Clicks", num: true }, { key: "impressions", label: "Impr.", num: true }, { key: "position", label: "Pos." }]} />
              <KeyTable rows={s.search.topPages.map((r) => ({ ...r, key: r.key.replace(/^https?:\/\/[^/]+/, "") || "/" }))} cols={[{ key: "key", label: "Top pages" }, { key: "clicks", label: "Clicks", num: true }, { key: "impressions", label: "Impr.", num: true }]} />
            </div>
          </Section>
        ))}

      {s.traffic &&
        (isUnavailable(s.traffic) ? (
          <Missing title="Organic traffic" s={s.traffic} />
        ) : (
          <Section title="Organic traffic (GA4 · Organic Search)" source={s.traffic.source}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Kpi label="Organic sessions" m={s.traffic.totals.sessions} compare={compare} />
              <Kpi label="Users" m={s.traffic.totals.users} compare={compare} />
              <Kpi label="Views" m={s.traffic.totals.pageViews} compare={compare} />
              <Kpi label="Engagement rate" m={s.traffic.totals.engagementRate} format={pct} compare={compare} />
              <Kpi label="All-channel sessions" m={s.traffic.allSessions} compare={compare} />
            </div>
            <p className="mt-1 text-xs text-muted">Users are summed daily unique users, so a returning visitor can count more than once.</p>
            <div className="mt-4">
              <TrendChart data={s.traffic.daily} series={[{ key: "sessions", label: "Sessions", color: "var(--chart-1)" }, { key: "users", label: "Users", color: "var(--chart-2)" }]} height={200} />
            </div>
            <div className="mt-4">
              <KeyTable rows={s.traffic.landingPages} cols={[{ key: "key", label: "Top landing pages" }, { key: "sessions", label: "Sessions", num: true }, { key: "users", label: "Users", num: true }]} />
            </div>
          </Section>
        ))}

      {s.rankings &&
        (isUnavailable(s.rankings) ? (
          <Missing title="Keyword rankings" s={s.rankings} />
        ) : (
          <Section title="Keyword rankings" source={s.rankings.source.includes("demo") ? "demo" : s.rankings.source}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Tracked keywords" m={{ current: s.rankings.tracked, previous: null, change: null }} compare={false} />
              <Kpi label="Average position (ranking keywords)" m={s.rankings.averagePosition} format={posFmt} goodWhen="down" compare={compare} />
              <Kpi label="Improved" m={{ current: s.rankings.improved.length, previous: null, change: null }} compare={false} />
              <Kpi label="Declined" m={{ current: s.rankings.declined.length, previous: null, change: null }} compare={false} />
            </div>
            <p className="mt-2 text-xs text-muted">
              Latest check {s.rankings.checkedAt ? formatDate(s.rankings.checkedAt) : "—"}
              {s.rankings.comparedAt && ` · compared with ${formatDate(s.rankings.comparedAt)}`}
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <KeyTable rows={s.rankings.distribution.map((d) => ({ ...d }))} cols={[{ key: "bucket", label: "Position" }, { key: "current", label: "Now", num: true }, ...(compare ? [{ key: "previous", label: "Before", num: true }] : [])]} />
              <KeyTable rows={s.rankings.improved.map((m) => ({ keyword: m.keyword, from: m.from === null ? ">100" : m.from, to: m.to === null ? ">100" : m.to }))} cols={[{ key: "keyword", label: "Improved" }, { key: "from", label: "From" }, { key: "to", label: "To" }]} />
              <KeyTable rows={s.rankings.declined.map((m) => ({ keyword: m.keyword, from: m.from === null ? ">100" : m.from, to: m.to === null ? ">100" : m.to }))} cols={[{ key: "keyword", label: "Declined" }, { key: "from", label: "From" }, { key: "to", label: "To" }]} />
            </div>
          </Section>
        ))}

      {s.tasks && !isUnavailable(s.tasks) && (
        <Section title="SEO tasks" source="tasks">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Created in period" m={{ current: s.tasks.created, previous: null, change: null }} compare={false} />
            <Kpi label="Completed in period" m={{ current: s.tasks.completed, previous: null, change: null }} compare={false} />
            <Kpi label="Open now" m={{ current: s.tasks.open, previous: null, change: null }} compare={false} />
            <Kpi label="Overdue at period end" m={{ current: s.tasks.overdue, previous: null, change: null }} compare={false} />
          </div>
        </Section>
      )}
    </div>
  );
}
