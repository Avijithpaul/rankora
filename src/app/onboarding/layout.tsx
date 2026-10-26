import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { signOut } from "@/app/(auth)/actions";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="flex h-16 items-center justify-between border-b border-line bg-surface px-6">
        <Logo href="/app" />
        <form action={signOut}>
          <button className="text-sm text-muted hover:text-ink">Sign out</button>
        </form>
      </header>
      <main className="mx-auto max-w-xl px-6 py-12">{children}</main>
    </div>
  );
}
