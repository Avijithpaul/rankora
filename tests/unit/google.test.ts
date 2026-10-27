import { describe, expect, it, vi } from "vitest";
import { buildAuthUrl, checkState, createPkce, exchangeCode, grantedServices, idTokenClaims, pkceChallenge, refreshAccessToken, SCOPES } from "@/lib/google/oauth";
import { GoogleApiError, toGoogleError } from "@/lib/google/errors";
import { parseRows, parseSites, querySearchAnalytics, suggestSite } from "@/lib/google/search-console";
import { gaDate, parseAccountSummaries, parseReport, runReport } from "@/lib/google/analytics";
import { gaDailyRows, gaPageRows, gscDailyRows, gscKeyRows, planSync } from "@/lib/google/sync";
import { change, dailySeries, resolveRange, searchBreakdown, searchTotals } from "@/lib/analytics/ranges";

const client = { clientId: "cid.apps.googleusercontent.com", clientSecret: "secret", redirectUri: "https://app.example/api/integrations/google/callback" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Google OAuth", () => {
  it("PKCE matches the RFC 7636 test vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const p = createPkce();
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
    expect(p.challenge).toBe(pkceChallenge(p.verifier));
  });

  it("builds a read-only, offline, PKCE authorization URL", () => {
    const u = new URL(buildAuthUrl(client, { state: "st", challenge: "ch", services: ["gsc", "ga4"] }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = Object.fromEntries(u.searchParams);
    expect(p).toMatchObject({ client_id: client.clientId, redirect_uri: client.redirectUri, response_type: "code", access_type: "offline", prompt: "consent", state: "st", code_challenge: "ch", code_challenge_method: "S256" });
    expect(p.scope.split(" ").sort()).toEqual(["email", "openid", SCOPES.ga4, SCOPES.gsc].sort());
    expect(p.scope).not.toMatch(/\.edit|manage|https:\/\/www\.googleapis\.com\/auth\/analytics(\s|$)/);
    expect(new URL(buildAuthUrl(client, { state: "s", challenge: "c", services: ["gsc"] })).searchParams.get("scope")).not.toContain("analytics");
  });

  it("validates OAuth state: unknown, reused, expired, wrong user, wrong provider", () => {
    const row = { user_id: "u1", website_id: "w", provider: "google", expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null };
    expect(checkState(row, "u1")).toEqual({ ok: true });
    expect(checkState(null, "u1")).toMatchObject({ reason: "unknown_state" });
    expect(checkState({ ...row, used_at: new Date().toISOString() }, "u1")).toMatchObject({ reason: "state_reused" });
    expect(checkState({ ...row, expires_at: new Date(Date.now() - 1).toISOString() }, "u1")).toMatchObject({ reason: "state_expired" });
    expect(checkState(row, "someone-else")).toMatchObject({ reason: "different_user" });
    expect(checkState(row, null)).toMatchObject({ reason: "different_user" });
    expect(checkState({ ...row, provider: "github" }, "u1")).toMatchObject({ reason: "wrong_provider" });
  });

  it("exchanges the code with the PKCE verifier and parses tokens", async () => {
    const idToken = `x.${Buffer.from(JSON.stringify({ sub: "123", email: "Owner@Example.com" })).toString("base64url")}.y`;
    const fetchMock = vi.fn(async () => json({ access_token: "at", refresh_token: "rt", expires_in: 3599, scope: `openid ${SCOPES.gsc}`, id_token: idToken }));
    const t = await exchangeCode(client, "code-1", "verifier-1", fetchMock as unknown as typeof fetch);
    expect(t).toMatchObject({ accessToken: "at", refreshToken: "rt", idToken });
    expect(t.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3_500_000);
    const body = new URLSearchParams(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(Object.fromEntries(body)).toMatchObject({ code: "code-1", code_verifier: "verifier-1", grant_type: "authorization_code", redirect_uri: client.redirectUri });
    expect(idTokenClaims(idToken)).toEqual({ sub: "123", email: "owner@example.com" });
    expect(grantedServices(t.scopes)).toEqual({ gsc: true, ga4: false });
  });

  it("maps a revoked refresh token (invalid_grant) to an auth error", async () => {
    const f = (async () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400)) as unknown as typeof fetch;
    await expect(refreshAccessToken(client, "rt", f)).rejects.toMatchObject({ kind: "auth" });
    const down = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(refreshAccessToken(client, "rt", down)).rejects.toMatchObject({ kind: "network", retryable: true });
  });

  it("maps API errors", () => {
    expect(toGoogleError(401, {}, "X").kind).toBe("auth");
    expect(toGoogleError(403, { error: { message: "User does not have sufficient permission" } }, "X").kind).toBe("permission");
    expect(toGoogleError(429, {}, "X")).toMatchObject({ kind: "rate_limited", retryable: true });
    expect(toGoogleError(400, { error: { status: "RESOURCE_EXHAUSTED" } }, "X").kind).toBe("rate_limited");
    expect(toGoogleError(503, {}, "X").retryable).toBe(true);
    expect(new GoogleApiError("m", "permission").retryable).toBe(false);
  });
});

