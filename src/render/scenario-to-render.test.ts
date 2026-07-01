import { describe, expect, it } from "vitest";

import type { Edge, Node } from "@xyflow/react";
import type { ChainResult } from "@/engine";

import { scenarioToRender } from "./scenario-to-render";

function mkStation(id: string, label: string, x: number, y: number): Node {
  return {
    id,
    type: "station",
    position: { x, y },
    data: { label },
  };
}

describe("scenarioToRender (VROL-855)", () => {
  it("returns idle stations + zero-flow edges when no result is present", () => {
    const nodes: Node[] = [mkStation("n1", "Mixer", 60, 180), mkStation("n2", "Packer", 260, 180)];
    const edges: Edge[] = [{ id: "e1-2", source: "n1", target: "n2" }];
    const out = scenarioToRender(nodes, edges, null);
    expect(out.stations).toHaveLength(2);
    expect(out.stations[0]?.state).toBe("idle");
    expect(out.stations[0]?.isBottleneck).toBe(false);
    expect(out.stations[0]?.x).toBeCloseTo(60 / 200);
    expect(out.stations[0]?.y).toBeCloseTo(180 / 140);
    expect(out.edges).toEqual([{ id: "e1-2", sourceId: "n1", targetId: "n2", flowRate: 0 }]);
  });

  it("maps dominant state per station from the last sample", () => {
    const nodes: Node[] = [mkStation("n1", "Mixer", 60, 180), mkStation("n2", "Packer", 260, 180)];
    const result = {
      samples: [
        {
          perStationStateMs: [
            { Running: 8_000, Starved: 1_000 },
            { BlockedOut: 5_000, Running: 2_000 },
          ],
        },
      ],
      perStationLabels: ["Mixer", "Packer"],
      throughputLambda: 0.01,
      bottleneckStationIdx: 1,
    } as unknown as ChainResult;
    const out = scenarioToRender(nodes, [], result);
    expect(out.stations[0]?.state).toBe("running");
    expect(out.stations[1]?.state).toBe("blocked");
    expect(out.stations[1]?.isBottleneck).toBe(true);
  });

  it("skips non-station nodes and dangling edges", () => {
    const nodes: Node[] = [
      mkStation("n1", "Mixer", 0, 0),
      { id: "sticky1", type: "sticky", position: { x: 0, y: 0 }, data: {} },
    ];
    const edges: Edge[] = [
      { id: "e1", source: "n1", target: "sticky1" },
      { id: "e2", source: "n1", target: "n99" },
    ];
    const out = scenarioToRender(nodes, edges, null);
    expect(out.stations).toHaveLength(1);
    expect(out.edges).toHaveLength(0);
  });

  it("forwards throughputLambda × 1000 as flowRate (parts / sec)", () => {
    const nodes: Node[] = [mkStation("n1", "A", 0, 0), mkStation("n2", "B", 200, 0)];
    const edges: Edge[] = [{ id: "e", source: "n1", target: "n2" }];
    const result = {
      samples: [],
      perStationLabels: [],
      throughputLambda: 0.005,
      bottleneckStationIdx: 0,
    } as unknown as ChainResult;
    const out = scenarioToRender(nodes, edges, result);
    expect(out.edges[0]?.flowRate).toBe(5);
  });

  it("consumes each topology label only once when node labels duplicate", () => {
    const nodes: Node[] = [
      mkStation("a", "Filler", 0, 0),
      mkStation("b", "Filler", 200, 0),
      mkStation("c", "Packer", 400, 0),
    ];
    const result = {
      samples: [
        {
          perStationStateMs: [{ Running: 1000 }, { Down: 1000 }, { Setup: 1000 }],
        },
      ],
      perStationLabels: ["Filler", "Filler", "Packer"],
      throughputLambda: 0,
      bottleneckStationIdx: -1,
    } as unknown as ChainResult;
    const out = scenarioToRender(nodes, [], result);
    expect(out.stations[0]?.state).toBe("running");
    expect(out.stations[1]?.state).toBe("down");
    expect(out.stations[2]?.state).toBe("setup");
  });
});
