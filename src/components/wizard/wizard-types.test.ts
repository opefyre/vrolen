/**
 * VROL-820 + VROL-871 — exercise the per-step validation predicates
 * across the rebuilt 8-step wizard.
 */

import { describe, expect, it } from "vitest";

import { constant } from "@/engine";

import {
  defaultDraft,
  linearConnections,
  validateArrivals,
  validateConnections,
  validateProducts,
  validateRealism,
  validateReview,
  validateRunWindow,
  validateShape,
  validateStations,
} from "./wizard-types";

describe("Wizard step validators (VROL-871)", () => {
  it("validateShape passes for the default draft", () => {
    expect(validateShape(defaultDraft()).valid).toBe(true);
  });

  it("validateShape fails when shapeKind is not one of the known kinds", () => {
    // @ts-expect-error — intentionally invalid for the test
    const result = validateShape({ ...defaultDraft(), shapeKind: "spaghetti" });
    expect(result.valid).toBe(false);
    expect(result.errors["shapeKind"]).toMatch(/shape/i);
  });

  it("validateStations fails when the station list is empty", () => {
    const result = validateStations({ ...defaultDraft(), stations: [] });
    expect(result.valid).toBe(false);
    expect(result.errors["count"]).toBeDefined();
  });

  it("validateStations flags blank names, bad capacity, bad defect", () => {
    const draft = defaultDraft();
    const broken = {
      ...draft,
      stations: [
        {
          ...draft.stations[0]!,
          label: "",
        },
        {
          ...draft.stations[1]!,
          parallelCapacity: 99,
        },
        {
          ...draft.stations[2]!,
          defectRate: 2,
        },
      ],
    };
    const result = validateStations(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["station-0-label"]).toBeDefined();
    expect(result.errors["station-1-capacity"]).toBeDefined();
    expect(result.errors["station-2-defect"]).toBeDefined();
  });

  it("validateConnections fails on multi-source / multi-sink graphs", () => {
    const draft = defaultDraft();
    // Two disconnected stations — both are sources AND sinks.
    const broken = {
      ...draft,
      stations: [draft.stations[0]!, draft.stations[1]!],
      connections: [],
    };
    const result = validateConnections(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["sources"]).toBeDefined();
    expect(result.errors["sinks"]).toBeDefined();
  });

  it("validateConnections passes for the default linear chain", () => {
    expect(validateConnections(defaultDraft()).valid).toBe(true);
  });

  it("validateProducts is satisfied when products mode is off", () => {
    expect(validateProducts(defaultDraft()).valid).toBe(true);
  });

  it("validateProducts flags blank product names + zero weights when enabled", () => {
    const draft = defaultDraft();
    const broken = {
      ...draft,
      productsEnabled: true,
      products: [
        { id: "A", name: "", weight: 0 },
        { id: "A", name: "Duplicate id", weight: 1 },
      ],
    };
    const result = validateProducts(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["product-0-name"]).toBeDefined();
    expect(result.errors["product-0-weight"]).toBeDefined();
    expect(result.errors["product-1-id"]).toBeDefined();
  });

  it("validateRealism fails on MTBF/MTTR <= 0 when breakdowns are on", () => {
    const draft = defaultDraft();
    const broken = {
      ...draft,
      breakdowns: { enabled: true, mtbfMs: 0, mttrMs: 0 },
    };
    const result = validateRealism(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["mtbf"]).toBeDefined();
    expect(result.errors["mttr"]).toBeDefined();
  });

  it("validateRealism flags stations whose rework target was deleted", () => {
    const draft = defaultDraft();
    const broken = {
      ...draft,
      stations: [
        { ...draft.stations[0]!, reworkTargetId: "deleted-station-id" },
        ...draft.stations.slice(1),
      ],
    };
    const result = validateRealism(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["station-0-rework"]).toBeDefined();
  });

  it("validateArrivals fails on negative materials counts when materials enabled", () => {
    const draft = defaultDraft();
    const broken = {
      ...draft,
      materials: { ...draft.materials, enabled: true, bottles: -1, caps: -1 },
    };
    const result = validateArrivals(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["bottles"]).toBeDefined();
    expect(result.errors["caps"]).toBeDefined();
  });

  it("validateArrivals fails when batch size < 1", () => {
    const draft = defaultDraft();
    const broken = {
      ...draft,
      arrivals: { ...draft.arrivals, batchSize: 0 },
    };
    const result = validateArrivals(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["batchSize"]).toBeDefined();
  });

  it("validateRunWindow fails when warm-up >= horizon", () => {
    const draft = defaultDraft();
    const broken = {
      ...draft,
      runWindow: { ...draft.runWindow, warmupMs: draft.runWindow.horizonMs + 1 },
    };
    const result = validateRunWindow(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["warmupMs"]).toBeDefined();
  });

  it("validateRunWindow caps replications at 50", () => {
    const draft = defaultDraft();
    const broken = {
      ...draft,
      runWindow: { ...draft.runWindow, replications: 9999 },
    };
    const result = validateRunWindow(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["replications"]).toBeDefined();
  });

  it("validateReview rolls up upstream errors", () => {
    const draft = defaultDraft();
    const broken = {
      ...draft,
      // Force two upstream failures.
      stations: [{ ...draft.stations[0]!, label: "" }],
      connections: [],
      runWindow: { ...draft.runWindow, horizonMs: 0 },
    };
    const result = validateReview(broken);
    expect(result.valid).toBe(false);
    expect(result.errors["step-1"]).toBeDefined();
    expect(result.errors["step-6"]).toBeDefined();
  });

  it("validateReview passes for the default draft", () => {
    expect(validateReview(defaultDraft()).valid).toBe(true);
  });

  it("linearConnections builds N-1 edges for N stations", () => {
    const stations = defaultDraft().stations;
    expect(linearConnections(stations)).toHaveLength(stations.length - 1);
  });

  it("constant distribution defaults flow through to cycle distributions", () => {
    const draft = defaultDraft();
    const cyc = draft.stations[0]?.cycleDistribution;
    expect(cyc).toEqual(constant(800));
  });
});
