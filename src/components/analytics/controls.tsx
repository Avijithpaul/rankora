import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CalendarDays, Loader2, PlugZap } from "lucide-react";
import { PRESETS, type DateRange } from "@/lib/analytics/ranges";
import type { SourceState } from "@/lib/analytics/source";
import { cn, formatDate, formatNumber, formatPercent } from "@/lib/utils";
import { Badge, DemoDataBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/** GET form: preset or custom range + comparison. Keeps the current tab. */
export function RangeBar({ range, tab, action }: { range: DateRange; tab: string; action: string }) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3 text-sm">
      <input type="hidden" name="tab" value={tab} />
      <CalendarDays className="mb-2 size-4 text-muted" aria-hidden />
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Date range</span>
        <select name="range" defaultValue={range.key} className="h-9 rounded-lg border border-line-strong bg-surface px-2">
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">From</span>
        <input type="date" name="from" defaultValue={range.from} className="h-9 rounded-lg border border-line-strong bg-surface px-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">To</span>
        <input type="date" name="to" defaultValue={range.to} className="h-9 rounded-lg border border-line-strong bg-surface px-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Compare to</span>
        <select name="compare" defaultValue={range.compare} className="h-9 rounded-lg border border-line-strong bg-surface px-2">
          <option value="previous">Previous period</option>
          <option value="year">Same period last year</option>
          <option value="none">No comparison</option>
        </select>
      </label>
      <button className={buttonClasses({ size: "sm", className: "h-9" })}>Apply</button>
      <span className="mb-2 ml-auto text-xs text-muted">
        {formatDate(range.from)} – {formatDate(range.to)} ({range.days} days)
        {range.prevFrom && ` vs ${formatDate(range.prevFrom)} – ${formatDate(range.prevTo)}`}
      </span>
    </form>
  );
}

export function Tabs({ tabs, active, href }: { tabs: { key: string; label: string }[]; active: string; href: (key: string) => string }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={href(t.key)}
          aria-current={active === t.key ? "page" : undefined}
          className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active === t.key ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Explains why there is (no) data, for every non-ready state. Returns null when ready. */
export function SourceNotice({ state, name, integrationsHref }: { state: SourceState; name: string; integrationsHref: string }) {
  if (state.kind === "ready" || state.kind === "demo") return null;
  const map = {
    not_connected: { icon: PlugZap, title: `${name} is not connected`, body: `Connect a Google account and choose a property to see real ${name} data. Rankora never shows estimated or sample numbers as ${name} data.`, cta: `Connect ${name}` },
    pending: { icon: PlugZap, title: "Choose a property", body: "Your Google account is connected. Pick which property belongs to this website.", cta: "Choose property" },
    error: { icon: AlertTriangle, title: `${name} needs attention`, body: (state as { integration?: { last_error?: string | null } }).integration?.last_error ?? "The last sync failed.", cta: "Fix on Integrations" },
    syncing: { icon: Loader2, title: "First import in progress", body: `Importing up to 180 days of ${name} data. Keep the Integrations page open to speed it up.`, cta: "View progress" },
  } as const;
  const m = map[state.kind];
  return (
    <Card>
      <EmptyState
        icon={m.icon}
        title={m.title}
        description={m.body}
        action={
          <Link className={buttonClasses({ size: "sm" })} href={integrationsHref}>
            {m.cta}
          </Link>
        }
      />
    </Card>
  );
}

export function SourceLine({ state, label }: { state: SourceState; label: string }) {
  if (state.kind === "demo") return <DemoDataBadge />;
  if (state.kind !== "ready") return null;
  return (
    <Badge tone="success" title={`Imported from ${label}`}>
      {label} · synced {formatDate(state.integration.last_synced_at, { hour: "2-digit", minute: "2-digit" })}
    </Badge>
  );
}

export function Delta({ value, goodWhen = "up", digits = 1 }: { value: number | null; goodWhen?: "up" | "down"; digits?: number }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-muted">—</span>;
  const good = goodWhen === "up" ? value >= 0 : value <= 0;
  return (
    <span className={cn("tabular text-xs font-medium", Math.abs(value) < 0.0005 ? "text-muted" : good ? "text-success" : "text-critical")}>
      {value > 0 ? "+" : ""}
      {(value * 100).toFixed(digits)}%
    </span>
  );
}

export interface Column<R> {
  label: string;
  align?: "left" | "right";
  render: (r: R) => ReactNode;
}

export function DataTable<R>({ rows, columns, empty = "No data for this period.", rowKey }: { rows: R[]; columns: Column<R>[]; empty?: string; rowKey: (r: R) => string }) {
  if (rows.length === 0) return <p className="px-5 py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            {columns.map((c, i) => (
              <th key={i} className={cn("px-4 py-2 font-medium first:pl-5 last:pr-5", c.align === "right" && "text-right")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-surface-2/50">
              {columns.map((c, i) => (
                <td key={i} className={cn("px-4 py-2 first:pl-5 last:pr-5", c.align === "right" && "tabular text-right")}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const fmt = { n: (v: number | null | undefined) => formatNumber(v ?? null), pct: (v: number | null | undefined) => formatPercent(v ?? null), pos: (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(1)) };
