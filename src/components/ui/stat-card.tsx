import type { ReactNode } from "react";
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
  className,
}: {
  label: string;
  value: ReactNode;
  /** relative change, e.g. 0.12 for +12%; null/undefined hides it */
  delta?: number | null;
  deltaGoodWhen?: "up" | "down";
  hint?: string;
  footer?: ReactNode;
  className?: string;
}) {
  const d = typeof delta === "number" && Number.isFinite(delta) ? delta : null;
  const good = d !== null && (deltaGoodWhen === "up" ? d >= 0 : d <= 0);
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {label}
        {hint && (
          <span title={hint} className="cursor-help">
            <Info className="size-3.5" aria-label={hint} />
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="tabular text-2xl font-semibold tracking-tight text-ink">{value}</span>
        {d !== null && (
          <span className={cn("tabular inline-flex items-center text-xs font-medium", good ? "text-success" : "text-critical")}>
            {d >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
            {Math.abs(d * 100).toFixed(1)}%
          </span>
        )}
      </div>
      {footer && <div className="mt-2 text-xs text-muted">{footer}</div>}
    </Card>
  );
}
