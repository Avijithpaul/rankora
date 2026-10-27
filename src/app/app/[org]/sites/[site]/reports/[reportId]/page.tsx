import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { deleteReportAction } from "@/lib/actions/reports";
import { EXPORTERS } from "@/lib/reports/export";
import type { ReportSnapshot } from "@/lib/reports/compose";
import { SubmitButton } from "@/components/content/submit-button";
import { PrintButton } from "@/components/reports/print-button";
import { ReportView } from "@/components/reports/report-view";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage({ params }: PageProps<"/app/[org]/sites/[site]/reports/[reportId]">) {
  const { org: orgSlug, site: siteId, reportId } = await params;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) notFound();
  const supabase = await createClient();
  const { data: report } = await supabase.from("reports").select("id, title, snapshot").eq("id", reportId).eq("website_id", website.id).maybeSingle();
  if (!report) notFound();
  const base = `/app/${orgSlug}/sites/${siteId}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`${base}/reports`} className="mr-auto inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Reports
        </Link>
        <PrintButton />
        {(["csv", "json"] as const).map((f) => (
          <a key={f} href={`/api/reports/${report.id}/export?format=${f}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <Download aria-hidden /> {EXPORTERS[f].label}
          </a>
        ))}
        {EXPORTERS.pdf.available() ? (
          <a href={`/api/reports/${report.id}/export?format=pdf`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <Download aria-hidden /> PDF
          </a>
        ) : (
          <span className="text-xs text-muted" title="Server-side PDF rendering is planned; use Print → Save as PDF.">
            PDF: use Print → Save as PDF
          </span>
        )}
        {roleAtLeast(role, "member") && (
          <form action={deleteReportAction}>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="reportId" value={report.id} />
            <SubmitButton variant="ghost" size="sm">
              Delete
            </SubmitButton>
          </form>
        )}
      </div>
      <ReportView title={report.title} snapshot={report.snapshot as unknown as ReportSnapshot} />
      <p className="mt-6 text-center text-xs text-muted">Rankora · {website.domain} · report {report.id.slice(0, 8)}</p>
    </>
  );
}
