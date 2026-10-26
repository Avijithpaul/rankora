import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path d="M9 22V10h7.2a4.2 4.2 0 0 1 1.3 8.2L22 22h-3.6l-3.9-3.5H12.2V22H9Zm3.2-6.3h3.8a1.5 1.5 0 0 0 0-3h-3.8v3Z" fill="#fff" />
      <path d="M21 9.5h2.5V12" stroke="#7CF5C4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function Logo({ href = "/", inverted = false, className }: { href?: string; inverted?: boolean; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2", className)} aria-label="Rankora home">
      <LogoMark />
      <span className={cn("text-[17px] font-semibold tracking-tight", inverted ? "text-white" : "text-ink")}>Rankora</span>
    </Link>
  );
}
