import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

export function StatCard({
  label,
  value,
  delta,
  deltaGoodWhen = "up",
  hint,
  footer,
  icon: Icon,
  className,
}: {
  label: string;
  value: ReactNode;
  /** relative change, e.g. 0.12 for +12%; null/undefined hides it */
  delta?: number | null;
  deltaGoodWhen?: "up" | "down";
  hint?: string;
  footer?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  const d = typeof delta === "number" && Number.isFinite(delta) ? delta : null;
  const good = d !== null && (deltaGoodWhen === "up" ? d >= 0 : d <= 0);
  return (
    <Card className={cn("group relative overflow-hidden p-4 hover:border-brand/35 hover:shadow-[0_0_32px_var(--glow)]", className)}>
      {/* accent line along the top edge */}
      <span className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent opacity-60 transition-opacity group-hover:opacity-100" aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          {label}
          {hint && (
            <span title={hint} className="cursor-help">
              <Info className="size-3.5" aria-label={hint} />
            </span>
          )}
        </div>
        {Icon && (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand transition-transform duration-300 group-hover:scale-110" aria-hidden>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="tabular font-[family-name:var(--font-display)] text-[1.7rem] font-bold leading-tight tracking-tight text-ink">{value}</span>
        {d !== null && (
          <span className={cn("tabular inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold", good ? "bg-success-soft text-success" : "bg-critical-soft text-critical")}>
            {d >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
            {Math.abs(d * 100).toFixed(1)}%
          </span>
        )}
      </div>
      {footer && <div className="mt-2 text-xs text-muted">{footer}</div>}
    </Card>
  );
}
