import { usageLevel } from "@/lib/billing/entitlements";
import { cn, formatNumber } from "@/lib/utils";

/** One limit: used / limit with a coloured bar (green < 80 %, amber ≥ 80 %, red at the limit). */
export function UsageMeter({ label, used, limit, hint }: { label: string; used: number; limit: number; hint?: string }) {
  const level = usageLevel(used, limit);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-2">{label}</span>
        <span className={cn("tabular", level === "reached" ? "font-semibold text-critical" : level === "warning" ? "font-medium text-warning" : "text-muted")}>
          {formatNumber(used)} / {limit === 0 ? "not included" : formatNumber(limit)}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
        <div className={cn("animate-grow-x h-full rounded-full", level === "reached" ? "bg-critical" : level === "warning" ? "bg-warning" : "bg-success")} style={{ width: `${limit === 0 ? 0 : Math.max(2, pct)}%` }} />
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
