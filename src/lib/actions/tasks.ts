"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { priorityFromSeverity, taskSchema } from "@/lib/tasks/utils";

const UUID = /^[0-9a-f-]{36}$/i;
const msg = (back: string, key: "error" | "saved", text: string) => `${back}${back.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`;

/** Only internal back-links into this site's module pages are honoured. */
function backTo(formData: FormData, base: string, fallback: string) {
  const b = String(formData.get("back") ?? "");
  return b.startsWith(`${base}/`) && !b.includes("//", 1) && !/[\r\n]/.test(b) ? b : fallback;
}

async function ctxFrom(formData: FormData) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const ctx = await requireWebsite(orgSlug, siteId);
  const base = `/app/${orgSlug}/sites/${siteId}`;
  return { ...ctx, base };
}

function assertEditor(ctx: Awaited<ReturnType<typeof ctxFrom>>, back: string) {
  if (!roleAtLeast(ctx.role, "member")) redirect(msg(back, "error", "Viewers cannot change tasks."));
  if (ctx.website.is_demo) redirect(msg(back, "error", "The Demo Project is read-only."));
}

function friendly(error: { message: string; code?: string } | null) {
  if (!error) return null;
  if (error.code === "23505" || /seo_tasks_open_issue_idx/.test(error.message)) return "This issue already has an open task.";
  if (/not a member/.test(error.message)) return "The assignee is not a member of this organization.";
  if (/does not belong/.test(error.message)) return "That issue belongs to another website.";
  return "The task could not be saved.";
}

