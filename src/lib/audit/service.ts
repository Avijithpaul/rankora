/**
 * Audit orchestration (server only, service role). Every exported function
 * expects the CALLER to have authorized the user for the website/job first
 * (see src/lib/audit/access.ts).
 */
import "server-only";
import { getEntitlements, recordUsage } from "@/lib/billing/usage";
import { checkLimit, limitMessage } from "@/lib/billing/entitlements";
import { errorMessage, logEvent } from "@/lib/monitoring";
import { notifyUsers } from "@/lib/notifications";

/** Thrown when a plan's monthly allowance is used up. */
export class QuotaExceededError extends Error {
  readonly code = "quota";
}
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { runCrawlTick } from "@/lib/crawler/engine";
import { createSafeFetcher } from "@/lib/crawler/fetcher";
import { SupabaseCrawlStore } from "@/lib/crawler/supabase-store";
import type { CrawlConfig, CrawlPhase, CrawlState } from "@/lib/crawler/types";
import { DEFAULT_USER_AGENT } from "@/lib/security/safe-fetch";
import { analyzeSite, type AnalyzerLink } from "./analyze";
import { fromDbRow } from "./mappers";
import { runPageSpeed } from "./pagespeed";
import { computeScore, type ScoreSummary } from "@/lib/seo/scoring";
import { providerConfig } from "@/lib/env";

export const LOCK_TTL_MS = 90_000;
const MAX_JOB_ERRORS = 3;

type Job = Tables<"crawl_jobs">;

export interface JobStatus {
  id: string;
  status: Job["status"];
  phase: Job["phase"];
  pagesCrawled: number;
  pagesDiscovered: number;
  maxPages: number;
  error: string | null;
  auditId: string | null;
}

export function toStatus(job: Pick<Job, "id" | "status" | "phase" | "pages_crawled" | "pages_discovered" | "settings_snapshot" | "error" | "audit_id">): JobStatus {
  const snap = (job.settings_snapshot ?? {}) as Record<string, unknown>;
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    pagesCrawled: job.pages_crawled,
    pagesDiscovered: job.pages_discovered,
    maxPages: Number(snap.maxPages ?? 0),
    error: job.error,
    auditId: job.audit_id,
  };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
export async function startAudit(opts: {
  website: Tables<"websites">;
  planId: string;
  userId: string;
  trigger: "manual" | "scheduled" | "onboarding";
}): Promise<{ jobId: string; alreadyRunning: boolean }> {
  const db = createAdminClient();
  const { website } = opts;

  const existing = await db
    .from("crawl_jobs")
    .select("id")
    .eq("website_id", website.id)
    .in("status", ["queued", "running"])
    .maybeSingle();
  if (existing.data) return { jobId: existing.data.id, alreadyRunning: true };

  const [{ data: settings }, { data: plan }] = await Promise.all([
    db.from("website_settings").select("*").eq("website_id", website.id).single(),
    db.from("plans").select("limits").eq("id", opts.planId).single(),
  ]);
  const planCap = Number((plan?.limits as Record<string, unknown> | null)?.crawl_pages_per_audit ?? 100);
  // monthly crawl budget: an audit may use at most what is left this month
  const ent = await getEntitlements(website.organization_id);
  const monthLeft = Math.max(0, ent.limits.crawl_pages_per_month - ent.usage.crawl_pages_per_month);
  if (monthLeft <= 0) throw new QuotaExceededError(limitMessage("crawl_pages_per_month", checkLimit(ent.limits.crawl_pages_per_month, ent.usage.crawl_pages_per_month), ent.planName));
  const snapshot = {
    maxPages: Math.max(1, Math.min(settings?.max_pages ?? 100, planCap, monthLeft)),
    maxDepth: settings?.max_depth ?? 5,
    crawlDelayMs: settings?.crawl_delay_ms ?? 250,
    respectRobotsTxt: settings?.respect_robots_txt ?? true,
    checkExternalLinks: settings?.check_external_links ?? false,
    pagespeedEnabled: settings?.pagespeed_enabled ?? true,
    excludePatterns: settings?.exclude_patterns ?? [],
    baseUrl: website.base_url,
  };

  const { data, error } = await db
    .from("crawl_jobs")
    .insert({
      organization_id: website.organization_id,
      website_id: website.id,
      status: "queued",
      phase: "discovery",
      trigger: opts.trigger,
      requested_by: opts.userId,
      settings_snapshot: snapshot as unknown as Json,
    })
    .select("id")
    .single();
  if (error) {
    // unique index: another request created a job in the meantime
    if (error.code === "23505") {
      const again = await db.from("crawl_jobs").select("id").eq("website_id", website.id).in("status", ["queued", "running"]).single();
      if (again.data) return { jobId: again.data.id, alreadyRunning: true };
    }
    throw new Error(`Could not create crawl job: ${error.message}`);
  }
  return { jobId: data.id, alreadyRunning: false };
}

