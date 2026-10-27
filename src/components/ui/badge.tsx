import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "brand" | "critical" | "warning" | "opportunity" | "success" | "demo";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-2 ring-line-strong",
  brand: "bg-brand-soft text-brand-ink ring-brand/20",
  critical: "bg-critical-soft text-critical ring-critical/20",
  warning: "bg-warning-soft text-warning ring-warning/20",
  opportunity: "bg-opportunity-soft text-opportunity ring-opportunity/20",
  success: "bg-success-soft text-success ring-success/20",
  demo: "bg-demo-soft text-demo ring-demo/25",
};

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export const SEVERITY_TONE = {
  critical: "critical",
  warning: "warning",
  opportunity: "opportunity",
  passed: "success",
} as const satisfies Record<string, BadgeTone>;

const SEVERITY_LABEL = { critical: "Critical", warning: "Warning", opportunity: "Opportunity", passed: "Passed" };

export function SeverityBadge({ severity }: { severity: keyof typeof SEVERITY_TONE }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</Badge>;
}

/** Mandatory label wherever demo data is rendered. */
export function DemoDataBadge({ className }: { className?: string }) {
  return (
    <Badge tone="demo" className={className} title="Sample data for demonstration. Not live analytics.">
      Demo Data
    </Badge>
  );
}
