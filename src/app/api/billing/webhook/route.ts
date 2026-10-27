import { NextResponse } from "next/server";
import { billingProvider, applyBillingEvent } from "@/lib/billing/service";
import { logEvent } from "@/lib/monitoring";

/** Payment provider webhook. Only active when a payment provider is configured and approved. */
export async function POST(request: Request) {
  const provider = billingProvider();
  if (provider.id !== "stripe") return NextResponse.json({ error: "Billing webhooks are not enabled" }, { status: 404 });
  const raw = await request.text();
  if (raw.length > 512 * 1024) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let event;
  try {
    event = provider.parseWebhook(raw, request.headers.get("stripe-signature"));
  } catch {
    await logEvent("warn", "billing.webhook", "Rejected webhook with an invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    const r = await applyBillingEvent("stripe", event, JSON.parse(raw));
    return NextResponse.json({ received: true, duplicate: r.duplicate });
  } catch {
    // 500 makes the provider retry later
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
