/**
 * Search Console / GA4 → Postgres sync (server only, service role).
 * A sync is a list of steps (one API dataset each) over a date range; each tick
 * runs as many steps as fit in its time budget and records progress in
 * integrations.sync_state, so long first syncs resume across invocations.
 *
 * Stored rows always carry source = 'gsc' | 'ga4' — data from these tables is
 * only ever labelled as Google data when it came from these API calls.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { GoogleApiError, GOOGLE_ERROR_HELP } from "./errors";
import { getAccessToken } from "./connections";
import { querySearchAnalytics, type GscDimension, type GscRow } from "./search-console";
import { gaDate, runReport, type ReportRow } from "./analytics";
import { addDays, isoDay } from "@/lib/analytics/ranges";

type Integration = Tables<"integrations">;
type Provider = "google_search_console" | "google_analytics_4";

export const INITIAL_DAYS = 180; // enough for 90-day views with a previous-period comparison
export const INCREMENTAL_DAYS = 5; // GSC finalises data with a 2–3 day delay

export const STEPS: Record<Provider, string[]> = {
  google_search_console: ["gsc_totals", "gsc_devices", "gsc_countries", "gsc_queries", "gsc_pages"],
  google_analytics_4: ["ga_totals", "ga_channels", "ga_devices", "ga_countries", "ga_pages", "ga_landing"],
};

export interface SyncState {
  mode?: "initial" | "incremental";
  from?: string;
  to?: string;
  step?: number;
  done?: boolean;
  rows?: number;
  retryAt?: string;
}

export function planSync(mode: "initial" | "incremental", today = new Date()): SyncState {
  const to = isoDay(addDays(today, -1));
  const from = isoDay(addDays(today, -(mode === "initial" ? INITIAL_DAYS : INCREMENTAL_DAYS)));
  return { mode, from, to, step: 0, done: false, rows: 0 };
}

const CHUNK = 1000;
async function insertChunks(table: string, rows: Record<string, unknown>[]) {
  const db = createAdminClient();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table as "search_console_daily").upsert(rows.slice(i, i + CHUNK) as never);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Row mappers (pure; exported for tests)
// ---------------------------------------------------------------------------
export function gscDailyRows(rows: GscRow[], dim: "total" | "device" | "country", ids: { organization_id: string; website_id: string }) {
  return rows.map((r) => ({
    ...ids,
    date: r.keys[0],
    device: dim === "device" ? r.keys[1].toLowerCase() : "all",
    country: dim === "country" ? r.keys[1].toLowerCase() : "all",
    source: "gsc",
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Number(r.ctr.toFixed(6)),
    position: Number(r.position.toFixed(2)),
  }));
}

export function gscKeyRows(rows: GscRow[], key: "query" | "page", ids: { organization_id: string; website_id: string }) {
  return rows
    .filter((r) => r.keys[1])
    .map((r) => ({
      ...ids,
      date: r.keys[0],
      [key]: r.keys[1].slice(0, key === "page" ? 2048 : 500),
      source: "gsc",
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Number(r.ctr.toFixed(6)),
      position: Number(r.position.toFixed(2)),
    }));
}

const GA_DAILY_METRICS = ["totalUsers", "newUsers", "sessions", "engagedSessions", "screenPageViews", "engagementRate", "userEngagementDuration", "activeUsers"];

export function gaDailyRows(rows: ReportRow[], dim: "total" | "channel" | "device" | "country", ids: { organization_id: string; website_id: string }) {
  return rows.map((r) => {
    const active = Number(r.activeUsers ?? 0);
    return {
      ...ids,
      date: gaDate(r.date),
      channel: dim === "channel" ? String(r.sessionDefaultChannelGroup || "(not set)").slice(0, 80) : "all",
      device: dim === "device" ? String(r.deviceCategory || "(not set)").toLowerCase() : "all",
      country: dim === "country" ? String(r.country || "(not set)").slice(0, 80) : "all",
      source: "ga4",
      users: Number(r.totalUsers ?? 0),
      new_users: Number(r.newUsers ?? 0),
      sessions: Number(r.sessions ?? 0),
      engaged_sessions: Number(r.engagedSessions ?? 0),
      page_views: Number(r.screenPageViews ?? 0),
      engagement_rate: Number(Number(r.engagementRate ?? 0).toFixed(5)),
      avg_engagement_time_seconds: active > 0 ? Number((Number(r.userEngagementDuration ?? 0) / active).toFixed(2)) : null,
    };
  });
}

export function gaPageRows(rows: ReportRow[], landing: boolean, ids: { organization_id: string; website_id: string }) {
  const key = landing ? "landingPage" : "pagePath";
  return rows
    .filter((r) => r[key] !== undefined && r[key] !== "")
    .map((r) => ({
      ...ids,
      date: gaDate(r.date),
      page_path: String(r[key]).slice(0, 2048),
      is_landing: landing,
      source: "ga4",
      users: Number(r.totalUsers ?? 0),
      sessions: Number(r.sessions ?? 0),
      engaged_sessions: Number(r.engagedSessions ?? 0),
      page_views: Number(r.screenPageViews ?? 0),
      organic_sessions: null,
    }));
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
async function clearRange(table: string, websiteId: string, from: string, to: string, filter: (q: ReturnType<ReturnType<typeof createAdminClient>["from"]>) => unknown) {
  const db = createAdminClient();
  let q = db.from(table as "analytics_daily").delete().eq("website_id", websiteId).gte("date", from).lte("date", to);
  q = filter(q as never) as typeof q;
  const { error } = await q;
  if (error) throw new Error(`${table} cleanup: ${error.message}`);
}

async function runStep(step: string, integ: Integration, token: string, from: string, to: string): Promise<number> {
  const ids = { organization_id: integ.organization_id, website_id: integ.website_id };
  const property = integ.external_account_id!;
  const gsc = (dims: GscDimension[], maxRows = 25_000) => querySearchAnalytics(token, property, { startDate: from, endDate: to, dimensions: dims, maxRows });
  const ga = (dims: string[], metrics: string[], limit = 50_000) => runReport(token, property, { startDate: from, endDate: to, dimensions: dims, metrics, limit });
  const neq = (col: string) => (q: { neq: (c: string, v: string) => unknown; eq: (c: string, v: string) => unknown }) => q.neq(col, "all");

  switch (step) {
    case "gsc_totals": {
      const rows = gscDailyRows(await gsc(["date"]), "total", ids);
      await insertChunks("search_console_daily", rows);
      return rows.length;
    }
    case "gsc_devices": {
      const rows = gscDailyRows(await gsc(["date", "device"]), "device", ids);
      await clearRange("search_console_daily", integ.website_id, from, to, neq("device") as never);
      await insertChunks("search_console_daily", rows);
      return rows.length;
    }
    case "gsc_countries": {
      const rows = gscDailyRows(await gsc(["date", "country"], 50_000), "country", ids);
      await clearRange("search_console_daily", integ.website_id, from, to, neq("country") as never);
      await insertChunks("search_console_daily", rows);
      return rows.length;
    }
    case "gsc_queries": {
      const rows = gscKeyRows(await gsc(["date", "query"], 50_000), "query", ids);
      await clearRange("search_console_queries", integ.website_id, from, to, (q) => q);
      await insertChunks("search_console_queries", rows);
      return rows.length;
    }
    case "gsc_pages": {
      const rows = gscKeyRows(await gsc(["date", "page"], 50_000), "page", ids);
      await clearRange("search_console_pages", integ.website_id, from, to, (q) => q);
      await insertChunks("search_console_pages", rows);
      return rows.length;
    }
    case "ga_totals": {
      const rows = gaDailyRows(await ga(["date"], GA_DAILY_METRICS), "total", ids);
      await insertChunks("analytics_daily", rows);
      return rows.length;
    }
    case "ga_channels": {
      const rows = gaDailyRows(await ga(["date", "sessionDefaultChannelGroup"], GA_DAILY_METRICS), "channel", ids);
      await clearRange("analytics_daily", integ.website_id, from, to, neq("channel") as never);
      await insertChunks("analytics_daily", rows);
      return rows.length;
    }
    case "ga_devices": {
      const rows = gaDailyRows(await ga(["date", "deviceCategory"], GA_DAILY_METRICS), "device", ids);
      await clearRange("analytics_daily", integ.website_id, from, to, neq("device") as never);
      await insertChunks("analytics_daily", rows);
      return rows.length;
    }
    case "ga_countries": {
      const rows = gaDailyRows(await ga(["date", "country"], GA_DAILY_METRICS), "country", ids);
      await clearRange("analytics_daily", integ.website_id, from, to, neq("country") as never);
      await insertChunks("analytics_daily", rows);
      return rows.length;
    }
    case "ga_pages": {
      const rows = gaPageRows(await ga(["date", "pagePath"], ["totalUsers", "sessions", "engagedSessions", "screenPageViews"]), false, ids);
      await clearRange("analytics_pages", integ.website_id, from, to, (q) => q.eq("is_landing", false as never));
      await insertChunks("analytics_pages", rows);
      return rows.length;
    }
    case "ga_landing": {
      const rows = gaPageRows(await ga(["date", "landingPage"], ["totalUsers", "sessions", "engagedSessions", "screenPageViews"]), true, ids);
      await clearRange("analytics_pages", integ.website_id, from, to, (q) => q.eq("is_landing", true as never));
      await insertChunks("analytics_pages", rows);
      return rows.length;
    }
    default:
      throw new Error(`Unknown sync step ${step}`);
  }
}

export interface SyncTickResult {
  status: "running" | "done" | "error" | "busy" | "waiting";
  step: number;
  steps: number;
  message: string | null;
}

/** Start (or restart) a sync for an integration. */
export async function startSync(integrationId: string, mode: "initial" | "incremental") {
  const db = createAdminClient();
  await db
    .from("integrations")
    .update({ sync_state: planSync(mode) as unknown as Json, last_sync_started_at: new Date().toISOString(), last_error: null })
    .eq("id", integrationId);
}

