import type { ElementType, ReactNode } from "react";

/**
 * Fades its content in as it scrolls into view, using a CSS scroll-driven
 * animation (no JavaScript). Browsers without support simply show the content,
 * so it can never be stuck invisible. See `[data-reveal]` in globals.css.
 */
export function Reveal({ children, as: Tag = "div", className }: { children: ReactNode; as?: ElementType; className?: string }) {
  return (
    <Tag data-reveal="" className={className}>
      {children}
    </Tag>
  );
}
