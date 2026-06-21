/**
 * VROL-820 — exercise the per-step validation predicates.
 */

import { describe, expect, it } from "vitest";

import {
  defaultDraft,
  validateArrivals,
  validateRealism,
  validateReview,
  validateShape,
  validateStations,
} from "./wizard-types";

describe("Wizard step validators (VROL-820)", () => {
  it("validateShape passes for the default draft", () => {
    expect(validateShape(defaultDraft()).valid).toBe(true);
  });

  it("validateShape fails when no preset is chosen", () => {
    const result = validateShape({ ...defaultDraft(), presetId: null });
    expect(result.valid).toBe(false);
    expect(result.errors["presetId"]).toMatch(/shape/i);
  });

  it("validateStations fails when the station list is empty", () => {
    const result = validateStations({ ...defaultDraft(), stations: [] });
    expect(result.valid).toBe(false);
    expect(result.errors["count"]).toBeDefined();
  });

  it("validateStations flags blank names and non-positive cycle times", () => {
    const draft = {
      ...defaultDraft(),
      stations: [
        { id: "a", label: "", stationType: "machine", cycleMs: 1000 },
        { id: "b", label: "Capper", stationType: "machine", cycleMs: 0 },
      ],
    };
    const result = validateStations(draft);
    expect(result.valid).toBe(false);
    expect(result.errors["station-0-label"]).toBeDefined();
    expect(result.errors["station-1-cycle"]).toBeDefined();
  });

  it("validateArrivals fails when arrival rate is zero", () => {
    const result = validateArrivals({ ...defaultDraft(), arrivalsPerMin: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors["arrivalsPerMin"]).toBeDefined();
  });

  it("validateArrivals fails when arrival rate is NaN", () => {
    const result = validateArrivals({ ...defaultDraft(), arrivalsPerMin: Number.NaN });
    expect(result.valid).toBe(false);
    expect(result.errors["arrivalsPerMin"]).toBeDefined();
  });

  it("validateArrivals fails when horizon is non-positive", () => {
    const result = validateArrivals({ ...defaultDraft(), horizonMs: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors["horizonMs"]).toBeDefined();
  });

  it("validateRealism passes for each level", () => {
    for (const realism of ["simple", "realistic", "stress"] as const) {
      expect(validateRealism({ ...defaultDraft(), realism }).valid).toBe(true);
    }
  });

  it("validateReview rolls up upstream errors", () => {
    const broken = { ...defaultDraft(), presetId: null, arrivalsPerMin: 0 };
    const result = validateReview(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["step-0"]).toBeDefined();
    expect(result.errors["step-2"]).toBeDefined();
  });

  it("validateReview passes for the default draft", () => {
    expect(validateReview(defaultDraft()).valid).toBe(true);
  });
});