// ---------------------------------------------------------------------------
// Process one tick (claims a lock so only one worker runs a job at a time)
// ---------------------------------------------------------------------------
export async function processJob(jobId: string, budgetMs = 20_000): Promise<JobStatus> {
  const db = createAdminClient();
  const token = randomUUID();
  const staleBefore = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  const nowIso = new Date().toISOString();

  const { data: claimed } = await db
    .from("crawl_jobs")
    .update({ locked_at: nowIso, locked_by: token, heartbeat_at: nowIso })
    .eq("id", jobId)
    .in("status", ["queued", "running"])
    .or(`locked_at.is.null,locked_at.lt."${staleBefore}"`)
    .select("*")
    .maybeSingle();

  if (!claimed) {
    const { data: job } = await db.from("crawl_jobs").select("*").eq("id", jobId).single();
    if (!job) throw new Error("Job not found");
    return toStatus(job);
  }

  let job: Job = claimed;
  try {
    if (job.status === "queued") {
      job = (await db.from("crawl_jobs").update({ status: "running", started_at: nowIso }).eq("id", jobId).select("*").single()).data ?? job;
    }
    const { data: website } = await db.from("websites").select("*").eq("id", job.website_id).single();
    if (!website) throw new Error("Website no longer exists");
    const snap = job.settings_snapshot as Record<string, unknown>;
    const config: CrawlConfig = {
      siteHost: new URL(String(snap.baseUrl ?? website.base_url)).hostname,
      baseUrl: String(snap.baseUrl ?? website.base_url),
      maxPages: Number(snap.maxPages ?? 100),
      maxDepth: Number(snap.maxDepth ?? 5),
      crawlDelayMs: Number(snap.crawlDelayMs ?? 250),
      respectRobotsTxt: snap.respectRobotsTxt !== false,
      checkExternalLinks: snap.checkExternalLinks === true,
      excludePatterns: (snap.excludePatterns as string[]) ?? [],
      userAgent: DEFAULT_USER_AGENT,
      maxAttempts: 3,
      maxExternalChecks: 100,
    };
    const store = new SupabaseCrawlStore(db, { id: job.id, organizationId: job.organization_id, websiteId: job.website_id });

    let phase = job.phase as CrawlPhase;
    let state = (job.state ?? {}) as CrawlState;
    const started = Date.now();
    let pagesCrawled = job.pages_crawled;
    let pagesDiscovered = job.pages_discovered;

    if (phase === "discovery" || phase === "crawling" || phase === "link_check") {
      const r = await runCrawlTick({ phase, state, config, store, fetcher: createSafeFetcher(), budgetMs });
      phase = r.phase;
      state = r.state;
      pagesCrawled = r.pagesCrawled;
      pagesDiscovered = r.pagesDiscovered;
    }

    if (phase === "pagespeed" && Date.now() - started < budgetMs * 0.5) {
      const key = providerConfig().pagespeedApiKey;
      if (snap.pagespeedEnabled === false) state = { ...state, pagespeed: { skipped: "PageSpeed checks are turned off in crawl settings" } };
      else if (!key) state = { ...state, pagespeed: { skipped: "PAGESPEED_API_KEY is not configured" } };
      else {
        try {
          state = { ...state, pagespeed: await runPageSpeed(config.baseUrl, key) };
        } catch (e) {
          state = { ...state, pagespeed: { skipped: `PageSpeed Insights failed: ${(e as Error).message}` } };
        }
      }
      phase = "analyzing";
    }

    let auditId: string | null = job.audit_id;
    let status: Job["status"] = "running";
    if (phase === "analyzing" && Date.now() - started < budgetMs * 0.8) {
      auditId = await finalizeAudit(job, website, state, config.checkExternalLinks);
      phase = "done";
      status = "completed";
    }

    const { count: failed } = await db
      .from("crawl_pages")
      .select("id", { count: "exact", head: true })
      .eq("crawl_job_id", job.id)
      .eq("fetch_state", "failed");

    const { data: updated } = await db
      .from("crawl_jobs")
      .update({
        phase,
        state: state as unknown as Json,
        status,
        pages_crawled: pagesCrawled,
        pages_discovered: pagesDiscovered,
        pages_failed: failed ?? 0,
        audit_id: auditId,
        finished_at: status === "completed" ? new Date().toISOString() : null,
        locked_at: null,
        locked_by: null,
        heartbeat_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("locked_by", token)
      .select("*")
      .single();
    return toStatus(updated ?? job);
  } catch (e) {
    const attempt = job.attempt + 1;
    // users see a generic message; the details stay in the server-side event log
    const message = attempt >= MAX_JOB_ERRORS ? "The audit failed after several attempts. Please try again later." : "A temporary error occurred; the audit will retry.";
    await logEvent("error", "crawl.tick", `Crawl tick failed (attempt ${attempt})`, { jobId, websiteId: job.website_id, error: errorMessage(e) });
    const { data: updated } = await db
      .from("crawl_jobs")
      .update({
        attempt,
        error: message,
        status: attempt >= MAX_JOB_ERRORS ? "failed" : job.status === "queued" ? "running" : job.status,
        finished_at: attempt >= MAX_JOB_ERRORS ? new Date().toISOString() : null,
        locked_at: null,
        locked_by: null,
      })
      .eq("id", job.id)
      .select("*")
      .single();
    return toStatus(updated ?? job);
  }
}

// ---------------------------------------------------------------------------
// Finalize: analyze + score + persist audit, checks and issue lifecycle
// ---------------------------------------------------------------------------
const PAGE_COLUMNS =
  "id, normalized_url, depth, fetch_state, status_code, redirect_chain, content_type, response_time_ms, is_indexable, title, meta_description, h1, canonical_url, robots_meta, x_robots_tag, lang, has_viewport, word_count, content_hash, images_count, images_missing_alt, structured_data_types, open_graph, twitter_card, found_in_sitemap, details";

async function loadAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function finalizeAudit(job: Job, website: Tables<"websites">, state: CrawlState, checkExternalLinks: boolean): Promise<string> {
  const db = createAdminClient();
  await db.rpc("crawl_compute_inbound", { p_job: job.id });

  const rows = await loadAll((from, to) =>
    db.from("crawl_pages").select(PAGE_COLUMNS).eq("crawl_job_id", job.id).neq("fetch_state", "pending").order("id").range(from, to),
  );
  const urlById = new Map(rows.map((r) => [r.id, r.normalized_url]));
  const linkRows = await loadAll((from, to) =>
    db
      .from("crawl_links")
      .select("source_page_id, target_url, is_internal, target_status, target_error")
      .eq("crawl_job_id", job.id)
      .order("id")
      .range(from, to),
  );
  const links: AnalyzerLink[] = linkRows
    .filter((l) => urlById.has(l.source_page_id))
    .map((l) => ({
      sourceUrl: urlById.get(l.source_page_id)!,
      targetUrl: l.target_url,
      isInternal: l.is_internal,
      targetStatus: l.target_status,
      targetError: l.target_error,
    }));

  const evaluations = analyzeSite(rows.map(fromDbRow), links, { baseUrl: website.base_url, state, checkExternalLinks });
  const summary = computeScore(evaluations);
  const pagesAnalyzed = rows.filter((r) => r.fetch_state === "fetched").length;
  const auditId = await persistAudit(job, summary, pagesAnalyzed);

  await db
    .from("websites")
    .update({ latest_score: summary.score, last_crawled_at: new Date().toISOString() })
    .eq("id", website.id);
  await recordUsage({ orgId: job.organization_id, websiteId: website.id, metric: "crawl_pages", quantity: Math.max(1, rows.length), metadata: { crawl_job_id: job.id } });
  if (job.requested_by) {
    await notifyUsers(job.organization_id, [job.requested_by], {
      type: "audit.completed",
      title: `Site audit finished for ${website.domain}`,
      body: `SEO score ${Math.round(summary.score)}/100 · ${pagesAnalyzed} pages analyzed.`,
      link: `sites/${website.id}/audit`,
    });
  }
  return auditId;
}

async function persistAudit(job: Job, summary: ScoreSummary, pagesAnalyzed: number): Promise<string> {
  const db = createAdminClient();
  const { data: audit, error } = await db
    .from("seo_audits")
    .insert({
      organization_id: job.organization_id,
      website_id: job.website_id,
      crawl_job_id: job.id,
      scoring_version: summary.version,
      score: summary.score,
      score_breakdown: { byCategory: summary.byCategory, earnedWeight: summary.earnedWeight, possibleWeight: summary.possibleWeight } as unknown as Json,
      pages_analyzed: pagesAnalyzed,
      critical_count: summary.counts.critical,
      warning_count: summary.counts.warning,
      opportunity_count: summary.counts.opportunity,
      passed_count: summary.counts.passed,
    })
    .select("id")
    .single();
  if (error || !audit) throw new Error(`Could not save audit: ${error?.message}`);

  const checkRows = summary.checks.map((c) => ({
    organization_id: job.organization_id,
    audit_id: audit.id,
    rule_id: c.ruleId,
    category: c.category,
    severity: c.severity,
    result: c.result,
    weight: c.weight,
    rule_score: c.ruleScore,
    affected_count: c.affected,
    total_count: c.total,
    explanation: c.explanation,
    recommendation: c.recommendation,
    details: { ...c.details, sampleUrls: c.affectedUrls.slice(0, 20) } as unknown as Json,
  }));
  const ins = await db.from("seo_checks").insert(checkRows);
  if (ins.error) throw new Error(`Could not save checks: ${ins.error.message}`);

  await syncIssues(job, audit.id, summary);
  return audit.id;
}

/**
 * Issue lifecycle (one issue per rule per website, fingerprint = rule id):
 *  failed now  -> open (created, or reopened if it was fixed; 'ignored' stays ignored)
 *  passed now  -> fixed (fixed_at set) if it was open
 *  not applicable -> left unchanged
 */
async function syncIssues(job: Job, auditId: string, summary: ScoreSummary) {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { data: existing } = await db.from("seo_issues").select("id, fingerprint, status").eq("website_id", job.website_id);
  const byFp = new Map((existing ?? []).map((i) => [i.fingerprint, i]));

  for (const c of summary.checks) {
    const prev = byFp.get(c.ruleId);
    if (c.result === "failed" && c.severity !== "passed") {
      const fields = {
        title: c.title,
        explanation: c.explanation,
        recommendation: c.recommendation,
        severity: c.severity,
        affected_pages_count: c.affected,
        last_detected_at: now,
        last_audit_id: auditId,
      };
      let issueId: string;
      if (prev) {
        const status = prev.status === "ignored" ? "ignored" : "open";
        await db.from("seo_issues").update({ ...fields, status, fixed_at: null }).eq("id", prev.id);
        issueId = prev.id;
      } else {
        const { data } = await db
          .from("seo_issues")
          .insert({ ...fields, organization_id: job.organization_id, website_id: job.website_id, rule_id: c.ruleId, fingerprint: c.ruleId, first_detected_at: now })
          .select("id")
          .single();
        if (!data) continue;
        issueId = data.id;
      }
      await db.from("seo_issue_pages").delete().eq("issue_id", issueId);
      const pages = c.affectedUrls.map((url) => ({ issue_id: issueId, organization_id: job.organization_id, url }));
      if (pages.length) await db.from("seo_issue_pages").insert(pages);
    } else if (c.result === "passed" && prev && prev.status === "open") {
      await db.from("seo_issues").update({ status: "fixed", fixed_at: now, affected_pages_count: 0, last_audit_id: auditId }).eq("id", prev.id);
      await db.from("seo_issue_pages").delete().eq("issue_id", prev.id);
    }
  }
}
