import type { ElementType, HTMLAttributes, ReactNode } from "react";

export type RevealVariant = "up" | "left" | "right" | "zoom" | "blur" | "flip";

/**
 * Animates its content as it scrolls into view, using a CSS scroll-driven
 * animation (no JavaScript). Browsers without support simply show the content,
 * so it can never be stuck invisible. See `[data-reveal]` in globals.css.
 *
 * `children` mode reveals each direct child separately (natural stagger for grids and lists).
 */
export function Reveal({
  children,
  as: Tag = "div",
  variant = "up",
  each = false,
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: ElementType;
  variant?: RevealVariant;
  /** reveal each direct child on its own instead of the whole block */
  each?: boolean;
  className?: string;
}) {
  const attrs = each ? { "data-reveal-children": variant } : { "data-reveal": variant };
  return (
    <Tag {...rest} {...attrs} className={className}>
      {children}
    </Tag>
  );
}
