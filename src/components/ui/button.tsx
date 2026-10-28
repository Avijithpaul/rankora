import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link, { type LinkProps } from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary: "btn-shine bg-brand text-on-brand font-semibold shadow-[0_0_24px_var(--glow)] hover:bg-brand-hover",
  secondary: "border border-line-strong bg-surface text-ink-2 shadow-sm hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2",
  danger: "bg-critical text-white shadow-sm hover:bg-critical/90",
  link: "text-brand underline-offset-4 hover:underline",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(base, variants[variant], variant !== "link" && sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant,
  size,
  className,
  children,
  ...props
}: LinkProps & { variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link className={buttonClasses({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
