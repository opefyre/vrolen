/**
 * VROL-829 — SPA history navigation helper.
 *
 * The app is intentionally router-less (locked stack). This module wraps the
 * HTML5 History API so navigation between top-level routes (/editor,
 * /templates, /help, …) is instant and state-preserving rather than
 * full-page-reload. It exposes:
 *
 *  - `navigate(path, opts)` — push (or replace) a history entry and notify
 *    subscribers. Listeners react to a synthetic `popstate` event because
 *    the browser does NOT fire one for programmatic pushState / replaceState
 *    on its own.
 *  - `usePathname()` — `useSyncExternalStore`-backed hook that returns the
 *    current pathname and re-renders the calling component when it changes.
 *
 * The store subscribes to `popstate` (back/forward + our synthetic dispatch)
 * which is sufficient for every code path in this app since the only way to
 * change the URL is `navigate(...)`, an actual browser back/forward, or a
 * native anchor that we intentionally let through (external links).
 */

import { useSyncExternalStore } from "react";

interface NavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  readonly replace?: boolean;
}

/**
 * Programmatic navigation. Pushes (or replaces) a history entry, then
 * dispatches `popstate` so every `usePathname()` consumer re-renders.
 */
export function navigate(path: string, opts?: NavigateOptions): void {
  if (typeof window === "undefined") return;
  if (opts?.replace === true) {
    window.history.replaceState(null, "", path);
  } else {
    window.history.pushState(null, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function getPathnameSnapshot(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname;
}

function getServerSnapshot(): string {
  return "/";
}

function subscribePathname(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
  };
}

/**
 * Subscribe a component to `window.location.pathname`. Re-renders on every
 * `popstate` event (browser back/forward and our synthetic dispatch from
 * `navigate(...)`).
 */
export function usePathname(): string {
  return useSyncExternalStore(subscribePathname, getPathnameSnapshot, getServerSnapshot);
}

/**
 * VROL-1196 — subscribe to `window.location.search`. usePathname doesn't
 * fire when only the query string changes (audit found /learn tabs
 * silently stuck on Glossary even as ?section=examples was set). Consumers
 * that care about search-param navigation should use this alongside
 * usePathname.
 */
function getSearchSnapshot(): string {
  if (typeof window === "undefined") return "";
  return window.location.search;
}
function getSearchServerSnapshot(): string {
  return "";
}
export function useSearch(): string {
  return useSyncExternalStore(subscribePathname, getSearchSnapshot, getSearchServerSnapshot);
}
