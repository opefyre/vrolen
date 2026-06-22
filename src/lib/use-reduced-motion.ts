/**
 * `useReducedMotion` — returns true when the user prefers reduced motion
 * (matches the OS-level `prefers-reduced-motion: reduce` media query).
 *
 * VROL-801 — accessibility gate for decorative animations. Components call
 * this hook and skip / shorten their animations when it returns true. The
 * hook subscribes to the media-query change event so the value updates if
 * the user toggles the OS setting mid-session without a page reload.
 *
 * Falls back to false in SSR / non-DOM environments (Node, happy-dom without
 * matchMedia) so callers don't have to guard for `typeof window === undefined`.
 */

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    // Some test envs (happy-dom etc.) throw on unsupported queries — treat
    // as "no preference" rather than crashing the render.
    return false;
  }
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(readInitial);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(QUERY);
    } catch {
      return;
    }
    const handler = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    // Sync the state once on mount via rAF — the OS-level preference can flip
    // between the initial render and this effect, so re-read it here. Defer
    // the actual setState through a frame so we don't trigger a cascading
    // render synchronously inside the effect body (react-hooks rule).
    const raf =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(() => {
            setReduced(mql.matches);
          })
        : null;
    // Older Safari only exposes addListener / removeListener; modern browsers
    // expose addEventListener('change', ...). Cover both.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => {
        if (raf !== null) window.cancelAnimationFrame(raf);
        mql.removeEventListener("change", handler);
      };
    }
    // Fallback for older browsers.
    const legacy = mql as MediaQueryList & {
      addListener?: (l: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (l: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(handler);
    return () => {
      if (raf !== null) window.cancelAnimationFrame(raf);
      legacy.removeListener?.(handler);
    };
  }, []);

  return reduced;
}
