import type { Metadata } from "next";
import { BarChart3, CheckCircle2, Gauge, KeyRound, SearchCheck } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { providerConfig } from "@/lib/env";
import { googleClient, getAccessToken } from "@/lib/google/connections";
import { listSites, suggestSite, type GscSite } from "@/lib/google/search-console";
import { listProperties, type Ga4Property } from "@/lib/google/analytics";
import { GoogleApiError, GOOGLE_ERROR_HELP } from "@/lib/google/errors";
import { detachIntegrationAction, revokeGoogleAction, selectPropertyAction, syncNowAction } from "@/lib/actions/integrations";
import { formatDate } from "@/lib/utils";
import { Badge, DemoDataBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SyncRunner } from "@/components/integrations/sync-runner";

export const metadata: Metadata = { title: "Integrations" };
export const maxDuration = 60;

const MESSAGES: Record<string, [string, "success" | "error" | "info"]> = {
  connected: ["Google account connected. Choose a property for each service below.", "success"],
  partial: ["Google account connected, but only some permissions were granted. Reconnect to grant both Search Console and Analytics access.", "info"],
  denied: ["You cancelled the Google consent screen. Nothing was connected.", "info"],
  disconnected: ["Integration disconnected.", "success"],
  revoked: ["Google access revoked and tokens deleted.", "success"],
  not_configured: ["Google integration is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / TOKEN_ENCRYPTION_KEY).", "error"],
  state_expired: ["The connection request expired. Please try again.", "error"],
  state_reused: ["That connection link was already used. Please try again.", "error"],
  unknown_state: ["The connection request was not recognised. Please try again.", "error"],
  different_user: ["The connection was started by a different user. Please try again while signed in.", "error"],
  no_scopes: ["No Search Console or Analytics permission was granted.", "error"],
  no_refresh_token: ["Google did not return offline access. Remove Rankora in your Google account permissions and connect again.", "error"],
  property_not_found: ["That property is not accessible with the connected Google account.", "error"],
  forbidden: ["You don't have permission to manage integrations for this website.", "error"],
  demo: ["The Demo Project uses sample data and cannot connect Google accounts.", "info"],
  rate_limited: ["Too many connection attempts. Please wait a while.", "error"],
  invalid: ["Invalid request.", "error"],
  failed: ["Connecting to Google failed. Please try again.", "error"],
};

type Svc = { provider: "google_search_console" | "google_analytics_4"; service: "gsc" | "ga4"; title: string; icon: typeof SearchCheck; blurb: string };
const SERVICES: Svc[] = [
  { provider: "google_search_console", service: "gsc", title: "Google Search Console", icon: SearchCheck, blurb: "Clicks, impressions, CTR, positions, queries, pages, countries and devices." },
  { provider: "google_analytics_4", service: "ga4", title: "Google Analytics 4", icon: BarChart3, blurb: "Users, sessions, views, engagement, channels, landing pages, countries and devices." },
];

const STATUS_TONE = { connected: "success", pending: "warning", error: "critical", disconnected: "neutral" } as const;

