"use client";

import { useLayoutEffect } from "react";

/** Everything that animates in: Reveal blocks, children of Reveal grids, and every Card. */
const TARGETS = "[data-reveal], [data-reveal-children] > *, .card-surface";
const STEP = 90; // ms between cards that enter together
const MAX_STEPS = 7;

/**
 * Reveals cards as they scroll into view: each one fades and rises, and cards that
 * enter together follow one another left-to-right, top-to-bottom.
 *
 * Progressive enhancement: the server HTML is fully visible. Once this component runs,
 * whatever is already on screen stays as it is, and `html[data-reveal-ready]` makes the
 * rest wait (see globals.css) until it scrolls in. Without JavaScript, or with reduced
 * motion, nothing is ever hidden.
 */
export function CardReveal() {
  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const root = document.documentElement;

    const show = (el: HTMLElement) => el.setAttribute("data-in", "");
    const seen = new WeakSet<HTMLElement>();

    const io = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((e) => e.isIntersecting)
          .map((e) => e.target as HTMLElement)
          .sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return Math.abs(ra.top - rb.top) > 24 ? ra.top - rb.top : ra.left - rb.left;
          });
        entering.forEach((el, i) => {
          io.unobserve(el);
          const delay = Math.min(i, MAX_STEPS) * STEP;
          el.style.setProperty("--rk-delay", `${delay}ms`);
          show(el);
          // drop the delay afterwards so hover and tilt respond immediately
          window.setTimeout(() => el.style.removeProperty("--rk-delay"), delay + 900);
        });
      },
      { threshold: 0 },
    );

    const scan = (scope: ParentNode, initial: boolean) => {
      const found: HTMLElement[] = [];
      if (scope instanceof HTMLElement && scope.matches(TARGETS)) found.push(scope);
      scope.querySelectorAll<HTMLElement>(TARGETS).forEach((el) => found.push(el));
      for (const el of found) {
        if (seen.has(el) || el.hasAttribute("data-in")) continue;
        seen.add(el);
        // a card inside something that already animates moves with its parent
        if (el.parentElement?.closest(TARGETS)) {
          show(el);
          continue;
        }
        // on first run, content the visitor can already see is left alone (no flash)
        if (initial) {
          const r = el.getBoundingClientRect();
          if (r.bottom > 0 && r.top < window.innerHeight) {
            show(el);
            continue;
          }
        }
        io.observe(el);
      }
    };

    scan(document, true);
    root.dataset.revealReady = "";

    // new content: client navigation, streamed sections, opened panels
    const mo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n, false));
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      delete root.dataset.revealReady;
    };
  }, []);

  return null;
}
