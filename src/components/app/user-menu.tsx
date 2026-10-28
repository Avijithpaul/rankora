"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Building2, ChevronDown, CreditCard, Globe, LogOut, UserRound } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { providerLabel, type AuthProvider } from "@/lib/profile";
import { Avatar } from "./avatar";

/** Top-right account menu: who is signed in, with which account, and quick links. */
export function UserMenu({
  orgSlug,
  orgName,
  name,
  email,
  avatarUrl,
  provider,
  role,
}: {
  orgSlug: string;
  orgName: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  provider: AuthProvider;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { href: `/app/${orgSlug}/account`, icon: UserRound, label: "Your profile" },
    { href: `/app/${orgSlug}/settings`, icon: Building2, label: "Organization settings" },
    { href: `/app/${orgSlug}/billing`, icon: CreditCard, label: "Plan & billing" },
    { href: `/app/${orgSlug}/notifications`, icon: Bell, label: "Notifications" },
    { href: "/", icon: Globe, label: "Rankora website" },
  ];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-surface-2"
      >
        <Avatar name={name} src={avatarUrl} size={32} />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-ink md:inline">{name}</span>
        <ChevronDown className={`hidden size-4 text-muted transition-transform md:block ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div role="menu" className="animate-scale-in absolute right-0 z-40 mt-2 w-72 origin-top-right overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_60px_-15px_rgb(0_0_0/0.5)]">
          <div className="flex items-center gap-3 border-b border-line bg-[radial-gradient(120%_100%_at_0%_0%,var(--glow),transparent_70%)] p-4">
            <Avatar name={name} src={avatarUrl} size={44} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{name}</p>
              {email && <p className="truncate text-xs text-muted">{email}</p>}
              <p className="mt-1 text-[11px] text-muted">
                Signed in with <span className="font-medium text-ink-2">{providerLabel(provider)}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-xs">
            <span className="min-w-0 truncate text-muted">{orgName}</span>
            <Badge className="shrink-0 capitalize">{role}</Badge>
          </div>
          <nav className="p-1.5" aria-label="Account">
            {items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <it.icon className="size-4 text-muted" aria-hidden />
                {it.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-sm text-ink-2">
            Theme
            <ThemeToggle />
          </div>
          <form action={signOut} className="border-t border-line p-1.5">
            <button role="menuitem" className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-critical transition-colors hover:bg-critical/10">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
