import type { Metadata } from "next";
import { requireOrg } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Plan & billing" };

const LIMIT_LABELS: Record<string, string> = {
  websites: "Websites",
  crawl_pages_per_audit: "Pages per audit",
  tracked_keywords: "Tracked keywords",
  keyword_lookups_per_month: "Keyword lookups / month",
  members: "Team members",
};

export default async function BillingPage({ params }: PageProps<"/app/[org]/billing">) {
  const { org: slug } = await params;
  const { org } = await requireOrg(slug);
  const supabase = await createClient();
  const [{ data: sub }, { data: plans }, { count: siteCount }] = await Promise.all([
    supabase.from("subscriptions").select("plan_id, status, provider, current_period_end").eq("organization_id", org.id).maybeSingle(),
    supabase.from("plans").select("*").order("sort_order"),
    supabase.from("websites").select("id", { count: "exact", head: true }).eq("organization_id", org.id).neq("status", "archived"),
  ]);
  const current = plans?.find((p) => p.id === (sub?.plan_id ?? org.plan_id));

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Plan & billing" description="Your plan determines usage limits. Limits are enforced server-side." />
      <FormMessage tone="info">
        Online payments are not enabled yet. The billing architecture (plans, subscriptions, usage records) is in place so a
        payment provider such as Stripe can be connected later.
      </FormMessage>
      <Card>
        <CardHeader title="Current plan" action={<Badge tone="brand">{current?.name ?? "Free"}</Badge>} />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-3">
            {Object.entries((current?.limits as Record<string, number>) ?? {}).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{LIMIT_LABELS[k] ?? k}</dt>
                <dd className="tabular mt-1 text-lg font-semibold">
                  {k === "websites" ? `${siteCount ?? 0} / ${formatNumber(v)}` : formatNumber(v)}
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        {(plans ?? []).map((p) => (
          <Card key={p.id} className={p.id === current?.id ? "ring-2 ring-brand" : undefined}>
            <CardBody>
              <p className="text-sm font-semibold">{p.name}</p>
              <p className="tabular mt-1 text-2xl font-semibold">
                ${(p.price_monthly_cents / 100).toFixed(0)}
                <span className="text-sm font-normal text-muted">/mo</span>
              </p>
              <p className="mt-2 text-sm text-muted">{p.description}</p>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
