"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { providerConfig } from "@/lib/env";
import { recordAudit } from "@/lib/audit-log";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/validation/schemas";
import { MAX_DRAFT_CHARS } from "@/lib/content/document";
import { generateAiSuggestion, runContentAnalysis } from "@/lib/content/service";
import { AI_TASKS } from "@/lib/ai/types";
import { checkEntitlement, recordUsage } from "@/lib/billing/usage";

const FIELDS = ["mode", "keyword", "url", "title", "metaDescription", "body", "terms"];

const analyzeSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("url"),
    keyword: z.string().trim().min(2, "Enter a target keyword").max(120),
    url: z.string().trim().min(4, "Enter the page URL").max(2048),
    terms: z.string().max(4000).optional(),
  }),
  z.object({
    mode: z.literal("draft"),
    keyword: z.string().trim().min(2, "Enter a target keyword").max(120),
    title: z.string().trim().max(300).optional(),
    metaDescription: z.string().trim().max(500).optional(),
    body: z.string().trim().min(50, "Paste at least a few sentences").max(MAX_DRAFT_CHARS, `Drafts are limited to ${MAX_DRAFT_CHARS.toLocaleString("en")} characters`),
    terms: z.string().max(4000).optional(),
  }),
]);

export async function analyzeContentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const values = formValues(formData, FIELDS);
  const ctx = await requireWebsite(orgSlug, siteId);
  if (!roleAtLeast(ctx.role, "member")) return { ok: false, message: "Viewers cannot run content analyses.", values };
  if (ctx.website.is_demo) return { ok: false, message: "The Demo Project is read-only. Add a real website to analyze content.", values };
  if (!providerConfig().serviceRoleConfigured) return { ok: false, message: "This feature is not fully configured on the server yet. Please contact the administrator.", values };

  const parsed = analyzeSchema.safeParse(Object.fromEntries(FIELDS.map((k) => [k, formData.get(k) ?? undefined])));
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error), values };

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("rate_limit_hit", { p_bucket: "content.analyze", p_limit: 60, p_window_seconds: 3600 });
  if (!allowed) return { ok: false, message: "Too many analyses in the last hour. Please wait a little.", values };

  const r = await runContentAnalysis(parsed.data, { website: ctx.website, userId: ctx.user.id });
  if (!r.ok) return { ok: false, message: r.message, fieldErrors: r.reason === "empty" ? {} : { url: [r.message] }, values };
  revalidatePath(`/app/${orgSlug}/sites/${siteId}/content`);
  redirect(`/app/${orgSlug}/sites/${siteId}/content/${r.id}`);
}

const aiSchema = z.object({ analysisId: z.uuid(), task: z.enum(AI_TASKS) });

export async function generateAiSuggestionAction(formData: FormData) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const ctx = await requireWebsite(orgSlug, siteId);
  const parsed = aiSchema.safeParse({ analysisId: formData.get("analysisId"), task: formData.get("task") });
  const base = `/app/${orgSlug}/sites/${siteId}/content`;
  if (!parsed.success) redirect(`${base}?error=invalid`);
  const back = `${base}/${parsed.data.analysisId}`;
  if (!roleAtLeast(ctx.role, "member")) redirect(`${back}?ai_error=${encodeURIComponent("Viewers cannot request AI suggestions.")}#ai`);
  if (ctx.website.is_demo) redirect(`${back}?ai_error=${encodeURIComponent("The Demo Project is read-only.")}#ai`);

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("rate_limit_hit", { p_bucket: "ai.suggest", p_limit: 30, p_window_seconds: 3600 });
  if (!allowed) redirect(`${back}?ai_error=${encodeURIComponent("AI suggestion limit reached (30 per hour). Try again later.")}#ai`);

  const quota = await checkEntitlement(ctx.org.id, "ai_credits_per_month");
  if (quota.message) redirect(`${back}?ai_error=${encodeURIComponent(quota.message)}#ai`);
  const r = await generateAiSuggestion(parsed.data.analysisId, parsed.data.task, ctx.website);
  if (!r.ok) redirect(`${back}?ai_error=${encodeURIComponent(r.message)}#ai`);
  // one AI credit per successful suggestion set
  await recordUsage({ orgId: ctx.org.id, websiteId: ctx.website.id, metric: "ai_credits", quantity: 1, metadata: { task: parsed.data.task } });
  await recordAudit({ organizationId: ctx.org.id, actorId: ctx.user.id, action: "content.ai_suggestion", entityType: "content_analysis", entityId: parsed.data.analysisId, metadata: { task: parsed.data.task } });
  revalidatePath(back);
  redirect(`${back}?ai=${parsed.data.task}#ai-${parsed.data.task}`);
}

export async function deleteAnalysisAction(formData: FormData) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const ctx = await requireWebsite(orgSlug, siteId);
  const id = String(formData.get("analysisId") ?? "");
  const base = `/app/${orgSlug}/sites/${siteId}/content`;
  if (!roleAtLeast(ctx.role, "member") || !/^[0-9a-f-]{36}$/i.test(id)) redirect(`${base}?error=role`);
  // RLS (content_delete: member+) scopes the delete to the user's organization.
  const supabase = await createClient();
  await supabase.from("content_analyses").delete().eq("id", id).eq("website_id", ctx.website.id);
  revalidatePath(base);
  redirect(`${base}?deleted=1`);
}
