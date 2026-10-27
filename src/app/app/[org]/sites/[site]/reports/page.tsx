import type { Metadata } from "next";
import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { listWebsites, requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createReportAction } from "@/lib/actions/reports";
import { REPORT_DESCRIPTION, REPORT_LABEL, REPORT_TYPES, type ReportType } from "@/lib/reports/compose";
import { formatDate } from "@/lib/utils";
import { SubmitButton } from "@/components/content/submit-button";
import { Badge, DemoDataBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Reports" };
export const maxDuration = 60;

function lastMonth() {
  const d = new Date();
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return m.toISOString().slice(0, 7);
}

export default async function ReportsPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/reports">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, org, role } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const [sites, { data: reports }] = await Promise.all([
    listWebsites(org.id),
    supabase.from("reports").select("id, type, title, date_from, date_to, compare_from, is_demo, created_at").eq("website_id", website.id).order("created_at", { ascending: false }).limit(100),
  ]);
  const canCreate = roleAtLeast(role, "member");
  const preselect = typeof sp.type === "string" && REPORT_TYPES.includes(sp.type as ReportType) ? sp.type : "overview";

  return (
    <>
      <PageHeader title="Reports" description="Frozen, printable snapshots of your SEO data for a date range, with period comparison. Each section names its data source." />
      {typeof sp.error === "string" && (
        <div className="mb-4">
          <FormMessage>{sp.error.slice(0, 200)}</FormMessage>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {REPORT_TYPES.map((t) => (
              <Link key={t} href={`${base}/reports?type=${t}#new`} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand/40 hover:bg-brand-soft/30">
                <span className="text-sm font-semibold text-ink">{REPORT_LABEL[t]}</span>
                <span className="mt-1 block text-xs text-muted">{REPORT_DESCRIPTION[t]}</span>
              </Link>
            ))}
          </div>

          <Card>
            <CardHeader title="Saved reports" description={website.domain} />
            {!reports?.length ? (
              <EmptyState icon={FileBarChart} title="No reports yet" description="Create one with the form." className="py-10" />
            ) : (
              <ul className="divide-y divide-line">
                {reports.map((r) => (
                  <li key={r.id}>
                    <Link href={`${base}/reports/${r.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-surface-2/50">
                      <Badge tone="brand">{REPORT_LABEL[r.type as ReportType]}</Badge>
                      <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
                      {r.is_demo && <DemoDataBadge />}
                      <span className="shrink-0 text-xs text-muted">
                        {formatDate(r.date_from)} – {formatDate(r.date_to)}
                        {r.compare_from ? " · compared" : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card id="new">
          <CardHeader title="New report" />
          <CardBody>
            {!canCreate ? (
              <p className="text-sm text-muted">Viewers can read reports but not create them.</p>
            ) : (
              <form action={createReportAction} className="space-y-4">
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <input type="hidden" name="siteId" value={siteId} />
                <Field label="Report" htmlFor="type">
                  <Select id="type" name="type" defaultValue={preselect}>
                    {REPORT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {REPORT_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Website" htmlFor="websiteId">
                  <Select id="websiteId" name="websiteId" defaultValue={website.id}>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.domain}){s.is_demo ? " — Demo Data" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Date range" htmlFor="preset" hint="Ignored for the Monthly SEO Summary, which uses the month below.">
                  <Select id="preset" name="preset" defaultValue="28d">
                    <option value="7d">Last 7 days</option>
                    <option value="28d">Last 28 days</option>
                    <option value="90d">Last 3 months</option>
                    <option value="custom">Custom (dates below)</option>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From" htmlFor="from">
                    <Input id="from" name="from" type="date" />
                  </Field>
                  <Field label="To" htmlFor="to">
                    <Input id="to" name="to" type="date" />
                  </Field>
                </div>
                <Field label="Month (Monthly SEO Summary)" htmlFor="month">
                  <Input id="month" name="month" type="month" defaultValue={lastMonth()} />
                </Field>
                <Field label="Compare with" htmlFor="compare">
                  <Select id="compare" name="compare" defaultValue="previous">
                    <option value="previous">Previous period (previous month for monthly)</option>
                    <option value="year">Same period last year</option>
                    <option value="none">No comparison</option>
                  </Select>
                </Field>
                <Field label="Title (optional)" htmlFor="title">
                  <Input id="title" name="title" maxLength={200} />
                </Field>
                <SubmitButton pendingLabel="Building report…">Create report</SubmitButton>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
