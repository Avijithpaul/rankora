import Link from "next/link";
import { cn } from "@/lib/utils";

/** Rankora mark: a rising bar chart inside a teal ring — "rank up". */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <defs>
        <linearGradient id="rk-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-ink)" />
          <stop offset="1" stopColor="var(--brand)" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="url(#rk-g)" strokeWidth="3" />
      <rect x="9.5" y="17" width="3" height="6" rx="1.2" fill="url(#rk-g)" />
      <rect x="14.5" y="13" width="3" height="10" rx="1.2" fill="url(#rk-g)" />
      <rect x="19.5" y="9" width="3" height="14" rx="1.2" fill="url(#rk-g)" />
    </svg>
  );
}

export function Logo({ href = "/", inverted = false, className }: { href?: string; inverted?: boolean; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5", className)} aria-label="Rankora home">
      <LogoMark />
      <span className={cn("font-[family-name:var(--font-display)] text-xl font-bold tracking-tight", inverted ? "text-white" : "text-ink")}>Rankora</span>
    </Link>
  );
}