export async function createTaskAction(formData: FormData) {
  const ctx = await ctxFrom(formData);
  const back = backTo(formData, ctx.base, `${ctx.base}/tasks`);
  assertEditor(ctx, back);
  const parsed = taskSchema.safeParse(Object.fromEntries(["title", "notes", "priority", "status", "assignedTo", "dueDate", "pageUrl"].map((k) => [k, formData.get(k) ?? undefined])));
  if (!parsed.success) redirect(msg(back, "error", parsed.error.issues[0]?.message ?? "Invalid task"));
  const issueId = String(formData.get("issueId") ?? "");
  const supabase = await createClient();
  const t = parsed.data;
  const { data, error } = await supabase
    .from("seo_tasks")
    .insert({
      organization_id: ctx.org.id,
      website_id: ctx.website.id,
      issue_id: UUID.test(issueId) ? issueId : null,
      source: UUID.test(issueId) ? "issue" : "manual",
      title: t.title,
      notes: t.notes,
      priority: t.priority,
      status: t.status,
      assigned_to: t.assignedTo,
      due_date: t.dueDate,
      page_url: t.pageUrl,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  const problem = friendly(error);
  if (problem || !data) redirect(msg(back, "error", problem ?? "The task could not be saved."));
  revalidatePath(`${ctx.base}/tasks`);
  redirect(`${ctx.base}/tasks/${data.id}?saved=created`);
}

/** One click from an audit issue: title, priority, page and notes come from the stored issue. */
export async function createTasksFromIssuesAction(formData: FormData) {
  const ctx = await ctxFrom(formData);
  const back = backTo(formData, ctx.base, `${ctx.base}/audit`);
  assertEditor(ctx, back);
  const ids = formData.getAll("issueId").map(String).filter((v) => UUID.test(v)).slice(0, 200);
  if (!ids.length) redirect(msg(back, "error", "Select at least one issue."));
  const supabase = await createClient();
  // RLS + website filter: only this website's issues
  const { data: issues } = await supabase.from("seo_issues").select("id, title, severity, recommendation, status").eq("website_id", ctx.website.id).in("id", ids);
  const { data: open } = await supabase.from("seo_tasks").select("issue_id").eq("website_id", ctx.website.id).in("issue_id", ids).in("status", ["todo", "in_progress"]);
  const taken = new Set((open ?? []).map((t) => t.issue_id));
  const fresh = (issues ?? []).filter((i) => !taken.has(i.id));
  const { data: pages } = fresh.length ? await supabase.from("seo_issue_pages").select("issue_id, url").in("issue_id", fresh.map((i) => i.id)) : { data: [] as { issue_id: string; url: string }[] };
  const pagesOf = new Map<string, string[]>();
  for (const p of pages ?? []) pagesOf.set(p.issue_id, [...(pagesOf.get(p.issue_id) ?? []), p.url]);
  const rows = fresh.map((i) => {
    const urls = pagesOf.get(i.id) ?? [];
    return {
      organization_id: ctx.org.id,
      website_id: ctx.website.id,
      issue_id: i.id,
      source: "issue" as const,
      title: i.title.slice(0, 200),
      priority: priorityFromSeverity(i.severity),
      status: "todo" as const,
      page_url: urls.length === 1 ? urls[0].slice(0, 2048) : null,
      notes: [i.recommendation, urls.length > 1 ? `Affected pages: ${urls.length} (see the issue).` : null].filter(Boolean).join("\n\n").slice(0, 5000) || null,
      created_by: ctx.user.id,
    };
  });
  if (rows.length) {
    const { error } = await supabase.from("seo_tasks").insert(rows);
    const problem = friendly(error);
    if (problem) redirect(msg(back, "error", problem));
  }
  revalidatePath(`${ctx.base}/tasks`);
  revalidatePath(`${ctx.base}/audit`);
  const skipped = ids.length - rows.length;
  redirect(msg(back, "saved", `${rows.length} task${rows.length === 1 ? "" : "s"} created${skipped ? `, ${skipped} skipped (already has an open task)` : ""}.`));
}

export async function updateTaskAction(formData: FormData) {
  const ctx = await ctxFrom(formData);
  const id = String(formData.get("taskId") ?? "");
  const back = backTo(formData, ctx.base, `${ctx.base}/tasks/${id}`);
  if (!UUID.test(id)) redirect(`${ctx.base}/tasks`);
  assertEditor(ctx, back);
  const parsed = taskSchema.safeParse(Object.fromEntries(["title", "notes", "priority", "status", "assignedTo", "dueDate", "pageUrl"].map((k) => [k, formData.get(k) ?? undefined])));
  if (!parsed.success) redirect(msg(back, "error", parsed.error.issues[0]?.message ?? "Invalid task"));
  const t = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seo_tasks")
    .update({ title: t.title, notes: t.notes, priority: t.priority, status: t.status, assigned_to: t.assignedTo, due_date: t.dueDate, page_url: t.pageUrl })
    .eq("id", id)
    .eq("website_id", ctx.website.id)
    .select("id");
  const problem = friendly(error) ?? (data?.length ? null : "Task not found.");
  if (problem) redirect(msg(back, "error", problem));
  revalidatePath(`${ctx.base}/tasks`);
  redirect(msg(back, "saved", "Task saved."));
}

/** Quick status change from the board. */
export async function setTaskStatusAction(formData: FormData) {
  const ctx = await ctxFrom(formData);
  const id = String(formData.get("taskId") ?? "");
  const status = String(formData.get("status") ?? "");
  const back = backTo(formData, ctx.base, `${ctx.base}/tasks`);
  assertEditor(ctx, back);
  if (!UUID.test(id) || !["todo", "in_progress", "completed", "ignored"].includes(status)) redirect(msg(back, "error", "Invalid status."));
  const supabase = await createClient();
  await supabase.from("seo_tasks").update({ status: status as "todo" }).eq("id", id).eq("website_id", ctx.website.id);
  revalidatePath(`${ctx.base}/tasks`);
  redirect(back);
}

export async function deleteTaskAction(formData: FormData) {
  const ctx = await ctxFrom(formData);
  const id = String(formData.get("taskId") ?? "");
  assertEditor(ctx, `${ctx.base}/tasks/${id}`);
  const supabase = await createClient();
  if (UUID.test(id)) await supabase.from("seo_tasks").delete().eq("id", id).eq("website_id", ctx.website.id);
  revalidatePath(`${ctx.base}/tasks`);
  redirect(msg(`${ctx.base}/tasks`, "saved", "Task deleted."));
}
