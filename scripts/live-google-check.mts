/**
 * End-to-end check of the Google integration pipeline against the LIVE database
 * with Google's HTTP APIs SIMULATED (no Google credentials needed):
 *   token refresh → encrypted storage → Search Console + GA4 sync → SQL breakdowns
 *   → revoked token handling → disconnect.
 * Uses a temporary user/org/website and deletes everything afterwards.
 *
 *   npm run google:live-check
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

// Fake OAuth client config for this process only (real Google is never called).
process.env.GOOGLE_CLIENT_ID ||= "live-check.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET ||= "live-check-secret";

const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
const { encryptSecret, decryptSecret } = await import("../src/lib/security/crypto.ts");
const { getAccessToken, disconnectConnection } = await import("../src/lib/google/connections.ts");
const { runSyncTick, startSync, STEPS } = await import("../src/lib/google/sync.ts");

// ---- simulated Google ---------------------------------------------------------
let refreshMode: "ok" | "revoked" = "ok";
const googleCalls: string[] = [];
const realFetch = globalThis.fetch;
const days = ["2026-10-20", "2026-10-21", "2026-10-22"];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!/googleapis\.com|accounts\.google\.com/.test(url)) return realFetch(input, init);
  googleCalls.push(url.replace(/\?.*$/, ""));
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    return refreshMode === "ok" ? j({ access_token: "fresh-access-token", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/webmasters.readonly" }) : j({ error: "invalid_grant" }, 400);
  }
  if (url.startsWith("https://oauth2.googleapis.com/revoke")) return j({});
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.includes("/searchAnalytics/query")) {
    const dims: string[] = body.dimensions;
    const rows = days.flatMap((d, i) =>
      dims.length === 1 ? [{ keys: [d], clicks: 10 + i, impressions: 100 + i, ctr: 0.1, position: 5 }] : ["a", "b"].map((k) => ({ keys: [d, dims[1] === "device" ? (k === "a" ? "MOBILE" : "DESKTOP") : dims[1] === "country" ? (k === "a" ? "usa" : "bgd") : dims[1] === "page" ? `https://lc.example/${k}` : `query ${k}`], clicks: k === "a" ? 6 : 4, impressions: 50, ctr: 0.1, position: k === "a" ? 3 : 8 })),
    );
    return j({ rows });
  }
  if (url.includes(":runReport")) {
    const dims: string[] = body.dimensions.map((d: { name: string }) => d.name);
    const mets: string[] = body.metrics.map((m: { name: string }) => m.name);
    const rows = days.flatMap((d) =>
      (dims.length === 1 ? [null] : ["x", "y"]).map((k) => ({
        dimensionValues: [{ value: d.replace(/-/g, "") }, ...(k ? [{ value: dims[1] === "sessionDefaultChannelGroup" ? (k === "x" ? "Organic Search" : "Direct") : dims[1].includes("age") || dims[1] === "pagePath" ? `/${k}` : k }] : [])],
        metricValues: mets.map((m) => ({ value: m === "engagementRate" ? "0.5" : m === "userEngagementDuration" ? "300" : "10" })),
      })),
    );
    return j({ dimensionHeaders: dims.map((name) => ({ name })), metricHeaders: mets.map((name) => ({ name })), rows, rowCount: rows.length });
  }
  return j({ error: { message: "unexpected" } }, 404);
}) as typeof fetch;

const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const db = createAdminClient();
const userId = randomUUID();
let orgId: string | null = null;
try {
  await pgc.query(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'{}',now(),now())`,
    [userId, `g-check-${userId.slice(0, 8)}@rankora.invalid`],
  );
  orgId = (await db.from("organizations").insert({ name: "G check", slug: `g-check-${userId.slice(0, 8)}`, created_by: userId }).select("id").single()).data!.id;
  await db.from("organization_members").insert({ organization_id: orgId, user_id: userId, role: "owner" });
  const site = (await db.from("websites").insert({ organization_id: orgId, name: "lc", domain: "lc.example", base_url: "https://lc.example/" }).select("*").single()).data!;

  // An EXPIRED access token + a refresh token, encrypted as the app stores them
  const conn = (
    await db
      .from("oauth_connections")
      .insert({ organization_id: orgId, provider: "google", provider_account_email: "owner@lc.example", access_token_encrypted: encryptSecret("old-token"), refresh_token_encrypted: encryptSecret("refresh-1"), token_expires_at: new Date(Date.now() - 60_000).toISOString(), scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] })
      .select("id")
      .single()
  ).data!;
  const token = await getAccessToken(conn.id);
  const stored = (await db.from("oauth_connections").select("access_token_encrypted, token_expires_at").eq("id", conn.id).single()).data!;
  check("expired token refreshed", token === "fresh-access-token");
  check("new token stored encrypted (not plaintext)", !stored.access_token_encrypted!.includes("fresh") && decryptSecret(stored.access_token_encrypted!) === "fresh-access-token");

  const ids: Record<string, string> = {};
  for (const [provider, prop] of [
    ["google_search_console", "sc-domain:lc.example"],
    ["google_analytics_4", "properties/123456"],
  ] as const) {
    ids[provider] = (await db.from("integrations").insert({ organization_id: orgId, website_id: site.id, provider, status: "connected", oauth_connection_id: conn.id, external_account_id: prop }).select("id").single()).data!.id;
    await startSync(ids[provider], "initial");
    let r = await runSyncTick(ids[provider], 30_000);
    for (let i = 0; i < 5 && r.status === "running"; i++) r = await runSyncTick(ids[provider], 30_000);
    check(`${provider} sync completed all ${STEPS[provider].length} steps`, r.status === "done", JSON.stringify(r));
  }

  const counts = async (t: string) => (await db.from(t as "analytics_daily").select("*", { count: "exact", head: true }).eq("website_id", site.id)).count;
  check("Search Console rows stored", (await counts("search_console_daily"))! > 0 && (await counts("search_console_queries"))! > 0 && (await counts("search_console_pages"))! > 0);
  check("GA4 rows stored", (await counts("analytics_daily"))! > 0 && (await counts("analytics_pages"))! > 0);
  const sources = (await pgc.query(`select distinct source from public.search_console_daily where website_id = $1 union select distinct source from public.analytics_daily where website_id = $1`, [site.id])).rows.map((r) => r.source).sort();
  check("rows labelled with their Google source", JSON.stringify(sources) === JSON.stringify(["ga4", "gsc"]), sources.join(","));

  const q = await db.rpc("gsc_breakdown", { p_site: site.id, p_dim: "query", p_from: "2026-10-01", p_to: "2026-10-31" });
  check("gsc_breakdown aggregates synced queries", q.data?.[0]?.key === "query a" && Number(q.data?.[0]?.clicks) === 18, JSON.stringify(q.data?.[0]));
  const ch = await db.rpc("ga_breakdown", { p_site: site.id, p_dim: "channel", p_from: "2026-10-01", p_to: "2026-10-31" });
  check("ga_breakdown aggregates channels", (ch.data ?? []).some((r) => r.key === "Organic Search"));

  // Re-sync is idempotent (no duplicate rows)
  const before = await counts("search_console_queries");
  await startSync(ids.google_search_console, "initial");
  let again = await runSyncTick(ids.google_search_console, 30_000);
  for (let i = 0; i < 5 && again.status === "running"; i++) again = await runSyncTick(ids.google_search_console, 30_000);
  check("re-sync does not duplicate rows", (await counts("search_console_queries")) === before);

  // Revoked refresh token → connection expired, integrations flagged
  await db.from("oauth_connections").update({ token_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", conn.id);
  refreshMode = "revoked";
  const err = await getAccessToken(conn.id).then(() => null, (e: { kind?: string }) => e.kind);
  const c2 = (await db.from("oauth_connections").select("status, access_token_encrypted").eq("id", conn.id).single()).data!;
  const integ = (await db.from("integrations").select("status, last_error").eq("id", ids.google_search_console).single()).data!;
  check("revoked token → auth error", err === "auth");
  check("connection marked expired and token wiped", c2.status === "expired" && c2.access_token_encrypted === null);
  check("integration flagged for reconnect", integ.status === "error" && /Reconnect/i.test(integ.last_error ?? ""));
  const syncAfter = await runSyncTick(ids.google_analytics_4, 10_000);
  check("sync after revocation stops with a clear error", syncAfter.status === "error" && /Reconnect/i.test(syncAfter.message ?? ""));

  await disconnectConnection(conn.id);
  const c3 = (await db.from("oauth_connections").select("status, refresh_token_encrypted, revoked_at").eq("id", conn.id).single()).data!;
  check("disconnect revokes at Google and deletes tokens", c3.status === "revoked" && c3.refresh_token_encrypted === null && Boolean(c3.revoked_at) && googleCalls.some((u) => u.includes("/revoke")));
  check("no real Google endpoint other than the simulator was used", googleCalls.every((u) => /googleapis\.com|accounts\.google\.com/.test(u)));
} finally {
  globalThis.fetch = realFetch;
  if (orgId) await db.from("organizations").delete().eq("id", orgId);
  await pgc.query(`delete from auth.users where id = $1`, [userId]);
  const left = (await pgc.query(`select count(*)::int n from public.organizations where slug like 'g-check-%'`)).rows[0].n;
  console.log(`\ncleanup done (leftover temp orgs: ${left})`);
  await pgc.end();
}
