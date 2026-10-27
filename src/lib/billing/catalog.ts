/**
 * Public plan catalog for marketing pages. Must match the `plans` rows seeded in
 * supabase/migrations/…_saas.sql — tests/unit/billing.test.ts compares them.
 * In the app, limits are always read from the database, never from here.
 */
import type { LimitKey, PlanId } from "./entitlements";

export interface CatalogPlan {
  id: PlanId;
  name: string;
  priceMonthly: number;
  blurb: string;
  featured?: boolean;
  limits: Record<LimitKey, number>;
}

export const PLAN_CATALOG: CatalogPlan[] = [
  {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    blurb: "For trying Rankora on one site.",
    limits: { websites: 1, members: 2, crawl_pages_per_month: 500, crawl_pages_per_audit: 100, tracked_keywords: 25, rank_checks_per_month: 750, keyword_lookups_per_month: 50, reports_per_month: 5, ai_credits_per_month: 20, backlink_lookups_per_month: 0 },
  },
  {
    id: "starter",
    name: "Starter",
    priceMonthly: 12,
    blurb: "For freelancers and small sites.",
    limits: { websites: 3, members: 3, crawl_pages_per_month: 5000, crawl_pages_per_audit: 500, tracked_keywords: 150, rank_checks_per_month: 4500, keyword_lookups_per_month: 300, reports_per_month: 30, ai_credits_per_month: 100, backlink_lookups_per_month: 2 },
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: 29,
    blurb: "For professionals managing a few sites.",
    featured: true,
    limits: { websites: 5, members: 5, crawl_pages_per_month: 25000, crawl_pages_per_audit: 1000, tracked_keywords: 500, rank_checks_per_month: 15000, keyword_lookups_per_month: 1000, reports_per_month: 100, ai_credits_per_month: 500, backlink_lookups_per_month: 10 },
  },
  {
    id: "agency",
    name: "Agency",
    priceMonthly: 99,
    blurb: "For agencies and in-house teams.",
    limits: { websites: 25, members: 25, crawl_pages_per_month: 150000, crawl_pages_per_audit: 5000, tracked_keywords: 2500, rank_checks_per_month: 75000, keyword_lookups_per_month: 5000, reports_per_month: 500, ai_credits_per_month: 2500, backlink_lookups_per_month: 50 },
  },
];