export default async function IntegrationsPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/integrations">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, role, org } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const canManage = roleAtLeast(role, "member") && !website.is_demo;
  const configured = Boolean(googleClient());
  const cfg = providerConfig();

  const [{ data: integrations }, { data: connections }] = await Promise.all([
    supabase.from("integrations").select("id, provider, status, oauth_connection_id, external_account_id, external_account_name, last_synced_at, last_error, sync_state").eq("website_id", website.id),
    supabase.from("oauth_connections").select("id, provider_account_email, status, scopes, created_at, revoked_at").eq("organization_id", org.id).eq("provider", "google").is("revoked_at", null),
  ]);

  // Live property lists for integrations that are connected to a Google account
  const options = new Map<string, { gsc?: GscSite[]; ga4?: Ga4Property[]; error?: string }>();
  if (canManage) {
    for (const i of integrations ?? []) {
      if (!i.oauth_connection_id || i.status === "disconnected") continue;
      try {
        const token = await getAccessToken(i.oauth_connection_id);
        options.set(i.id, i.provider === "google_search_console" ? { gsc: await listSites(token) } : { ga4: await listProperties(token) });
      } catch (e) {
        options.set(i.id, { error: e instanceof GoogleApiError ? GOOGLE_ERROR_HELP[e.kind] : "Could not load properties from Google." });
      }
    }
  }

  const msgKey = typeof sp.google === "string" ? sp.google : null;
  const msg = msgKey ? MESSAGES[msgKey] : null;
  const syncing = typeof sp.sync === "string" ? sp.sync : null;
  const connectUrl = (services: string) => `/api/integrations/google/start?site=${siteId}&services=${services}`;

  return (
    <>
      <PageHeader title="Integrations" description={`Connect data sources for ${website.domain}. Rankora requests read-only access only.`} />
      <div className="space-y-4">
        {msg && <FormMessage tone={msg[1]}>{typeof sp.message === "string" ? sp.message : msg[0]}</FormMessage>}
        {website.is_demo && (
          <FormMessage tone="info">
            The Demo Project shows sample Search Console and Analytics figures labelled <strong>Demo Data</strong>. Google accounts can only be connected to real websites.
          </FormMessage>
        )}
        {!configured && !website.is_demo && (
          <Card className="border-warning/30 p-5 text-sm">
            <p className="font-semibold text-ink">Google integration not configured on the server</p>
            <p className="mt-1 text-muted">
              Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>TOKEN_ENCRYPTION_KEY</code> (and <code>SUPABASE_SECRET_KEY</code>), add{" "}
              <code>{(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/google/callback</code> as an authorized redirect URI in Google Cloud,
              and enable the Search Console API, Google Analytics Data API and Google Analytics Admin API. See docs/INTEGRATIONS.md.
            </p>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {SERVICES.map((s) => {
            const i = (integrations ?? []).find((x) => x.provider === s.provider);
            const status = website.is_demo ? "demo" : (i?.status ?? "disconnected");
            const opt = i ? options.get(i.id) : undefined;
            const list = s.service === "gsc" ? opt?.gsc : opt?.ga4;
            const suggested = s.service === "gsc" && opt?.gsc ? suggestSite(opt.gsc, website.domain, website.base_url) : null;
            const state = (i?.sync_state ?? {}) as { done?: boolean; from?: string; step?: number };
            const runSync = i && i.status === "connected" && i.external_account_id && canManage && (syncing === i.id || (state.from && state.done === false));
            return (
              <Card key={s.provider}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <s.icon className="size-4 text-brand" aria-hidden /> {s.title}
                    </span>
                  }
                  description={s.blurb}
                  action={
                    status === "demo" ? <DemoDataBadge /> : <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"} className="capitalize">{status === "pending" ? "Choose property" : status}</Badge>
                  }
                />
                <CardBody className="space-y-4 text-sm">
                  {status === "demo" ? (
                    <p className="text-muted">Sample data only.</p>
                  ) : !i || status === "disconnected" ? (
                    <>
                      <p className="text-muted">Not connected. Data appears in {s.service === "gsc" ? "Search Performance" : "Analytics"} after you connect and choose a property.</p>
                      {canManage && (
                        <a className={buttonClasses({ size: "sm", className: !configured ? "pointer-events-none opacity-50" : "" })} href={configured ? connectUrl(s.service) : undefined} aria-disabled={!configured}>
                          Connect Google account
                        </a>
                      )}
                    </>
                  ) : (
                    <>
                      {i.last_error && <FormMessage>{i.last_error}</FormMessage>}
                      {i.external_account_name && (
                        <p>
                          <span className="text-muted">Property:</span> <span className="font-medium text-ink">{i.external_account_name}</span>
                        </p>
                      )}
                      <p className="text-muted">
                        {i.last_synced_at ? `Last synced ${formatDate(i.last_synced_at, { hour: "2-digit", minute: "2-digit" })}` : "Not synced yet"}
                      </p>
                      {runSync && <SyncRunner integrationId={i.id} label={s.title} />}

                      {canManage && opt?.error && (
                        <div className="space-y-2">
                          <FormMessage>{opt.error}</FormMessage>
                          <a className={buttonClasses({ size: "sm", variant: "secondary" })} href={connectUrl(s.service)}>
                            Reconnect Google
                          </a>
                        </div>
                      )}
                      {canManage && list && list.length === 0 && (
                        <FormMessage tone="info">
                          {s.service === "gsc"
                            ? "This Google account has no verified Search Console properties. Add and verify your site in Search Console, then reload this page."
                            : "This Google account has no GA4 properties. Create a GA4 property or connect a different account."}
                        </FormMessage>
                      )}
                      {canManage && list && list.length > 0 && (
                        <form action={selectPropertyAction} className="flex flex-col gap-2 sm:flex-row">
                          <input type="hidden" name="orgSlug" value={orgSlug} />
                          <input type="hidden" name="siteId" value={siteId} />
                          <input type="hidden" name="integrationId" value={i.id} />
                          <Select name="property" defaultValue={i.external_account_id ?? suggested ?? ""} className="h-9" aria-label={`${s.title} property`} required>
                            <option value="" disabled>
                              Choose a property…
                            </option>
                            {s.service === "gsc"
                              ? (list as GscSite[]).map((p) => (
                                  <option key={p.siteUrl} value={p.siteUrl}>
                                    {p.siteUrl.replace(/^sc-domain:/, "Domain: ")}
                                    {p.siteUrl === suggested ? " (matches this website)" : ""}
                                  </option>
                                ))
                              : (list as Ga4Property[]).map((p) => (
                                  <option key={p.property} value={p.property}>
                                    {p.displayName} — {p.account} ({p.property.replace("properties/", "")})
                                  </option>
                                ))}
                          </Select>
                          <Button size="sm" type="submit">
                            {i.external_account_id ? "Change property" : "Use this property"}
                          </Button>
                        </form>
                      )}
                      {canManage && i.status === "connected" && i.external_account_id && !runSync && (
                        <div className="flex flex-wrap gap-2">
                          <form action={syncNowAction}>
                            <input type="hidden" name="orgSlug" value={orgSlug} />
                            <input type="hidden" name="siteId" value={siteId} />
                            <input type="hidden" name="integrationId" value={i.id} />
                            <Button size="sm" variant="secondary" type="submit">
                              Sync now
                            </Button>
                          </form>
                          <form action={syncNowAction}>
                            <input type="hidden" name="orgSlug" value={orgSlug} />
                            <input type="hidden" name="siteId" value={siteId} />
                            <input type="hidden" name="integrationId" value={i.id} />
                            <input type="hidden" name="full" value="1" />
                            <Button size="sm" variant="ghost" type="submit" title="Re-import the last 180 days">
                              Full re-sync
                            </Button>
                          </form>
                        </div>
                      )}
                      {canManage && (
                        <details className="border-t border-line pt-3">
                          <summary className="cursor-pointer text-xs text-muted">Disconnect</summary>
                          <form action={detachIntegrationAction} className="mt-3 space-y-2">
                            <input type="hidden" name="orgSlug" value={orgSlug} />
                            <input type="hidden" name="siteId" value={siteId} />
                            <input type="hidden" name="integrationId" value={i.id} />
                            <label className="flex items-center gap-2 text-xs text-ink-2">
                              <input type="checkbox" name="deleteData" className="size-4 accent-[var(--critical)]" /> Also delete data already imported for this website
                            </label>
                            <Button size="sm" variant="danger" type="submit">
                              Disconnect from this website
                            </Button>
                          </form>
                        </details>
                      )}
                    </>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>

        {!website.is_demo && (
          <Card>
            <CardHeader title="Connected Google accounts" description="Shared by all websites in this organization. Tokens are encrypted and never sent to your browser." />
            {(connections ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No Google account connected.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {(connections ?? []).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <CheckCircle2 className={c.status === "active" ? "size-4 text-success" : "size-4 text-critical"} aria-hidden />
                    <span className="font-medium text-ink">{c.provider_account_email}</span>
                    <Badge tone={c.status === "active" ? "success" : "critical"}>{c.status === "active" ? "Active" : "Needs reconnect"}</Badge>
                    <span className="text-xs text-muted">
                      {c.scopes.some((x) => x.endsWith("webmasters.readonly")) ? "Search Console" : ""}
                      {c.scopes.some((x) => x.endsWith("webmasters.readonly")) && c.scopes.some((x) => x.endsWith("analytics.readonly")) ? " · " : ""}
                      {c.scopes.some((x) => x.endsWith("analytics.readonly")) ? "Analytics" : ""} · read-only · since {formatDate(c.created_at)}
                    </span>
                    {roleAtLeast(role, "admin") && (
                      <form action={revokeGoogleAction} className="ml-auto">
                        <input type="hidden" name="orgSlug" value={orgSlug} />
                        <input type="hidden" name="siteId" value={siteId} />
                        <input type="hidden" name="connectionId" value={c.id} />
                        <Button size="sm" variant="ghost" type="submit" title="Revokes Rankora's access at Google for every website in this organization">
                          Revoke access
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && configured && (
              <div className="border-t border-line px-5 py-3">
                <a className={buttonClasses({ size: "sm", variant: "secondary" })} href={connectUrl("gsc,ga4")}>
                  Connect a Google account (Search Console + Analytics)
                </a>
              </div>
            )}
          </Card>
        )}

        <Card>
          <CardHeader title="Other data providers" description="Configured by the server administrator via environment variables." />
          <ul className="divide-y divide-line text-sm">
            <li className="flex items-center gap-3 px-5 py-3">
              <Gauge className="size-4 text-muted" aria-hidden /> Google PageSpeed Insights (Core Web Vitals in Site Audit)
              <Badge tone={cfg.pagespeedApiKey ? "success" : "neutral"} className="ml-auto">{cfg.pagespeedApiKey ? "Configured" : "Not configured"}</Badge>
            </li>
            <li className="flex items-center gap-3 px-5 py-3">
              <KeyRound className="size-4 text-muted" aria-hidden /> DataForSEO (keyword data & rank tracking)
              <Badge tone={cfg.dataForSeo ? "success" : "warning"} className="ml-auto">{cfg.dataForSeo ? "Connected" : "Provider Not Connected"}</Badge>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
