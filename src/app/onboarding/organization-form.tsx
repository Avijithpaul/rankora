"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { createOrganizationAction } from "@/lib/actions/workspace";
import { slugify } from "@/lib/utils";

export function OrganizationForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, { ok: false });
  const [name, setName] = useState(state.values?.name ?? "");
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(false);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage>{state.message}</FormMessage>
      <Field label="Organization name" htmlFor="name" error={fe.name} hint="Your company, agency or project.">
        <Input
          id="name"
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
          placeholder="Acme Inc."
          required
          aria-invalid={Boolean(fe.name)}
        />
      </Field>
      <Field label="Workspace URL" htmlFor="slug" error={fe.slug}>
        <div className="flex items-center rounded-lg border border-line-strong bg-surface-2 pl-3 text-sm text-muted focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
          <span className="shrink-0">rankora.app/app/</span>
          <input
            id="slug"
            name="slug"
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
            className="h-10 w-full rounded-r-lg bg-surface px-2 text-ink focus:outline-none"
            required
            aria-invalid={Boolean(fe.slug)}
          />
        </div>
      </Field>
      <Button type="submit" loading={pending}>
        Continue
      </Button>
    </form>
  );
}
