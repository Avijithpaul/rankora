import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Rankora mark: rising bars grow into the "R", a gold trend arrow climbs past it to the #1 star.
 * Same artwork as app/icon.svg (favicon.ico and apple-icon.png are rendered from that file).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8 drop-shadow-[0_4px_12px_rgb(46_196_173/0.3)]", className)} aria-hidden>
      <defs>
        <linearGradient id="rk-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#163234" />
          <stop offset="1" stopColor="#060e11" />
        </linearGradient>
        <linearGradient id="rk-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5ff0d6" stopOpacity="0.85" />
          <stop offset="1" stopColor="#5ff0d6" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="rk-r" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#d2fff6" />
          <stop offset="0.5" stopColor="#45dcc3" />
          <stop offset="1" stopColor="#119180" />
        </linearGradient>
        <linearGradient id="rk-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7ef0dc" />
          <stop offset="1" stopColor="#1a9e8b" />
        </linearGradient>
        <linearGradient id="rk-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff0b0" />
          <stop offset="0.5" stopColor="#ffcb4d" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <radialGradient id="rk-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffd166" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffd166" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#rk-tile)" />
      <rect x="0.8" y="0.8" width="62.4" height="62.4" rx="14.2" fill="none" stroke="url(#rk-edge)" strokeWidth="1.6" />
      <rect x="7" y="43" width="6" height="9" rx="1.8" fill="url(#rk-bar)" fillOpacity="0.5" />
      <rect x="14.5" y="36" width="6" height="16" rx="1.8" fill="url(#rk-bar)" fillOpacity="0.75" />
      <path
        fillRule="evenodd"
        fill="url(#rk-r)"
        d="M22 15 H37 C43.6 15 48 19.8 48 25.6 C48 30.4 45.2 34.2 40.8 35.6 L48.6 50 H40 L32.8 36.6 H30 V50 H22 Z M30 21.8 H36.4 C38.8 21.8 40.2 23.4 40.2 25.6 C40.2 27.8 38.8 29.4 36.4 29.4 H30 Z"
      />
      <path d="M7 39 L17.5 30.5 L27 21 L44 9.5" fill="none" stroke="#ffd166" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M38.5 8.6 H45 V15" fill="none" stroke="#ffd166" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="54.5" cy="20.5" r="9" fill="url(#rk-halo)" />
      <polygon
        points="54.50,14.90 56.05,18.37 59.83,18.77 57.00,21.31 57.79,25.03 54.50,23.13 51.21,25.03 52.00,21.31 49.17,18.77 52.95,18.37"
        fill="url(#rk-gold)"
        stroke="url(#rk-gold)"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ href = "/", inverted = false, className }: { href?: string; inverted?: boolean; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5", className)} aria-label="Rankora home">
      <LogoMark />
      <span className={cn("font-[family-name:var(--font-display)] text-xl font-bold tracking-tight", inverted ? "text-white" : "text-ink")}>
        Rank<span className="text-brand">ora</span>
      </span>
    </Link>
  );
}
