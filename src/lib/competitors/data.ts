import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";
import type { Tables } from "@/lib/supabase/database.types";
import type { RankedKeyword } from "@/lib/providers/types";
import type { Positions, TrackedKeywordRow } from "./compare";

type Website = Tables<"websites">;

/**
 * Tracked keywords with our latest position and, per competitor, the position
 * from the SAME SERP check (same checked_on date). Older competitor rows are not
 * mixed with newer own positions.
 */
export async function loadRankingComparison(website: Website, competitorIds: string[]) {
  const supabase = await createClient();
  const keywords = await selectAll((from, to) =>
    supabase
      .from("keywords")
      .select("id, keyword, search_volume, current_position, last_checked_on")
      .eq("website_id", website.id)
      .eq("is_tracked", true)
      .order("search_volume", { ascending: false, nullsFirst: false })
      .order("keyword")
      .range(from, to),
  );
  const rows: TrackedKeywordRow[] = keywords.map((k) => ({
    id: k.id,
    keyword: k.keyword,
    searchVolume: k.search_volume,
    own: k.last_checked_on ? k.current_position : undefined,
    checkedOn: k.last_checked_on,
  }));
  const positions: Positions = new Map(competitorIds.map((id) => [id, new Map<string, number | null>()]));
  if (competitorIds.length && keywords.length) {
    const lastChecked = new Map(keywords.map((k) => [k.id, k.last_checked_on]));
    const oldest = keywords.reduce<string | null>((m, k) => (k.last_checked_on && (!m || k.last_checked_on < m) ? k.last_checked_on : m), null);
    if (oldest) {
      const comp = await selectAll((from, to) =>
        supabase.from("competitor_rankings").select("competitor_id, keyword_id, checked_on, position").in("competitor_id", competitorIds).gte("checked_on", oldest).range(from, to),
      );
      for (const r of comp) if (lastChecked.get(r.keyword_id) === r.checked_on) positions.get(r.competitor_id)?.set(r.keyword_id, r.position);
    }
  }
  return { keywords: rows, positions };
}

export async function latestKeywordSnapshot(website: Website, domain: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("domain_keyword_snapshots")
    .select("id, domain, provider, item_count, items, fetched_at")
    .eq("website_id", website.id)
    .eq("domain", domain)
    .eq("country_code", website.country_code)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { ...data, items: (data.items as unknown as RankedKeyword[]) ?? [] } : null;
}
