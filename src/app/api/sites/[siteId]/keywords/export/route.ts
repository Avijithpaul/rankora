import { NextResponse } from "next/server";
import { authorizeSite } from "@/lib/keywords/site-access";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/keywords/csv";
import { selectAll } from "@/lib/supabase/paginate";
import type { Tables } from "@/lib/supabase/database.types";

/** CSV export of saved keywords (optionally one group / tracked only). */
export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/keywords/export">) {
  const { siteId } = await ctx.params;
  const access = await authorizeSite(siteId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const groupId = url.searchParams.get("group");
  const supabase = await createClient();
  const validGroup = groupId && /^[0-9a-f-]{36}$/i.test(groupId) ? groupId : null;
  const tracked = url.searchParams.get("tracked") === "1";
  // page through results (Data API max 1000 rows per request); group filter via an inner join
  const rows = await selectAll(
    (from, to) => {
      let q = supabase
        .from("keywords")
        .select(validGroup ? "*, keyword_group_members!inner(group_id)" : "*")
        .eq("website_id", siteId);
      if (validGroup) q = q.eq("keyword_group_members.group_id", validGroup);
      if (tracked) q = q.eq("is_tracked", true);
      return q.order("keyword").order("id").range(from, to) as unknown as PromiseLike<{ data: Tables<"keywords">[] | null; error: { message: string } | null }>;
    },
    20_000,
  );
  const csv = toCsv(
    [
      "keyword", "country", "language", "device", "search_engine", "tracked", "target_url",
      "search_volume", "cpc", "competition", "difficulty", "intent", "metrics_source", "metrics_fetched_at",
      "current_position", "previous_position", "best_position", "ranking_url", "last_checked_on", "rank_source",
    ],
    rows.map((k) => [
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
