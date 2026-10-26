import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BarChart3, KeyRound, SearchCheck, ScanSearch } from "lucide-react";
import { requireWebsite } from "@/lib/auth/dal";
import { completeOnboardingAction } from "@/lib/actions/workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OnboardingSteps } from "../steps";

export const metadata: Metadata = { title: "You're set up" };

export default async function NextStepsPage({ searchParams }: PageProps<"/onboarding/next-steps">) {
  const sp = await searchParams;
  const orgSlug = typeof sp.org === "string" ? sp.org : "";
  const siteId = typeof sp.site === "string" ? sp.site : "";
  if (!orgSlug || !siteId) redirect("/onboarding");
  const { website } = await requireWebsite(orgSlug, siteId);

  const steps = [
    { icon: ScanSearch, title: "Run your first site audit", body: "Crawl the site and compute a transparent SEO score.", status: "Phase 2" },
    { icon: SearchCheck, title: "Connect Google Search Console", body: "Clicks, impressions, CTR and positions — read-only.", status: "Optional · Phase 4" },
    { icon: BarChart3, title: "Connect Google Analytics 4", body: "Users, sessions and organic traffic by page.", status: "Optional · Phase 4" },
    { icon: KeyRound, title: "Add keywords to track", body: "Monitor rankings by country and device.", status: "Phase 3" },
  ];

  return (
    <>
      <OnboardingSteps current={2} />
      <h1 className="text-2xl font-semibold tracking-tight">{website.name} is ready</h1>
      <p className="mb-8 mt-1 text-sm text-muted">
        Here&apos;s what to do next. Items marked with a phase are being built and will unlock as they ship.
      </p>
      <Card className="divide-y divide-line">
        {steps.map((s) => (
          <div key={s.title} className="flex items-start gap-4 p-4">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
              <s.icon className="size-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-ink">{s.title}</p>
                <Badge>{s.status}</Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted">{s.body}</p>
            </div>
          </div>
        ))}
      </Card>
      <form action={completeOnboardingAction} className="mt-8">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="siteId" value={siteId} />
        <Button type="submit">Go to dashboard</Button>
      </form>
    </>
  );
}
