import { NextResponse } from "next/server";
import { authorizeJob } from "@/lib/audit/job-access";
import { processJob } from "@/lib/audit/service";

export const maxDuration = 60;

/**
 * Advances a crawl by one time-boxed batch. Called repeatedly by the audit page
 * while it is open; /api/cron/crawl continues jobs when nobody is watching.
 * A database lock ensures only one tick works on a job at a time.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/crawl-jobs/[id]/tick">) {
  const { id } = await ctx.params;
  const access = await authorizeJob(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.canRun) return NextResponse.json({ error: "Not allowed to run audits for this website" }, { status: 403 });
  const status = await processJob(id, 20_000);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
