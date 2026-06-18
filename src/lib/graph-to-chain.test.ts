import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { Distribution } from "@/engine";
import { graphToChainOptions } from "./graph-to-chain";

function node(
  id: string,
  data: { label?: string; cycleMs?: number; cycleDistribution?: Distribution } = {},
): Node {
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

  it("returns stationKeys aligned with chainNodeIds (falls back to id when missing)", () => {
    // a has an explicit stationKey; b does not — should fall back to its id.
    const nodes = [node("a", { cycleMs: 50 }), node("b", { cycleMs: 100 })];
    (nodes[0]!.data as Record<string, unknown>).stationKey = "key-A";
    const edges = [edge("a", "b")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.stationKeys).toEqual(["key-A", "b"]);
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

  it("reads cycleDistribution from node.data when present (Normal kind)", () => {
    const nodes = [
      node("a", { cycleDistribution: { kind: "normal", mean: 120, stddev: 10 } }),
      node("b", { cycleDistribution: { kind: "constant", value: 200 } }),
    ];
    const edges = [edge("a", "b")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.cycleDistributions).toEqual([
      { kind: "normal", mean: 120, stddev: 10 },
      { kind: "constant", value: 200 },
    ]);
    // cycleTimes is the mean of each distribution
    expect(r.cycleTimes).toEqual([120, 200]);
  });

  it("falls back to constant(cycleMs) when cycleDistribution is missing (back-compat)", () => {
    const nodes = [node("a", { cycleMs: 75 }), node("b", { cycleMs: 175 })];
    const edges = [edge("a", "b")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.cycleDistributions).toEqual([
      { kind: "constant", value: 75 },
      { kind: "constant", value: 175 },
    ]);
    expect(r.cycleTimes).toEqual([75, 175]);
  });

  it("handles Triangular distribution shape", () => {
    const nodes = [
      node("a", { cycleDistribution: { kind: "triangular", min: 50, mode: 100, max: 200 } }),
    ];
    const edges: Edge[] = [];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    // mean = (min + mode + max) / 3 = 350/3 ≈ 116.66
    expect(r.cycleTimes[0]).toBeCloseTo(350 / 3, 4);
  });

  it("emits a topology for a diamond DAG (single source, single sink, branching)", () => {
    // a → b, a → c, b → d, c → d (diamond)
    const nodes = [
      node("a", { cycleMs: 50 }),
      node("b", { cycleMs: 200 }),
      node("c", { cycleMs: 200 }),
      node("d", { cycleMs: 50 }),
    ];
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.topology).not.toBeNull();
    expect(r.topology!.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
    expect(r.topology!.edges).toEqual([
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "d" },
      { source: "c", target: "d" },
    ]);
    expect(r.skippedNodeIds).toEqual([]);
  });

  it("emits no topology for a pure linear chain (callers stay on cycleDistributions)", () => {
    const nodes = [node("a", { cycleMs: 50 }), node("b", { cycleMs: 200 })];
    const edges = [edge("a", "b")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.topology).toBeNull();
    expect(r.chainNodeIds).toEqual(["a", "b"]);
  });

  it("falls back to linear when graph has multiple sinks (engine can't DAG it yet)", () => {
    // a → b → c, b → d (two sinks: c, d)
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("b", "d")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.topology).toBeNull();
    expect(r.chainNodeIds).toEqual(["a", "b"]);
    expect([...r.skippedNodeIds].sort()).toEqual(["c", "d"]);
  });
});
