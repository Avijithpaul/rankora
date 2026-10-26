/** Convert crawl records (in-memory or database rows) into analyzer input. */
import type { AnalyzerLink, AnalyzerPage } from "./analyze";
import type { MemoryCrawlStore } from "@/lib/crawler/memory-store";
import type { SavedPage } from "@/lib/crawler/types";
import type { Json, Tables } from "@/lib/supabase/database.types";

export function fromSaved(
  url: string,
  depth: number,
  foundInSitemap: boolean,
  state: AnalyzerPage["fetchState"],
  saved: SavedPage | undefined,
): AnalyzerPage {
  const p = saved?.parsed;
  const hops = saved?.redirectChain.length ?? 0;
  return {
    url,
    depth,
    fetchState: state,
    statusCode: saved?.statusCode ?? null,
    finalStatus: hops > 0 ? null : (saved?.statusCode ?? null),
    redirectHops: hops,
    contentType: saved?.contentType ?? null,
    responseTimeMs: saved?.responseTimeMs ?? null,
    isIndexable: saved?.isIndexable ?? null,
    title: p?.title ?? null,
    metaDescription: p?.metaDescription ?? null,
    h1: p?.h1 ?? [],
    headingSkips: p?.headingSkips ?? 0,
    canonical: p?.canonical ?? null,
    canonicalInvalid: p?.canonicalInvalid ?? false,
    noindex: (p?.noindex ?? false) || /\b(noindex|none)\b/i.test(saved?.xRobotsTag ?? ""),
    lang: p?.lang ?? null,
    hasViewport: p?.hasViewport ?? false,
    wordCount: p?.wordCount ?? null,
    contentHash: p?.contentHash ?? null,
    imagesTotal: p?.images.total ?? 0,
    imagesMissingAlt: p?.images.missingAlt ?? 0,
    structuredDataTypes: p?.structuredDataTypes ?? [],
    openGraph: p?.openGraph ?? {},
    twitterCard: p?.twitterCard ?? {},
    foundInSitemap,
  };
}

export function fromMemoryStore(store: MemoryCrawlStore): { pages: AnalyzerPage[]; links: AnalyzerLink[] } {
  const pages = [...store.pages.values()].map((p) => fromSaved(p.url, p.depth, p.foundInSitemap, p.state, p.saved));
  const urlById = new Map([...store.pages.values()].map((p) => [p.id, p.url]));
  const links = store.links.map((l) => ({
    sourceUrl: urlById.get(l.sourcePageId)!,
    targetUrl: l.targetUrl,
    isInternal: l.isInternal,
    targetStatus: l.targetStatus,
    targetError: l.targetError,
  }));
  return { pages, links };
}

type PageRow = Pick<
  Tables<"crawl_pages">,
  | "normalized_url"
  | "depth"
  | "fetch_state"
  | "status_code"
  | "redirect_chain"
  | "content_type"
  | "response_time_ms"
  | "is_indexable"
  | "title"
  | "meta_description"
  | "h1"
  | "canonical_url"
  | "robots_meta"
  | "x_robots_tag"
  | "lang"
  | "has_viewport"
  | "word_count"
  | "content_hash"
  | "images_count"
  | "images_missing_alt"
  | "structured_data_types"
  | "open_graph"
  | "twitter_card"
  | "found_in_sitemap"
  | "details"
>;

const obj = (j: Json) => (j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {});

export function fromDbRow(r: PageRow): AnalyzerPage {
  const hops = Array.isArray(r.redirect_chain) ? r.redirect_chain.length : 0;
  const d = obj(r.details);
  const robots = `${r.robots_meta ?? ""} ${r.x_robots_tag ?? ""}`;
  return {
    url: r.normalized_url,
    depth: r.depth,
    fetchState: r.fetch_state as AnalyzerPage["fetchState"],
    statusCode: r.status_code,
    finalStatus: hops > 0 ? null : r.status_code,
    redirectHops: hops,
    contentType: r.content_type,
    responseTimeMs: r.response_time_ms,
    isIndexable: r.is_indexable,
    title: r.title,
    metaDescription: r.meta_description,
    h1: r.h1 ?? [],
    headingSkips: Number(d.headingSkips ?? 0),
    canonical: r.canonical_url,
    canonicalInvalid: Boolean(d.canonicalInvalid),
    noindex: /\b(noindex|none)\b/i.test(robots),
    lang: r.lang,
    hasViewport: Boolean(r.has_viewport),
    wordCount: r.word_count,
    contentHash: r.content_hash,
    imagesTotal: r.images_count ?? 0,
    imagesMissingAlt: r.images_missing_alt ?? 0,
    structuredDataTypes: r.structured_data_types ?? [],
    openGraph: obj(r.open_graph) as Record<string, string>,
    twitterCard: obj(r.twitter_card) as Record<string, string>,
    foundInSitemap: r.found_in_sitemap,
  };
}
