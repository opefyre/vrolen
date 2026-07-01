import { describe, expect, it } from "vitest";

import type { Edge, Node } from "@xyflow/react";

import { scenarioToIsoLayout } from "./scenario-to-iso-layout";

function station(id: string): Node {
  return { id, type: "station", position: { x: 0, y: 0 }, data: {} };
}
function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

describe("scenarioToIsoLayout (VROL-858)", () => {
  it("assigns layer 0 to source, incremented layers down a linear chain", () => {
    const nodes = [station("a"), station("b"), station("c")];
    const edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];
    const { positions, layerCount } = scenarioToIsoLayout(nodes, edges);
    expect(positions.get("a")?.x).toBe(0);
    expect(positions.get("b")?.x).toBe(1);
    expect(positions.get("c")?.x).toBe(2);
    expect(layerCount).toBe(3);
  });

  it("staggers parallel branches on distinct rows", () => {
    const nodes = [station("src"), station("a"), station("b"), station("sink")];
    const edges = [
      edge("e1", "src", "a"),
      edge("e2", "src", "b"),
      edge("e3", "a", "sink"),
      edge("e4", "b", "sink"),
    ];
    const { positions } = scenarioToIsoLayout(nodes, edges);
    expect(positions.get("a")?.y).not.toBe(positions.get("b")?.y);
    expect(positions.get("src")?.x).toBe(0);
    expect(positions.get("sink")?.x).toBe(2);
    expect(positions.get("a")?.x).toBe(1);
    expect(positions.get("b")?.x).toBe(1);
  });

  it("skips non-station nodes and dangling edges", () => {
    const nodes: Node[] = [
      station("s1"),
      { id: "sticky1", type: "sticky", position: { x: 0, y: 0 }, data: {} },
    ];
    const edges = [edge("e", "s1", "sticky1"), edge("e2", "s1", "s99")];
    const { positions, layerCount } = scenarioToIsoLayout(nodes, edges);
    expect(positions.size).toBe(1);
    expect(positions.get("s1")?.x).toBe(0);
    expect(layerCount).toBe(1);
  });

  it("gives cycle members a layer even when strict topo would loop", () => {
    const nodes = [station("a"), station("b")];
    const edges = [edge("e1", "a", "b"), edge("e2", "b", "a")];
    const { positions } = scenarioToIsoLayout(nodes, edges);
    expect(positions.get("a")).toBeDefined();
    expect(positions.get("b")).toBeDefined();
  });

  it("puts a downstream diamond at layer=max(source)+1", () => {
    const nodes = [station("a"), station("b"), station("c"), station("d")];
    const edges = [edge("e1", "a", "c"), edge("e2", "b", "c"), edge("e3", "c", "d")];
    const { positions } = scenarioToIsoLayout(nodes, edges);
    expect(positions.get("a")?.x).toBe(0);
    expect(positions.get("b")?.x).toBe(0);
    expect(positions.get("c")?.x).toBe(1);
    expect(positions.get("d")?.x).toBe(2);
  });
});
