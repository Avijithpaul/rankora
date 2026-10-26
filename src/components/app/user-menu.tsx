import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Badge } from "@/components/ui/badge";

export function UserMenu({ orgSlug, name, email, role }: { orgSlug: string; name: string; email: string | null; role: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <details className="relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2 [&::-webkit-details-marker]:hidden"
        aria-label="Account menu"
      >
        <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-ink">{initials || "?"}</span>
        <span className="hidden max-w-[12rem] truncate text-sm font-medium text-ink md:inline">{name}</span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-line bg-surface p-2 shadow-lg">
        <div className="px-2 py-2">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          {email && <p className="truncate text-xs text-muted">{email}</p>}
          <Badge className="mt-2 capitalize">{role}</Badge>
        </div>
        <div className="border-t border-line pt-1">
          <Link href={`/app/${orgSlug}/account`} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink-2 hover:bg-surface-2">
            <UserRound className="size-4" aria-hidden />
            Account settings
          </Link>
          <form action={signOut}>
            <button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink-2 hover:bg-surface-2">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </details>
  );
}
