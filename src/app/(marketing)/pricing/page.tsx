import type { Metadata } from "next";
import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pricing" };

// Mirrors the seeded `plans` table (supabase/migrations/…_core_tenancy.sql).
const PLANS = [
  { id: "free", name: "Free", price: 0, blurb: "For trying Rankora on one site.", limits: ["1 website", "100 pages per audit", "25 tracked keywords", "2 team members"] },
  { id: "pro", name: "Pro", price: 29, blurb: "For professionals managing a few sites.", limits: ["5 websites", "1,000 pages per audit", "500 tracked keywords", "5 team members"], featured: true },
  { id: "agency", name: "Agency", price: 99, blurb: "For agencies and in-house teams.", limits: ["25 websites", "5,000 pages per audit", "2,500 tracked keywords", "25 team members"] },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Simple, usage-based plans</h1>
        <p className="mt-3 text-muted">Start free. Upgrade when you add more websites or keywords.</p>
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id} className={cn("flex flex-col rounded-2xl border p-6", p.featured ? "border-brand ring-2 ring-brand/20" : "border-line")}>
            <p className="font-semibold">{p.name}</p>
            <p className="mt-2 text-4xl font-semibold tracking-tight">
              ${p.price}
              <span className="text-base font-normal text-muted">/month</span>
            </p>
            <p className="mt-2 text-sm text-muted">{p.blurb}</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {p.limits.map((l) => (
                <li key={l} className="flex gap-2">
                  <Check className="size-4 text-success" aria-hidden /> {l}
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
        Paid plans are not purchasable yet.
      </p>
    </div>
  );
}
