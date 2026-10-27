import Link from "next/link";
import { ListChecks } from "lucide-react";
import { completionRate, isOverdue, TASK_PRIORITY_LABEL, TASK_PRIORITY_TONE, TASK_STATUS_LABEL, type TaskPriority, type TaskStats, type TaskStatus } from "@/lib/tasks/utils";
import { cn, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

const SEGMENTS: { key: TaskStatus; cls: string }[] = [
  { key: "completed", cls: "bg-success" },
  { key: "in_progress", cls: "bg-brand" },
  { key: "todo", cls: "bg-line-strong" },
];

/** Dashboard card: real task counts for one website, with the next open tasks. */
export function TaskProgress({
  stats,
  upcoming,
  href,
  today,
}: {
  stats: TaskStats;
  upcoming: { id: string; title: string; priority: string; status: string; due_date: string | null }[];
  href: string;
  today: string;
}) {
  const active = stats.todo + stats.in_progress + stats.completed;
  const rate = completionRate(stats);
  return (
    <Card>
      <CardHeader title="SEO task progress" action={<Link href={href} className="text-sm text-brand hover:underline">Open board</Link>} />
      {active + stats.ignored === 0 ? (
        <EmptyState icon={ListChecks} title="No tasks yet" description="Create tasks from audit issues to track fixes here." className="py-8" />
      ) : (
        <CardBody className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-2xl font-semibold text-ink">{rate === null ? "—" : `${Math.round(rate * 100)}%`}</span>
              <span className="text-muted">
                {stats.completed} of {active} completed{stats.ignored ? ` · ${stats.ignored} ignored` : ""}
              </span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${stats.completed} completed, ${stats.in_progress} in progress, ${stats.todo} to do`}>
              {active > 0 && SEGMENTS.map((s) => <div key={s.key} className={s.cls} style={{ width: `${(stats[s.key] / active) * 100}%` }} />)}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
              {SEGMENTS.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1">
                  <span className={cn("size-2 rounded-full", s.cls)} aria-hidden /> {TASK_STATUS_LABEL[s.key]} {stats[s.key]}
                </span>
              ))}
              {stats.overdue > 0 && <span className="font-medium text-critical">{stats.overdue} overdue</span>}
              <span>{stats.completed_30d} completed in 30 days</span>
            </div>
          </div>
          {upcoming.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {upcoming.map((t) => (
                <li key={t.id}>
                  <Link href={`${href}/${t.id}`} className="flex items-center gap-2 py-2 text-sm hover:text-brand">
                    <Badge tone={TASK_PRIORITY_TONE[t.priority as TaskPriority]}>{TASK_PRIORITY_LABEL[t.priority as TaskPriority]}</Badge>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.due_date && <span className={cn("shrink-0 text-xs", isOverdue(t, today) ? "text-critical" : "text-muted")}>{formatDate(t.due_date)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      )}
    </Card>
  );
}