const CLAIM_MS = 120_000;

/** Run sync steps for up to `budgetMs`. Safe to call concurrently (claimed). */
export async function runSyncTick(integrationId: string, budgetMs = 25_000): Promise<SyncTickResult> {
  const db = createAdminClient();
  const started = Date.now();
  const stale = new Date(Date.now() - CLAIM_MS).toISOString();
  const { data: integ } = await db
    .from("integrations")
    .update({ sync_claimed_at: new Date().toISOString() })
    .eq("id", integrationId)
    .or(`sync_claimed_at.is.null,sync_claimed_at.lt."${stale}"`)
    .select("*")
    .maybeSingle();
  if (!integ) return { status: "busy", step: 0, steps: 0, message: "Another sync is running" };

  const provider = integ.provider as Provider;
  const steps = STEPS[provider];
  let state = (integ.sync_state ?? {}) as SyncState;
  const release = (patch: Record<string, unknown>) => db.from("integrations").update({ ...patch, sync_claimed_at: null }).eq("id", integ.id);

  try {
    if (!steps) throw new Error("Not a Google integration");
    if (!integ.oauth_connection_id || !integ.external_account_id) {
      await release({});
      return { status: "error", step: 0, steps: steps.length, message: "Choose a property first." };
    }
    if (!state.from || state.done) state = planSync(integ.last_synced_at ? "incremental" : "initial");
    if (state.retryAt && new Date(state.retryAt).getTime() > Date.now()) {
      await release({});
      return { status: "waiting", step: state.step ?? 0, steps: steps.length, message: GOOGLE_ERROR_HELP.rate_limited };
    }
    const token = await getAccessToken(integ.oauth_connection_id);
    while ((state.step ?? 0) < steps.length && Date.now() - started < budgetMs) {
      const rows = await runStep(steps[state.step ?? 0], integ, token, state.from!, state.to!);
      state = { ...state, step: (state.step ?? 0) + 1, rows: (state.rows ?? 0) + rows, retryAt: undefined };
    }
    const done = (state.step ?? 0) >= steps.length;
    await release({
      sync_state: { ...state, done } as unknown as Json,
      status: "connected",
      last_error: null,
      ...(done ? { last_synced_at: new Date().toISOString() } : {}),
    });
    return { status: done ? "done" : "running", step: state.step ?? 0, steps: steps.length, message: null };
  } catch (e) {
    const err = e instanceof GoogleApiError ? e : null;
    const message = err ? GOOGLE_ERROR_HELP[err.kind] : "Sync failed unexpectedly. Please try again.";
    console.error(`[google.sync ${integrationId}]`, e);
    if (err?.retryable) {
      await release({ sync_state: { ...state, retryAt: new Date(Date.now() + 60_000).toISOString() } as unknown as Json, last_error: message });
      return { status: "waiting", step: state.step ?? 0, steps: steps?.length ?? 0, message };
    }
    await release({ status: "error", last_error: message, sync_state: { ...state, done: false } as unknown as Json });
    return { status: "error", step: state.step ?? 0, steps: steps?.length ?? 0, message };
  }
}
