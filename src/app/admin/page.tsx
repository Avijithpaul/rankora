import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { providerConfig } from "@/lib/env";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { PlannedModule } from "@/components/ui/states";
import { formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

/**
 * Platform admin console. Access requires a row in platform_admins (checked
 * through RLS as the user). Only aggregate, non-customer-content metrics are
 * shown here; customer SEO data is never listed.
 */
export default async function AdminPage() {
  const user = await requireUser("/admin");
  const supabase = await createClient();
  const { data: admin } = await supabase.from("platform_admins").select("role").eq("user_id", user.id).maybeSingle();
  if (!admin) notFound(); // do not reveal the admin area exists

  const cfg = providerConfig();
  let counts: Record<string, number | null> = {};
  if (cfg.serviceRoleConfigured) {
    const db = createAdminClient();
    const count = async (t: "organizations" | "websites" | "crawl_jobs" | "profiles") =>
      (await db.from(t).select("*", { count: "exact", head: true })).count;
    const [orgs, sites, crawls, users] = await Promise.all([count("organizations"), count("websites"), count("crawl_jobs"), count("profiles")]);
    counts = { Users: users, Organizations: orgs, Websites: sites, "Crawl jobs": crawls };
  }

  const integrations = [
    ["Google OAuth (GSC / GA4)", Boolean(cfg.googleOAuth)],
    ["PageSpeed Insights API", Boolean(cfg.pagespeedApiKey)],
    ["DataForSEO (keywords / SERP / backlinks)", Boolean(cfg.dataForSeo)],
    ["Token encryption key", cfg.tokenEncryptionConfigured],
    ["Supabase service role", cfg.serviceRoleConfigured],
  ] as const;

  return (
    <div className="min-h-dvh">
      <header className="flex h-16 items-center gap-3 border-b border-line bg-surface px-6">
        <Logo href="/app" />
        <Badge tone="critical">Admin · {admin.role}</Badge>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <PageHeader title="System overview" description="Platform-level metrics. Customer SEO content is not shown here." />
        {!cfg.serviceRoleConfigured && <FormMessage tone="info">Configure SUPABASE_SECRET_KEY to load platform counts.</FormMessage>}
        <div className="grid gap-4 sm:grid-cols-4">
          {Object.entries(counts).map(([k, v]) => (
            <Card key={k} className="p-4">
              <p className="text-xs text-muted">{k}</p>
              <p className="tabular mt-1 text-2xl font-semibold">{formatNumber(v)}</p>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader title="Integration configuration" description="Whether server-side credentials are present (values are never displayed)." />
          <CardBody>
            <ul className="space-y-2 text-sm">
              {integrations.map(([name, ok]) => (
                <li key={name} className="flex items-center justify-between">
                  {name}
                  <Badge tone={ok ? "success" : "neutral"}>{ok ? "Configured" : "Not configured"}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <PlannedModule title="User, organization, usage and error management" phase="Phase 7">
          Searchable users and organizations, plan changes, usage charts, crawl queue health and system error logs.
        </PlannedModule>
      </main>
    </div>
  );
}
