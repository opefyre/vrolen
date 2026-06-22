/**
 * VROL-806 — route-meta lookup tests.
 *
 * Confirms every known SPA route has a title + description, that the title
 * follows the `<page> · Vrolen` convention, and that unknown paths fall back
 * to the generic Vrolen entry instead of returning `undefined`.
 */

import { describe, expect, it } from "vitest";

import { FALLBACK_ROUTE_META, ROUTE_META, getRouteMeta } from "./route-meta";

describe("route-meta (VROL-806)", () => {
  it("covers every known SPA route", () => {
    for (const path of [
      "/",
      "/editor",
      "/templates",
      "/learn",
      "/help",
      "/run",
      "/iso-demo",
      "/design-tokens",
      "/demo",
    ] as const) {
      expect(ROUTE_META[path]).toBeDefined();
      expect(ROUTE_META[path]?.title).toBeTruthy();
      expect(ROUTE_META[path]?.description).toBeTruthy();
    }
  });

  it("uses the `<page> · Vrolen` title convention", () => {
    for (const path of Object.keys(ROUTE_META)) {
      const meta = ROUTE_META[path];
      expect(meta).toBeDefined();
      expect(meta?.title.endsWith("Vrolen")).toBe(true);
    }
  });

  it("getRouteMeta returns the matching entry for a known path", () => {
    expect(getRouteMeta("/learn")).toEqual(ROUTE_META["/learn"]);
    expect(getRouteMeta("/editor")).toEqual(ROUTE_META["/editor"]);
  });

  it("getRouteMeta falls back to a safe default for unknown paths", () => {
    expect(getRouteMeta("/nope")).toEqual(FALLBACK_ROUTE_META);
    expect(getRouteMeta("/editor/scenario/123")).toEqual(FALLBACK_ROUTE_META);
  });
});
