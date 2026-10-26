"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Bookmark,
  Building2,
  CreditCard,
  FileBarChart,
  FileText,
  Globe,
  LayoutDashboard,
  LineChart,
  Link2,
  ListChecks,
  Menu,
  PenLine,
  Plug,
  ScanSearch,
  Search,
  Settings2,
  Shield,
  Swords,
  TrendingUp,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ORG_NAV, SITE_MODULES } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  BarChart3,
  Bookmark,
  Building2,
  CreditCard,
  FileBarChart,
  FileText,
  Globe,
  LayoutDashboard,
  LineChart,
  Link2,
  ListChecks,
  PenLine,
  Plug,
  ScanSearch,
  Search,
  Settings2,
  Swords,
  TrendingUp,
  Wrench,
};

type Site = { id: string; name: string; domain: string; is_demo: boolean };

export function AppSidebar({
  orgSlug,
  orgName,
  orgs,
  sites,
  isPlatformAdmin,
  hasDemo,
}: {
  orgSlug: string;
  orgName: string;
  orgs: { slug: string; name: string }[];
  sites: Site[];
  isPlatformAdmin: boolean;
  hasDemo: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // The drawer closes automatically on navigation: it is open only for the path it was opened on.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const setOpen = (v: boolean) => setOpenFor(v ? pathname : null);
  const match = pathname.match(/\/app\/[^/]+\/sites\/([0-9a-f-]{36})/i);
  const activeSiteId = match?.[1] ?? null;
  const siteId = activeSiteId ?? sites[0]?.id ?? null;
  const siteBase = siteId ? `/app/${orgSlug}/sites/${siteId}` : null;

  const groups = ["Overview", "Research", "Optimize", "Manage"] as const;

  const nav = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto px-3 pb-6 pt-4 text-sm" aria-label="Main">
      <div className="space-y-2 px-1">
        <label htmlFor="org-switch" className="sr-only">
          Organization
        </label>
        <select
          id="org-switch"
          value={orgSlug}
          onChange={(e) => {
            const v = e.target.value;
            router.push(v === "__new" ? "/onboarding?new=1" : v === "__demo" ? "/onboarding/demo" : `/app/${v}`);
          }}
          className="h-9 w-full rounded-lg border border-white/10 bg-sidebar-2 px-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-brand"
        >
          {orgs.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.name}
            </option>
          ))}
          <option value="__new">+ New organization</option>
          {!hasDemo && <option value="__demo">+ Open Demo Project</option>}
        </select>
      </div>

      {siteBase &&
        groups.map((g) => (
          <div key={g}>
            <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-ink/50">{g}</p>
            <ul className="space-y-0.5">
              {SITE_MODULES.filter((m) => m.group === g).map((m) => {
                const href = `${siteBase}/${m.slug}`;
                const active = pathname === href || pathname.startsWith(`${href}/`);
                const Icon = ICONS[m.icon] ?? FileText;
                return (
                  <li key={m.slug}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-colors",
                        active ? "bg-white/10 font-medium text-white" : "text-sidebar-ink hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                      <span className="truncate">{m.label}</span>
                      {m.status === "planned" && (
                        <span className="ml-auto rounded bg-white/5 px-1.5 text-[10px] text-sidebar-ink/60" title={`Planned for ${m.phase}`}>
                          Soon
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

      <div className="mt-auto">
        <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-ink/50">{orgName}</p>
        <ul className="space-y-0.5">
          {ORG_NAV.map((item) => {
            const href = `/app/${orgSlug}/${item.href}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const Icon = ICONS[item.icon];
            return (
              <li key={item.href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-1.5",
                    active ? "bg-white/10 font-medium text-white" : "text-sidebar-ink hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon className="size-4 opacity-80" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
          {isPlatformAdmin && (
            <li>
              <Link href="/admin" className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sidebar-ink hover:bg-white/5 hover:text-white">
                <Shield className="size-4 opacity-80" aria-hidden />
                Admin
              </Link>
            </li>
          )}
        </ul>
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile top bar trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-40 grid size-10 place-items-center rounded-lg border border-line bg-surface text-ink shadow-sm lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar lg:flex">
        <div className="flex h-16 shrink-0 items-center px-5">
          <Logo href="/app" inverted />
        </div>
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar">
            <div className="flex h-16 shrink-0 items-center justify-between px-5">
              <Logo href="/app" inverted />
              <button type="button" onClick={() => setOpen(false)} className="text-sidebar-ink" aria-label="Close navigation">
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
