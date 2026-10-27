import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, ListChecks, Plus } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createTaskAction, setTaskStatusAction } from "@/lib/actions/tasks";
import { listMembers } from "@/lib/org/members";
import { completionRate, isOverdue, TASK_PRIORITY_LABEL, TASK_PRIORITY_TONE as PRIORITY_TONE, TASK_STATUS_LABEL, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/tasks/utils";
import { cn, formatDate } from "@/lib/utils";
import { TaskForm } from "@/components/tasks/task-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "SEO Tasks" };

const COLUMN_TONE: Record<TaskStatus, string> = { todo: "bg-surface-2", in_progress: "bg-brand-soft/50", completed: "bg-success-soft/50", ignored: "bg-surface-2/60" };
const NEXT: Record<TaskStatus, TaskStatus[]> = { todo: ["in_progress", "completed", "ignored"], in_progress: ["completed", "todo"], completed: ["todo"], ignored: ["todo"] };

const today = () => new Date().toISOString().slice(0, 10);

export default async function TasksPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/tasks">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, org, role, user } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const assignee = typeof sp.assignee === "string" ? sp.assignee : "all";
  const priority = typeof sp.priority === "string" && sp.priority in TASK_PRIORITY_LABEL ? sp.priority : "all";

  let query = supabase
    .from("seo_tasks")
    .select("id, title, priority, status, assigned_to, due_date, page_url, issue_id, source, updated_at, seo_issues(status)")
    .eq("website_id", website.id)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (assignee === "me") query = query.eq("assigned_to", user.id);
  else if (assignee === "none") query = query.is("assigned_to", null);
  if (priority !== "all") query = query.eq("priority", priority as TaskPriority);
  const [{ data: tasks }, { data: stats }, members] = await Promise.all([query, supabase.rpc("task_stats", { p_org: org.id, p_site: website.id }), listMembers(org.id)]);
  const s = stats?.[0] ?? { todo: 0, in_progress: 0, completed: 0, ignored: 0, overdue: 0, completed_30d: 0, due_7d: 0 };
  const rate = completionRate({ todo: Number(s.todo), in_progress: Number(s.in_progress), completed: Number(s.completed) });
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const canEdit = roleAtLeast(role, "member") && !website.is_demo;
  const day = today();
  const back = `${base}/tasks?${new URLSearchParams({ assignee, priority })}`;

  return (
    <>
      <PageHeader title="SEO Tasks" description="Turn audit issues into assignable work. Tasks track your team's progress; they do not change your website." />
      {typeof sp.error === "string" && (
        <div className="mb-4">
          <FormMessage>{sp.error.slice(0, 200)}</FormMessage>
        </div>
      )}
      {typeof sp.saved === "string" && (
        <div className="mb-4">
          <FormMessage tone="success">{sp.saved.slice(0, 200)}</FormMessage>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="To Do" value={Number(s.todo)} />
        <StatCard label="In Progress" value={Number(s.in_progress)} />
        <StatCard label="Completed" value={Number(s.completed)} hint="Ignored tasks are excluded from the completion rate." footer={rate === null ? undefined : `${Math.round(rate * 100)}% complete`} />
        <StatCard label="Overdue" value={<span className={cn(Number(s.overdue) > 0 && "text-critical")}>{Number(s.overdue)}</span>} />
        <StatCard label="Due in 7 days" value={Number(s.due_7d)} />
      </div>

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 p-3 text-sm" role="search">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Assignee</span>
            <Select name="assignee" defaultValue={assignee}>
              <option value="all">Everyone</option>
              <option value="me">Assigned to me</option>
              <option value="none">Unassigned</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Priority</span>
            <Select name="priority" defaultValue={priority}>
              <option value="all">Any priority</option>
              {Object.entries(TASK_PRIORITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </label>
          <button className="h-10 rounded-lg border border-line-strong bg-surface px-4 font-medium text-ink-2 hover:bg-surface-2">Apply</button>
          <Link href={`${base}/audit`} className="ml-auto self-center text-brand hover:underline">
            Create tasks from audit issues →
          </Link>
        </form>
      </Card>

      {!tasks?.length && assignee === "all" && priority === "all" ? (
        <Card className="mb-4">
          <EmptyState
            icon={ListChecks}
            title="No tasks yet"
            description={website.is_demo ? "The Demo Project is read-only." : "Open an issue in Site Audit and click Create task, or add a task below."}
          />
        </Card>
      ) : (
        <div className="mb-4 grid gap-3 lg:grid-cols-4">
          {TASK_STATUSES.map((status) => {
            const col = (tasks ?? []).filter((t) => t.status === status);
            return (
              <section key={status} aria-label={TASK_STATUS_LABEL[status]} className={cn("rounded-[var(--radius-card)] p-2", COLUMN_TONE[status])}>
                <h2 className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold text-ink">
                  {TASK_STATUS_LABEL[status]} <span className="tabular text-xs font-normal text-muted">{col.length}</span>
                </h2>
                <ul className="space-y-2">
                  {col.map((t) => {
                    const overdue = isOverdue(t, day);
                    const issueStatus = (t.seo_issues as unknown as { status: string } | null)?.status;
                    return (
                      <li key={t.id} className="rounded-lg border border-line bg-surface p-3 text-sm shadow-sm">
                        <Link href={`${base}/tasks/${t.id}`} className="font-medium text-ink hover:text-brand">
                          {t.title}
                        </Link>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                          <Badge tone={PRIORITY_TONE[t.priority as TaskPriority]}>{TASK_PRIORITY_LABEL[t.priority as TaskPriority]}</Badge>
                          {t.source === "issue" && <Badge tone={issueStatus === "fixed" ? "success" : "neutral"}>{issueStatus === "fixed" ? "Issue fixed" : "From audit"}</Badge>}
                          {t.due_date && (
                            <span className={cn("inline-flex items-center gap-1", overdue ? "font-medium text-critical" : "text-muted")}>
                              <CalendarClock className="size-3.5" aria-hidden /> {formatDate(t.due_date)}
                              {overdue && " · overdue"}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 truncate text-xs text-muted">{t.assigned_to ? nameOf.get(t.assigned_to) ?? "Former member" : "Unassigned"}</div>
                        {canEdit && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {NEXT[status].map((to) => (
                              <form key={to} action={setTaskStatusAction}>
                                <input type="hidden" name="orgSlug" value={orgSlug} />
                                <input type="hidden" name="siteId" value={siteId} />
                                <input type="hidden" name="taskId" value={t.id} />
                                <input type="hidden" name="status" value={to} />
                                <input type="hidden" name="back" value={back} />
                                <button className="rounded-md border border-line-strong px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2">→ {TASK_STATUS_LABEL[to]}</button>
                              </form>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {col.length === 0 && <li className="px-2 py-3 text-xs text-muted">No tasks</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {canEdit && (
        <Card id="new">
          <CardHeader title={<span className="inline-flex items-center gap-2"><Plus className="size-4" aria-hidden /> New task</span>} />
          <CardBody>
            <TaskForm action={createTaskAction} hidden={{ orgSlug, siteId, back: `${base}/tasks` }} members={members} submitLabel="Create task" />
          </CardBody>
        </Card>
      )}
    </>
  );
}