describe("Search Console API client", () => {
  it("lists verified sites and suggests the matching property", () => {
    const sites = parseSites({
      siteEntry: [
        { siteUrl: "https://www.example.com/", permissionLevel: "siteOwner" },
        { siteUrl: "sc-domain:example.com", permissionLevel: "siteFullUser" },
        { siteUrl: "https://other.com/", permissionLevel: "siteUnverifiedUser" },
      ],
    });
    expect(sites.map((s) => s.siteUrl)).toEqual(["https://www.example.com/", "sc-domain:example.com"]);
    expect(suggestSite(sites, "example.com", "https://www.example.com/")).toBe("sc-domain:example.com");
    expect(suggestSite(sites.slice(0, 1), "example.com", "https://www.example.com/")).toBe("https://www.example.com/");
    expect(suggestSite(sites, "nothere.com", "https://nothere.com/")).toBeNull();
    expect(parseRows({})).toEqual([]);
  });

  it("pages through results 25,000 rows at a time", async () => {
    const page = (n: number) => ({ rows: Array.from({ length: n }, (_, i) => ({ keys: ["2026-10-01", `q${i}`], clicks: 1, impressions: 2, ctr: 0.5, position: 3 })) });
    const calls: unknown[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      calls.push(b);
      return json(page(b.startRow === 0 ? 25_000 : 10));
    }) as unknown as typeof fetch;
    const rows = await querySearchAnalytics("at", "sc-domain:example.com", { startDate: "2026-10-01", endDate: "2026-10-01", dimensions: ["date", "query"], maxRows: 50_000 }, f);
    expect(rows).toHaveLength(25_010);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ dataState: "all", startRow: 0, rowLimit: 25_000, type: "web" });
  });
});

