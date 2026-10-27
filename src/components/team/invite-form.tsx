"use client";

import { useActionState, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/form";
import type { ActionState } from "@/lib/validation/schemas";

type State = ActionState & { inviteUrl?: string };

export function InviteForm({ action, orgSlug, canInviteAdmins }: { action: (prev: State, fd: FormData) => Promise<State>; orgSlug: string; canInviteAdmins: boolean }) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  const [copied, setCopied] = useState(false);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <FormMessage tone={state.ok ? "success" : "error"}>{state.message}</FormMessage>
      {state.inviteUrl && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
          <code className="min-w-0 flex-1 truncate text-xs" title={state.inviteUrl}>
            {state.inviteUrl}
          </code>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(state.inviteUrl!);
              setCopied(true);
            }}
          >
            <Copy aria-hidden /> {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <Field label="Email" htmlFor="invite-email">
          <Input id="invite-email" name="email" type="email" autoComplete="off" required defaultValue={state.ok ? "" : state.values?.email} />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" name="role" defaultValue={state.values?.role ?? "member"}>
            {canInviteAdmins && <option value="admin">Admin</option>}
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </Select>
        </Field>
        <Button type="submit" loading={pending}>
          Invite
        </Button>
      </div>
      <p className="text-xs text-muted">The invited person signs in (or registers) with this email address and opens the link. Links expire after 7 days and work once.</p>
    </form>
  );
}
