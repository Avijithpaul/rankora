import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/keywords/csv";
import type { StoredIdea } from "@/lib/keywords/service";

/** CSV export of one stored keyword-research result (RLS-scoped). */
export async function GET(_req: Request, ctx: RouteContext<"/api/keyword-research/[queryId]/export">) {
  const { queryId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(queryId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await getUser())) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const supabase = await createClient();
  const { data: q } = await supabase
    .from("keyword_research_queries")
    .select("seed, country_code, language_code, provider, results, created_at")
    .eq("id", queryId)
    .maybeSingle();
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ideas = (q.results as unknown as StoredIdea[]) ?? [];
  const csv = toCsv(
    ["keyword", "type", "search_volume", "cpc", "competition", "difficulty", "intent", "source", "country", "language", "provider", "fetched_at"],
    ideas.map((i) => [i.keyword, i.type, i.searchVolume, i.cpc, i.competition, i.difficulty, i.intent, i.source, q.country_code, q.language_code, q.provider === "demo" ? "DEMO DATA" : q.provider, q.created_at]),
  );
  const name = `keyword-research-${q.seed.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}${q.provider === "demo" ? "-DEMO-DATA" : ""}.csv`;
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
