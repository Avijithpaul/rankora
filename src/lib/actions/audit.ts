"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWebsite } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { providerConfig } from "@/lib/env";
import { auditDenial, canChangeIssueStatus } from "@/lib/audit/access";
import { QuotaExceededError, startAudit } from "@/lib/audit/service";
import { recordAudit } from "@/lib/audit-log";

export async function startAuditAction(formData: FormData) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const { org, website, role, user } = await requireWebsite(orgSlug, siteId);
  const base = `/app/${orgSlug}/sites/${siteId}/audit`;

  const denial = auditDenial(role, website);
  if (denial) redirect(`${base}?error=${denial}`);
  if (!providerConfig().serviceRoleConfigured) redirect(`${base}?error=config`);

  // 10 audit starts per user per hour (crawls are expensive for us and for the target site)
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("rate_limit_hit", { p_bucket: "audit.start", p_limit: 10, p_window_seconds: 3600 });
  if (!allowed) redirect(`${base}?error=rate_limited`);

  let started: Awaited<ReturnType<typeof startAudit>>;
  try {
    started = await startAudit({ website, planId: org.plan_id, userId: user.id, trigger: "manual" });
  } catch (e) {
    if (e instanceof QuotaExceededError) redirect(`${base}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  const { jobId, alreadyRunning } = started;
  if (!alreadyRunning) {
    await recordAudit({ organizationId: org.id, actorId: user.id, action: "audit.started", entityType: "crawl_job", entityId: jobId });
  }
  revalidatePath(base);
  redirect(`${base}?job=${jobId}`);
}

export async function setIssueStatusAction(formData: FormData) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const issueId = String(formData.get("issueId") ?? "");
  const to = String(formData.get("status") ?? "");
  const { website, role } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const { data: issue } = await supabase.from("seo_issues").select("id, status").eq("id", issueId).eq("website_id", website.id).maybeSingle();
  const back = `/app/${orgSlug}/sites/${siteId}/audit/issues/${issueId}`;
  if (!issue || !canChangeIssueStatus(role, issue.status, to)) redirect(`${back}?error=status`);
  const { error } = await supabase.from("seo_issues").update({ status: to }).eq("id", issue.id);
  if (error) redirect(`${back}?error=status`);
  revalidatePath(`/app/${orgSlug}/sites/${siteId}/audit`, "layout");
  redirect(back);
}
