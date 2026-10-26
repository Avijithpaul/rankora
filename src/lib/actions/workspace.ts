"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, requireUser, requireWebsite } from "@/lib/auth/dal";
import { assertPublicHost, registrableDomain, UnsafeUrlError } from "@/lib/security/url-safety";
import { resolveAll } from "@/lib/security/safe-fetch";
import { recordAudit } from "@/lib/audit-log";
import { buildDemoPayload } from "@/lib/demo/generate";
import type { Json } from "@/lib/supabase/database.types";
import {
  crawlSettingsSchema,
  fieldErrorsOf,
  formValues,
  organizationSchema,
  profileSchema,
  websiteSchema,
  type ActionState,
} from "@/lib/validation/schemas";

const PG_UNIQUE = "23505";

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------
export async function createOrganizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/onboarding");
  const values = formValues(formData, ["name", "slug"]);
  const parsed = organizationSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", { p_name: parsed.data.name, p_slug: parsed.data.slug });
  if (error) {
    if (error.code === PG_UNIQUE) return { ok: false, fieldErrors: { slug: ["That URL is already taken"] }, values };
    if (error.message.includes("Organization limit")) return { ok: false, message: "You have reached the organization limit.", values };
    console.error("[org.create]", error);
    return { ok: false, message: "Could not create the organization. Please try again.", values };
  }
  redirect(`/onboarding/website?org=${encodeURIComponent(parsed.data.slug)}`);
}

export async function renameOrganizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const slug = String(formData.get("orgSlug") ?? "");
  const { org, user } = await requireOrg(slug, "admin");
  const name = String(formData.get("name") ?? "").trim();
  const parsed = organizationSchema.shape.name.safeParse(name);
  if (!parsed.success) return { ok: false, fieldErrors: { name: [parsed.error.issues[0].message] }, values: { name } };
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update({ name: parsed.data }).eq("id", org.id);
  if (error) return { ok: false, message: "Could not save changes.", values: { name } };
  await recordAudit({ organizationId: org.id, actorId: user.id, action: "organization.renamed", entityType: "organization", entityId: org.id });
  revalidatePath(`/app/${slug}`, "layout");
  return { ok: true, message: "Organization updated." };
}

// ---------------------------------------------------------------------------
// Websites
// ---------------------------------------------------------------------------
async function checkWebsiteLimit(orgId: string, planId: string) {
  const supabase = await createClient();
  const [{ data: plan }, { count }] = await Promise.all([
    supabase.from("plans").select("limits").eq("id", planId).maybeSingle(),
    supabase.from("websites").select("id", { count: "exact", head: true }).eq("organization_id", orgId).neq("status", "archived"),
  ]);
  const limit = Number((plan?.limits as Record<string, unknown> | null)?.websites ?? 1);
  return { allowed: (count ?? 0) < limit, limit };
}

function applyPreferredDomain(url: URL, preferred: "as_entered" | "www" | "non_www") {
  const u = new URL(url);
  if (preferred === "www" && !u.hostname.startsWith("www.")) u.hostname = `www.${u.hostname}`;
  if (preferred === "non_www") u.hostname = u.hostname.replace(/^www\./, "");
  return u;
}

