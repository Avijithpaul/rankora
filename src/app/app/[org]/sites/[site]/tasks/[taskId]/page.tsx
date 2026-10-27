import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { deleteTaskAction, updateTaskAction } from "@/lib/actions/tasks";
import { listMembers } from "@/lib/org/members";
import { isOverdue, TASK_PRIORITY_LABEL, TASK_PRIORITY_TONE, TASK_STATUS_LABEL, type TaskPriority, type TaskStatus } from "@/lib/tasks/utils";
import { formatDate } from "@/lib/utils";
import { SubmitButton } from "@/components/content/submit-button";
import { TaskForm } from "@/components/tasks/task-form";
import { Badge, SeverityBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Task" };

const today = () => new Date().toISOString().slice(0, 10);

export default async function TaskPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/tasks/[taskId]">) {
  const { org: orgSlug, site: siteId, taskId } = await params;
  const sp = await searchParams;
  const { website, org, role } = await requireWebsite(orgSlug, siteId);
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) notFound();
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const { data: task } = await supabase.from("seo_tasks").select("*").eq("id", taskId).eq("website_id", website.id).maybeSingle();
  if (!task) notFound();
  const [members, { data: issue }] = await Promise.all([
    listMembers(org.id),
    task.issue_id ? supabase.from("seo_issues").select("id, title, severity, status, affected_pages_count, last_detected_at").eq("id", task.issue_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const canEdit = roleAtLeast(role, "member") && !website.is_demo;
  const nameOf = (id: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? "Former member") : "Unassigned");
  const pageHref = task.page_url ? (task.page_url.startsWith("/") ? `https://${website.domain}${task.page_url}` : task.page_url) : null;

  return (
    <>
      <Link href={`${base}/tasks`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> SEO Tasks
      </Link>
      <PageHeader
        title={task.title}
        badge={
          <>
            <Badge tone={TASK_PRIORITY_TONE[task.priority as TaskPriority]}>{TASK_PRIORITY_LABEL[task.priority as TaskPriority]}</Badge>
            <Badge>{TASK_STATUS_LABEL[task.status as TaskStatus]}</Badge>
            {isOverdue(task, today()) && <Badge tone="critical">Overdue</Badge>}
          </>
        }
        description={`${website.domain} · created ${formatDate(task.created_at)}${task.completed_at ? ` · completed ${formatDate(task.completed_at)}` : ""}`}
      />
      {typeof sp.error === "string" && (
        <div className="mb-4">
          <FormMessage>{sp.error.slice(0, 200)}</FormMessage>
        </div>
      )}
      {typeof sp.saved === "string" && (
        <div className="mb-4">
          <FormMessage tone="success">{sp.saved === "created" ? "Task created." : sp.saved.slice(0, 200)}</FormMessage>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={canEdit ? "Edit task" : "Task"} description={canEdit ? undefined : "Viewers can read tasks but not change them."} />
          <CardBody>
            <TaskForm
              action={updateTaskAction}
              hidden={{ orgSlug, siteId, taskId: task.id, back: `${base}/tasks/${task.id}` }}
              members={members}
              values={task}
              submitLabel="Save changes"
              disabled={!canEdit}
            />
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-2 text-sm">
              <p>
                <span className="text-muted">Assignee:</span> {nameOf(task.assigned_to)}
              </p>
              <p>
                <span className="text-muted">Due:</span> {task.due_date ? formatDate(task.due_date) : "No due date"}
              </p>
              <p className="break-all">
                <span className="text-muted">Page:</span>{" "}
                {pageHref ? (
                  <a href={pageHref} target="_blank" rel="noopener noreferrer nofollow" className="text-brand hover:underline">
                    {task.page_url}
                  </a>
                ) : (
                  "—"
                )}
              </p>
              <p>
                <span className="text-muted">Source:</span> {task.source === "issue" ? "Audit issue" : task.source === "recommendation" ? "Recommendation" : "Manual"}
              </p>
              <p>
                <span className="text-muted">Updated:</span> {formatDate(task.updated_at, { hour: "2-digit", minute: "2-digit" })}
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Source issue" />
            <CardBody className="text-sm">
              {issue ? (
                <>
                  <Link href={`${base}/audit/issues/${issue.id}`} className="font-medium text-brand hover:underline">
                    {issue.title}
                  </Link>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <SeverityBadge severity={issue.severity} />
                    <Badge tone={issue.status === "fixed" ? "success" : "neutral"} className="capitalize">
                      {issue.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {issue.status === "fixed"
                      ? "The latest audit no longer finds this issue — you can mark the task completed."
                      : `${issue.affected_pages_count ?? 0} affected page(s) in the latest audit.`}
                  </p>
                </>
              ) : (
                <p className="text-muted">{task.issue_id === null && task.source === "issue" ? "The source issue no longer exists." : "Created manually."}</p>
              )}
            </CardBody>
          </Card>
          {canEdit && (
            <form action={deleteTaskAction}>
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="taskId" value={task.id} />
              <SubmitButton variant="danger" size="sm">
                Delete task
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
