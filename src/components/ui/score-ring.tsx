import { scoreBand } from "@/lib/seo/scoring";
import { cn } from "@/lib/utils";

export function ScoreRing({ score, size = 96, className }: { score: number | null; size?: number; className?: string }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, score ?? 0));
  const band = score === null ? null : scoreBand(value);
  const color = !band
    ? "var(--line-strong)"
    : band.tone === "good"
      ? "var(--success)"
      : band.tone === "fair"
        ? "#f79009"
        : "var(--critical)";
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * value) / 100}
          className="animate-ring"
          style={{ "--ring-c": c } as React.CSSProperties}
        />
      </svg>
      <div className="absolute text-center" aria-label={score === null ? "No score yet" : `SEO score ${Math.round(value)} of 100`}>
        <div className="tabular animate-scale-in delay-3 text-2xl font-semibold text-ink">{score === null ? "—" : Math.round(value)}</div>
        {band && <div className="text-[11px] font-medium text-muted">{band.label}</div>}
      </div>
    </div>
  );
}
