import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { notifyOrgAdmins } from "@/lib/notifications";
import { checkLimit, crossedThreshold, LIMIT_LABEL, limitMessage, limitPhrase, MONTHLY_METRIC, periodStart, readLimits, type LimitCheck, type LimitKey } from "./entitlements";

export interface Entitlements {
  planId: string;
  planName: string;
  limits: Record<LimitKey, number>;
  usage: Record<LimitKey, number>;
}

/** Plan, limits and current usage for an organization (service role; call after authorizing). */
export async function getEntitlements(orgId: string): Promise<Entitlements> {
  const db = createAdminClient();
  const { data: org } = await db.from("organizations").select("plan_id, plans(name, limits)").eq("id", orgId).single();
  const plan = (org?.plans ?? null) as unknown as { name: string; limits: unknown } | null;
  const start = periodStart();
  const [websites, members, tracked, { data: usage }] = await Promise.all([
    db.from("websites").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    db.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", orgId),
    db.from("keywords").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_tracked", true),
    db.from("usage_records").select("metric, quantity").eq("organization_id", orgId).gte("occurred_at", start).limit(50_000),
  ]);
  const byMetric = new Map<string, number>();
  for (const u of usage ?? []) byMetric.set(u.metric, (byMetric.get(u.metric) ?? 0) + u.quantity);
  const used = {
    websites: websites.count ?? 0,
    members: members.count ?? 0,
    tracked_keywords: tracked.count ?? 0,
    crawl_pages_per_audit: 0,
  } as Record<LimitKey, number>;
  for (const [key, metric] of Object.entries(MONTHLY_METRIC)) used[key as LimitKey] = byMetric.get(metric!) ?? 0;
  return { planId: org?.plan_id ?? "free", planName: plan?.name ?? "Free", limits: readLimits(plan?.limits), usage: used };
}

/** Checks one limit; returns a user-facing message when it is exceeded. */
export async function checkEntitlement(orgId: string, key: LimitKey, amount = 1): Promise<LimitCheck & { message: string | null; planName: string }> {
  const e = await getEntitlements(orgId);
  const c = checkLimit(e.limits[key], e.usage[key], amount);
  return { ...c, planName: e.planName, message: c.allowed ? null : limitMessage(key, c, e.planName) };
}

/**
 * Records metered usage and notifies organization admins once when 80 % or
 * 100 % of a monthly limit is crossed.
 */
export async function recordUsage(opts: { orgId: string; websiteId?: string | null; metric: string; quantity: number; metadata?: Record<string, Json> }) {
  if (opts.quantity <= 0) return;
  const db = createAdminClient();
  const key = (Object.entries(MONTHLY_METRIC).find(([, m]) => m === opts.metric)?.[0] ?? null) as LimitKey | null;
  const before = key ? await getEntitlements(opts.orgId) : null;
  await db.from("usage_records").insert({ organization_id: opts.orgId, website_id: opts.websiteId ?? null, metric: opts.metric, quantity: opts.quantity, metadata: opts.metadata ?? {} });
  if (key && before) {
    const used = before.usage[key];
    const crossed = crossedThreshold(used, used + opts.quantity, before.limits[key]);
    if (crossed) {
      await notifyOrgAdmins(opts.orgId, {
        type: `usage.${crossed}`,
        title: crossed === "reached" ? `${LIMIT_LABEL[key]} limit reached` : `80% of ${limitPhrase(key)} used`,
        body: `${(used + opts.quantity).toLocaleString("en")} of ${before.limits[key].toLocaleString("en")} on the ${before.planName} plan this month.`,
        link: "billing",
      });
    }
  }
}
