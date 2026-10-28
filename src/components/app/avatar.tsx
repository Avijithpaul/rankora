import { cn } from "@/lib/utils";
import { initialsOf, safeAvatarUrl } from "@/lib/profile";

/**
 * Profile photo from the sign-in provider (Google / GitHub) when there is one,
 * otherwise the person's initials on a brand gradient.
 */
export function Avatar({ name, src, size = 32, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const url = safeAvatarUrl(src);
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- provider avatars are tiny, external and already sized
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className={cn("shrink-0 rounded-full object-cover ring-2 ring-brand/30", className)}
        style={style}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-ink to-brand font-semibold text-on-brand ring-2 ring-brand/30", className)}
      style={style}
    >
      {initialsOf(name)}
    </span>
  );
}
