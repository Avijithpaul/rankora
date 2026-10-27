import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiConfig, providerConfig } from "@/lib/env";
import { adminSetPlanAction } from "@/lib/actions/billing";
import { billingProvider } from "@/lib/billing/service";
import { PLAN_IDS, periodStart } from "@/lib/billing/entitlements";
import { formatDate, formatNumber } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { SubmitButton } from "@/components/content/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const ADMIN_MSG: Record<string, string> = { forbidden: "Only superadmins can change plans.", invalid: "Invalid request.", reason: "Enter a reason for the plan change (it is written to the audit log)." };

/**
 * Platform admin console. Access requires a row in platform_admins (checked as the
 * user through RLS). It shows operational metrics and organization metadata only —
 * never customer SEO content (pages, keywords, analytics).
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser("/admin");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: admin } = await supabase.from("platform_admins").select("role").eq("user_id", user.id).maybeSingle();
  if (!admin) notFound(); // do not reveal the admin area exists

  const cfg = providerConfig();
  const config = [
    ["Supabase service role", cfg.serviceRoleConfigured],
    ["Token encryption key", cfg.tokenEncryptionConfigured],
    ["Cron secret", Boolean(process.env.CRON_SECRET)],
    ["Google OAuth (GSC / GA4)", Boolean(cfg.googleOAuth)],
    ["PageSpeed Insights API", Boolean(cfg.pagespeedApiKey)],
    ["DataForSEO (keywords / SERP)", Boolean(cfg.dataForSeo)],
    ["Backlink provider", Boolean(cfg.backlinkProvider)],
    ["AI provider (Claude)", Boolean(aiConfig())],
    ["Payments (Stripe, approved)", billingProvider().acceptsPayments],
  ] as const;

  if (!cfg.serviceRoleConfigured) {
    return <Shell role={admin.role}>{<FormMessage tone="info">The service role key is not configured, so platform metrics cannot be loaded.</FormMessage>}</Shell>;
  }

  const db = createAdminClient();
  const { day, week, stale } = windows();
  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [users, newUsers, orgs, websites, jobs24, failed24, stuck, integrationErrors, failedBilling, { data: orgRows }, { data: subs }, { data: usage }, { data: events }] = await Promise.all([
    count(db.from("profiles").select("id", { count: "exact", head: true })),
    count(db.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", week)),
    count(db.from("organizations").select("id", { count: "exact", head: true }).eq("is_demo", false)),
    count(db.from("websites").select("id", { count: "exact", head: true }).eq("is_demo", false)),
    count(db.from("crawl_jobs").select("id", { count: "exact", head: true }).gte("created_at", day)),
    count(db.from("crawl_jobs").select("id", { count: "exact", head: true }).gte("created_at", day).eq("status", "failed")),
    count(db.from("crawl_jobs").select("id", { count: "exact", head: true }).eq("status", "running").lt("heartbeat_at", stale)),
    count(db.from("integrations").select("id", { count: "exact", head: true }).eq("status", "error")),
    count(db.from("billing_events").select("id", { count: "exact", head: true }).eq("status", "failed")),
    db.from("organizations").select("id, name, slug, plan_id, created_at").eq("is_demo", false).order("created_at", { ascending: false }).limit(25),
    db.from("subscriptions").select("plan_id, status, organizations!inner(is_demo)").eq("organizations.is_demo", false),
    db.from("usage_records").select("metric, quantity").gte("occurred_at", periodStart()).limit(50_000),
    db.from("system_events").select("id, level, source, message, created_at").in("level", ["warn", "error"]).order("created_at", { ascending: false }).limit(25),
  ]);
  const byPlan = new Map<string, number>();
  for (const s of subs ?? []) {
    const key = s.status === "canceled" ? "free" : s.plan_id;
    byPlan.set(key, (byPlan.get(key) ?? 0) + 1);
  }
  const usageByMetric = new Map<string, number>();
  for (const u of usage ?? []) usageByMetric.set(u.metric, (usageByMetric.get(u.metric) ?? 0) + u.quantity);

  return (
    <Shell role={admin.role}>
      {typeof sp.error === "string" && ADMIN_MSG[sp.error] && <FormMessage>{ADMIN_MSG[sp.error]}</FormMessage>}
      {sp.saved === "plan" && <FormMessage tone="success">Plan changed and recorded in the organization&apos;s audit log.</FormMessage>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {(
          [
            ["Users", users],
            ["New users (7 d)", newUsers],
            ["Organizations", orgs],
            ["Websites", websites],
            ["Crawls (24 h)", jobs24],
            ["Failed crawls (24 h)", failed24],
            ["Stuck crawls", stuck],
            ["Integrations in error", integrationErrors],
          ] as const
        ).map(([k, v]) => (
          <Card key={k} className="p-4">
            <p className="text-xs text-muted">{k}</p>
            <p className={`tabular mt-1 text-2xl font-semibold ${(k.startsWith("Failed") || k.startsWith("Stuck") || k.startsWith("Integrations")) && v > 0 ? "text-critical" : ""}`}>{formatNumber(v)}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Subscriptions by plan" description="Real organizations (demo excluded)" />
          <CardBody className="space-y-2 text-sm">
            {PLAN_IDS.map((p) => (
              <div key={p} className="flex justify-between">
                <span className="capitalize">{p}</span>
                <span className="tabular">{formatNumber(byPlan.get(p) ?? 0)}</span>
              </div>
            ))}
            {failedBilling > 0 && <p className="text-critical">{failedBilling} billing event(s) failed to process.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Usage this month" description="All organizations" />
          <CardBody className="space-y-2 text-sm">
            {[...usageByMetric].length === 0 && <p className="text-muted">No metered usage yet.</p>}
            {[...usageByMetric].map(([m, q]) => (
              <div key={m} className="flex justify-between">
                <code className="text-xs">{m}</code>
                <span className="tabular">{formatNumber(q)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Configuration" description="Presence only; values are never displayed" />
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {config.map(([name, ok]) => (
                <li key={name} className="flex items-center justify-between gap-2">
                  {name}
                  <Badge tone={ok ? "success" : "neutral"}>{ok ? "On" : "Off"}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent warnings and errors" description="system_events — secrets are redacted before storage" />
        {!events?.length ? (
          <p className="px-5 py-4 text-sm text-muted">No warnings or errors recorded.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-5 py-2">
                <Badge tone={e.level === "error" ? "critical" : "warning"}>{e.level}</Badge>
                <code className="text-xs">{e.source}</code>
                <span className="min-w-0 flex-1 truncate">{e.message}</span>
                <span className="text-xs text-muted">{formatDate(e.created_at, { hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Organizations" description="Latest 25. Plan changes here use manual billing (no payment) and are audited." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2 font-medium">Organization</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-5 py-2 font-medium">Change plan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(orgRows ?? []).map((o) => (
                <tr key={o.id}>
                  <td className="px-5 py-2">
                    <span className="font-medium">{o.name}</span> <span className="text-xs text-muted">/{o.slug}</span>
                  </td>
                  <td className="px-3 py-2 capitalize">{o.plan_id}</td>
                  <td className="px-3 py-2 text-muted">{formatDate(o.created_at)}</td>
                  <td className="px-5 py-2">
                    {admin.role === "superadmin" ? (
                      <form action={adminSetPlanAction} className="flex items-center gap-2">
                        <input type="hidden" name="organizationId" value={o.id} />
                        <Select name="planId" defaultValue={o.plan_id} className="h-8 w-28 text-xs" aria-label={`Plan for ${o.name}`}>
                          {PLAN_IDS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </Select>
                        <Input name="reason" placeholder="Reason" className="h-8 w-40 text-xs" required maxLength={200} aria-label="Reason" />
                        <SubmitButton size="sm" variant="secondary">
                          Apply
                        </SubmitButton>
                      </form>
                    ) : (
                      <span className="text-xs text-muted">superadmin only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  );
}

/** Time windows for the monitoring queries. */
function windows() {
  const now = Date.now();
  return {
    day: new Date(now - 86_400_000).toISOString(),
    week: new Date(now - 7 * 86_400_000).toISOString(),
    stale: new Date(now - 10 * 60_000).toISOString(),
  };
}

function Shell({ role, children }: { role: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="flex h-16 items-center gap-3 border-b border-line bg-surface px-6">
        <Logo href="/app" />
        <Badge tone="critical">Admin · {role}</Badge>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader title="Platform monitoring" description="Operational metrics and organization metadata. Customer SEO content is never shown here." />
        {children}
      </main>
    </div>
  );
}
