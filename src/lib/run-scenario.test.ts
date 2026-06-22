import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { constant } from "@/engine";
import { DEFAULT_RUN_SETTINGS } from "@/routes/editor-run-settings";

import { runScenario } from "./run-scenario";

const baseNodes: Node[] = [
  {
    id: "n1",
    position: { x: 0, y: 0 },
    data: { label: "A", cycleDistribution: constant(50), defectRate: 0 },
  },
  {
    id: "n2",
    position: { x: 200, y: 0 },
    data: { label: "B", cycleDistribution: constant(100), defectRate: 0 },
  },
];
const baseEdges: Edge[] = [{ id: "e1-2", source: "n1", target: "n2" }];

describe("runScenario", () => {
  it("returns an outcome with result + runMeta on a valid 2-node chain", () => {
    const out = runScenario(baseNodes, baseEdges, DEFAULT_RUN_SETTINGS, null);
    expect("result" in out).toBe(true);
    if (!("result" in out)) return;
    expect(out.result.completed).toBeGreaterThan(0);
    expect(out.runMeta.chainNodeIds).toEqual(["n1", "n2"]);
    expect(out.runMeta.stationLabels).toEqual(["A", "B"]);
    expect(out.runMeta.edgeKeys).toEqual(["n1→n2"]);
  });

  it("returns a translation failure on a cyclic graph", () => {
    const cycEdges: Edge[] = [
      { id: "e1-2", source: "n1", target: "n2" },
      { id: "e2-1", source: "n2", target: "n1" },
    ];
    const out = runScenario(baseNodes, cycEdges, DEFAULT_RUN_SETTINGS, null);
    expect("kind" in out && out.kind === "translation").toBe(true);
  });

  it("returns a materials-no-selection failure when materials are on but no node is selected", () => {
    const out = runScenario(
      baseNodes,
      baseEdges,
      { ...DEFAULT_RUN_SETTINGS, materials: { ...DEFAULT_RUN_SETTINGS.materials, enabled: true } },
      null,
    );
    expect("kind" in out && out.kind === "materials-no-selection").toBe(true);
  });

  it("VROL-AUDIT: forwards samplerIntervalMs so result.samples populates", () => {
    const out = runScenario(
      baseNodes,
      baseEdges,
      { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000 },
      null,
    );
    expect("result" in out).toBe(true);
    if (!("result" in out)) return;
    // Pre-fix: result.samples was undefined / empty regardless of the setting.
    // After fix: every 1s a sample is emitted across the default 60s horizon.
    expect(out.result.samples).toBeDefined();
    expect((out.result.samples ?? []).length).toBeGreaterThan(10);
  });

  it("VROL-AUDIT: samplerIntervalMs=0 leaves samples empty (off)", () => {
    const out = runScenario(
      baseNodes,
      baseEdges,
      { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 0 },
      null,
    );
    expect("result" in out).toBe(true);
    if (!("result" in out)) return;
    // Sampler off: engine returns no samples.
    expect((out.result.samples ?? []).length).toBe(0);
  });
});
