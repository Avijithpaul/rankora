import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Construction } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="relative mb-5">
          <div className="absolute inset-0 rounded-2xl bg-brand/25 blur-xl" aria-hidden />
          <div className="relative grid size-14 place-items-center rounded-2xl border border-brand/25 bg-brand-soft text-brand">
            <Icon className="size-6" aria-hidden />
          </div>
        </div>
      )}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <div className="mt-1 max-w-md text-sm text-muted">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid size-11 place-items-center rounded-xl bg-critical-soft text-critical">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <div className="mt-1 max-w-md text-sm text-muted">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-md bg-surface-2", className)} aria-hidden />;
}

/** Honest placeholder for modules that are not implemented yet. */
export function PlannedModule({ title, phase, children }: { title: string; phase: string; children?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-xl bg-surface-2 text-muted">
        <Construction className="size-5" aria-hidden />
      </div>
      <Badge tone="neutral">Planned · {phase}</Badge>
      <h3 className="mt-3 text-sm font-semibold text-ink">{title} is not built yet</h3>
      <div className="mx-auto mt-1 max-w-lg text-sm text-muted">{children}</div>
    </div>
  );
}
