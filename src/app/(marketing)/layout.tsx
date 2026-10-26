import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { MARKETING_FEATURES } from "./features-data";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-ink-2 md:flex" aria-label="Primary">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ButtonLink href="/login" variant="ghost" size="sm">
              Sign in
            </ButtonLink>
            <ButtonLink href="/register" size="sm">
              Start free
            </ButtonLink>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line bg-canvas">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-3 text-sm text-muted">All-in-One SEO Analyze, Fix &amp; Optimization Platform.</p>
          </div>
          <div>
            <p className="text-sm font-semibold">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {MARKETING_FEATURES.map((f) => (
                <li key={f.slug}>
                  <Link href={`/${f.slug}`} className="hover:text-ink">
                    {f.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Company</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {NAV.slice(1).map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="hover:text-ink">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="text-sm text-muted">
            <p className="font-semibold text-ink">Data honesty</p>
            <p className="mt-3">
              Rankora never invents search volumes, backlinks or analytics. Metrics come from your connected providers or are
              clearly labelled as demo data.
            </p>
          </div>
        </div>
        <p className="border-t border-line py-5 text-center text-xs text-muted">© {new Date().getFullYear()} Rankora</p>
      </footer>
    </div>
  );
}
