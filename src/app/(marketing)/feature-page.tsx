import type { Metadata } from "next";
import { CheckCircle2, Info } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { MARKETING_FEATURES, type MarketingFeature } from "./features-data";

function get(slug: MarketingFeature["slug"]) {
  const f = MARKETING_FEATURES.find((x) => x.slug === slug);
  if (!f) throw new Error(`Unknown feature ${slug}`);
  return f;
}

export function featureMetadata(slug: MarketingFeature["slug"]): Metadata {
  const f = get(slug);
  return { title: f.name, description: f.intro };
}

export function FeaturePage({ slug }: { slug: MarketingFeature["slug"] }) {
  const f = get(slug);
  return (
    <>
      <section data-pointer className="relative overflow-hidden border-b border-line bg-canvas">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="cursor-glow" aria-hidden />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
          <p className="animate-fade-up text-sm font-semibold text-brand">{f.name}</p>
          <h1 className="animate-fade-up delay-1 mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">{f.headline}</h1>
          <p className="animate-fade-up delay-2 mx-auto mt-5 max-w-2xl text-lg text-muted">{f.intro}</p>
          <div className="animate-fade-up delay-3 mt-8 flex justify-center gap-3">
            <ButtonLink href="/register" size="lg">
              Start free
            </ButtonLink>
            <ButtonLink href="/features" size="lg" variant="secondary">
              All features
            </ButtonLink>
          </div>
        </div>
      </section>
      <section data-reveal-children="zoom" className="mx-auto grid max-w-5xl gap-6 px-4 py-16 sm:grid-cols-2 sm:px-6">
        {f.points.map((p) => (
          <div key={p.title} data-spotlight className="animate-fade-up hover-lift rounded-xl border border-line bg-surface/60 p-6 hover:border-brand/40">
            <CheckCircle2 className="size-5 text-brand" aria-hidden />
            <h2 className="mt-3 font-semibold text-ink">{p.title}</h2>
            <p className="mt-1 text-sm text-muted">{p.body}</p>
          </div>
        ))}
        <div className="flex gap-3 rounded-xl bg-brand-soft p-5 text-sm text-brand-ink sm:col-span-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {f.dataNote}
        </div>
      </section>
    </>
  );
}
