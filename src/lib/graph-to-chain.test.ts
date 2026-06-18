import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { graphToChainOptions } from "./graph-to-chain";

function node(id: string, data: { label?: string; cycleMs?: number } = {}): Node {
  return { id, position: { x: 0, y: 0 }, data: { label: id, ...data } };
}
function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

describe("graphToChainOptions", () => {
  it("returns an error on an empty graph", () => {
    const r = graphToChainOptions([], []);
    expect(r.error).toMatch(/empty/i);
    expect(r.chainNodeIds).toHaveLength(0);
  });

  it("turns a simple linear chain into ordered cycleTimes + labels", () => {
    const nodes = [
      node("a", { label: "Filler", cycleMs: 50 }),
      node("b", { label: "Capper", cycleMs: 200 }),
      node("c", { label: "Labeler", cycleMs: 50 }),
    ];
    const edges = [edge("a", "b"), edge("b", "c")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.chainNodeIds).toEqual(["a", "b", "c"]);
    expect(r.cycleTimes).toEqual([50, 200, 50]);
    expect(r.stationLabels).toEqual(["Filler", "Capper", "Labeler"]);
    expect(r.skippedNodeIds).toEqual([]);
  });

  it("falls back to default cycle time when the node has no cycleMs", () => {
    const nodes = [node("a"), node("b")];
    const edges = [edge("a", "b")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.cycleTimes).toEqual([100, 100]);
  });

  it("rejects a cyclic graph", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toMatch(/cycle/i);
  });

  it("flags disconnected nodes as skipped, runs the connected chain", () => {
    const nodes = [node("a", { cycleMs: 50 }), node("b", { cycleMs: 200 }), node("loner")];
    const edges = [edge("a", "b")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.chainNodeIds).toEqual(["a", "b"]);
    expect(r.skippedNodeIds).toEqual(["loner"]);
  });

  it("when multiple sources exist, picks the one with the longest linear chain", () => {
    // a→b (2)   c→d→e→f (4)
    const nodes = ["a", "b", "c", "d", "e", "f"].map((id) => node(id));
    const edges = [edge("a", "b"), edge("c", "d"), edge("d", "e"), edge("e", "f")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.chainNodeIds).toEqual(["c", "d", "e", "f"]);
    expect([...r.skippedNodeIds].sort()).toEqual(["a", "b"]);
  });

  it("stops walking when a node has more than one successor (branch)", () => {
    // a → b, b → c, b → d (b branches; chain stops at b)
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("b", "d")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.chainNodeIds).toEqual(["a", "b"]);
    expect([...r.skippedNodeIds].sort()).toEqual(["c", "d"]);
  });

  it("ignores self-loops and edges referencing unknown ids", () => {
    const nodes = [node("a", { cycleMs: 50 }), node("b", { cycleMs: 100 })];
    const edges = [
      edge("a", "a"), // self-loop ignored
      edge("a", "b"),
      edge("b", "ghost"), // unknown target ignored
    ];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.chainNodeIds).toEqual(["a", "b"]);
  });
});
