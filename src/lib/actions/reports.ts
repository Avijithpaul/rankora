"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { providerConfig } from "@/lib/env";
import { REPORT_TYPES, resolvePeriod, type ReportType } from "@/lib/reports/compose";
import { createReport } from "@/lib/reports/build";
import { checkEntitlement } from "@/lib/billing/usage";

const withError = (url: string, text: string) => `${url}${url.includes("?") ? "&" : "?"}error=${encodeURIComponent(text)}`;

export async function createReportAction(formData: FormData) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const currentSite = String(formData.get("siteId") ?? "");
  // website selection: the report may be built for any website of the organization the user can access
  const targetSite = String(formData.get("websiteId") ?? currentSite);
  const back = `/app/${orgSlug}/sites/${currentSite}/reports`;
  const ctx = await requireWebsite(orgSlug, targetSite);
  if (!roleAtLeast(ctx.role, "member")) redirect(withError(back, "Viewers can read reports but not create them."));
  if (!providerConfig().serviceRoleConfigured) redirect(withError(back, "This feature is not fully configured on the server yet. Please contact the administrator."));
  const type = String(formData.get("type") ?? "") as ReportType;
  if (!REPORT_TYPES.includes(type)) redirect(withError(back, "Choose a report type."));
  const period = resolvePeriod({
    type,
    preset: String(formData.get("preset") ?? "28d"),
    from: String(formData.get("from") ?? ""),
    to: String(formData.get("to") ?? ""),
    month: String(formData.get("month") ?? ""),
    compare: String(formData.get("compare") ?? "previous"),
  });
  if ("error" in period) redirect(withError(back, period.error));
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("rate_limit_hit", { p_bucket: "reports.create", p_limit: 30, p_window_seconds: 3600 });
  if (!allowed) redirect(withError(back, "Too many reports this hour."));
  const quota = await checkEntitlement(ctx.org.id, "reports_per_month");
  if (quota.message) redirect(withError(back, quota.message));
  const id = await createReport({ type, website: ctx.website, period, userId: ctx.user.id, title: String(formData.get("title") ?? "") });
  revalidatePath(`/app/${orgSlug}/sites/${ctx.website.id}/reports`);
  redirect(`/app/${orgSlug}/sites/${ctx.website.id}/reports/${id}`);
}

export async function deleteReportAction(formData: FormData) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const ctx = await requireWebsite(orgSlug, siteId);
  const id = String(formData.get("reportId") ?? "");
  const back = `/app/${orgSlug}/sites/${siteId}/reports`;
  if (!roleAtLeast(ctx.role, "member")) redirect(withError(back, "Viewers cannot delete reports."));
  const supabase = await createClient();
  if (/^[0-9a-f-]{36}$/i.test(id)) await supabase.from("reports").delete().eq("id", id).eq("website_id", ctx.website.id);
  revalidatePath(back);
  redirect(back);
}
