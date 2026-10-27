import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { getBacklinkProvider } from "@/lib/providers/registry";
import { ProviderError, type Backlink, type BacklinkProvider } from "@/lib/providers/types";
import { planLimits, usageThisMonth } from "@/lib/keywords/service";

type Website = Tables<"websites">;

export const BACKLINK_SYNCS_PER_MONTH_DEFAULT = 10;
export const LIVE_LINK_LIMIT = 1000;
export const LOST_LINK_LIMIT = 200;

export type BacklinkSyncResult = { ok: true; stored: number } | { ok: false; reason: "not_connected" | "quota" | "provider_error"; message: string };

const toRow = (website: Website, provider: string, syncedAt: string) => (b: Backlink) => ({
  organization_id: website.organization_id,
  website_id: website.id,
  source_url: b.sourceUrl,
  source_domain: b.sourceDomain,
  target_url: b.targetUrl,
  anchor_text: b.anchor,
  rel: b.rel,
  link_type: b.linkType,
  domain_authority: b.domainRank,
  provider,
  first_seen_at: b.firstSeen ? new Date(b.firstSeen).toISOString() : null,
  last_seen_at: b.lastSeen ? new Date(b.lastSeen).toISOString() : null,
  // the provider reports "lost" with the last date it saw the link; we never infer it
  lost_at: b.isLost && b.lastSeen ? new Date(b.lastSeen).toISOString() : null,
  is_new: b.isNew,
  is_lost: b.isLost,
  synced_at: syncedAt,
});

/**
 * Pulls the provider's summary, live links and recently lost links for the
 * website's domain. Rows store exactly what the provider returned in the latest
 * sync; links it no longer returns are removed rather than guessed about.
 */
export async function syncBacklinks(opts: { website: Website; userId: string; planId: string; provider?: BacklinkProvider | null }): Promise<BacklinkSyncResult> {
  const { website } = opts;
  const provider = opts.provider !== undefined ? opts.provider : getBacklinkProvider();
  if (!provider) return { ok: false, reason: "not_connected", message: "No backlink data provider is connected." };
  if (website.is_demo) return { ok: false, reason: "not_connected", message: "Backlinks are not available for the Demo Project." };
  const db = createAdminClient();
  const limit = (await planLimits(opts.planId)).backlink_lookups_per_month ?? BACKLINK_SYNCS_PER_MONTH_DEFAULT;
  if ((await usageThisMonth(website.organization_id, "backlink_lookups")) >= limit) {
    return { ok: false, reason: "quota", message: `Your plan includes ${limit} backlink syncs per month.` };
  }
  const syncedAt = new Date().toISOString();
  try {
    const [summary, live, lost] = await Promise.all([
      provider.summary(website.domain),
      provider.backlinks(website.domain, { limit: LIVE_LINK_LIMIT, status: "live" }),
      provider.backlinks(website.domain, { limit: LOST_LINK_LIMIT, status: "lost" }),
    ]);
    const byKey = new Map<string, Backlink>();
    for (const b of [...lost.items, ...live.items]) byKey.set(`${b.sourceUrl}\n${b.targetUrl}`, b); // live wins over lost
    const rows = [...byKey.values()].map(toRow(website, provider.id, syncedAt));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("backlinks").upsert(rows.slice(i, i + 500), { onConflict: "website_id,source_url,target_url" });
      if (error) throw new Error(error.message);
    }
    // Rows the provider no longer returned are removed, so stored links always equal the latest provider response.
    await db.from("backlinks").delete().eq("website_id", website.id).lt("synced_at", syncedAt);
    await db.from("backlink_syncs").insert({
      organization_id: website.organization_id,
      website_id: website.id,
      provider: provider.id,
      status: "completed",
      summary: { ...summary, liveTotal: live.total, lostTotal: lost.total } as unknown as Json,
      rows_stored: rows.length,
      created_by: opts.userId,
      synced_at: syncedAt,
    });
    await db.from("usage_records").insert({ organization_id: website.organization_id, website_id: website.id, metric: "backlink_lookups", quantity: 1 });
    return { ok: true, stored: rows.length };
  } catch (e) {
    const message = e instanceof ProviderError ? e.message : `Backlink sync failed: ${(e as Error).message}`;
    await db.from("backlink_syncs").insert({ organization_id: website.organization_id, website_id: website.id, provider: provider.id, status: "failed", error: message.slice(0, 1000), created_by: opts.userId });
    return { ok: false, reason: "provider_error", message };
  }
}
