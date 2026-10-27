/**
 * Plan entitlements and usage limits. Pure and unit tested; the database plan
 * catalog (public.plans.limits) holds the numbers, this module interprets them.
 */

export const PLAN_IDS = ["free", "starter", "pro", "agency"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Every limit a plan can set. Monthly limits reset on the 1st (UTC). */
export const LIMIT_KEYS = [
  "websites",
  "members",
  "crawl_pages_per_month",
  "crawl_pages_per_audit",
  "tracked_keywords",
  "rank_checks_per_month",
  "keyword_lookups_per_month",
  "reports_per_month",
  "ai_credits_per_month",
  "backlink_lookups_per_month",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const LIMIT_LABEL: Record<LimitKey, string> = {
  websites: "Websites",
  members: "Team members",
  crawl_pages_per_month: "Crawled pages / month",
  crawl_pages_per_audit: "Pages per audit",
  tracked_keywords: "Tracked keywords",
  rank_checks_per_month: "Rank checks / month",
  keyword_lookups_per_month: "Keyword lookups / month",
  reports_per_month: "Reports / month",
  ai_credits_per_month: "AI credits / month",
  backlink_lookups_per_month: "Backlink syncs / month",
};

/** Label for use inside a sentence: "ai credits" stays "AI credits". */
export function limitPhrase(key: LimitKey): string {
  const label = LIMIT_LABEL[key];
  return /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/** "1 website", "5 websites", "No backlink syncs / month" — for plan feature lists. */
export function limitCountLabel(key: LimitKey, n: number): string {
  if (n === 0) return `No ${limitPhrase(key)}`;
  let phrase = limitPhrase(key);
  if (n === 1) {
    // singular: drop the plural "s" from the noun before any " / month" suffix
    const [noun, ...rest] = phrase.split(" / ");
    phrase = [noun.endsWith("s") ? noun.slice(0, -1) : noun, ...rest].join(" / ");
  }
  return `${n.toLocaleString("en")} ${phrase}`;
}

/** Monthly limits and the usage_records metric that counts them. */
export const MONTHLY_METRIC: Partial<Record<LimitKey, string>> = {
  crawl_pages_per_month: "crawl_pages",
  rank_checks_per_month: "rank_checks",
  keyword_lookups_per_month: "keyword_lookups",
  reports_per_month: "reports",
  ai_credits_per_month: "ai_credits",
  backlink_lookups_per_month: "backlink_lookups",
};

/** Conservative fallbacks if a plan row lacks a key (never more generous than Free). */
export const FREE_FALLBACK: Record<LimitKey, number> = {
  websites: 1,
  members: 2,
  crawl_pages_per_month: 500,
  crawl_pages_per_audit: 100,
  tracked_keywords: 25,
  rank_checks_per_month: 750,
  keyword_lookups_per_month: 50,
  reports_per_month: 5,
  ai_credits_per_month: 20,
  backlink_lookups_per_month: 0,
};

export function readLimits(raw: unknown): Record<LimitKey, number> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    LIMIT_KEYS.map((k) => {
      const v = Number(src[k]);
      return [k, Number.isFinite(v) && v >= 0 ? Math.floor(v) : FREE_FALLBACK[k]];
    }),
  ) as Record<LimitKey, number>;
}

export interface LimitCheck {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
}

/** Can `amount` more units be used? */
export function checkLimit(limit: number, used: number, amount = 1): LimitCheck {
  const remaining = Math.max(0, limit - used);
  return { allowed: amount <= remaining, limit, used, remaining };
}

export type UsageLevel = "ok" | "warning" | "reached";

/** ≥ 80 % is a warning, 100 % is reached. */
export function usageLevel(used: number, limit: number): UsageLevel {
  if (limit <= 0) return "reached";
  const ratio = used / limit;
  return ratio >= 1 ? "reached" : ratio >= 0.8 ? "warning" : "ok";
}

/** Which threshold was crossed by moving from `before` to `after` (for one-time notifications). */
export function crossedThreshold(before: number, after: number, limit: number): "warning" | "reached" | null {
  if (limit <= 0) return null;
  if (before < limit && after >= limit) return "reached";
  if (before < limit * 0.8 && after >= limit * 0.8) return "warning";
  return null;
}

export function limitMessage(key: LimitKey, check: LimitCheck, planName: string): string {
  return `Your ${planName} plan includes ${check.limit.toLocaleString("en")} ${limitPhrase(key)} (${check.used.toLocaleString("en")} used). Upgrade your plan for more.`;
}

export function isUpgrade(from: PlanId, to: PlanId) {
  return PLAN_IDS.indexOf(to) > PLAN_IDS.indexOf(from);
}

/** Start of the current usage period (calendar month, UTC). */
export function periodStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function periodEnd(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
