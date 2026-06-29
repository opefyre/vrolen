/**
 * VROL-1051 — exhaustive coverage of the applyLabel formatter so each
 * payload kind produces the expected button text.
 */
import { describe, expect, it } from "vitest";

import { applyLabel } from "./apply-label";

describe("applyLabel (VROL-1051)", () => {
  it("formats cycle:halve with station", () => {
    expect(applyLabel({ kind: "cycle:halve", stationLabel: "Filler" })).toBe(
      "Apply cycle 0.5× on Filler",
    );
  });

  it("formats cycle:scaleAll with multiplier", () => {
    expect(applyLabel({ kind: "cycle:scaleAll", multiplier: 0.75 })).toBe(
      "Apply cycle 0.75× line-wide",
    );
  });

  it("formats buffer:grow as +5", () => {
    expect(applyLabel({ kind: "buffer:grow", edgeKey: "any" })).toBe("Apply buffer +5");
  });

  it("formats tool-pool:grow with pool name", () => {
    expect(applyLabel({ kind: "tool-pool:grow", poolName: "Heads" })).toBe("Apply Heads pool +1");
  });

  it("formats tool-pool:scaleAll with delta", () => {
    expect(applyLabel({ kind: "tool-pool:scaleAll", delta: 2 })).toBe("Apply tool pools +2");
  });

  it("formats energy:scale with station + multiplier", () => {
    expect(applyLabel({ kind: "energy:scale", stationLabel: "Filler", multiplier: 0.75 })).toBe(
      "Apply energy 0.75× on Filler",
    );
  });

  it("formats capacity:set with station + target", () => {
    expect(applyLabel({ kind: "capacity:set", stationLabel: "Filler", capacity: 2 })).toBe(
      "Apply capacity 2 on Filler",
    );
  });

  it("formats capacity:scaleAll with delta", () => {
    expect(applyLabel({ kind: "capacity:scaleAll", delta: 1 })).toBe("Apply capacity +1 line-wide");
  });

  it("falls back to plain Apply for info-only kinds", () => {
    expect(applyLabel({ kind: "reliability:flag", stationLabel: "Filler" })).toBe("Apply");
    expect(applyLabel({ kind: "sampling:flag" })).toBe("Apply");
  });
});
