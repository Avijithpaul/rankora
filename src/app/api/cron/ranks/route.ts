import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runRankBatch, todayUtc } from "@/lib/keywords/service";
import { getRankProvider } from "@/lib/providers/registry";
import { safeEqual } from "@/lib/security/crypto";

export const maxDuration = 60;

/** Daily rank checks for every website with due tracked keywords. Requires Bearer CRON_SECRET. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!getRankProvider()) return NextResponse.json({ skipped: "Provider Not Connected" });
  const db = createAdminClient();
  const { data: due } = await db
    .from("keywords")
    .select("website_id")
    .eq("is_tracked", true)
    .or(`last_checked_on.is.null,last_checked_on.lt.${todayUtc()}`)
    .limit(500);
  const siteIds = [...new Set((due ?? []).map((d) => d.website_id))];
  const started = Date.now();
  const results: Record<string, unknown> = {};
  for (const id of siteIds) {
    if (Date.now() - started > 40_000) break;
    const { data: website } = await db.from("websites").select("*").eq("id", id).eq("is_demo", false).eq("status", "active").maybeSingle();
    if (!website) continue;
    results[id] = await runRankBatch(website, { max: 20, budgetMs: 15_000 });
  }
  return NextResponse.json({ sites: Object.keys(results).length, results });
}