describe("GA4 API client", () => {
  it("flattens account summaries and report rows", () => {
    expect(parseAccountSummaries({ accountSummaries: [{ displayName: "Acme", propertySummaries: [{ property: "properties/123", displayName: "Acme web" }, { property: "bogus" }] }] })).toEqual([
      { property: "properties/123", displayName: "Acme web", account: "Acme" },
    ]);
    const rows = parseReport({
      dimensionHeaders: [{ name: "date" }, { name: "deviceCategory" }],
      metricHeaders: [{ name: "sessions" }, { name: "engagementRate" }],
      rows: [{ dimensionValues: [{ value: "20261001" }, { value: "mobile" }], metricValues: [{ value: "42" }, { value: "0.61" }] }],
    });
    expect(rows).toEqual([{ date: "20261001", deviceCategory: "mobile", sessions: 42, engagementRate: 0.61 }]);
    expect(gaDate("20261001")).toBe("2026-10-01");
  });

  it("rejects malformed property ids before calling Google", async () => {
    const f = vi.fn();
    await expect(runReport("at", "properties/../admin", { startDate: "a", endDate: "b", dimensions: [], metrics: [] }, f as unknown as typeof fetch)).rejects.toThrow(/Invalid GA4 property/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("sync row mapping (always labelled as Google data)", () => {
  const ids = { organization_id: "o", website_id: "w" };
  it("maps Search Console rows", () => {
    const daily = gscDailyRows([{ keys: ["2026-10-01", "MOBILE"], clicks: 3, impressions: 40, ctr: 0.075, position: 7.123 }], "device", ids)[0];
    expect(daily).toMatchObject({ date: "2026-10-01", device: "mobile", country: "all", source: "gsc", position: 7.12 });
    expect(gscKeyRows([{ keys: ["2026-10-01", ""], clicks: 1, impressions: 1, ctr: 1, position: 1 }], "query", ids)).toHaveLength(0);
  });
  it("maps GA4 rows", () => {
    const r = gaDailyRows([{ date: "20261001", sessionDefaultChannelGroup: "Organic Search", totalUsers: 10, newUsers: 4, sessions: 12, engagedSessions: 8, screenPageViews: 30, engagementRate: 0.6667, userEngagementDuration: 600, activeUsers: 10 }], "channel", ids)[0];
    expect(r).toMatchObject({ date: "2026-10-01", channel: "Organic Search", device: "all", country: "all", source: "ga4", users: 10, sessions: 12, avg_engagement_time_seconds: 60 });
    expect(gaPageRows([{ date: "20261001", landingPage: "/x", sessions: 2 }], true, ids)[0]).toMatchObject({ page_path: "/x", is_landing: true, source: "ga4" });
  });
  it("plans initial and incremental syncs ending yesterday", () => {
    const today = new Date("2026-10-27T10:00:00Z");
    expect(planSync("initial", today)).toMatchObject({ from: "2026-04-30", to: "2026-10-26", step: 0, done: false });
    expect(planSync("incremental", today)).toMatchObject({ from: "2026-10-22", to: "2026-10-26" });
  });
});

describe("date ranges and aggregation", () => {
  const today = new Date("2026-10-27T10:00:00Z");
  it("resolves presets ending yesterday with a previous-period comparison", () => {
    expect(resolveRange({ range: "7d" }, today)).toEqual({ key: "7d", from: "2026-10-20", to: "2026-10-26", days: 7, compare: "previous", prevFrom: "2026-10-13", prevTo: "2026-10-19" });
    expect(resolveRange({ range: "28d", compare: "none" }, today)).toMatchObject({ prevFrom: null, prevTo: null });
    expect(resolveRange({ range: "28d", compare: "year" }, today)).toMatchObject({ prevFrom: "2025-09-30", prevTo: "2025-10-27" }); // 364 days back keeps weekdays aligned
  });
  it("validates custom ranges (clamps to yesterday and 365 days, rejects garbage)", () => {
    expect(resolveRange({ range: "custom", from: "2026-10-01", to: "2026-12-31" }, today)).toMatchObject({ from: "2026-10-01", to: "2026-10-26", days: 26 });
    expect(resolveRange({ range: "custom", from: "2020-01-01", to: "2026-10-26" }, today).days).toBe(365);
    expect(resolveRange({ range: "custom", from: "x'; drop", to: "2026-10-26" }, today).key).toBe("28d");
  });
  it("computes impression-weighted position and CTR", () => {
    expect(searchTotals([{ clicks: 10, impressions: 100, position: 2 }, { clicks: 0, impressions: 300, position: 10 }])).toEqual({ clicks: 10, impressions: 400, ctr: 0.025, position: 8 });
    expect(searchTotals([])).toEqual({ clicks: 0, impressions: 0, ctr: null, position: null });
    expect(change(120, 100)).toBeCloseTo(0.2);
    expect(change(5, 0)).toBeNull();
  });
  it("breaks down by key with previous-period values", () => {
    const b = searchBreakdown([{ q: "a", clicks: 5, impressions: 10, position: 1 }, { q: "b", clicks: 9, impressions: 20, position: 4 }], [{ q: "a", clicks: 1, impressions: 5, position: 2 }], (r) => r.q);
    expect(b.map((r) => r.key)).toEqual(["b", "a"]);
    expect(b[1].prev).toMatchObject({ clicks: 1 });
    expect(b[0].prev).toBeNull();
  });
  it("only emits days that have data (no invented zero days)", () => {
    expect(dailySeries([{ date: "2026-10-02", v: 3 }], "2026-10-01", "2026-10-03", (l) => ({ v: l[0].v }))).toEqual([{ date: "2026-10-02", v: 3 }]);
  });
});
