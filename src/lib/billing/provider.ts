/**
 * Billing provider abstraction. The app talks to `BillingProvider`; webhook
 * events are normalised into `BillingEvent` and applied by the billing service.
 *
 * Real payments are OFF unless BILLING_PROVIDER=stripe, BILLING_LIVE_APPROVED=true
 * and the Stripe keys and price ids are all set. Without that, the "manual"
 * provider is used: no money moves, and only a platform admin can change a plan.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlanId } from "./entitlements";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete";

export interface BillingEvent {
  id: string;
  type: "subscription.updated" | "subscription.canceled" | "checkout.completed" | "ignored";
  organizationId: string | null;
  planId: PlanId | null;
  status: SubscriptionStatus | null;
  customerId: string | null;
  subscriptionId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingProvider {
  readonly id: "manual" | "stripe";
  /** true when this provider can take payments */
  readonly acceptsPayments: boolean;
  createCheckout(opts: { organizationId: string; planId: PlanId; customerEmail: string; customerId?: string | null; successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  createPortal(opts: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** Verify the signature and normalise the event; throws on an invalid signature. */
  parseWebhook(rawBody: string, signatureHeader: string | null): BillingEvent;
}

export class BillingNotAvailableError extends Error {}

/** No payments: plan changes are made by a platform admin and recorded as provider "manual". */
export const manualBilling: BillingProvider = {
  id: "manual",
  acceptsPayments: false,
  async createCheckout() {
    throw new BillingNotAvailableError("Online payments are not enabled. A platform admin can change the plan.");
  },
  async createPortal() {
    throw new BillingNotAvailableError("Online payments are not enabled.");
  },
  parseWebhook() {
    throw new BillingNotAvailableError("No billing webhooks without a payment provider.");
  },
};

// ---------------------------------------------------------------------------
// Stripe (REST API, no SDK). Inactive until explicitly configured and approved.
// ---------------------------------------------------------------------------
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  prices: Partial<Record<PlanId, string>>;
  fetchImpl?: typeof fetch;
  toleranceSeconds?: number;
  now?: () => number;
}

/** Stripe-Signature: "t=<unix>,v1=<hex hmac of `${t}.${body}`>" (HMAC-SHA256 with the endpoint secret). */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const signatures = header
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!Number.isFinite(t) || !signatures.length || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const STRIPE_STATUS: Record<string, SubscriptionStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  paused: "past_due",
};

const iso = (unix: unknown) => (typeof unix === "number" ? new Date(unix * 1000).toISOString() : null);

/** Maps a Stripe event object to a BillingEvent (pure; unit tested with fixtures). */
export function mapStripeEvent(event: { id: string; type: string; data?: { object?: Record<string, unknown> } }, prices: Partial<Record<PlanId, string>>): BillingEvent {
  const o = event.data?.object ?? {};
  const meta = (o.metadata ?? {}) as Record<string, string>;
  const base: BillingEvent = {
    id: event.id,
    type: "ignored",
    organizationId: meta.organization_id ?? (typeof o.client_reference_id === "string" ? o.client_reference_id : null),
    planId: null,
    status: null,
    customerId: typeof o.customer === "string" ? o.customer : null,
    subscriptionId: null,
    periodStart: null,
    periodEnd: null,
    cancelAtPeriodEnd: false,
  };
  const planFromPrice = (priceId: unknown) => (Object.entries(prices).find(([, p]) => p === priceId)?.[0] as PlanId | undefined) ?? null;
  if (event.type === "checkout.session.completed") {
    return { ...base, type: "checkout.completed", subscriptionId: typeof o.subscription === "string" ? o.subscription : null, planId: (meta.plan_id as PlanId) ?? null };
  }
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const items = ((o.items as { data?: { price?: { id?: string }; current_period_start?: number; current_period_end?: number }[] })?.data ?? []);
    const status = event.type === "customer.subscription.deleted" ? "canceled" : (STRIPE_STATUS[String(o.status)] ?? "incomplete");
    return {
      ...base,
      type: status === "canceled" ? "subscription.canceled" : "subscription.updated",
      subscriptionId: typeof o.id === "string" ? o.id : null,
      planId: planFromPrice(items[0]?.price?.id) ?? ((meta.plan_id as PlanId) || null),
      status,
      periodStart: iso(o.current_period_start ?? items[0]?.current_period_start),
      periodEnd: iso(o.current_period_end ?? items[0]?.current_period_end),
      cancelAtPeriodEnd: o.cancel_at_period_end === true,
    };
  }
  return base;
}

export function stripeBilling(cfg: StripeConfig): BillingProvider {
  const f = cfg.fetchImpl ?? fetch;
  const call = async (path: string, params: Record<string, string>) => {
    const res = await f(`https://api.stripe.com/v1${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !json.url) throw new Error(`Stripe: ${json.error?.message ?? `HTTP ${res.status}`}`);
    return { url: json.url };
  };
  return {
    id: "stripe",
    acceptsPayments: true,
    async createCheckout(o) {
      const price = cfg.prices[o.planId];
      if (!price) throw new BillingNotAvailableError(`No Stripe price configured for ${o.planId}`);
      return call("/checkout/sessions", {
        mode: "subscription",
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        success_url: o.successUrl,
        cancel_url: o.cancelUrl,
        client_reference_id: o.organizationId,
        "metadata[organization_id]": o.organizationId,
        "metadata[plan_id]": o.planId,
        "subscription_data[metadata][organization_id]": o.organizationId,
        "subscription_data[metadata][plan_id]": o.planId,
        ...(o.customerId ? { customer: o.customerId } : { customer_email: o.customerEmail }),
      });
    },
    async createPortal(o) {
      return call("/billing_portal/sessions", { customer: o.customerId, return_url: o.returnUrl });
    },
    parseWebhook(rawBody, header) {
      if (!verifyStripeSignature(rawBody, header, cfg.webhookSecret, cfg.toleranceSeconds, cfg.now ? cfg.now() : undefined)) throw new Error("Invalid Stripe signature");
      return mapStripeEvent(JSON.parse(rawBody), cfg.prices);
    },
  };
}

export interface BillingEnv {
  BILLING_PROVIDER?: string;
  BILLING_LIVE_APPROVED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_AGENCY?: string;
}

/** Stripe only when explicitly selected, approved and fully configured; otherwise manual. */
export function billingProviderFrom(env: BillingEnv): BillingProvider {
  const approved = env.BILLING_PROVIDER === "stripe" && env.BILLING_LIVE_APPROVED === "true";
  if (approved && env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_STARTER && env.STRIPE_PRICE_PRO && env.STRIPE_PRICE_AGENCY) {
    return stripeBilling({
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      prices: { starter: env.STRIPE_PRICE_STARTER, pro: env.STRIPE_PRICE_PRO, agency: env.STRIPE_PRICE_AGENCY },
    });
  }
  return manualBilling;
}
