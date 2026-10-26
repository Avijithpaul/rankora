"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { COUNTRIES, LANGUAGES } from "@/lib/locales";
import { readKeywordImport, type ImportRow } from "@/lib/keywords/csv";
import { isValidKeyword, normalizeKeyword } from "@/lib/keywords/utils";
import { applyMetrics, refreshMetrics, researchKeywords, trackingRoom, type StoredIdea } from "@/lib/keywords/service";
import { recordAudit } from "@/lib/audit-log";

type Ctx = Awaited<ReturnType<typeof requireWebsite>>;

async function editable(formData: FormData) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const ctx = await requireWebsite(orgSlug, siteId);
  return { ...ctx, orgSlug, siteId, base: `/app/${orgSlug}/sites/${siteId}` };
}

function assertWritable(ctx: Ctx & { base: string }, back: string) {
  if (!roleAtLeast(ctx.role, "member")) redirect(`${back}${back.includes("?") ? "&" : "?"}error=role`);
  if (ctx.website.is_demo) redirect(`${back}${back.includes("?") ? "&" : "?"}error=demo`);
}

const ids = (formData: FormData, key = "ids") =>
  formData
    .getAll(key)
    .map(String)
    .filter((v) => /^[0-9a-f-]{36}$/i.test(v))
    .slice(0, 1000);

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------
const researchSchema = z.object({
  seed: z.string().trim().min(2, "Enter a seed keyword").max(80),
  countryCode: z.enum(COUNTRIES.map((c) => c.code) as [string, ...string[]]),
  languageCode: z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]),
});

