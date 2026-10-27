import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/content/submit-button";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from "@/lib/tasks/utils";
import type { Member } from "@/lib/org/members";

export interface TaskFormValues {
  title?: string;
  notes?: string | null;
  priority?: string;
  status?: string;
  assigned_to?: string | null;
  due_date?: string | null;
  page_url?: string | null;
}

/** Server-rendered task form used for both create and edit. */
export function TaskForm({
  action,
  hidden,
  members,
  values = {},
  submitLabel,
  disabled,
}: {
  action: (fd: FormData) => Promise<void>;
  hidden: Record<string, string>;
  members: Member[];
  values?: TaskFormValues;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <form action={action} className="space-y-4">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <fieldset disabled={disabled} className="space-y-4">
        <Field label="Title" htmlFor="title">
          <Input id="title" name="title" required maxLength={200} defaultValue={values.title} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority" htmlFor="priority">
            <Select id="priority" name="priority" defaultValue={values.priority ?? "medium"}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={values.status ?? "todo"}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assignee" htmlFor="assignedTo">
            <Select id="assignedTo" name="assignedTo" defaultValue={values.assigned_to ?? ""}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" htmlFor="dueDate">
            <Input id="dueDate" name="dueDate" type="date" defaultValue={values.due_date ?? ""} />
          </Field>
        </div>
        <Field label="Page (optional)" htmlFor="pageUrl" hint="Full URL or a path such as /pricing">
          <Input id="pageUrl" name="pageUrl" maxLength={2048} defaultValue={values.page_url ?? ""} />
        </Field>
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" name="notes" rows={5} maxLength={5000} defaultValue={values.notes ?? ""} />
        </Field>
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </fieldset>
    </form>
  );
}
