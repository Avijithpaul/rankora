import type { ReactNode } from "react";
import { BarChart3, LineChart, ScanSearch } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ScoreRing } from "@/components/ui/score-ring";
import { SeverityBadge } from "@/components/ui/badge";

const POINTS = [
  { icon: ScanSearch, title: "Transparent audits", body: "A real crawl and a weighted score you can explain." },
  { icon: BarChart3, title: "Your Google data", body: "Search Console and GA4 with read-only access." },
  { icon: LineChart, title: "Progress you can prove", body: "Rankings, tasks and reports for every website." },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-ink lg:flex lg:flex-col">
        <div className="hero-glow pointer-events-none absolute inset-0 opacity-90" aria-hidden />
        <div className="relative">
          <Logo inverted />
        </div>

        {/* sample product preview, labelled as such */}
        <div className="relative mx-auto mt-14 w-full max-w-md animate-float">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_30px_80px_-20px_rgb(46_196_173/0.35)] backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">SEO health</p>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-sidebar-ink">Sample</span>
            </div>
            <div className="mt-4 flex items-center gap-5">
              <ScoreRing score={82} size={92} className="[&_.text-ink]:text-white [&_.text-muted]:text-sidebar-ink" />
              <ul className="flex-1 space-y-2 text-xs">
                {(
                  [
                    ["critical", "Broken links", "4"],
                    ["warning", "Slow pages", "6"],
                    ["opportunity", "Schema", "12"],
                  ] as const
                ).map(([sev, t, n]) => (
                  <li key={t} className="flex items-center gap-2">
                    <SeverityBadge severity={sev} />
                    <span className="flex-1 truncate text-sidebar-ink">{t}</span>
                    <span className="tabular text-white">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="relative mt-auto max-w-lg">
          <h2 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-white">
            Analyze, fix and grow organic search — <span className="text-gradient">with data you can trust.</span>
          </h2>
          <ul className="mt-8 grid gap-3">
            {POINTS.map((p) => (
              <li key={p.title} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/15 text-[var(--brand-ink)]">
                  <p.icon className="size-4" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{p.title}</span>
                  <span className="block text-xs text-sidebar-ink">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-10 text-xs text-sidebar-ink/60">© {new Date().getFullYear()} Rankora</p>
      </aside>
      <main className="relative flex flex-col overflow-hidden bg-canvas px-6 py-10 sm:px-12">
        <div className="pointer-events-none absolute -right-40 -top-40 size-[26rem] rounded-full bg-brand/10 blur-3xl" aria-hidden />
        <div className="relative lg:hidden">
          <Logo />
        </div>
        <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
