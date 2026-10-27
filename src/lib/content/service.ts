import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSafeFetcher } from "@/lib/crawler/fetcher";
import { isSameSite } from "@/lib/crawler/url";
import { parsePublicUrl, UnsafeUrlError } from "@/lib/security/url-safety";
import { addDays, isoDay } from "@/lib/analytics/ranges";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { aiProvider } from "@/lib/ai/registry";
import { MAX_AI_TEXT_CHARS } from "@/lib/ai/prompts";
import type { AiContext, AiProvider, AiSuggestionRecord, AiTask, InternalLinkCandidate } from "@/lib/ai/types";
import { analyzeContent, type ContentAnalysis } from "./analyze";
import { documentFromDraft, documentFromHtml, type ContentDocument } from "./document";
import { linkOpportunities, mergeTerms, parseUserTerms, termsFromSavedKeywords, termsFromSearchConsole, type CrawledPageRef, type LinkOpportunity } from "./sources";

type Website = Tables<"websites">;
/** Client used for reads; defaults to the signed-in user (RLS). Scripts may inject one. */
type Reader = SupabaseClient<Database>;

/** Shape of content_analyses.results (versioned through scoring_version). */
export interface StoredContentResults {
  analysis: ContentAnalysis;
  document: {
    url: string | null;
    finalUrl: string | null;
    title: string | null;
    metaDescription: string | null;
    headings: { level: number; text: string }[];
    links: string[];
  };
  /** visible text kept for later AI suggestions, truncated */
  excerpt: string;
  termSources: { searchConsole: number; savedKeywords: number; user: number; searchConsoleConnected: boolean };
  linkOpportunities: LinkOpportunity[];
  linkCandidates: InternalLinkCandidate[];
}

export type AnalyzeInput =
  | { mode: "url"; url: string; keyword: string; terms?: string }
  | { mode: "draft"; keyword: string; title?: string; metaDescription?: string; body: string; terms?: string };

export type AnalyzeResult = { ok: true; id: string } | { ok: false; reason: "invalid_url" | "off_site" | "fetch_failed" | "not_html" | "empty"; message: string };

/** Fetches one page of the website through the SSRF-safe fetcher. */
async function fetchPage(url: string, website: Website): Promise<{ ok: true; html: string; finalUrl: string } | { ok: false; reason: "invalid_url" | "off_site" | "fetch_failed" | "not_html"; message: string }> {
  let parsed: URL;
  try {
    parsed = parsePublicUrl(url);
  } catch (e) {
    return { ok: false, reason: "invalid_url", message: e instanceof UnsafeUrlError ? e.message : "Enter a valid http(s) URL." };
  }
  // Only pages of this website: the optimizer is not a general-purpose fetch proxy.
  if (!isSameSite(parsed, website.domain)) return { ok: false, reason: "off_site", message: `The URL must be on ${website.domain}.` };
  const r = await createSafeFetcher()(parsed.toString(), { timeoutMs: 15_000, accept: "text/html,application/xhtml+xml" });
  if (!r.ok) return { ok: false, reason: "fetch_failed", message: r.error };
  if (r.status >= 400) return { ok: false, reason: "fetch_failed", message: `The page returned HTTP ${r.status}.` };
  if (!/html/i.test(r.contentType ?? "")) return { ok: false, reason: "not_html", message: `Expected an HTML page, got ${r.contentType ?? "unknown content type"}.` };
  if (!isSameSite(r.finalUrl, website.domain)) return { ok: false, reason: "off_site", message: "The page redirects to another site." };
  return { ok: true, html: r.body, finalUrl: r.finalUrl };
}

async function latestCrawlPages(supabase: Reader, websiteId: string): Promise<CrawledPageRef[]> {
  const { data: job } = await supabase.from("crawl_jobs").select("id").eq("website_id", websiteId).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!job) return [];
  const { data } = await supabase
    .from("crawl_pages")
    .select("normalized_url, title, h1, inbound_links_count")
    .eq("crawl_job_id", job.id)
    .eq("fetch_state", "fetched")
    .eq("status_code", 200)
    .eq("is_indexable", true)
    .order("inbound_links_count", { ascending: false, nullsFirst: false })
    .limit(1000);
  return (data ?? []).map((p) => ({ url: p.normalized_url, title: p.title, h1: p.h1, inbound: p.inbound_links_count }));
}

async function gatherTerms(supabase: Reader, website: Website, keyword: string, userTerms?: string) {
  const now = new Date();
  const to = isoDay(now);
  const [{ data: saved }, { data: queries }, { count: gscRows }] = await Promise.all([
    supabase.from("keywords").select("keyword").eq("website_id", website.id).order("search_volume", { ascending: false, nullsFirst: false }).limit(1000),
    supabase.rpc("gsc_breakdown", { p_site: website.id, p_dim: "query", p_from: isoDay(addDays(now, -90)), p_to: to, p_limit: 1000 }),
    supabase.from("search_console_daily").select("date", { count: "exact", head: true }).eq("website_id", website.id).limit(1),
  ]);
  const user = parseUserTerms(userTerms);
  const gsc = termsFromSearchConsole(keyword, (queries ?? []).map((q) => ({ key: q.key ?? "", impressions: Number(q.impressions) })));
  const savedTerms = termsFromSavedKeywords(keyword, (saved ?? []).map((k) => k.keyword));
  return {
    terms: mergeTerms(user, gsc, savedTerms),
    sources: { searchConsole: gsc.length, savedKeywords: savedTerms.length, user: user.length, searchConsoleConnected: (gscRows ?? 0) > 0 },
  };
}

