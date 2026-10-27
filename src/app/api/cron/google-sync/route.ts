import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSyncTick, startSync } from "@/lib/google/sync";
import { safeEqual } from "@/lib/security/crypto";

export const maxDuration = 60;

/**
 * Daily incremental sync of connected Search Console / GA4 integrations
 * (last few days, which Google keeps revising). Requires Bearer CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = createAdminClient();
  const staleBefore = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const { data: due } = await db
    .from("integrations")
    .select("id, last_synced_at, sync_state")
    .in("provider", ["google_search_console", "google_analytics_4"])
    .eq("status", "connected")
    .not("external_account_id", "is", null)
    .or(`last_synced_at.is.null,last_synced_at.lt."${staleBefore}"`)
    .limit(20);
  const started = Date.now();
  const results: Record<string, unknown> = {};
  for (const i of due ?? []) {
    if (Date.now() - started > 40_000) break;
    const state = (i.sync_state ?? {}) as { done?: boolean };
    if (i.last_synced_at && state.done !== false) await startSync(i.id, "incremental");
    results[i.id] = await runSyncTick(i.id, 15_000);
  }
  return NextResponse.json({ integrations: Object.keys(results).length, results });
}
