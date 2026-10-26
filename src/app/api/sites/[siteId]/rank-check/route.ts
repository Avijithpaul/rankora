import { NextResponse } from "next/server";
import { authorizeSite } from "@/lib/keywords/site-access";
import { dueKeywordCount, runRankBatch } from "@/lib/keywords/service";
import { getRankProvider } from "@/lib/providers/registry";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/** GET: how many tracked keywords are due today. */
export async function GET(_req: Request, ctx: RouteContext<"/api/sites/[siteId]/rank-check">) {
  const { siteId } = await ctx.params;
  const access = await authorizeSite(siteId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json({ remaining: await dueKeywordCount(siteId), providerConnected: Boolean(getRankProvider()) });
}

/** POST: check one batch of due keywords with the connected rank provider. */
export async function POST(_req: Request, ctx: RouteContext<"/api/sites/[siteId]/rank-check">) {
  const { siteId } = await ctx.params;
  const access = await authorizeSite(siteId, "member");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.website.is_demo) return NextResponse.json({ error: "The Demo Project uses sample rankings and cannot be checked." }, { status: 403 });
  if (!getRankProvider()) return NextResponse.json({ error: "Provider Not Connected" }, { status: 409 });
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("rate_limit_hit", { p_bucket: "ranks.tick", p_limit: 120, p_window_seconds: 3600 });
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const result = await runRankBatch(access.website, { max: 12, budgetMs: 40_000 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
