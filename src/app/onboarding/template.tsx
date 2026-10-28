import { ViewTransition } from "react";

/**
 * Re-mounts on every navigation. Browsers with view transitions crossfade the old page out and
 * the new one in (classes page-out / page-in in globals.css); others play the CSS enter animation.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page-enter">{children}</div>
    </ViewTransition>
  );
}
