import type { Metadata } from "next";
import { Check } from "lucide-react";
import { requireOrg, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { providerConfig } from "@/lib/env";
import { getEntitlements } from "@/lib/billing/usage";
import { billingProvider } from "@/lib/billing/service";
import { LIMIT_KEYS, LIMIT_LABEL, limitCountLabel, periodEnd, readLimits, usageLevel, type LimitKey } from "@/lib/billing/entitlements";
import { openBillingPortalAction, startCheckoutAction } from "@/lib/actions/billing";
import { cn, formatDate } from "@/lib/utils";
import { SubmitButton } from "@/components/content/submit-button";
import { UsageMeter } from "@/components/billing/usage-meter";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Plan & billing" };

const SHOWN: LimitKey[] = ["websites", "members", "crawl_pages_per_month", "tracked_keywords", "rank_checks_per_month", "reports_per_month", "ai_credits_per_month"];

export default async function BillingPage({ params, searchParams }: PageProps<"/app/[org]/billing">) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const { org, role } = await requireOrg(slug);
  const supabase = await createClient();
  const [{ data: sub }, { data: plans }] = await Promise.all([
    supabase.from("subscriptions").select("plan_id, status, provider, current_period_end, cancel_at_period_end, provider_customer_id").eq("organization_id", org.id).maybeSingle(),
    supabase.from("plans").select("*").eq("is_active", true).order("sort_order"),
  ]);
  const ent = providerConfig().serviceRoleConfigured ? await getEntitlements(org.id) : null;
  const provider = billingProvider();
  const canManage = roleAtLeast(role, "admin") && !org.is_demo;
  const currentId = org.plan_id;
  const attention = ent ? SHOWN.filter((k) => usageLevel(ent.usage[k], ent.limits[k]) !== "ok" && ent.limits[k] > 0) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Plan & billing" description="Your plan sets usage limits. Limits are enforced on the server and in the database; monthly limits reset on the 1st (UTC)." />
      {typeof sp.error === "string" && <FormMessage>{sp.error.slice(0, 200)}</FormMessage>}
      {typeof sp.saved === "string" && <FormMessage tone="success">{sp.saved.slice(0, 200)}</FormMessage>}
      {!provider.acceptsPayments && (
        <FormMessage tone="info">
          Online payments are not enabled. Plans can be changed by the Rankora team (manual billing) — no card is charged. The payment integration
          (Stripe) is built and switches on only when it is configured and approved.
        </FormMessage>
      )}
      {sub?.status === "past_due" && <FormMessage>Your last payment failed. Update your payment method to keep your plan.</FormMessage>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Usage this month"
            description={`Period ends ${formatDate(periodEnd())}`}
            action={<Badge tone="brand">{ent?.planName ?? "Free"} plan</Badge>}
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {ent ? (
              SHOWN.map((k) => <UsageMeter key={k} label={LIMIT_LABEL[k]} used={ent.usage[k]} limit={ent.limits[k]} />)
            ) : (
              <p className="text-sm text-muted">Usage is not available because the server is not fully configured.</p>
            )}
          </CardBody>
          {attention.length > 0 && (
            <p className="border-t border-line px-5 py-3 text-sm text-warning">
              Near or at the limit: {attention.map((k) => LIMIT_LABEL[k]).join(", ")}. Upgrade to keep working without interruption.
            </p>
          )}
        </Card>
        <Card>
          <CardHeader title="Subscription" />
          <CardBody className="space-y-2 text-sm">
            <p>
              <span className="text-muted">Status:</span> <span className="capitalize">{(sub?.status ?? "active").replace("_", " ")}</span>
            </p>
            <p>
              <span className="text-muted">Billing:</span> {sub?.provider === "stripe" ? "Card payments (Stripe)" : sub?.provider === "manual" ? "Managed by Rankora" : "Free plan"}
            </p>
            {sub?.current_period_end && (
              <p>
                <span className="text-muted">{sub.cancel_at_period_end ? "Ends" : "Renews"}:</span> {formatDate(sub.current_period_end)}
              </p>
            )}
            {canManage && provider.acceptsPayments && sub?.provider_customer_id && (
              <form action={openBillingPortalAction}>
                <input type="hidden" name="orgSlug" value={org.slug} />
                <SubmitButton size="sm" variant="secondary">
                  Manage payment & invoices
                </SubmitButton>
              </form>
            )}
            {!roleAtLeast(role, "admin") && <p className="text-xs text-muted">Only owners and admins can change the plan.</p>}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(plans ?? []).map((p) => {
          const limits = readLimits(p.limits);
          const isCurrent = p.id === currentId;
          const higher = (plans ?? []).findIndex((x) => x.id === p.id) > (plans ?? []).findIndex((x) => x.id === currentId);
          return (
            <Card key={p.id} className={cn("flex flex-col", isCurrent && "ring-2 ring-brand")}>
              <CardBody className="flex flex-1 flex-col">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{p.name}</p>
                  {isCurrent && <Badge tone="brand">Current</Badge>}
                </div>
                <p className="tabular mt-1 text-2xl font-semibold">
                  ${(p.price_monthly_cents / 100).toFixed(0)}
                  <span className="text-sm font-normal text-muted">/mo</span>
                </p>
                <p className="mt-1 text-sm text-muted">{p.description}</p>
                <ul className="mt-3 flex-1 space-y-1 text-sm">
                  {LIMIT_KEYS.filter((k) => k !== "crawl_pages_per_audit" && k !== "keyword_lookups_per_month").map((k) => (
                    <li key={k} className="flex items-center gap-2">
                      <Check className="size-3.5 shrink-0 text-success" aria-hidden />
                      <span>
                        {limitCountLabel(k, limits[k])}
                      </span>
                    </li>
                  ))}
                </ul>
                {canManage && higher && (
                  <form action={startCheckoutAction} className="mt-4">
                    <input type="hidden" name="orgSlug" value={org.slug} />
                    <input type="hidden" name="planId" value={p.id} />
                    <SubmitButton className="w-full" disabled={!provider.acceptsPayments} title={provider.acceptsPayments ? undefined : "Online payments are not enabled yet"}>
                      Upgrade to {p.name}
                    </SubmitButton>
                  </form>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
