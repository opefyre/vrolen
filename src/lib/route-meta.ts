/**
 * VROL-806 — Route metadata source-of-truth.
 *
 * Single registry that maps known SPA paths to a `{ title, description }`
 * pair. Used by `<RouteAnnouncer />` to update `document.title` and announce
 * the navigation via an aria-live region whenever the path changes.
 *
 * Title format: `<page> · Vrolen`. Description is a single sentence summary
 * of what the page is for.
 */

export interface RouteMeta {
  readonly title: string;
  readonly description: string;
}

/** Fallback title used when the active path is not in the registry. */
export const FALLBACK_ROUTE_META: RouteMeta = {
  title: "Vrolen",
  description: "Discrete-event simulation for production lines, right in your browser.",
};

/**
 * Known top-level routes. Keys are exact `window.location.pathname` matches.
 * Order is unimportant — lookup is by path equality.
 */
export const ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title: "Home · Vrolen",
    description: "Discrete-event simulation for production lines, right in your browser.",
  },
  "/editor": {
    title: "Editor · Vrolen",
    description: "Build and tune a production line on the canvas.",
  },
  "/templates": {
    title: "Templates · Vrolen",
    description: "Start from a curated production-line scenario.",
  },
  "/help": {
    title: "Help · Vrolen",
    description: "Glossary of KPIs and station states used across the simulator.",
  },
  "/run": {
    title: "Run · Vrolen",
    description: "Replay and inspect the latest simulation run.",
  },
  "/iso-demo": {
    title: "Isometric demo · Vrolen",
    description: "Isometric PixiJS visualisation of a running production line.",
  },
  "/design-tokens": {
    title: "Design tokens · Vrolen",
    description: "Internal reference for colour, typography, and spacing tokens.",
  },
  "/demo": {
    title: "Demo · Vrolen",
    description: "Walk-through of Vrolen's discrete-event simulator.",
  },
};

/**
 * Resolve a pathname to its `{ title, description }`. Unknown paths fall back
 * to a generic Vrolen entry so the announcer and `document.title` always have
 * something safe to render.
 */
export function getRouteMeta(pathname: string): RouteMeta {
  return ROUTE_META[pathname] ?? FALLBACK_ROUTE_META;
}
