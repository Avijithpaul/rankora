import { NextResponse } from "next/server";
import { authorizeJob } from "@/lib/audit/job-access";
import { createClient } from "@/lib/supabase/server";
import { toStatus } from "@/lib/audit/service";

/** Crawl job status for the signed-in user (RLS-scoped read). */
export async function GET(_req: Request, ctx: RouteContext<"/api/crawl-jobs/[id]">) {
  const { id } = await ctx.params;
  const access = await authorizeJob(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("crawl_jobs")
    .select("id, status, phase, pages_crawled, pages_discovered, settings_snapshot, error, audit_id")
    .eq("id", id)
    .single();
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toStatus(job), { headers: { "Cache-Control": "no-store" } });
}