export async function createWebsiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const fromOnboarding = formData.get("onboarding") === "1";
  const { org, user } = await requireOrg(orgSlug, "member");
  const values = formValues(formData, ["name", "url", "countryCode", "languageCode", "preferredDomain"]);
  if (org.is_demo) return { ok: false, message: "The Demo Project is read-only. Add real websites to one of your own organizations.", values };
  const parsed = websiteSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values };

  const { allowed, limit } = await checkWebsiteLimit(org.id, org.plan_id);
  if (!allowed) return { ok: false, message: `Your plan allows ${limit} website${limit === 1 ? "" : "s"}. Upgrade to add more.`, values };

  const baseUrl = applyPreferredDomain(parsed.data.url, parsed.data.preferredDomain);
  try {
    await assertPublicHost(baseUrl.hostname, resolveAll);
  } catch (e) {
    const msg = e instanceof UnsafeUrlError ? e.message : "We could not resolve that domain.";
    return { ok: false, fieldErrors: { url: [msg] }, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("websites")
    .insert({
      organization_id: org.id,
      name: parsed.data.name,
      domain: registrableDomain(baseUrl),
      base_url: baseUrl.toString(),
      preferred_domain: parsed.data.preferredDomain,
      country_code: parsed.data.countryCode,
      language_code: parsed.data.languageCode,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE) return { ok: false, fieldErrors: { url: ["This website is already in your organization"] }, values };
    console.error("[website.create]", error);
    return { ok: false, message: "Could not add the website. Please try again.", values };
  }

  await recordAudit({ organizationId: org.id, actorId: user.id, action: "website.created", entityType: "website", entityId: data.id });
  revalidatePath(`/app/${orgSlug}`, "layout");
  redirect(
    fromOnboarding
      ? `/onboarding/next-steps?org=${encodeURIComponent(orgSlug)}&site=${data.id}`
      : `/app/${orgSlug}/sites/${data.id}/dashboard`,
  );
}

export async function updateWebsiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const { org, user, website } = await requireWebsite(orgSlug, siteId, "member");
  const values = formValues(formData, ["name", "url", "countryCode", "languageCode", "preferredDomain"]);
  const parsed = websiteSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values };

  const baseUrl = applyPreferredDomain(parsed.data.url, parsed.data.preferredDomain);
  if (registrableDomain(baseUrl) !== website.domain) {
    return {
      ok: false,
      fieldErrors: { url: ["The domain can't be changed. Add a new website for a different domain."] },
      values,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("websites")
    .update({
      name: parsed.data.name,
      base_url: baseUrl.toString(),
      preferred_domain: parsed.data.preferredDomain,
      country_code: parsed.data.countryCode,
      language_code: parsed.data.languageCode,
    })
    .eq("id", website.id);
  if (error) return { ok: false, message: "Could not save changes.", values };
  await recordAudit({ organizationId: org.id, actorId: user.id, action: "website.updated", entityType: "website", entityId: website.id });
  revalidatePath(`/app/${orgSlug}`, "layout");
  return { ok: true, message: "Website settings saved." };
}

export async function updateCrawlSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const { org, website, user } = await requireWebsite(orgSlug, siteId, "member");
  const raw = {
    maxPages: formData.get("maxPages"),
    maxDepth: formData.get("maxDepth"),
    crawlDelayMs: formData.get("crawlDelayMs"),
    respectRobotsTxt: formData.get("respectRobotsTxt") === "on",
    checkExternalLinks: formData.get("checkExternalLinks") === "on",
    pagespeedEnabled: formData.get("pagespeedEnabled") === "on",
    crawlSchedule: formData.get("crawlSchedule"),
    excludePatterns: String(formData.get("excludePatterns") ?? ""),
  };
  const parsed = crawlSettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  // Enforce the plan's per-audit page cap server-side.
  const supabase = await createClient();
  const { data: plan } = await supabase.from("plans").select("limits").eq("id", org.plan_id).maybeSingle();
  const cap = Number((plan?.limits as Record<string, unknown> | null)?.crawl_pages_per_audit ?? 100);
  if (parsed.data.maxPages > cap) {
    return { ok: false, fieldErrors: { maxPages: [`Your plan allows up to ${cap} pages per audit`] } };
  }

  const { error } = await supabase
    .from("website_settings")
    .update({
      max_pages: parsed.data.maxPages,
      max_depth: parsed.data.maxDepth,
      crawl_delay_ms: parsed.data.crawlDelayMs,
      respect_robots_txt: parsed.data.respectRobotsTxt,
      check_external_links: parsed.data.checkExternalLinks,
      pagespeed_enabled: parsed.data.pagespeedEnabled,
      crawl_schedule: parsed.data.crawlSchedule,
      exclude_patterns: parsed.data.excludePatterns,
    })
    .eq("website_id", website.id);
  if (error) return { ok: false, message: "Could not save crawl settings." };
  await recordAudit({ organizationId: org.id, actorId: user.id, action: "website.crawl_settings_updated", entityType: "website", entityId: website.id });
  revalidatePath(`/app/${orgSlug}/sites/${siteId}/settings`);
  return { ok: true, message: "Crawl settings saved." };
}

export async function deleteWebsiteAction(formData: FormData) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const { org, website, user } = await requireWebsite(orgSlug, siteId, "admin");
  if (String(formData.get("confirmDomain") ?? "").trim().toLowerCase() !== website.domain) {
    redirect(`/app/${orgSlug}/sites/${siteId}/settings?error=confirm`);
  }
  const supabase = await createClient();
  const { error } = await supabase.from("websites").delete().eq("id", website.id);
  if (error) {
    console.error("[website.delete]", error);
    redirect(`/app/${orgSlug}/sites/${siteId}/settings?error=delete`);
  }
  await recordAudit({ organizationId: org.id, actorId: user.id, action: "website.deleted", entityType: "website", entityId: website.id, metadata: { domain: website.domain } });
  revalidatePath(`/app/${orgSlug}`, "layout");
  redirect(`/app/${orgSlug}/websites`);
}

export async function completeOnboardingAction(formData: FormData) {
  const user = await requireUser();
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const { website } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  await supabase.from("profiles").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", user.id);
  redirect(`/app/${orgSlug}/sites/${website.id}/dashboard`);
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const values = formValues(formData, ["fullName"]);
  const parsed = profileSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data.fullName }).eq("id", user.id);
  if (error) return { ok: false, message: "Could not save your profile.", values };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Profile saved.", values };
}

// ---------------------------------------------------------------------------
// Demo Project (sample data, always labelled "Demo Data")
// ---------------------------------------------------------------------------
export async function createDemoProjectAction() {
  await requireUser("/onboarding/demo");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_demo_project", { p_data: buildDemoPayload() as unknown as Json });
  if (error || !data) {
    console.error("[demo.create]", error);
    redirect("/onboarding/demo?error=1");
  }
  const result = data as { slug: string; website_id: string };
  revalidatePath("/app", "layout");
  redirect(`/app/${result.slug}/sites/${result.website_id}/dashboard`);
}

export async function deleteDemoProjectAction(formData: FormData) {
  const slug = String(formData.get("orgSlug") ?? "");
  const { org } = await requireOrg(slug, "owner");
  if (!org.is_demo) throw new Error("Only the Demo Project can be removed here.");
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").delete().eq("id", org.id).eq("is_demo", true);
  if (error) {
    console.error("[demo.delete]", error);
    redirect(`/app/${slug}/settings?error=delete`);
  }
  revalidatePath("/app", "layout");
  redirect("/app");
}
