import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processJob } from "@/lib/audit/service";
import { safeEqual } from "@/lib/security/crypto";

export const maxDuration = 60;

/**
 * Background worker entry point (Vercel Cron or any scheduler).
 * Requires `Authorization: Bearer $CRON_SECRET`. Advances the oldest active jobs.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = createAdminClient();
  const { data: jobs } = await db
    .from("crawl_jobs")
    .select("id")
    .in("status", ["queued", "running"])
    .order("created_at")
    .limit(3);
  const started = Date.now();
  const results = [];
  for (const job of jobs ?? []) {
    if (Date.now() - started > 35_000) break;
    results.push(await processJob(job.id, 15_000));
  }
  return NextResponse.json({ processed: results.length, results });
}
