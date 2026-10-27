import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { recordAudit } from "@/lib/audit-log";
import { notifyOrgAdmins } from "@/lib/notifications";
import { logEvent } from "@/lib/monitoring";
import { PLAN_IDS, type PlanId } from "./entitlements";
import { billingProviderFrom, type BillingEnv, type BillingEvent, type BillingProvider } from "./provider";

export function billingProvider(): BillingProvider {
  return billingProviderFrom(process.env as BillingEnv);
}

/** Sets an organization's plan. The subscription row drives organizations.plan_id (DB trigger). */
export async function setPlan(opts: {
  organizationId: string;
  planId: PlanId;
  provider: "manual" | "stripe";
  actorId: string | null;
  status?: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  customerId?: string | null;
  subscriptionId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  reason?: string;
}) {
  if (!PLAN_IDS.includes(opts.planId)) throw new Error(`Unknown plan ${opts.planId}`);
  const db = createAdminClient();
  const { data: before } = await db.from("subscriptions").select("plan_id, status").eq("organization_id", opts.organizationId).maybeSingle();
  const row = {
    organization_id: opts.organizationId,
    plan_id: opts.planId,
    status: opts.status ?? "active",
    provider: opts.provider,
    provider_customer_id: opts.customerId ?? null,
    provider_subscription_id: opts.subscriptionId ?? null,
    current_period_start: opts.periodStart ?? null,
    current_period_end: opts.periodEnd ?? null,
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
  };
  const { error } = await db.from("subscriptions").upsert(row, { onConflict: "organization_id" });
  if (error) throw new Error(`Could not update the subscription: ${error.message}`);
  if (before?.plan_id !== opts.planId || before?.status !== row.status) {
    await recordAudit({ organizationId: opts.organizationId, actorId: opts.actorId, action: "billing.plan_changed", entityType: "subscription", metadata: { from: before?.plan_id ?? null, to: opts.planId, status: row.status, provider: opts.provider, reason: opts.reason ?? null } });
    await notifyOrgAdmins(opts.organizationId, {
      type: "billing.plan_changed",
      title: row.status === "canceled" ? "Subscription canceled — now on Free" : `Plan changed to ${opts.planId[0].toUpperCase()}${opts.planId.slice(1)}`,
      body: row.status === "canceled" ? "Limits of the Free plan apply from now on. Existing data is kept." : "New limits apply immediately.",
      link: "billing",
    });
  }
}

/** Applies a verified provider webhook event once (idempotent by provider event id). */
export async function applyBillingEvent(provider: "stripe", event: BillingEvent, payload: unknown) {
  const db = createAdminClient();
  const { data: inserted, error } = await db
    .from("billing_events")
    .insert({ provider, event_id: event.id, type: event.type, organization_id: event.organizationId, payload: payload as Json })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return { duplicate: true };
  if (error || !inserted) throw new Error(`Could not record billing event: ${error?.message}`);
  try {
    if (event.type === "ignored" || !event.organizationId) {
      await db.from("billing_events").update({ status: "ignored", processed_at: new Date().toISOString() }).eq("id", inserted.id);
      return { duplicate: false };
    }
    if (event.type === "checkout.completed") {
      // the subscription.* event carries status and period; checkout only links the customer
      await db.from("subscriptions").update({ provider: "stripe", provider_customer_id: event.customerId, provider_subscription_id: event.subscriptionId }).eq("organization_id", event.organizationId);
    } else if (event.planId) {
      await setPlan({
        organizationId: event.organizationId,
        planId: event.type === "subscription.canceled" ? "free" : event.planId,
        provider: "stripe",
        actorId: null,
        status: event.type === "subscription.canceled" ? "canceled" : (event.status ?? "active"),
        customerId: event.customerId,
        subscriptionId: event.subscriptionId,
        periodStart: event.periodStart,
        periodEnd: event.periodEnd,
        cancelAtPeriodEnd: event.cancelAtPeriodEnd,
        reason: `stripe:${event.type}`,
      });
    }
    await db.from("billing_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", inserted.id);
    return { duplicate: false };
  } catch (e) {
    await db.from("billing_events").update({ status: "failed", error: (e as Error).message.slice(0, 1000) }).eq("id", inserted.id);
    await logEvent("error", "billing.webhook", "Billing event failed", { eventId: event.id, type: event.type, error: (e as Error).message });
    throw e;
  }
}