export async function researchAction(formData: FormData) {
  const ctx = await editable(formData);
  const back = `${ctx.base}/keyword-research`;
  const parsed = researchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?error=invalid`);
  if (!roleAtLeast(ctx.role, "member")) redirect(`${back}?error=role`);
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("rate_limit_hit", { p_bucket: "keywords.research", p_limit: 30, p_window_seconds: 3600 });
  if (!allowed) redirect(`${back}?error=rate_limited`);
  const r = await researchKeywords({
    website: ctx.website,
    planId: ctx.org.plan_id,
    userId: ctx.user.id,
    seed: parsed.data.seed,
    market: { countryCode: parsed.data.countryCode, languageCode: parsed.data.languageCode },
  });
  if (!r.ok) redirect(`${back}?error=${r.reason}&message=${encodeURIComponent(r.message)}`);
  redirect(`${back}?q=${r.queryId}`);
}

export async function saveResearchAction(formData: FormData) {
  const ctx = await editable(formData);
  const queryId = String(formData.get("queryId") ?? "");
  const back = `${ctx.base}/keyword-research?q=${queryId}`;
  assertWritable(ctx, back);
  const chosen = formData.getAll("keyword").map((k) => normalizeKeyword(String(k))).filter(isValidKeyword).slice(0, 500);
  const track = formData.get("track") === "on";
  const groupId = String(formData.get("groupId") ?? "");
  if (chosen.length === 0) redirect(`${back}&error=none_selected`);

  const supabase = await createClient();
  // Metrics come from the server-stored provider result, never from the form.
  const { data: query } = await supabase
    .from("keyword_research_queries")
    .select("id, results, provider, country_code, language_code, created_at")
    .eq("id", queryId)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!query) redirect(`${ctx.base}/keyword-research?error=invalid`);
  const results = (query.results as unknown as StoredIdea[]) ?? [];
  const byKeyword = new Map(results.map((r) => [r.keyword, r]));
  const valid = chosen.filter((k) => byKeyword.has(k));

  if (track) {
    const room = await trackingRoom(ctx.org.id, ctx.org.plan_id);
    if (valid.length > room.room) redirect(`${back}&error=track_limit&message=${encodeURIComponent(`Your plan allows ${room.limit} tracked keywords (${room.used} in use).`)}`);
  }

  const rows = valid.map((k) => ({
    organization_id: ctx.org.id,
    website_id: ctx.website.id,
    keyword: k,
    normalized_keyword: k,
    country_code: query.country_code,
    language_code: query.language_code,
    is_tracked: track,
    created_by: ctx.user.id,
  }));
  await supabase.from("keywords").upsert(rows, { onConflict: "website_id,normalized_keyword,country_code,language_code,device,search_engine", ignoreDuplicates: true });
  const { data: saved } = await supabase
    .from("keywords")
    .select("id, normalized_keyword")
    .eq("website_id", ctx.website.id)
    .eq("country_code", query.country_code)
    .eq("language_code", query.language_code)
    .eq("device", "desktop")
    .in("normalized_keyword", valid);
  const idByKeyword = new Map((saved ?? []).map((s) => [s.normalized_keyword, s.id]));
  if (track && saved?.length) await supabase.from("keywords").update({ is_tracked: true }).in("id", saved.map((s) => s.id));
  await applyMetrics(idByKeyword, valid.map((k) => byKeyword.get(k)!), query.provider, query.created_at);
  if (groupId && saved?.length) await addToGroup(ctx.org.id, groupId, saved.map((s) => s.id));
  revalidatePath(`${ctx.base}/keywords`);
  redirect(`${ctx.base}/keywords?saved=${saved?.length ?? 0}`);
}

// ---------------------------------------------------------------------------
// Add / import / tracking / delete
// ---------------------------------------------------------------------------
async function insertKeywordRows(ctx: Ctx, rows: ImportRow[], track: boolean) {
  const supabase = await createClient();
  const payload = rows.map((r) => ({
    organization_id: ctx.org.id,
    website_id: ctx.website.id,
    keyword: r.keyword,
    normalized_keyword: r.keyword,
    country_code: r.countryCode,
    language_code: r.languageCode,
    device: r.device,
    target_url: r.targetUrl,
    is_tracked: track,
    created_by: ctx.user.id,
  }));
  const { data, error } = await supabase
    .from("keywords")
    .upsert(payload, { onConflict: "website_id,normalized_keyword,country_code,language_code,device,search_engine", ignoreDuplicates: true })
    .select("id, normalized_keyword");
  if (error) throw new Error(error.message);

  // Groups named in the import
  const groupNames = [...new Set(rows.map((r) => r.group).filter((g): g is string => Boolean(g)))];
  if (groupNames.length && data?.length) {
    await supabase
      .from("keyword_groups")
      .upsert(groupNames.map((name) => ({ organization_id: ctx.org.id, website_id: ctx.website.id, name, kind: "list" })), { onConflict: "website_id,kind,name", ignoreDuplicates: true });
    const { data: groups } = await supabase.from("keyword_groups").select("id, name").eq("website_id", ctx.website.id).eq("kind", "list").in("name", groupNames);
    const gid = new Map((groups ?? []).map((g) => [g.name, g.id]));
    const kid = new Map(data.map((d) => [d.normalized_keyword, d.id]));
    const members = rows.filter((r) => r.group && gid.has(r.group) && kid.has(r.keyword)).map((r) => ({ group_id: gid.get(r.group!)!, keyword_id: kid.get(r.keyword)!, organization_id: ctx.org.id }));
    if (members.length) await supabase.from("keyword_group_members").upsert(members, { onConflict: "group_id,keyword_id", ignoreDuplicates: true });
  }
  return data?.length ?? 0;
}

export async function addKeywordsAction(formData: FormData) {
  const ctx = await editable(formData);
  const back = String(formData.get("back") ?? `${ctx.base}/keywords`).startsWith(ctx.base) ? String(formData.get("back")) : `${ctx.base}/keywords`;
  assertWritable(ctx, back);
  const text = String(formData.get("keywords") ?? "").slice(0, 50_000);
  const track = formData.get("track") === "on";
  const device = formData.get("device") === "mobile" ? "mobile" : "desktop";
  const { rows, errors } = readKeywordImport(text.split(/\r?\n/).map((l) => `"${l.replace(/"/g, '""')}"`).join("\n"), {
    countryCode: ctx.website.country_code,
    languageCode: ctx.website.language_code,
  });
  const withDevice = rows.map((r) => ({ ...r, device: device as ImportRow["device"] }));
  if (withDevice.length === 0) redirect(`${back}${back.includes("?") ? "&" : "?"}error=none_valid`);
  if (track) {
    const room = await trackingRoom(ctx.org.id, ctx.org.plan_id);
    if (withDevice.length > room.room) redirect(`${back}${back.includes("?") ? "&" : "?"}error=track_limit&message=${encodeURIComponent(`Your plan allows ${room.limit} tracked keywords (${room.used} in use).`)}`);
  }
  const added = await insertKeywordRows(ctx, withDevice, track);
  revalidatePath(`${ctx.base}/keywords`);
  revalidatePath(`${ctx.base}/rank-tracker`);
  redirect(`${back}${back.includes("?") ? "&" : "?"}added=${added}&skipped=${errors.length + (withDevice.length - added)}`);
}

export async function importKeywordsAction(formData: FormData) {
  const ctx = await editable(formData);
  const back = `${ctx.base}/keywords`;
  assertWritable(ctx, back);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`${back}?error=no_file`);
  if (file.size > 1_000_000) redirect(`${back}?error=file_too_large`);
  const track = formData.get("track") === "on";
  const result = readKeywordImport(await file.text(), { countryCode: ctx.website.country_code, languageCode: ctx.website.language_code });
  if (result.rows.length === 0) redirect(`${back}?error=none_valid&message=${encodeURIComponent(result.errors.slice(0, 3).map((e) => `Line ${e.line}: ${e.message}`).join(" · "))}`);
  if (track) {
    const room = await trackingRoom(ctx.org.id, ctx.org.plan_id);
    if (result.rows.length > room.room) redirect(`${back}?error=track_limit&message=${encodeURIComponent(`Your plan allows ${room.limit} tracked keywords (${room.used} in use).`)}`);
  }
  const added = await insertKeywordRows(ctx, result.rows, track);
  await recordAudit({ organizationId: ctx.org.id, actorId: ctx.user.id, action: "keywords.imported", entityType: "website", entityId: ctx.website.id, metadata: { added, errors: result.errors.length } });
  revalidatePath(back);
  const msg = result.errors.length ? result.errors.slice(0, 3).map((e) => `Line ${e.line}: ${e.message}`).join(" · ") : "";
  redirect(`${back}?added=${added}&skipped=${result.errors.length + (result.rows.length - added)}${result.truncated ? "&truncated=1" : ""}${msg ? `&message=${encodeURIComponent(msg)}` : ""}`);
}

