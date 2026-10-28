import type { Metadata } from "next";
import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PLAN_CATALOG } from "@/lib/billing/catalog";
import { limitCountLabel, type LimitKey } from "@/lib/billing/entitlements";

export const metadata: Metadata = { title: "Pricing" };

const SHOWN: LimitKey[] = ["websites", "members", "crawl_pages_per_month", "tracked_keywords", "rank_checks_per_month", "reports_per_month", "ai_credits_per_month"];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="text-center">
        <h1 className="text-5xl font-extrabold tracking-tight">Simple, <span className="text-gradient">usage-based</span> plans</h1>
        <p className="mt-3 text-muted">Start free. Upgrade when you add more websites or keywords.</p>
      </div>
      <div data-reveal-children="flip" className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_CATALOG.map((p) => (
          <div key={p.id} data-spotlight={p.featured ? undefined : ""} className={cn("animate-fade-up hover-lift flex flex-col rounded-2xl border bg-surface/60 p-6 hover:shadow-[0_0_40px_var(--glow)]", p.featured ? "gradient-border bg-[radial-gradient(120%_60%_at_50%_0%,var(--glow),transparent_70%)] shadow-[0_0_50px_var(--glow)]" : "border-line")}>
            <div className="flex items-center justify-between">
              <p className="font-semibold">{p.name}</p>
              {p.featured && <span className="rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-semibold text-on-brand">Most popular</span>}
            </div>
            <p className="mt-2 text-4xl font-semibold tracking-tight">
              ${p.priceMonthly}
              <span className="text-base font-normal text-muted">/month</span>
            </p>
            <p className="mt-2 text-sm text-muted">{p.blurb}</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {SHOWN.map((k) => (
                <li key={k} className="flex gap-2">
                  <Check className="size-4 text-success" aria-hidden /> {limitCountLabel(k, p.limits[k])}
                </li>
              ))}
            </ul>
            <ButtonLink href="/register" variant={p.featured ? "primary" : "secondary"} className="mt-8 w-full">
              Get started
            </ButtonLink>
          </div>
        ))}
      </div>
      <p className="mt-8 text-center text-sm text-muted">
        Third-party data (keyword volumes, SERP rankings, backlinks) requires a connected data provider and may be billed by that provider.
        Online payment is not enabled yet; plans are activated by the Rankora team.
      </p>
    </div>
  );
}
