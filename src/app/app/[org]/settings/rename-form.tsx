"use client";

import { useActionState } from "react";
import { renameOrganizationAction } from "@/lib/actions/workspace";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

export function RenameOrgForm({ orgSlug, name, disabled }: { orgSlug: string; name: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(renameOrganizationAction, { ok: false });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <FormMessage tone={state.ok ? "success" : "error"}>{state.message}</FormMessage>
      <Field label="Organization name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" defaultValue={state.values?.name ?? name} disabled={disabled} />
      </Field>
      {!disabled && (
        <Button type="submit" loading={pending}>
          Save
        </Button>
      )}
    </form>
  );
}
