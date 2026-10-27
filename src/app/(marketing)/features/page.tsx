import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SITE_MODULES } from "@/lib/navigation";
import { MARKETING_FEATURES } from "../features-data";

export const metadata: Metadata = { title: "Features" };

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold tracking-tight">Features</h1>
      <p className="mt-3 max-w-2xl text-muted">From technical audits to rankings and reporting — built around data you can verify.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {MARKETING_FEATURES.map((f) => (
          <Link key={f.slug} href={`/${f.slug}`} className="animate-fade-up hover-lift group rounded-xl border border-line bg-surface/60 p-6 hover:border-brand/40 hover:shadow-[0_0_40px_var(--glow)]">
            <p className="text-sm font-semibold text-brand">{f.name}</p>
            <h2 className="mt-2 text-lg font-semibold">{f.headline}</h2>
            <p className="mt-2 text-sm text-muted">{f.intro}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand">
              Learn more <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        ))}
      </div>
      <h2 className="mt-16 text-xl font-semibold">All modules</h2>
      <ul className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {SITE_MODULES.map((m) => (
          <li key={m.slug}>
            <span className="font-medium text-ink">{m.label}</span> — <span className="text-muted">{m.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
