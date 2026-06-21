/**
 * VROL-790 — smoke tests for the copy SoT.
 *
 * Goal: catch regressions where someone adds a label that violates the
 * sentence-case / verb-noun / no-emoji convention without having to re-read
 * the JSDoc on every PR. Tests are intentionally cheap — one shape check per
 * surface plus a couple of convention guards — because the real defence is
 * code review.
 */

import { describe, expect, it } from "vitest";

import { BUTTONS, EMPTY_STATES, LABELS, PLACEHOLDERS, TOASTS } from "./copy";

describe("copy SoT", () => {
  it("exports five surface objects with string values", () => {
    for (const surface of [BUTTONS, EMPTY_STATES, TOASTS, LABELS, PLACEHOLDERS]) {
      expect(typeof surface).toBe("object");
      expect(Object.keys(surface).length).toBeGreaterThan(0);
      for (const value of Object.values(surface)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it("hits the 30-50 label coverage target", () => {
    const total =
      Object.keys(BUTTONS).length +
      Object.keys(EMPTY_STATES).length +
      Object.keys(TOASTS).length +
      Object.keys(LABELS).length +
      Object.keys(PLACEHOLDERS).length;
    expect(total).toBeGreaterThanOrEqual(30);
  });

  it("uses sentence case: no value starts with a lowercase letter or whitespace", () => {
    const allEntries: ReadonlyArray<readonly [string, string]> = [
      ...Object.entries(BUTTONS),
      ...Object.entries(EMPTY_STATES),
      ...Object.entries(TOASTS),
      ...Object.entries(LABELS),
      ...Object.entries(PLACEHOLDERS),
    ];
    for (const [key, value] of allEntries) {
      // First non-whitespace char is upper, digit, or non-ASCII (e.g., quote)
      expect(value, `${key} should start with a non-whitespace, non-lowercase char`).toMatch(
        /^[^a-z\s]/,
      );
    }
  });

  it("forbids emoji in shipped copy", () => {
    const emojiRange =
      // High-range pictographs + supplementary symbols. Conservative — won't
      // false-positive on en-dashes, ellipses, or curly quotes.
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const allEntries = [
      ...Object.entries(BUTTONS),
      ...Object.entries(EMPTY_STATES),
      ...Object.entries(TOASTS),
      ...Object.entries(LABELS),
      ...Object.entries(PLACEHOLDERS),
    ];
    for (const [key, value] of allEntries) {
      expect(value, `${key} should not contain emoji`).not.toMatch(emojiRange);
    }
  });

  it("exposes the headline labels expected by downstream consumers", () => {
    // Spot-check a few canonical entries other tickets will depend on.
    expect(BUTTONS.RUN).toBe("Run simulation");
    expect(BUTTONS.SAVE_SCENARIO).toBe("Save scenario");
    expect(EMPTY_STATES.NO_RESULTS).toBe("No results yet");
    expect(TOASTS.SAVED).toBe("Saved");
  });
});
