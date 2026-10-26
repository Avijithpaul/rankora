import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const INTENT_LABEL: Record<string, { label: string; short: string }> = {
  informational: { label: "Informational", short: "I" },
  navigational: { label: "Navigational", short: "N" },
  commercial: { label: "Commercial", short: "C" },
  transactional: { label: "Transactional", short: "T" },
};

/** Provider intent, or a clearly marked rule-based fallback. */
export function IntentBadge({ intent, fallback }: { intent: string | null; fallback?: string | null }) {
  if (intent && INTENT_LABEL[intent]) return <Badge tone="brand">{INTENT_LABEL[intent].label}</Badge>;
  if (fallback && INTENT_LABEL[fallback]) {
    return (
      <Badge title="Inferred from the keyword text by a simple rule — not provider data">
        {INTENT_LABEL[fallback].label} <span className="opacity-60">· rule-based</span>
      </Badge>
    );
  }
  return <span className="text-muted">—</span>;
}

export function KdBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  const tone = value < 30 ? "success" : value < 60 ? "warning" : "critical";
  return (
    <Badge tone={tone} className="tabular" title="Keyword difficulty (0–100) from the provider">
      {value}
    </Badge>
  );
}

/** Position with movement arrow vs previous check. */
export function PositionCell({ current, previous }: { current: number | null; previous: number | null }) {
  const change = current !== null && previous !== null ? previous - current : null;
  return (
    <span className="tabular inline-flex items-center gap-1.5">
      <span className={cn("font-medium", current === null && "text-muted")}>{current ?? (previous !== null ? "Lost" : "—")}</span>
      {change !== null && change !== 0 && (
        <span className={cn("inline-flex items-center text-xs", change > 0 ? "text-success" : "text-critical")}>
          {change > 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
          {Math.abs(change)}
        </span>
      )}
      {change === 0 && <Minus className="size-3 text-muted" aria-label="unchanged" />}
      {current !== null && previous === null && <Badge tone="opportunity">New</Badge>}
    </span>
  );
}