export async function bulkKeywordAction(formData: FormData) {
  const ctx = await editable(formData);
  const back = `${ctx.base}/keywords`;
  assertWritable(ctx, back);
  const selected = ids(formData);
  const op = String(formData.get("op") ?? "");
  if (selected.length === 0) redirect(`${back}?error=none_selected`);
  const supabase = await createClient();
  if (op === "track") {
    const room = await trackingRoom(ctx.org.id, ctx.org.plan_id);
    const { data: untracked } = await supabase.from("keywords").select("id").in("id", selected).eq("website_id", ctx.website.id).eq("is_tracked", false);
    if ((untracked?.length ?? 0) > room.room) redirect(`${back}?error=track_limit&message=${encodeURIComponent(`Your plan allows ${room.limit} tracked keywords (${room.used} in use).`)}`);
    await supabase.from("keywords").update({ is_tracked: true }).in("id", selected).eq("website_id", ctx.website.id);
  } else if (op === "untrack") {
    await supabase.from("keywords").update({ is_tracked: false }).in("id", selected).eq("website_id", ctx.website.id);
  } else if (op === "delete") {
    await supabase.from("keywords").delete().in("id", selected).eq("website_id", ctx.website.id);
  } else if (op === "group") {
    const groupId = String(formData.get("groupId") ?? "");
    if (groupId) await addToGroup(ctx.org.id, groupId, selected);
  } else if (op === "ungroup") {
    const groupId = String(formData.get("groupId") ?? "");
    if (groupId) await supabase.from("keyword_group_members").delete().eq("group_id", groupId).in("keyword_id", selected);
  } else if (op === "metrics") {
    const r = await refreshMetrics({ website: ctx.website, planId: ctx.org.plan_id, keywordIds: selected });
    if (!r.ok) redirect(`${back}?error=provider&message=${encodeURIComponent(r.message)}`);
  }
  revalidatePath(back);
  revalidatePath(`${ctx.base}/rank-tracker`);
  redirect(`${back}?done=${op}`);
}

async function addToGroup(orgId: string, groupId: string, keywordIds: string[]) {
  const supabase = await createClient();
  const rows = keywordIds.map((keyword_id) => ({ group_id: groupId, keyword_id, organization_id: orgId }));
  // composite FKs reject groups/keywords from another organization
  await supabase.from("keyword_group_members").upsert(rows, { onConflict: "group_id,keyword_id", ignoreDuplicates: true });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
const groupSchema = z.object({
  name: z.string().trim().min(1, "Name the group").max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
});

export async function createGroupAction(formData: FormData) {
  const ctx = await editable(formData);
  const back = `${ctx.base}/keywords`;
  assertWritable(ctx, back);
  const parsed = groupSchema.safeParse({ name: formData.get("name"), color: formData.get("color") ?? "" });
  if (!parsed.success) redirect(`${back}?error=group_name`);
  const supabase = await createClient();
  const { error } = await supabase.from("keyword_groups").insert({
    organization_id: ctx.org.id,
    website_id: ctx.website.id,
    name: parsed.data.name,
    kind: "list",
    color: parsed.data.color || null,
  });
  if (error) redirect(`${back}?error=${error.code === "23505" ? "group_exists" : "group_name"}`);
  revalidatePath(back);
  redirect(back);
}

export async function deleteGroupAction(formData: FormData) {
  const ctx = await editable(formData);
  const back = `${ctx.base}/keywords`;
  assertWritable(ctx, back);
  const groupId = String(formData.get("groupId") ?? "");
  const supabase = await createClient();
  await supabase.from("keyword_groups").delete().eq("id", groupId).eq("website_id", ctx.website.id);
  revalidatePath(back);
  redirect(back);
}

// ---------------------------------------------------------------------------
// Single keyword
// ---------------------------------------------------------------------------
export async function updateKeywordAction(formData: FormData) {
  const ctx = await editable(formData);
  const keywordId = String(formData.get("keywordId") ?? "");
  const back = `${ctx.base}/keywords/${keywordId}`;
  assertWritable(ctx, back);
  const target = String(formData.get("targetUrl") ?? "").trim();
  let targetUrl: string | null = null;
  if (target) {
    try {
      const u = new URL(target);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      targetUrl = u.toString().slice(0, 2048);
    } catch {
      redirect(`${back}?error=target_url`);
    }
  }
  const notes = String(formData.get("notes") ?? "").slice(0, 2000) || null;
  const supabase = await createClient();
  const { error } = await supabase.from("keywords").update({ target_url: targetUrl, notes }).eq("id", keywordId).eq("website_id", ctx.website.id);
  if (error) redirect(`${back}?error=save`);
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}
