"use client";

import { useActionState, useEffect, useRef } from "react";
import { PENDING_SITE_KEY } from "@/components/marketing/hero-audit-form";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/form";
import { COUNTRIES, LANGUAGES } from "@/lib/locales";
import type { ActionState } from "@/lib/validation/schemas";

type Defaults = Partial<Record<"name" | "url" | "countryCode" | "languageCode" | "preferredDomain", string>>;

export function WebsiteForm({
  action,
  orgSlug,
  siteId,
  defaults = {},
  submitLabel = "Add website",
  onboarding = false,
  lockUrlHost = false,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  orgSlug: string;
  siteId?: string;
  defaults?: Defaults;
  submitLabel?: string;
  onboarding?: boolean;
  lockUrlHost?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  const urlRef = useRef<HTMLInputElement>(null);
  // A site typed on the landing page before sign-up pre-fills a NEW website (never overwrites).
  useEffect(() => {
    if (siteId || !urlRef.current || urlRef.current.value) return;
    try {
      const pending = localStorage.getItem(PENDING_SITE_KEY);
      if (pending) urlRef.current.value = pending;
    } catch {
      /* storage unavailable */
    }
  }, [siteId]);
  const fe = state.fieldErrors ?? {};
  const v = { ...defaults, ...state.values };
  return (
    <form
      action={formAction}
      className="space-y-5"
      noValidate
      onSubmit={() => {
        try {
          localStorage.removeItem(PENDING_SITE_KEY);
        } catch {
          /* ignore */
        }
      }}
    >
      <input type="hidden" name="orgSlug" value={orgSlug} />
      {siteId && <input type="hidden" name="siteId" value={siteId} />}
      {onboarding && <input type="hidden" name="onboarding" value="1" />}
      <FormMessage tone={state.ok ? "success" : "error"}>{state.message}</FormMessage>

      <Field
        label="Website URL"
        htmlFor="url"
        error={fe.url}
        hint={lockUrlHost ? "You can change the protocol or start path, not the domain." : "e.g. https://www.example.com"}
      >
        <Input ref={urlRef} id="url" name="url" inputMode="url" placeholder="https://example.com" defaultValue={v.url} required aria-invalid={Boolean(fe.url)} />
      </Field>
      <Field label="Display name" htmlFor="name" error={fe.name}>
        <Input id="name" name="name" placeholder="Marketing site" defaultValue={v.name} required aria-invalid={Boolean(fe.name)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Target country" htmlFor="countryCode" error={fe.countryCode} hint="Used for rankings and keyword data.">
          <Select id="countryCode" name="countryCode" defaultValue={v.countryCode ?? "US"}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Language" htmlFor="languageCode" error={fe.languageCode}>
          <Select id="languageCode" name="languageCode" defaultValue={v.languageCode ?? "en"}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Preferred domain" htmlFor="preferredDomain" error={fe.preferredDomain} hint="Which host version should be treated as canonical.">
        <Select id="preferredDomain" name="preferredDomain" defaultValue={v.preferredDomain ?? "as_entered"}>
          <option value="as_entered">As entered</option>
          <option value="www">Always www.</option>
          <option value="non_www">Never www.</option>
        </Select>
      </Field>
      <Button type="submit" loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
