"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "dark" | "light";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const current = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** Light/dark switch. The choice is stored in localStorage and applied before paint by the root layout. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, current, () => "dark" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("rankora-theme", next);
        } catch {
          /* private mode: the choice lasts for this page only */
        }
      }}
      className={cn("grid size-9 place-items-center rounded-full border border-line text-ink-2 transition-colors hover:border-brand/50 hover:text-brand", className)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <Sun key="sun" className="animate-scale-in size-4" aria-hidden /> : <Moon key="moon" className="animate-scale-in size-4" aria-hidden />}
    </button>
  );
}
