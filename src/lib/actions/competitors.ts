"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { providerConfig } from "@/lib/env";
import { recordAudit } from "@/lib/audit-log";
import { MAX_COMPETITORS, normalizeCompetitorDomain } from "@/lib/competitors/compare";
import { captureHomepageComparison, comparePages, refreshDomainKeywords } from "@/lib/competitors/service";
import { syncBacklinks } from "@/lib/backlinks/service";

const UUID = /^[0-9a-f-]{36}$/i;
const withMsg = (url: string, key: "error" | "saved", text: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`;

async function editor(formData: FormData, backPath: (base: string) => string) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const ctx = await requireWebsite(orgSlug, siteId);
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const back = backPath(base);
  if (!roleAtLeast(ctx.role, "member")) redirect(withMsg(back, "error", "Viewers cannot change competitors."));
  if (ctx.website.is_demo) redirect(withMsg(back, "error", "The Demo Project is read-only."));
  if (!providerConfig().serviceRoleConfigured) redirect(withMsg(back, "error", "This feature is not fully configured on the server yet. Please contact the administrator."));
  return { ...ctx, base, back };
}

async function competitorOf(websiteId: string, id: string) {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("competitors").select("*").eq("id", id).eq("website_id", websiteId).maybeSingle();
  return data;
}

async function rateLimited(bucket: string, limit: number) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("rate_limit_hit", { p_bucket: bucket, p_limit: limit, p_window_seconds: 3600 });
  return !data;
}

export async function addCompetitorAction(formData: FormData) {
  const ctx = await editor(formData, (b) => `${b}/competitors`);
  const n = normalizeCompetitorDomain(String(formData.get("domain") ?? ""), ctx.website.domain);
  if (!n.ok) redirect(withMsg(ctx.back, "error", n.message));
  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || null;
  const supabase = await createClient();
  const { count } = await supabase.from("competitors").select("id", { count: "exact", head: true }).eq("website_id", ctx.website.id);
  if ((count ?? 0) >= MAX_COMPETITORS) redirect(withMsg(ctx.back, "error", `Up to ${MAX_COMPETITORS} competitors per website.`));
  const { data, error } = await supabase
    .from("competitors")
    .insert({ organization_id: ctx.org.id, website_id: ctx.website.id, domain: n.domain, name, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error?.code === "23505") redirect(withMsg(ctx.back, "error", `${n.domain} is already a competitor.`));
  if (error || !data) redirect(withMsg(ctx.back, "error", "The competitor could not be added."));
  await recordAudit({ organizationId: ctx.org.id, actorId: ctx.user.id, action: "competitor.add", entityType: "competitor", entityId: data.id, metadata: { domain: n.domain } });
  revalidatePath(`${ctx.base}/competitors`);
  redirect(`${ctx.base}/competitors/${data.id}`);
}

export async function removeCompetitorAction(formData: FormData) {
  const ctx = await editor(formData, (b) => `${b}/competitors`);
  const id = String(formData.get("competitorId") ?? "");
  const supabase = await createClient();
  if (UUID.test(id)) await supabase.from("competitors").delete().eq("id", id).eq("website_id", ctx.website.id);
  await recordAudit({ organizationId: ctx.org.id, actorId: ctx.user.id, action: "competitor.remove", entityType: "competitor", entityId: id });
  revalidatePath(`${ctx.base}/competitors`);
  redirect(withMsg(`${ctx.base}/competitors`, "saved", "Competitor removed with its stored comparison data."));
}

export async function refreshCompetitorKeywordsAction(formData: FormData) {
  const id = String(formData.get("competitorId") ?? "");
  const ctx = await editor(formData, (b) => `${b}/competitors/${id}?tab=overlap`);
  const competitor = await competitorOf(ctx.website.id, id);
  if (!competitor) redirect(`${ctx.base}/competitors`);
  if (await rateLimited("competitors.keywords", 20)) redirect(withMsg(ctx.back, "error", "Too many refreshes this hour."));
  const force = formData.get("force") === "1";
  const own = await refreshDomainKeywords({ website: ctx.website, competitor: null, userId: ctx.user.id, planId: ctx.org.plan_id, force });
  if (!own.ok) redirect(withMsg(ctx.back, "error", own.message));
  const theirs = await refreshDomainKeywords({ website: ctx.website, competitor, userId: ctx.user.id, planId: ctx.org.plan_id, force });
  if (!theirs.ok) redirect(withMsg(ctx.back, "error", theirs.message));
  revalidatePath(ctx.back.split("?")[0]);
  redirect(withMsg(ctx.back, "saved", own.cached && theirs.cached ? "Showing cached ranking data (less than 7 days old)." : "Ranking data refreshed."));
}

export async function captureHomepageAction(formData: FormData) {
  const id = String(formData.get("competitorId") ?? "");
  const ctx = await editor(formData, (b) => `${b}/competitors/${id}?tab=audit`);
  const competitor = await competitorOf(ctx.website.id, id);
  if (!competitor) redirect(`${ctx.base}/competitors`);
  if (await rateLimited("competitors.snapshot", 30)) redirect(withMsg(ctx.back, "error", "Too many snapshots this hour."));
  await captureHomepageComparison({ website: ctx.website, competitor, userId: ctx.user.id });
  revalidatePath(ctx.back.split("?")[0]);
  redirect(ctx.back);
}

const compareSchema = z.object({ keyword: z.string().trim().min(2).max(120), ownUrl: z.string().trim().min(4).max(2048), theirUrl: z.string().trim().min(4).max(2048) });

export async function comparePagesAction(formData: FormData) {
  const id = String(formData.get("competitorId") ?? "");
  const ctx = await editor(formData, (b) => `${b}/competitors/${id}?tab=content`);
  const competitor = await competitorOf(ctx.website.id, id);
  if (!competitor) redirect(`${ctx.base}/competitors`);
  const parsed = compareSchema.safeParse({ keyword: formData.get("keyword"), ownUrl: formData.get("ownUrl"), theirUrl: formData.get("theirUrl") });
  if (!parsed.success) redirect(withMsg(ctx.back, "error", "Enter a keyword and both page URLs."));
  if (await rateLimited("competitors.compare", 30)) redirect(withMsg(ctx.back, "error", "Too many comparisons this hour."));
  const r = await comparePages({ website: ctx.website, competitor, userId: ctx.user.id, ...parsed.data });
  if (!r.ok) redirect(withMsg(ctx.back, "error", r.message));
  revalidatePath(ctx.back.split("?")[0]);
  redirect(`${ctx.back}&compare=${r.id}`);
}

export async function syncBacklinksAction(formData: FormData) {
  const ctx = await editor(formData, (b) => `${b}/backlinks`);
  if (await rateLimited("backlinks.sync", 5)) redirect(withMsg(ctx.back, "error", "Too many syncs this hour."));
  const r = await syncBacklinks({ website: ctx.website, userId: ctx.user.id, planId: ctx.org.plan_id });
  if (!r.ok) redirect(withMsg(ctx.back, "error", r.message));
  revalidatePath(ctx.back);
  redirect(withMsg(ctx.back, "saved", `${r.stored} backlinks stored from the provider.`));
}