export async function runContentAnalysis(input: AnalyzeInput, ctx: { website: Website; userId: string; reader?: Reader }): Promise<AnalyzeResult> {
  const { website } = ctx;
  const reader = ctx.reader ?? (await createClient());
  let doc: ContentDocument;
  let finalUrl: string | null = null;
  if (input.mode === "url") {
    const page = await fetchPage(input.url, website);
    if (!page.ok) return page;
    finalUrl = page.finalUrl;
    doc = documentFromHtml(page.html, page.finalUrl);
  } else {
    doc = documentFromDraft({ title: input.title, metaDescription: input.metaDescription, body: input.body }, website.domain);
  }
  if (!doc.text) return { ok: false, reason: "empty", message: "No readable text was found to analyze." };

  const [{ terms, sources }, pages] = await Promise.all([gatherTerms(reader, website, input.keyword, input.terms), latestCrawlPages(reader, website.id)]);
  const analysis = analyzeContent(doc, { keyword: input.keyword, language: website.language_code, terms });
  const opportunities = linkOpportunities(input.keyword, pages, doc);
  const linked = new Set(doc.links.map((l) => l.url));
  const candidates = [...opportunities.map((o) => ({ url: o.url, title: o.title })), ...pages.filter((p) => !linked.has(p.url) && p.url !== doc.url).map((p) => ({ url: p.url, title: p.title }))]
    .filter((c, i, all) => all.findIndex((x) => x.url === c.url) === i)
    .slice(0, 40);

  const results: StoredContentResults = {
    analysis,
    document: {
      url: input.mode === "url" ? input.url : null,
      finalUrl,
      title: doc.title,
      metaDescription: doc.metaDescription,
      headings: doc.headings.slice(0, 200),
      links: doc.links.map((l) => l.url).slice(0, 300),
    },
    excerpt: doc.text.slice(0, MAX_AI_TEXT_CHARS),
    termSources: sources,
    linkOpportunities: opportunities,
    linkCandidates: candidates,
  };

  // content_analyses is server-written only (grants); authorization happened in the caller.
  const { data, error } = await createAdminClient()
    .from("content_analyses")
    .insert({
      organization_id: website.organization_id,
      website_id: website.id,
      target_keyword: analysis.keyword,
      source_type: input.mode,
      source_url: input.mode === "url" ? (finalUrl ?? input.url).slice(0, 2048) : null,
      title: (doc.title ?? doc.headings.find((h) => h.level === 1)?.text ?? null)?.slice(0, 300) ?? null,
      score: analysis.score,
      scoring_version: analysis.version,
      word_count: analysis.stats.words,
      results: results as unknown as Json,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not store the analysis: ${error?.message}`);
  return { ok: true, id: data.id };
}

export type AiGenerateResult = { ok: true } | { ok: false; reason: "not_connected" | "not_found" | "refused" | "invalid_output" | "rate_limited" | "auth" | "unavailable"; message: string };

export async function generateAiSuggestion(analysisId: string, task: AiTask, website: Website, opts: { reader?: Reader; provider?: AiProvider | null } = {}): Promise<AiGenerateResult> {
  const provider = opts.provider === undefined ? aiProvider() : opts.provider;
  if (!provider) return { ok: false, reason: "not_connected", message: "No AI provider is configured." };
  const supabase = opts.reader ?? (await createClient());
  // Read as the user first: RLS proves the analysis belongs to their organization.
  const { data: row } = await supabase.from("content_analyses").select("id, results, ai_suggestions").eq("id", analysisId).eq("website_id", website.id).maybeSingle();
  if (!row) return { ok: false, reason: "not_found", message: "Analysis not found." };
  const results = row.results as unknown as StoredContentResults;
  const a = results.analysis;
  const ctx: AiContext = {
    website: { name: website.name, domain: website.domain, language: website.language_code },
    keyword: a.keyword,
    sourceUrl: results.document.finalUrl ?? results.document.url,
    title: results.document.title,
    metaDescription: results.document.metaDescription,
    headings: results.document.headings,
    text: results.excerpt,
    wordCount: a.stats.words,
    failingChecks: a.checks.filter((c) => c.status === "fail" || c.status === "warn").map((c) => ({ label: c.label, detail: c.detail })),
    missingTerms: a.terms.filter((t) => !t.found).map((t) => t.term),
    linkCandidates: results.linkCandidates ?? [],
    existingLinks: results.document.links,
  };
  if (task === "internal_links" && ctx.linkCandidates.length === 0) {
    return { ok: false, reason: "invalid_output", message: "Run a site audit first — internal-link suggestions only use pages found by your crawl." };
  }
  const r = await provider.generate(task, ctx);
  if (!r.ok) return r;
  const record: AiSuggestionRecord = { task, label: "AI suggestion", provider: provider.id, model: r.model, generatedAt: new Date().toISOString(), output: r.output };
  const existing = (row.ai_suggestions ?? {}) as Record<string, unknown>;
  const { error } = await createAdminClient()
    .from("content_analyses")
    .update({ ai_suggestions: { ...existing, [task]: record } as unknown as Json, ai_model: r.model, ai_generated_at: record.generatedAt })
    .eq("id", row.id)
    .eq("website_id", website.id);
  if (error) throw new Error(`Could not store AI suggestions: ${error.message}`);
  return { ok: true };
}
