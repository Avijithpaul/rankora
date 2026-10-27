"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

export const PENDING_SITE_KEY = "rankora-pending-site";

const CHIPS = [
  { label: "Technical site audit", href: "/seo-audit" },
  { label: "Keyword rank tracking", href: "/rank-tracking" },
  { label: "Search Console + GA4", href: "/analytics" },
  { label: "Content optimizer", href: "/features" },
];

/**
 * Hero call to action: the visitor types their site, which is remembered in this
 * browser and pre-filled after sign-up in the "Add website" step. Nothing is
 * crawled before an account exists.
 */
export function HeroAuditForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto mt-10 w-full max-w-3xl">
      <form
        className="rounded-2xl border border-line bg-surface/80 p-3 shadow-[0_0_60px_var(--glow)] backdrop-blur"
        onSubmit={(e) => {
          e.preventDefault();
          const value = String(new FormData(e.currentTarget).get("site") ?? "").trim();
          if (!/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(value)) {
            setError("Enter a website address such as example.com");
            return;
          }
          try {
            localStorage.setItem(PENDING_SITE_KEY, value);
          } catch {
            /* storage unavailable: the visitor types it again after sign-up */
          }
          router.push("/register");
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-canvas/60 px-4 py-3 focus-within:border-brand/60">
            <Globe className="size-5 shrink-0 text-muted" aria-hidden />
            <span className="sr-only">Your website</span>
            <input
              name="site"
              inputMode="url"
              autoComplete="url"
              placeholder="Enter your website — e.g. yourshop.com"
              className="w-full bg-transparent text-base text-ink outline-none placeholder:text-muted"
              onChange={() => setError(null)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "hero-site-error" : undefined}
            />
          </label>
          <Button type="submit" size="lg" className="h-[52px] px-6">
            Start free audit <ArrowRight aria-hidden />
          </Button>
        </div>
        {error && (
          <p id="hero-site-error" className="px-2 pt-2 text-sm text-critical" role="alert">
            {error}
          </p>
        )}
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="text-muted">Explore:</span>
        {CHIPS.map((c) => (
          <a key={c.label} href={c.href} className="rounded-full border border-line bg-surface/60 px-3.5 py-1.5 text-ink-2 transition-colors hover:border-brand/50 hover:text-ink">
            {c.label}
          </a>
        ))}
      </div>
    </div>
  );
}
