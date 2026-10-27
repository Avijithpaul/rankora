/** SEO task helpers shared by actions, pages and the dashboard. Pure. */
import { z } from "zod";

export const TASK_STATUSES = ["todo", "in_progress", "completed", "ignored"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: "To Do", in_progress: "In Progress", completed: "Completed", ignored: "Ignored" };

export const TASK_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** Default priority for a task created from an audit issue. */
export function priorityFromSeverity(severity: string): TaskPriority {
  return severity === "critical" ? "critical" : severity === "warning" ? "medium" : "low";
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const uuidOrEmpty = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid().nullable());

const dateOrEmpty = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.iso.date({ message: "Use a valid date" }).nullable());

const pageUrl = z
  .string()
  .trim()
  .max(2048)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\//i.test(v) || v.startsWith("/"), "Enter a full URL or a path starting with /");

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(200),
  notes: optionalText(5000),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  assignedTo: uuidOrEmpty,
  dueDate: dateOrEmpty,
  pageUrl,
});

export type TaskInput = z.infer<typeof taskSchema>;

export function isOverdue(task: { status: string; due_date: string | null }, today: string): boolean {
  return (task.status === "todo" || task.status === "in_progress") && task.due_date !== null && task.due_date < today;
}

export interface TaskStats {
  todo: number;
  in_progress: number;
  completed: number;
  ignored: number;
  overdue: number;
  completed_30d: number;
  due_7d: number;
}

/** Completion rate over tasks that are not ignored; null when there are none. */
export function completionRate(s: Pick<TaskStats, "todo" | "in_progress" | "completed">): number | null {
  const total = s.todo + s.in_progress + s.completed;
  return total ? Math.round((s.completed / total) * 1000) / 1000 : null;
}

export const TASK_PRIORITY_TONE = { critical: "critical", high: "warning", medium: "brand", low: "neutral" } as const satisfies Record<TaskPriority, string>;
