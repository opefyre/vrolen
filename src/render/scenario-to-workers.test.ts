import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { scenarioToWorkers, topologyIndexToNodeIdMap } from "./scenario-to-workers";

const layout = {
  positions: new Map([
    ["n1", { x: 0, y: 0 }],
    ["n2", { x: 1, y: 0 }],
    ["n3", { x: 2, y: 0 }],
  ]),
};

function makeResult(runningPcts: number[], labels: string[]): ChainResult {
  return {
    perStationRunningPct: runningPcts,
    perStationLabels: labels,
  } as unknown as ChainResult;
}

describe("scenarioToWorkers (VROL-212)", () => {
  it("returns no workers when result is null", () => {
    const out = scenarioToWorkers(layout, null, new Map());
    expect(out).toHaveLength(0);
  });

  it("emits one worker per station with pct > 0", () => {
    const result = makeResult([0.9, 0, 0.4], ["A", "B", "C"]);
    const idxToNodeId = new Map([
      [0, "n1"],
      [1, "n2"],
      [2, "n3"],
    ]);
    const out = scenarioToWorkers(layout, result, idxToNodeId);
    expect(out).toHaveLength(2);
    expect(out.map((w) => w.id).sort()).toEqual(["w-n1", "w-n3"]);
  });

  it("marks stations under the idle threshold as idle mode", () => {
    const result = makeResult([0.9, 0.02], ["A", "B"]);
    const idxToNodeId = new Map([
      [0, "n1"],
      [1, "n2"],
    ]);
    const out = scenarioToWorkers(layout, result, idxToNodeId);
    const byId = new Map(out.map((w) => [w.id, w] as const));
    expect(byId.get("w-n1")?.mode).toBe("working");
    expect(byId.get("w-n2")?.mode).toBe("idle");
  });

  it("offsets workers off the exact station centre so they don't hide the body", () => {
    const result = makeResult([0.5], ["A"]);
    const out = scenarioToWorkers(layout, result, new Map([[0, "n1"]]));
    expect(out[0]?.x).toBeGreaterThan(0);
    expect(out[0]?.y).toBeGreaterThan(0);
  });

  it("skips indices whose node id isn't in the map", () => {
    const result = makeResult([1.0, 1.0], ["A", "Ghost"]);
    const idxToNodeId = new Map([[0, "n1"]]);
    const out = scenarioToWorkers(layout, result, idxToNodeId);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("w-n1");
  });
});

describe("topologyIndexToNodeIdMap (VROL-212)", () => {
  it("maps each topology index to its react-flow node, consuming each label once", () => {
    const nodes = [
      { id: "a", type: "station", data: { label: "Filler" } },
      { id: "b", type: "station", data: { label: "Filler" } },
      { id: "c", type: "station", data: { label: "Packer" } },
    ];
    const m = topologyIndexToNodeIdMap(nodes, ["Filler", "Filler", "Packer"]);
    expect(m.get(0)).toBe("a");
    expect(m.get(1)).toBe("b");
    expect(m.get(2)).toBe("c");
  });

  it("skips non-station nodes", () => {
    const nodes = [
      { id: "sticky1", type: "sticky", data: { label: "Note" } },
      { id: "n1", type: "station", data: { label: "Mixer" } },
    ];
    const m = topologyIndexToNodeIdMap(nodes, ["Mixer"]);
    expect(m.size).toBe(1);
    expect(m.get(0)).toBe("n1");
  });
});
