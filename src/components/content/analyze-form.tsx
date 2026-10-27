"use client";

import { useActionState, useState } from "react";
import { FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/validation/schemas";

export function AnalyzeForm({
  action,
  orgSlug,
  siteId,
  domain,
  defaults,
  disabledReason,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  orgSlug: string;
  siteId: string;
  domain: string;
  defaults: { keyword?: string; url?: string };
  disabledReason?: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  const v: Record<string, string | undefined> = { ...defaults, ...state.values };
  const [mode, setMode] = useState<"url" | "draft">(v.mode === "draft" ? "draft" : "url");
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="mode" value={mode} />
      <FormMessage>{state.message}</FormMessage>

      <div role="radiogroup" aria-label="What to analyze" className="grid gap-2 sm:grid-cols-2">
        {(
          [
            { id: "url", icon: Link2, title: "Published page", text: `Fetch a URL on ${domain}` },
            { id: "draft", icon: FileText, title: "Draft", text: "Paste Markdown, HTML or plain text" },
          ] as const
        ).map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={mode === o.id}
            onClick={() => setMode(o.id)}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              mode === o.id ? "border-brand bg-brand-soft/60 ring-1 ring-brand/30" : "border-line-strong hover:bg-surface-2",
            )}
          >
            <o.icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-ink">{o.title}</span>
              <span className="block text-xs text-muted">{o.text}</span>
            </span>
          </button>
        ))}
      </div>

      <Field label="Target keyword" htmlFor="keyword" error={fe.keyword} hint="The search phrase this page should rank for.">
        <Input id="keyword" name="keyword" defaultValue={v.keyword} placeholder="e.g. waterproof hiking boots" required maxLength={120} aria-invalid={Boolean(fe.keyword)} />
      </Field>

      {mode === "url" ? (
        <Field label="Page URL" htmlFor="url" error={fe.url} hint={`Must be a page on ${domain}. Fetched once by RankoraBot.`}>
          <Input id="url" name="url" inputMode="url" defaultValue={v.url} placeholder={`https://${domain}/…`} required aria-invalid={Boolean(fe.url)} />
        </Field>
      ) : (
        <>
          <Field label="Title tag (optional)" htmlFor="title" error={fe.title}>
            <Input id="title" name="title" defaultValue={v.title} maxLength={300} />
          </Field>
          <Field label="Meta description (optional)" htmlFor="metaDescription" error={fe.metaDescription}>
            <Textarea id="metaDescription" name="metaDescription" rows={2} defaultValue={v.metaDescription} maxLength={500} />
          </Field>
          <Field label="Draft content" htmlFor="body" error={fe.body} hint="Use # for headings in Markdown, or paste HTML. Up to 100,000 characters.">
            <Textarea id="body" name="body" rows={14} defaultValue={v.body} className="font-mono text-xs" aria-invalid={Boolean(fe.body)} />
          </Field>
        </>
      )}

      <details className="rounded-lg border border-line p-3" open={Boolean(v.terms)}>
        <summary className="cursor-pointer text-sm font-medium text-ink-2">Related terms to check (optional)</summary>
        <p className="mt-2 text-xs text-muted">
          Rankora also uses your saved keywords and real Search Console queries that share words with the target keyword. Add your own terms here,
          one per line or comma separated.
        </p>
        <Textarea name="terms" rows={3} defaultValue={v.terms} className="mt-2" maxLength={4000} aria-label="Related terms" />
      </details>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending} disabled={Boolean(disabledReason)}>
          {pending ? "Analyzing…" : "Analyze content"}
        </Button>
        {disabledReason && <span className="text-sm text-muted">{disabledReason}</span>}
      </div>
    </form>
  );
}
