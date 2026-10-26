"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/lib/actions/workspace";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

export function ProfileForm({ fullName, email }: { fullName: string; email: string | null }) {
  const [state, action, pending] = useActionState(updateProfileAction, { ok: false });
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage tone={state.ok ? "success" : "error"}>{state.message}</FormMessage>
      <Field label="Full name" htmlFor="fullName" error={fe.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" defaultValue={state.values?.fullName ?? fullName} aria-invalid={Boolean(fe.fullName)} />
      </Field>
      <Field label="Email" htmlFor="email" hint="Email changes are not available yet.">
        <Input id="email" value={email ?? ""} disabled readOnly />
      </Field>
      <Button type="submit" loading={pending}>
        Save profile
      </Button>
    </form>
  );
}
