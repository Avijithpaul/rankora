import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getUser, type OrgRole } from "@/lib/auth/dal";
import { auditDenial } from "./access";

export type JobAccess =
  | { ok: true; jobId: string; role: OrgRole; canRun: boolean }
  | { ok: false; status: 401 | 403 | 404; error: string };

/**
 * Resolves a crawl job AS THE USER (RLS applies): a job in another tenant's
 * organization is simply not found. Only after this check may the service
 * role be used on the job.
 */
export async function authorizeJob(jobId: string): Promise<JobAccess> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return { ok: false, status: 404, error: "Not found" };
  const user = await getUser();
  if (!user) return { ok: false, status: 401, error: "Sign in required" };
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("crawl_jobs")
    .select("id, organization_id, websites!inner(is_demo, status)")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { ok: false, status: 404, error: "Not found" };
  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", job.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { ok: false, status: 404, error: "Not found" };
  const site = job.websites as unknown as { is_demo: boolean; status: string };
  return { ok: true, jobId: job.id, role: member.role, canRun: auditDenial(member.role, site) === null };
}
