/**
 * VROL-787 — smoke tests for the empty-state SoT.
 *
 * Cheap shape checks: confirm the registry holds plausible entries and the
 * helper rejects unknown ids. Real validation is code review against the
 * convention noted in `empty-states.ts`.
 */

import { describe, expect, it } from "vitest";

import { EMPTY_STATE_IDS, EMPTY_STATES, getEmptyState } from "./empty-states";

describe("empty-state SoT", () => {
  it("covers the surfaces called out in the ticket scope", () => {
    // The ticket calls out ~10 surfaces — assert the lookup is at least that
    // big so future deletions don't silently shrink coverage.
    expect(EMPTY_STATE_IDS.length).toBeGreaterThanOrEqual(10);
  });

  it("includes the named anchor surfaces from VROL-787", () => {
    for (const id of ["wizard-step-stations", "results-no-run", "sensitivity-no-run"] as const) {
      expect(EMPTY_STATES[id]).toBeDefined();
      expect(EMPTY_STATES[id]?.title).toBeTruthy();
    }
  });

  it("every entry has a non-empty sentence-case title", () => {
    for (const [id, copy] of Object.entries(EMPTY_STATES)) {
      expect(copy.title, `${id} title`).toBeTruthy();
      // Convention: titles start with an uppercase or non-letter, never a lowercase.
      expect(copy.title, `${id} title should be sentence case`).toMatch(/^[^a-z\s]/);
      if (copy.body) {
        expect(copy.body, `${id} body`).toMatch(/[^\s]/);
      }
    }
  });

  it("getEmptyState returns the correct copy for a known id", () => {
    const copy = getEmptyState("results-no-run");
    expect(copy.title).toBe("No results yet");
    expect(copy.body).toContain("Run simulation");
  });

  it("getEmptyState throws for unknown ids", () => {
    // Cast through unknown — the type system would otherwise prevent the
    // call, which is the whole point. We want runtime to fail loud too.
    expect(() => getEmptyState("does-not-exist" as unknown as never)).toThrow(
      /Unknown empty-state id/,
    );
  });

  it("EMPTY_STATE_IDS mirrors the registry keys exactly", () => {
    expect([...EMPTY_STATE_IDS].sort()).toEqual(Object.keys(EMPTY_STATES).sort());
  });
});
