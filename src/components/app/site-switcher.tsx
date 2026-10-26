"use client";

import { usePathname, useRouter } from "next/navigation";
import { Globe } from "lucide-react";

type Site = { id: string; name: string; domain: string; is_demo: boolean };

/** Website selector in the top navigation. Switching keeps the current module. */
export function SiteSwitcher({ orgSlug, sites, canAdd = true }: { orgSlug: string; sites: Site[]; canAdd?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const match = pathname.match(/\/app\/[^/]+\/sites\/([0-9a-f-]{36})(?:\/([^/]+))?/i);
  const current = match?.[1] ?? "";
  const moduleSlug = match?.[2] ?? "dashboard";

  if (sites.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Globe className="hidden size-4 shrink-0 text-muted sm:block" aria-hidden />
      <label htmlFor="site-switch" className="sr-only">
        Website
      </label>
      <select
        id="site-switch"
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          router.push(v === "__new" ? `/app/${orgSlug}/websites/new` : `/app/${orgSlug}/sites/${v}/${moduleSlug}`);
        }}
        className="h-9 min-w-0 max-w-[14rem] truncate rounded-lg border border-line-strong bg-surface px-2 pr-7 text-sm font-medium text-ink shadow-xs focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:max-w-xs"
      >
        {!current && (
          <option value="" disabled>
            Select a website…
          </option>
        )}
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.is_demo ? `${s.name} · Demo` : `${s.name} · ${s.domain}`}
          </option>
        ))}
        {canAdd && <option value="__new">+ Add website</option>}
      </select>
    </div>
  );
}
