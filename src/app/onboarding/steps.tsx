import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["Organization", "Website", "Next steps"];

export function OnboardingSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="mb-10 flex items-center gap-3 text-sm" aria-label="Onboarding progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-3">
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full text-xs font-semibold",
              i < current && "bg-success text-white",
              i === current && "bg-brand text-on-brand",
              i > current && "bg-surface-2 text-muted ring-1 ring-line-strong",
            )}
            aria-current={i === current ? "step" : undefined}
          >
            {i < current ? <Check className="size-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={cn(i === current ? "font-medium text-ink" : "text-muted", "hidden sm:inline")}>{s}</span>
          {i < STEPS.length - 1 && <span className="h-px w-8 bg-line-strong" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
