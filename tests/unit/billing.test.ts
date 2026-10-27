import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkLimit, crossedThreshold, FREE_FALLBACK, isUpgrade, LIMIT_KEYS, limitMessage, periodEnd, periodStart, readLimits, usageLevel } from "@/lib/billing/entitlements";
import { billingProviderFrom, manualBilling, mapStripeEvent, stripeBilling, verifyStripeSignature } from "@/lib/billing/provider";
import { redact } from "@/lib/monitoring";

describe("entitlements", () => {
  it("reads limits with conservative fallbacks for missing or invalid values", () => {
    const l = readLimits({ websites: 5, members: "x", tracked_keywords: -1, rank_checks_per_month: 99.7 });
    expect(l.websites).toBe(5);
    expect(l.members).toBe(FREE_FALLBACK.members);
    expect(l.tracked_keywords).toBe(FREE_FALLBACK.tracked_keywords);
    expect(l.rank_checks_per_month).toBe(99);
    expect(Object.keys(readLimits(null))).toEqual([...LIMIT_KEYS]);
  });
  it("checks remaining allowance", () => {
    expect(checkLimit(10, 9)).toEqual({ allowed: true, limit: 10, used: 9, remaining: 1 });
    expect(checkLimit(10, 9, 2).allowed).toBe(false);
    expect(checkLimit(10, 12)).toEqual({ allowed: false, limit: 10, used: 12, remaining: 0 });
    expect(checkLimit(0, 0).allowed).toBe(false);
  });
  it("classifies usage and detects threshold crossings once", () => {
    expect(usageLevel(7, 10)).toBe("ok");
    expect(usageLevel(8, 10)).toBe("warning");
    expect(usageLevel(10, 10)).toBe("reached");
    expect(usageLevel(0, 0)).toBe("reached");
    expect(crossedThreshold(70, 85, 100)).toBe("warning");
    expect(crossedThreshold(85, 90, 100)).toBeNull();
    expect(crossedThreshold(90, 100, 100)).toBe("reached");
    expect(crossedThreshold(10, 120, 100)).toBe("reached");
    expect(crossedThreshold(0, 5, 0)).toBeNull();
  });
  it("orders plans and formats messages", () => {
    expect(isUpgrade("free", "starter")).toBe(true);
    expect(isUpgrade("agency", "pro")).toBe(false);
    expect(limitMessage("reports_per_month", checkLimit(5, 5), "Free")).toBe("Your Free plan includes 5 reports / month (5 used). Upgrade your plan for more.");
  });
  it("uses calendar-month periods in UTC", () => {
    const now = new Date("2026-10-28T23:30:00Z");
    expect(periodStart(now)).toBe("2026-10-01T00:00:00.000Z");
    expect(periodEnd(now)).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("billing provider", () => {
  const secret = "whsec_test";
  const sign = (body: string, t: number, s = secret) => `t=${t},v1=${createHmac("sha256", s).update(`${t}.${body}`).digest("hex")}`;

  it("stays on manual billing (no payments) unless Stripe is selected, approved and fully configured", () => {
    const full = { BILLING_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: secret, STRIPE_PRICE_STARTER: "p1", STRIPE_PRICE_PRO: "p2", STRIPE_PRICE_AGENCY: "p3" };
    expect(billingProviderFrom({}).id).toBe("manual");
    expect(billingProviderFrom(full).id).toBe("manual"); // not approved
    expect(billingProviderFrom({ ...full, BILLING_LIVE_APPROVED: "true", STRIPE_PRICE_AGENCY: undefined }).id).toBe("manual");
    expect(billingProviderFrom({ ...full, BILLING_LIVE_APPROVED: "true" }).id).toBe("stripe");
    expect(manualBilling.acceptsPayments).toBe(false);
  });

  it("manual billing refuses checkout and webhooks", async () => {
    await expect(manualBilling.createCheckout({ organizationId: "o", planId: "pro", customerEmail: "a@b.c", successUrl: "x", cancelUrl: "y" })).rejects.toThrow(/not enabled/);
    expect(() => manualBilling.parseWebhook("{}", null)).toThrow();
  });

  it("verifies Stripe signatures with tolerance and constant-time comparison", () => {
    const body = '{"id":"evt_1"}';
    expect(verifyStripeSignature(body, sign(body, 1000), secret, 300, 1100)).toBe(true);
    expect(verifyStripeSignature(body, sign(body, 1000), secret, 300, 2000)).toBe(false); // too old
    expect(verifyStripeSignature(body + " ", sign(body, 1000), secret, 300, 1100)).toBe(false); // tampered
    expect(verifyStripeSignature(body, sign(body, 1000, "other"), secret, 300, 1100)).toBe(false);
    expect(verifyStripeSignature(body, `t=1000,v1=zz,${sign(body, 1000).split(",")[1]}`, secret, 300, 1100)).toBe(true); // any valid v1
    expect(verifyStripeSignature(body, null, secret)).toBe(false);
    expect(verifyStripeSignature(body, "garbage", secret)).toBe(false);
  });

  it("maps Stripe events to plan changes", () => {
    const prices = { starter: "price_s", pro: "price_p", agency: "price_a" };
    const sub = {
      id: "evt_2",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: true, current_period_start: 1761955200, current_period_end: 1764547200, metadata: { organization_id: "org-1" }, items: { data: [{ price: { id: "price_p" } }] } } },
    };
    expect(mapStripeEvent(sub, prices)).toEqual({
      id: "evt_2",
      type: "subscription.updated",
      organizationId: "org-1",
      planId: "pro",
      status: "active",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      periodStart: "2025-11-01T00:00:00.000Z",
      periodEnd: "2025-12-01T00:00:00.000Z",
      cancelAtPeriodEnd: true,
    });
    expect(mapStripeEvent({ ...sub, type: "customer.subscription.deleted" }, prices)).toMatchObject({ type: "subscription.canceled", status: "canceled" });
    expect(mapStripeEvent({ ...sub, data: { object: { ...sub.data.object, status: "unpaid" } } }, prices).status).toBe("past_due");
    expect(mapStripeEvent({ id: "evt_3", type: "checkout.session.completed", data: { object: { client_reference_id: "org-2", customer: "cus_2", subscription: "sub_2", metadata: { plan_id: "starter" } } } }, prices)).toMatchObject({
      type: "checkout.completed",
      organizationId: "org-2",
      subscriptionId: "sub_2",
      planId: "starter",
    });
    expect(mapStripeEvent({ id: "evt_4", type: "invoice.paid" }, prices).type).toBe("ignored");
  });

  it("Stripe adapter builds a subscription checkout without calling the network for real", async () => {
    let sent = "";
    const p = stripeBilling({
      secretKey: "sk_test_x",
      webhookSecret: secret,
      prices: { pro: "price_p" },
      fetchImpl: (async (_u: string, init: RequestInit) => {
        sent = String(init.body);
        return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/x" }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await p.createCheckout({ organizationId: "org-1", planId: "pro", customerEmail: "a@b.c", successUrl: "https://app/s", cancelUrl: "https://app/c" })).toEqual({ url: "https://checkout.stripe.com/c/x" });
    const params = new URLSearchParams(sent);
    expect(params.get("mode")).toBe("subscription");
    expect(params.get("line_items[0][price]")).toBe("price_p");
    expect(params.get("metadata[organization_id]")).toBe("org-1");
    await expect(p.createCheckout({ organizationId: "o", planId: "agency", customerEmail: "a@b.c", successUrl: "x", cancelUrl: "y" })).rejects.toThrow(/No Stripe price/);
  });
});

describe("monitoring redaction", () => {
  it("never stores secrets in system events", () => {
    expect(redact({ apiKey: "x", nested: { access_token: "t", ok: 1 }, list: [{ password: "p" }], msg: "hi" })).toEqual({ apiKey: "[redacted]", nested: { access_token: "[redacted]", ok: 1 }, list: [{ password: "[redacted]" }], msg: "hi" });
  });
});

describe("plan catalog", () => {
  it("marketing catalog matches the plans seeded by the SaaS migration", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { PLAN_CATALOG } = await import("@/lib/billing/catalog");
    const file = readdirSync("supabase/migrations").find((f) => f.endsWith("_saas.sql"))!;
    const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
    for (const plan of PLAN_CATALOG) {
      const m = new RegExp(String.raw`\('${plan.id}', '${plan.name}', '[^']*', (\d+),\s*'(\{[^']+\})'`).exec(sql);
      expect(m, plan.id).not.toBeNull();
      expect(Number(m![1])).toBe(plan.priceMonthly * 100);
      expect(JSON.parse(m![2])).toEqual(plan.limits);
    }
  });
});

describe("limit labels", () => {
  it("uses singular, plural and 'No' correctly and keeps acronyms", async () => {
    const { limitCountLabel } = await import("@/lib/billing/entitlements");
    expect(limitCountLabel("websites", 1)).toBe("1 website");
    expect(limitCountLabel("websites", 3)).toBe("3 websites");
    expect(limitCountLabel("members", 1)).toBe("1 team member");
    expect(limitCountLabel("crawl_pages_per_month", 25000)).toBe("25,000 crawled pages / month");
    expect(limitCountLabel("ai_credits_per_month", 1)).toBe("1 AI credit / month");
    expect(limitCountLabel("backlink_lookups_per_month", 0)).toBe("No backlink syncs / month");
  });
});
