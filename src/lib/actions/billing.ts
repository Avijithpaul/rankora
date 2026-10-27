"use server";

import { redirect } from "next/navigation";
import { requireOrg, requireUser, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { PLAN_IDS, type PlanId } from "@/lib/billing/entitlements";
import { billingProvider, setPlan } from "@/lib/billing/service";
import { BillingNotAvailableError } from "@/lib/billing/provider";
import { logEvent } from "@/lib/monitoring";

const msg = (url: string, key: "error" | "saved", text: string) => `${url}?${key}=${encodeURIComponent(text)}`;

/** Owners and admins start a provider checkout. With the manual provider no payment is possible. */
export async function startCheckoutAction(formData: FormData) {
  const { org, role, user } = await requireOrg(String(formData.get("orgSlug") ?? ""));
  const back = `/app/${org.slug}/billing`;
  const planId = String(formData.get("planId") ?? "") as PlanId;
  if (!roleAtLeast(role, "admin")) redirect(msg(back, "error", "Only owners and admins can change the plan."));
  if (org.is_demo) redirect(msg(back, "error", "The Demo Project has no subscription."));
  if (!PLAN_IDS.includes(planId) || planId === "free") redirect(msg(back, "error", "Choose a paid plan."));
  const provider = billingProvider();
  if (!provider.acceptsPayments) redirect(msg(back, "error", "Online payments are not enabled yet. Contact us to change your plan."));
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("rate_limit_hit", { p_bucket: "billing.checkout", p_limit: 10, p_window_seconds: 3600 });
  if (!allowed) redirect(msg(back, "error", "Too many checkout attempts. Please wait a little."));
  const { data: sub } = await supabase.from("subscriptions").select("provider_customer_id").eq("organization_id", org.id).maybeSingle();
  const site = publicEnv()!.NEXT_PUBLIC_SITE_URL;
  let url: string;
  try {
    ({ url } = await provider.createCheckout({
      organizationId: org.id,
      planId,
      customerEmail: user.email ?? "",
      customerId: sub?.provider_customer_id ?? null,
      successUrl: `${site}${back}?saved=${encodeURIComponent("Payment received — your plan updates in a few seconds.")}`,
      cancelUrl: `${site}${back}`,
    }));
  } catch (e) {
    if (!(e instanceof BillingNotAvailableError)) await logEvent("error", "billing.checkout", "Checkout failed", { orgId: org.id, planId, error: (e as Error).message });
    redirect(msg(back, "error", "The checkout could not be started. Please try again later."));
  }
  redirect(url);
}

export async function openBillingPortalAction(formData: FormData) {
  const { org, role } = await requireOrg(String(formData.get("orgSlug") ?? ""));
  const back = `/app/${org.slug}/billing`;
  if (!roleAtLeast(role, "admin")) redirect(msg(back, "error", "Only owners and admins can manage billing."));
  const provider = billingProvider();
  const supabase = await createClient();
  const { data: sub } = await supabase.from("subscriptions").select("provider_customer_id").eq("organization_id", org.id).maybeSingle();
  if (!provider.acceptsPayments || !sub?.provider_customer_id) redirect(msg(back, "error", "There is no payment account to manage."));
  let url: string;
  try {
    ({ url } = await provider.createPortal({ customerId: sub.provider_customer_id, returnUrl: `${publicEnv()!.NEXT_PUBLIC_SITE_URL}${back}` }));
  } catch {
    redirect(msg(back, "error", "The billing portal is not available right now."));
  }
  redirect(url);
}

/** Platform admins only: change an organization's plan without payment (manual provider). */
export async function adminSetPlanAction(formData: FormData) {
  const user = await requireUser("/admin");
  const supabase = await createClient();
  const { data: admin } = await supabase.from("platform_admins").select("role").eq("user_id", user.id).maybeSingle();
  if (admin?.role !== "superadmin") redirect("/admin?error=forbidden");
  const orgId = String(formData.get("organizationId") ?? "");
  const planId = String(formData.get("planId") ?? "") as PlanId;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !PLAN_IDS.includes(planId)) redirect("/admin?error=invalid");
  if (!reason) redirect("/admin?error=reason");
  await setPlan({ organizationId: orgId, planId, provider: "manual", actorId: user.id, reason: `admin: ${reason}` });
  redirect("/admin?saved=plan");
}
