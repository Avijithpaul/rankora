"use client";

import { useActionState } from "react";
import { updateCrawlSettingsAction } from "@/lib/actions/workspace";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";

export function CrawlSettingsForm({
  orgSlug,
  siteId,
  defaults,
}: {
  orgSlug: string;
  siteId: string;
  defaults: {
    maxPages: number;
    maxDepth: number;
    crawlDelayMs: number;
    respectRobotsTxt: boolean;
    checkExternalLinks: boolean;
    pagespeedEnabled: boolean;
    crawlSchedule: string;
    excludePatterns: string;
  };
}) {
  const [state, action, pending] = useActionState(updateCrawlSettingsAction, { ok: false });
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="siteId" value={siteId} />
      <FormMessage tone={state.ok ? "success" : "error"}>{state.message}</FormMessage>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Max pages" htmlFor="maxPages" error={fe.maxPages}>
          <Input id="maxPages" name="maxPages" type="number" min={1} max={10000} defaultValue={defaults.maxPages} />
        </Field>
        <Field label="Max depth" htmlFor="maxDepth" error={fe.maxDepth} hint="Clicks from the start URL">
          <Input id="maxDepth" name="maxDepth" type="number" min={0} max={20} defaultValue={defaults.maxDepth} />
        </Field>
        <Field label="Delay between requests (ms)" htmlFor="crawlDelayMs" error={fe.crawlDelayMs}>
          <Input id="crawlDelayMs" name="crawlDelayMs" type="number" min={0} max={10000} step={50} defaultValue={defaults.crawlDelayMs} />
        </Field>
      </div>
      <Field label="Schedule" htmlFor="crawlSchedule" error={fe.crawlSchedule} hint="Scheduled crawls run once the background worker is enabled (Phase 2).">
        <Select id="crawlSchedule" name="crawlSchedule" defaultValue={defaults.crawlSchedule}>
          <option value="manual">Manual only</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </Select>
      </Field>
      <Field label="Exclude URL patterns" htmlFor="excludePatterns" error={fe.excludePatterns} hint="One per line, e.g. /cart or /tag/*. Max 50.">
        <Textarea id="excludePatterns" name="excludePatterns" defaultValue={defaults.excludePatterns} rows={3} />
      </Field>
      <div className="space-y-3">
        {(
          [
            ["respectRobotsTxt", "Respect robots.txt", defaults.respectRobotsTxt],
            ["checkExternalLinks", "Check external links for errors", defaults.checkExternalLinks],
            ["pagespeedEnabled", "Fetch Core Web Vitals from PageSpeed Insights", defaults.pagespeedEnabled],
          ] as const
        ).map(([name, label, checked]) => (
          <label key={name} className="flex items-center gap-2.5 text-sm text-ink-2">
            <input type="checkbox" name={name} defaultChecked={checked} className="size-4 rounded border-line-strong accent-[var(--brand)]" />
            {label}
          </label>
        ))}
      </div>
      <Button type="submit" loading={pending}>
        Save crawl settings
      </Button>
    </form>
  );
}
