import { NextResponse } from "next/server";
import { authorizeSite } from "@/lib/keywords/site-access";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/keywords/csv";

/** CSV export of saved keywords (optionally one group / tracked only). */
export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/keywords/export">) {
  const { siteId } = await ctx.params;
  const access = await authorizeSite(siteId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const groupId = url.searchParams.get("group");
  const supabase = await createClient();
  let keywordIds: string[] | null = null;
  if (groupId && /^[0-9a-f-]{36}$/i.test(groupId)) {
    const { data } = await supabase.from("keyword_group_members").select("keyword_id").eq("group_id", groupId);
    keywordIds = (data ?? []).map((d) => d.keyword_id);
  }
  let q = supabase.from("keywords").select("*").eq("website_id", siteId).order("keyword").limit(10000);
  if (keywordIds) q = q.in("id", keywordIds.length ? keywordIds : ["00000000-0000-0000-0000-000000000000"]);
  if (url.searchParams.get("tracked") === "1") q = q.eq("is_tracked", true);
  const { data: rows } = await q;
  const csv = toCsv(
    [
      "keyword", "country", "language", "device", "search_engine", "tracked", "target_url",
      "search_volume", "cpc", "competition", "difficulty", "intent", "metrics_source", "metrics_fetched_at",
      "current_position", "previous_position", "best_position", "ranking_url", "last_checked_on", "rank_source",
    ],
    (rows ?? []).map((k) => [
      k.keyword, k.country_code, k.language_code, k.device, k.search_engine, k.is_tracked ? "yes" : "no", k.target_url,
      k.search_volume, k.cpc, k.competition, k.difficulty, k.intent, k.metrics_source, k.metrics_fetched_at,
      k.current_position, k.previous_position, k.best_position, k.current_url, k.last_checked_on, k.rank_source,
    ]),
  );
  const name = `${access.website.domain}-keywords-${new Date().toISOString().slice(0, 10)}${access.website.is_demo ? "-DEMO-DATA" : ""}.csv`;
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
