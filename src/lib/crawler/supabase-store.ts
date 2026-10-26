import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TablesUpdate } from "@/lib/supabase/database.types";
import type { CrawlStore, NewLink, PendingPage, QueueEntry, SavedPage } from "./types";
import { normalizeUrl } from "./url";

type Admin = SupabaseClient<Database>;

const MAX_LINKS_PER_PAGE = 500;
const chunk = <T,>(arr: T[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

/**
 * CrawlStore backed by Postgres (service role). Callers MUST have authorized
 * access to the job before constructing this store.
 */
export class SupabaseCrawlStore implements CrawlStore {
  constructor(
    private db: Admin,
    private job: { id: string; organizationId: string; websiteId: string },
  ) {}

  async countPages() {
    const r = await this.db.from("crawl_pages").select("id", { count: "exact", head: true }).eq("crawl_job_id", this.job.id);
    if (r.error) throw new Error(`countPages: ${r.error.message}`);
    return r.count ?? 0;
  }

  async countFetched() {
    const r = await this.db
      .from("crawl_pages")
      .select("id", { count: "exact", head: true })
      .eq("crawl_job_id", this.job.id)
      .neq("fetch_state", "pending");
    if (r.error) throw new Error(`countFetched: ${r.error.message}`);
    return r.count ?? 0;
  }

  async enqueue(entries: QueueEntry[]) {
    const rows = new Map<string, TablesUpdate<"crawl_pages">>();
    for (const e of entries) {
      const n = normalizeUrl(e.url);
      if (!n || rows.has(n)) continue;
      rows.set(n, {
        organization_id: this.job.organizationId,
        crawl_job_id: this.job.id,
        website_id: this.job.websiteId,
        url: e.url,
        normalized_url: n,
        depth: e.depth,
        fetch_state: "pending",
        found_in_sitemap: Boolean(e.foundInSitemap),
        found_via_link: Boolean(e.foundViaLink),
      });
    }
    let added = 0;
    for (const part of chunk([...rows.values()], 200)) {
      const data = must(
        await this.db
          .from("crawl_pages")
          .upsert(part as never, { onConflict: "crawl_job_id,normalized_url", ignoreDuplicates: true })
          .select("id"),
        "enqueue",
      );
      added += data?.length ?? 0;
    }
    return added;
  }

  async markFound(urls: string[], how: "sitemap" | "link") {
    const list = [...new Set(urls.map((u) => normalizeUrl(u)).filter((u): u is string => Boolean(u)))];
    const patch = how === "sitemap" ? { found_in_sitemap: true } : { found_via_link: true };
    for (const part of chunk(list, 100)) {
      must(await this.db.from("crawl_pages").update(patch).eq("crawl_job_id", this.job.id).in("normalized_url", part), "markFound");
    }
  }

  async nextPending(limit: number): Promise<PendingPage[]> {
    const data = must(
      await this.db
        .from("crawl_pages")
        .select("id, url, depth, attempts")
        .eq("crawl_job_id", this.job.id)
        .eq("fetch_state", "pending")
        .order("depth")
        .order("crawled_at")
        .limit(limit),
      "nextPending",
    );
    return data ?? [];
  }

  async savePage(id: string, page: SavedPage) {
    const p = page.parsed;
    const internal = p?.links.filter((l) => l.internal).length ?? null;
    const patch: TablesUpdate<"crawl_pages"> = {
      fetch_state: page.fetchState,
      attempts: page.attempts,
      status_code: page.statusCode,
      final_url: page.finalUrl,
      redirect_chain: page.redirectChain as unknown as Json,
      content_type: page.contentType?.slice(0, 200) ?? null,
      response_time_ms: page.responseTimeMs,
      content_length: page.contentLength,
      fetch_error: page.fetchError?.slice(0, 500) ?? null,
      skip_reason: page.skipReason,
      x_robots_tag: page.xRobotsTag?.slice(0, 300) ?? null,
      is_indexable: page.isIndexable,
      indexability_reason: page.indexabilityReason,
      crawled_at: new Date().toISOString(),
      title: p?.title?.slice(0, 1000) ?? null,
      meta_description: p?.metaDescription?.slice(0, 2000) ?? null,
      h1: p?.h1.map((h) => h.slice(0, 500)).slice(0, 20) ?? [],
      h2_count: p?.h2Count ?? null,
      canonical_url: p?.canonical ?? null,
      robots_meta: p?.robotsMeta ?? null,
      lang: p?.lang?.slice(0, 35) ?? null,
      word_count: p?.wordCount ?? null,
      content_hash: p?.contentHash ?? null,
      internal_links_count: internal,
      external_links_count: p ? p.links.length - (internal ?? 0) : null,
      images_count: p?.images.total ?? null,
      images_missing_alt: p?.images.missingAlt ?? null,
      has_viewport: p?.hasViewport ?? null,
      structured_data_types: p?.structuredDataTypes ?? [],
      open_graph: (p?.openGraph ?? {}) as Json,
      twitter_card: (p?.twitterCard ?? {}) as Json,
      details: (p
        ? {
            headingLevels: p.headingLevels.slice(0, 100),
            headingSkips: p.headingSkips,
            canonicalInvalid: p.canonicalInvalid,
            imagesMissingDimensions: p.images.missingDimensions,
            nofollowPage: p.nofollowPage,
            metaRefresh: p.metaRefresh,
            truncated: page.fetchError === "response truncated at size limit",
          }
        : {}) as Json,
    };
    must(await this.db.from("crawl_pages").update(patch).eq("id", id).eq("crawl_job_id", this.job.id), "savePage");
  }

  async retryLater(id: string, attempts: number, error: string) {
    must(
      await this.db
        .from("crawl_pages")
        .update({ attempts, fetch_error: error.slice(0, 500), crawled_at: new Date().toISOString() })
        .eq("id", id)
        .eq("crawl_job_id", this.job.id),
      "retryLater",
    );
  }

  async saveLinks(pageId: string, links: NewLink[]) {
    const rows = links.slice(0, MAX_LINKS_PER_PAGE).map((l) => ({
      organization_id: this.job.organizationId,
      crawl_job_id: this.job.id,
      source_page_id: pageId,
      target_url: l.targetUrl.slice(0, 2048),
      is_internal: l.isInternal,
      is_nofollow: l.isNofollow,
      anchor_text: l.anchorText.slice(0, 200) || null,
    }));
    for (const part of chunk(rows, 250)) must(await this.db.from("crawl_links").insert(part), "saveLinks");
  }

  async uncheckedExternalTargets(limit: number) {
    const data = must(
      await this.db
        .from("crawl_links")
        .select("target_url")
        .eq("crawl_job_id", this.job.id)
        .eq("is_internal", false)
        .is("target_status", null)
        .is("target_error", null)
        .limit(limit * 10),
      "uncheckedExternalTargets",
    );
    return [...new Set((data ?? []).map((d) => d.target_url))].slice(0, limit);
  }

  async setExternalStatus(targetUrl: string, status: number | null, error: string | null) {
    must(
      await this.db
        .from("crawl_links")
        .update({ target_status: status, target_error: error ? error.slice(0, 300) : status === null ? "unknown error" : null })
        .eq("crawl_job_id", this.job.id)
        .eq("target_url", targetUrl),
      "setExternalStatus",
    );
  }
}
