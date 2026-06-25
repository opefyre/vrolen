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

  it("passes reworkTargetNodeId + defectRate through to topology nodes (VROL-627)", () => {
    // 3-station branching graph so we end up in DAG mode and topology nodes
    // are produced. b has defectRate + reworkTargetNodeId pointing back at a.
    const nodes = [
      node("a", { cycleMs: 50 }),
      node("b", { cycleMs: 100 }),
      node("c", { cycleMs: 50 }),
    ];
    (nodes[1]!.data as Record<string, unknown>).defectRate = 0.4;
    (nodes[1]!.data as Record<string, unknown>).reworkTargetNodeId = "a";
    const edges = [edge("a", "b"), edge("b", "c"), edge("a", "c")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.topology).toBeDefined();
    const bTopo = r.topology!.nodes.find((n) => n.id === "b");
    expect(bTopo?.defectRate).toBe(0.4);
    expect(bTopo?.reworkTargetId).toBe("a");
  });

  it("passes reworkPassLimit through to topology when rework target is set (VROL-638)", () => {
    const nodes = [
      node("a", { cycleMs: 50 }),
      node("b", { cycleMs: 100 }),
      node("c", { cycleMs: 50 }),
    ];
    (nodes[1]!.data as Record<string, unknown>).defectRate = 0.4;
    (nodes[1]!.data as Record<string, unknown>).reworkTargetNodeId = "a";
    (nodes[1]!.data as Record<string, unknown>).reworkPassLimit = 5;
    const edges = [edge("a", "b"), edge("b", "c"), edge("a", "c")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    const bTopo = r.topology!.nodes.find((n) => n.id === "b");
    expect(bTopo?.reworkPassLimit).toBe(5);
  });

  it("forwards capacity > 1 + drops capacity = 1 default (VROL-646)", () => {
    const nodes = [
      node("a", { cycleMs: 50 }),
      node("b", { cycleMs: 100 }),
      node("c", { cycleMs: 50 }),
    ];
    (nodes[1]!.data as Record<string, unknown>).capacity = 3;
    (nodes[2]!.data as Record<string, unknown>).capacity = 1; // default — should be dropped
    const edges = [edge("a", "b"), edge("b", "c"), edge("a", "c")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    const bTopo = r.topology!.nodes.find((n) => n.id === "b");
    const cTopo = r.topology!.nodes.find((n) => n.id === "c");
    expect(bTopo?.capacity).toBe(3);
    expect(cTopo?.capacity).toBeUndefined();
  });

  it("drops reworkPassLimit when no rework target is set (VROL-638)", () => {
    // A pass limit without a rework target is meaningless; translator drops
    // it so the engine schema stays clean.
    const nodes = [
      node("a", { cycleMs: 50 }),
      node("b", { cycleMs: 100 }),
      node("c", { cycleMs: 50 }),
    ];
    (nodes[1]!.data as Record<string, unknown>).reworkPassLimit = 5;
    const edges = [edge("a", "b"), edge("b", "c"), edge("a", "c")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    const bTopo = r.topology!.nodes.find((n) => n.id === "b");
    expect(bTopo?.reworkPassLimit).toBeUndefined();
  });

  it("drops a reworkTargetNodeId pointing at an unknown node id (VROL-627)", () => {
    // b references "ghost" which doesn't exist in the node list. Translator
    // must drop it so the engine doesn't throw on an unknown id at init —
    // the engine's own validation is a backstop, but the friendly path is
    // to silently drop here so other config is still runnable.
    const nodes = [
      node("a", { cycleMs: 50 }),
      node("b", { cycleMs: 100 }),
      node("c", { cycleMs: 50 }),
    ];
    (nodes[1]!.data as Record<string, unknown>).reworkTargetNodeId = "ghost";
    const edges = [edge("a", "b"), edge("b", "c"), edge("a", "c")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    const bTopo = r.topology!.nodes.find((n) => n.id === "b");
    expect(bTopo?.reworkTargetId).toBeUndefined();
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

  it("emits topology for a pure linear chain so per-station features flow through", () => {
    // Previously this test asserted topology === null for linear chains.
    // That was codifying a bug: when topology was null the engine fell
    // back to a linear-mode path that consumed ONLY stationCycleTimes +
    // labels, silently dropping capacity, defectRate, setupDistribution,
    // changeoverMatrix, reworkTargetId, and per-product cycles. Users
    // would set "Parallel cycles = 10" on the bottleneck and see no
    // change because the engine never saw the value. Now: any valid
    // single-source/single-sink graph (branching or not) emits topology
    // so the engine reads the full per-station config.
    const nodes = [node("a", { cycleMs: 50 }), node("b", { cycleMs: 200 })];
    const edges = [edge("a", "b")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.topology).not.toBeNull();
    expect(r.topology!.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(r.chainNodeIds).toEqual(["a", "b"]);
  });

  it("falls back to linear when graph has multiple sinks (engine can't DAG it yet)", () => {
    // a → b → c, b → d (two sinks: c, d)
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("b", "d")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    // VROL-880 — fallback now emits a topology object with per-station
    // settings instead of null. Without this, capacity / defectRate / setup
    // / changeoverMatrix / cycleByProduct / rework / skills / unitsPerCycle
    // were silently dropped on multi-source/sink graphs.
    expect(r.topology).not.toBeNull();
    expect(r.topology?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(r.chainNodeIds).toEqual(["a", "b"]);
    expect([...r.skippedNodeIds].sort()).toEqual(["c", "d"]);
  });

  it("VROL-880 — fallback topology carries per-station settings (defectRate, capacity, etc.)", () => {
    // a → b → c (single linear chain), but introduce a second sink to force
    // the fallback path. The fallback used to drop everything except cycle
    // distribution; this test pins the fix.
    const nodes = [
      node("a", { defectRate: 0.1, capacity: 3 }),
      node("b", { defectRate: 0.05 }),
      node("c"),
      node("d"),
    ];
    const edges = [edge("a", "b"), edge("b", "c"), edge("b", "d")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.topology).not.toBeNull();
    const aTopo = r.topology?.nodes.find((n) => n.id === "a");
    expect(aTopo?.defectRate).toBe(0.1);
    expect(aTopo?.capacity).toBe(3);
    const bTopo = r.topology?.nodes.find((n) => n.id === "b");
    expect(bTopo?.defectRate).toBe(0.05);
  });

  it("VROL-1003 — Transport stations populate bufferDelayMs on their outgoing edge", () => {
    const nodes: Node[] = [
      node("source", { cycleMs: 100 }),
      // Transport: 10m at 2 m/s → residence = 5000 ms.
      {
        id: "conv",
        position: { x: 0, y: 0 },
        data: { label: "conv", stationType: "transport", lengthM: 10, speedMps: 2 },
      },
      node("sink", { cycleMs: 100 }),
    ];
    const edges = [edge("source", "conv"), edge("conv", "sink")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.bufferDelayMs).toHaveLength(2);
    expect(r.bufferDelayMs[0]).toBe(0);
    expect(r.bufferDelayMs[1]).toBe(5_000);
  });

  it("VROL-1003 — Transport without lengthM/speedMps yields 0 delay", () => {
    const nodes: Node[] = [
      node("a", { cycleMs: 100 }),
      { id: "b", position: { x: 0, y: 0 }, data: { label: "b", stationType: "transport" } },
      node("c", { cycleMs: 100 }),
    ];
    const edges = [edge("a", "b"), edge("b", "c")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.bufferDelayMs).toEqual([0, 0]);
  });

  it("VROL-867 v1 — perStationUnit captures the per-station unit label in chain order", () => {
    const nodes: Node[] = [
      { id: "src", position: { x: 0, y: 0 }, data: { label: "src", cycleMs: 100, unit: "kg" } },
      { id: "mid", position: { x: 0, y: 0 }, data: { label: "mid", cycleMs: 100, unit: "kg" } },
      { id: "sink", position: { x: 0, y: 0 }, data: { label: "sink", cycleMs: 100, unit: "kg" } },
    ];
    const edges = [edge("src", "mid"), edge("mid", "sink")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.perStationUnit).toEqual(["kg", "kg", "kg"]);
  });

  it("VROL-867 v1 — missing unit fields default to empty strings", () => {
    const nodes = [node("a", { cycleMs: 100 }), node("b", { cycleMs: 100 })];
    const edges = [edge("a", "b")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.perStationUnit).toEqual(["", ""]);
  });

  it("VROL-1012 v2 — perStationUnitsPerPart captures the per-station ratio (defaults to 1)", () => {
    const nodes: Node[] = [
      {
        id: "src",
        position: { x: 0, y: 0 },
        data: { label: "src", cycleMs: 100, unit: "kg", unitsPerPart: 0.5 },
      },
      {
        id: "sink",
        position: { x: 0, y: 0 },
        data: { label: "sink", cycleMs: 100, unit: "kg", unitsPerPart: 0.5 },
      },
    ];
    const edges = [edge("src", "sink")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.perStationUnitsPerPart).toEqual([0.5, 0.5]);
  });

  it("VROL-1012 v2 — invalid ratios fall back to 1", () => {
    const nodes: Node[] = [
      {
        id: "a",
        position: { x: 0, y: 0 },
        data: { label: "a", cycleMs: 100, unitsPerPart: 0 },
      },
      {
        id: "b",
        position: { x: 0, y: 0 },
        data: { label: "b", cycleMs: 100, unitsPerPart: -1 },
      },
      {
        id: "c",
        position: { x: 0, y: 0 },
        data: { label: "c", cycleMs: 100 },
      },
    ];
    const edges = [edge("a", "b"), edge("b", "c")];
    const r = graphToChainOptions(nodes, edges);
    expect(r.error).toBeNull();
    expect(r.perStationUnitsPerPart).toEqual([1, 1, 1]);
  });
});
