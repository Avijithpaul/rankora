"use client";

import { useEffect } from "react";

const SPOT = ".card-surface, [data-spotlight]";
const ZONE = "[data-pointer]";
const TILT = "[data-tilt]";
const MAGNET = "[data-magnetic]";
const MAX_TILT = 6; // degrees
const MAX_PULL = 6; // px

/**
 * One delegated pointer listener for the whole app. It only writes CSS variables
 * (and `translate` for magnetic elements); globals.css turns them into effects:
 *  - cards (.card-surface / [data-spotlight]) and zones ([data-pointer]) get --mx/--my for a spotlight
 *  - [data-tilt] gets --rx/--ry for a gentle 3D tilt
 *  - [data-magnetic] is pulled slightly towards the cursor
 * Disabled for touch-only devices and for users who prefer reduced motion.
 */
export function PointerEffects() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduced.matches) return;

    const active = new Map<string, HTMLElement>();
    let frame = 0;
    let last: PointerEvent | null = null;

    const release = (kind: string, el: HTMLElement) => {
      const props = kind === "tilt" ? ["--rx", "--ry"] : kind === "magnet" ? ["translate"] : ["--mx", "--my"];
      for (const p of props) el.style.removeProperty(p);
    };

    const track = (kind: string, el: HTMLElement | null) => {
      const prev = active.get(kind);
      if (prev && prev !== el) release(kind, prev);
      if (el) active.set(kind, el);
      else active.delete(kind);
    };

    const apply = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const target = e.target instanceof Element ? e.target : null;

      for (const [kind, sel] of [["spot", SPOT], ["zone", ZONE]] as const) {
        const el = target?.closest<HTMLElement>(sel) ?? null;
        track(kind, el);
        if (el) {
          const r = el.getBoundingClientRect();
          el.style.setProperty("--mx", `${e.clientX - r.left}px`);
          el.style.setProperty("--my", `${e.clientY - r.top}px`);
        }
      }

      const tilt = target?.closest<HTMLElement>(TILT) ?? null;
      track("tilt", tilt);
      if (tilt) {
        const r = tilt.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.setProperty("--ry", `${(x * MAX_TILT * 2).toFixed(2)}deg`);
        tilt.style.setProperty("--rx", `${(-y * MAX_TILT * 2).toFixed(2)}deg`);
      }

      const magnet = target?.closest<HTMLElement>(MAGNET) ?? null;
      track("magnet", magnet);
      if (magnet) {
        const r = magnet.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width - 0.5) * 2 * MAX_PULL;
        const y = ((e.clientY - r.top) / r.height - 0.5) * 2 * MAX_PULL;
        magnet.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
      }
    };

    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      for (const [kind, el] of active) release(kind, el);
      active.clear();
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
      onLeave();
    };
  }, []);

  return null;
}
