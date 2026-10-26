import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/brand/logo";

const POINTS = [
  "Crawl your site and get a transparent, weighted SEO score",
  "Connect Google Search Console and GA4 with read-only access",
  "Track rankings, tasks and progress across every website",
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-ink lg:flex lg:flex-col">
        <Logo inverted />
        <div className="mt-auto max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Analyze, fix and grow organic search — with data you can trust.
          </h2>
          <ul className="mt-8 space-y-3 text-sm">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#7CF5C4]" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-16 text-xs text-sidebar-ink/60">© {new Date().getFullYear()} Rankora</p>
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-brand/30 blur-3xl"
        />
      </aside>
      <main className="flex flex-col bg-surface px-6 py-10 sm:px-12">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
