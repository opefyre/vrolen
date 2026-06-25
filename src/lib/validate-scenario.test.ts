import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_RUN_SETTINGS, type RunSettings } from "@/routes/editor-run-settings";

import { validateScenario } from "./validate-scenario";

function node(id: string, data: Record<string, unknown> = {}): Node {
  return { id, position: { x: 0, y: 0 }, data: { label: id, ...data } };
}
function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

function settings(overrides: Partial<RunSettings> = {}): RunSettings {
  return { ...DEFAULT_RUN_SETTINGS, ...overrides };
}

describe("validateScenario (VROL-86)", () => {
  // ─── 1. Schema ─────────────────────────────────────────────────────────────
  it("schema: flags node with empty id as error", () => {
    const r = validateScenario(
      [node("a"), { ...node("b"), id: "" }, node("c")],
      [edge("e1", "a", "c")],
      settings(),
    );
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain("SCHEMA_NODE_ID_MISSING");
  });

  it("schema: passes for a well-formed minimal graph", () => {
    const r = validateScenario([node("a"), node("b")], [edge("e", "a", "b")], settings());
    expect(r.errors.filter((e) => e.category === "schema")).toEqual([]);
  });

  // ─── 2. Reference integrity ────────────────────────────────────────────────
  it("reference: edge sourcing from unknown node is an error", () => {
    const r = validateScenario([node("a"), node("b")], [edge("e", "ghost", "b")], settings());
    const err = r.errors.find((e) => e.code === "REF_EDGE_SOURCE_UNKNOWN");
    expect(err).toBeDefined();
    expect(err!.fix).toContain("ghost");
  });

  it("reference: rework target pointing at unknown node is an error", () => {
    const r = validateScenario(
      [node("a"), node("b", { reworkTargetNodeId: "ghost" })],
      [edge("e", "a", "b")],
      settings(),
    );
    expect(r.errors.find((e) => e.code === "REF_REWORK_TARGET_UNKNOWN")).toBeDefined();
  });

  it("reference: rework target that exists but is off-chain is a warning (VROL-AUDIT)", () => {
    // disconnected (no edges to/from) — exists in the node set but not in
    // the reachable chain. graph-to-chain silently drops it.
    const r = validateScenario(
      [node("a"), node("b", { reworkTargetNodeId: "disconnected" }), node("disconnected")],
      [edge("e", "a", "b")],
      settings(),
    );
    const w = r.warnings.find((x) => x.code === "REF_REWORK_TARGET_OFFCHAIN");
    expect(w).toBeDefined();
    expect(w!.fixAction).toEqual({ kind: "clear-rework-target", nodeId: "b" });
    expect(w!.message).toContain("scrapped");
  });

  // ─── 3. Topology ───────────────────────────────────────────────────────────
  it("topology: orphan node (no edges) emits a warning", () => {
    const r = validateScenario(
      [node("a"), node("b"), node("orphan")],
      [edge("e", "a", "b")],
      settings(),
    );
    const warn = r.warnings.find((w) => w.code === "TOPO_ORPHAN_NODE");
    expect(warn).toBeDefined();
    expect(warn!.message).toContain("orphan");
  });

  it("topology: empty scenario is an error", () => {
    const r = validateScenario([], [], settings());
    expect(r.errors.find((e) => e.code === "TOPO_EMPTY")).toBeDefined();
  });

  it("topology: cycle detection flags closed loops", () => {
    const r = validateScenario(
      [node("a"), node("b"), node("c")],
      [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a")],
      settings(),
    );
    expect(r.warnings.find((w) => w.code === "TOPO_CYCLE_DETECTED")).toBeDefined();
  });

  it("topology: multiple sources are an error (VROL-AUDIT — silent feature drop)", () => {
    const r = validateScenario(
      [node("a"), node("b"), node("c")],
      [edge("e1", "a", "c"), edge("e2", "b", "c")],
      settings(),
    );
    const err = r.errors.find((e) => e.code === "TOPO_MULTIPLE_SOURCES");
    expect(err).toBeDefined();
    // Message must explain why this blocks (silent feature drop).
    expect(err!.message).toMatch(/silently dropped/i);
  });

  it("topology: multiple sinks are an error (VROL-AUDIT — silent feature drop)", () => {
    const r = validateScenario(
      [node("source"), node("b"), node("c")],
      [edge("e1", "source", "b"), edge("e2", "source", "c")],
      settings(),
    );
    const err = r.errors.find((e) => e.code === "TOPO_MULTIPLE_SINKS");
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/silently dropped/i);
  });

  it("topology: single-source/single-sink linear chain stays clean (VROL-AUDIT regression)", () => {
    const r = validateScenario(
      [node("a"), node("b"), node("c")],
      [edge("e1", "a", "b"), edge("e2", "b", "c")],
      settings(),
    );
    expect(r.errors.find((e) => e.category === "topology")).toBeUndefined();
  });

  // ─── 4. Resource feasibility ───────────────────────────────────────────────
  it("resource: station requires a skill no worker has → error with suggested fix", () => {
    const r = validateScenario(
      [node("a"), node("b", { skills: ["welding"] })],
      [edge("e", "a", "b")],
      settings({
        workers: {
          enabled: true,
          list: [{ name: "Alex", skills: ["cap"], shiftEndMs: 60_000 }],
        },
      }),
    );
    const err = r.errors.find((e) => e.code === "RES_SKILL_UNCOVERED");
    expect(err).toBeDefined();
    expect(err!.fix).toContain("welding");
  });

  it("resource: 'any' skill is always satisfied (special case)", () => {
    const r = validateScenario(
      [node("a"), node("b", { skills: ["any"] })],
      [edge("e", "a", "b")],
      settings({
        workers: {
          enabled: true,
          list: [{ name: "Alex", skills: [], shiftEndMs: 60_000 }],
        },
      }),
    );
    expect(r.errors.find((e) => e.category === "resource")).toBeUndefined();
  });

  it("resource: checks skip when workers disabled", () => {
    const r = validateScenario(
      [node("a"), node("b", { skills: ["welding"] })],
      [edge("e", "a", "b")],
      settings(),
    );
    expect(r.errors.find((e) => e.category === "resource")).toBeUndefined();
  });

  // ─── 5. Schedule sanity ────────────────────────────────────────────────────
  it("schedule: zero-duration break is an error", () => {
    const r = validateScenario(
      [node("a"), node("b")],
      [edge("e", "a", "b")],
      settings({
        workers: {
          enabled: true,
          list: [
            {
              name: "Alex",
              skills: ["any"],
              shiftEndMs: 60_000,
              breaks: [{ startMs: 1000, endMs: 1000 }],
            },
          ],
        },
      }),
    );
    expect(r.errors.find((e) => e.code === "SCHED_BREAK_ZERO_DURATION")).toBeDefined();
  });

  it("schedule: overlapping breaks emit an error", () => {
    const r = validateScenario(
      [node("a"), node("b")],
      [edge("e", "a", "b")],
      settings({
        workers: {
          enabled: true,
          list: [
            {
              name: "Alex",
              skills: ["any"],
              shiftEndMs: 60_000,
              breaks: [
                { startMs: 1000, endMs: 2000 },
                { startMs: 1500, endMs: 2500 },
              ],
            },
          ],
        },
      }),
    );
    expect(r.errors.find((e) => e.code === "SCHED_BREAK_OVERLAP")).toBeDefined();
  });

  // ─── 6. Recipe + material coverage ─────────────────────────────────────────
  it("recipe: materials enabled but both inventories zero → error", () => {
    const r = validateScenario(
      [node("a"), node("b")],
      [edge("e", "a", "b")],
      settings({
        materials: { ...DEFAULT_RUN_SETTINGS.materials, enabled: true, bottles: 0, caps: 0 },
      }),
    );
    expect(r.errors.find((e) => e.code === "RECIPE_NO_INVENTORY")).toBeDefined();
  });

  it("recipe: recurring delivery with amount=0 emits a warning", () => {
    const r = validateScenario(
      [node("a"), node("b")],
      [edge("e", "a", "b")],
      settings({
        materials: {
          ...DEFAULT_RUN_SETTINGS.materials,
          enabled: true,
          bottles: 100,
          caps: 100,
          recurring: [{ material: "bottles", amount: 0, intervalMs: 60_000 }],
        },
      }),
    );
    expect(r.warnings.find((w) => w.code === "RECIPE_RECURRING_ZERO_AMOUNT")).toBeDefined();
  });

  // ─── findIssuesForField (VROL-660) ─────────────────────────────────────────
  it("findIssuesForField matches issues by nodeId + field key", async () => {
    const { findIssuesForField } = await import("./validate-scenario");
    const r = validateScenario(
      [node("a"), node("b", { reworkTargetNodeId: "ghost" })],
      [edge("e", "a", "b")],
      settings(),
    );
    const all = [...r.errors, ...r.warnings];
    const found = findIssuesForField(all, "b", "reworkTargetNodeId");
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("REF_REWORK_TARGET_UNKNOWN");
    // Wrong field key → no match.
    expect(findIssuesForField(all, "b", "skills")).toEqual([]);
    // Wrong node id → no match.
    expect(findIssuesForField(all, "a", "reworkTargetNodeId")).toEqual([]);
  });

  // ─── Fix actions (VROL-658) ────────────────────────────────────────────────
  it("orphan node carries a delete-node fixAction", () => {
    const r = validateScenario(
      [node("a"), node("b"), node("orphan")],
      [edge("e", "a", "b")],
      settings(),
    );
    const warn = r.warnings.find((w) => w.code === "TOPO_ORPHAN_NODE");
    expect(warn?.fixAction).toEqual({ kind: "delete-node", nodeId: "orphan" });
  });

  it("rework-target-unknown carries a clear-rework-target fixAction", () => {
    const r = validateScenario(
      [node("a"), node("b", { reworkTargetNodeId: "ghost" })],
      [edge("e", "a", "b")],
      settings(),
    );
    const err = r.errors.find((e) => e.code === "REF_REWORK_TARGET_UNKNOWN");
    expect(err?.fixAction).toEqual({ kind: "clear-rework-target", nodeId: "b" });
  });

  it("edge with unknown source carries a delete-edge fixAction", () => {
    const r = validateScenario([node("a"), node("b")], [edge("e1", "ghost", "b")], settings());
    const err = r.errors.find((e) => e.code === "REF_EDGE_SOURCE_UNKNOWN");
    expect(err?.fixAction).toEqual({ kind: "delete-edge", edgeId: "e1" });
  });

  // ─── Sprint 90/91 constraint warnings (VROL-934 / VROL-957) ───────────────
  it("BOM qty > 10 is flagged as suspicious", () => {
    const r = validateScenario(
      [node("a"), node("b", { bomFeeders: [{ feederStationId: "a", qtyPerCycle: 25 }] })],
      [edge("e", "a", "b")],
      settings(),
    );
    const w = r.warnings.find((x) => x.code === "BOM_QTY_SUSPICIOUS");
    expect(w).toBeDefined();
    expect(w?.nodeId).toBe("b");
  });

  it("BOM feeder pointing at a station not in the graph is a warning", () => {
    const r = validateScenario(
      [node("a"), node("b", { bomFeeders: [{ feederStationId: "ghost", qtyPerCycle: 2 }] })],
      [edge("e", "a", "b")],
      settings(),
    );
    expect(r.warnings.find((x) => x.code === "BOM_FEEDER_NOT_IN_GRAPH")).toBeDefined();
  });

  it("requiredToolPool not declared in RunSettings.toolPools is a warning", () => {
    const r = validateScenario(
      [node("a", { requiredToolPool: "chambers" }), node("b")],
      [edge("e", "a", "b")],
      settings(),
    );
    const w = r.warnings.find((x) => x.code === "TOOL_POOL_UNDECLARED");
    expect(w).toBeDefined();
    expect(w?.nodeId).toBe("a");
  });

  it("tool pool oversubscribed (demand > 2x capacity) is a warning", () => {
    const r = validateScenario(
      [
        node("a", { requiredToolPool: "p" }),
        node("b", { requiredToolPool: "p" }),
        node("c", { requiredToolPool: "p" }),
      ],
      [edge("e1", "a", "b"), edge("e2", "b", "c")],
      settings({ toolPools: [{ name: "p", capacity: 1 }] }),
    );
    expect(r.warnings.find((x) => x.code === "TOOL_POOL_OVERSUBSCRIBED")).toBeDefined();
  });

  it("perSkuRouting SKU not in products.list is a warning", () => {
    const r = validateScenario(
      [node("a", { perSkuRouting: { "sku-X": "b" } }), node("b")],
      [edge("e", "a", "b")],
      settings({
        products: {
          enabled: true,
          list: [{ id: "sku-A", name: "A", weight: 1 }],
        },
      }),
    );
    expect(r.warnings.find((x) => x.code === "ROUTING_PRODUCT_NOT_IN_LIST")).toBeDefined();
  });

  it("perSkuRouting destination not in graph is a warning", () => {
    const r = validateScenario(
      [node("a", { perSkuRouting: { "sku-A": "ghost" } }), node("b")],
      [edge("e", "a", "b")],
      settings({
        products: {
          enabled: true,
          list: [{ id: "sku-A", name: "A", weight: 1 }],
        },
      }),
    );
    expect(r.warnings.find((x) => x.code === "ROUTING_DEST_NOT_IN_GRAPH")).toBeDefined();
  });

  // ─── Result shape sanity ───────────────────────────────────────────────────
  it("returns empty errors + empty warnings for a clean linear scenario", () => {
    const r = validateScenario(
      [node("source"), node("middle"), node("sink")],
      [edge("e1", "source", "middle"), edge("e2", "middle", "sink")],
      settings(),
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  // ─── 8. VROL-867 v1 — UoM consistency ───────────────────────────────────────
  it("UOM_MISMATCH: edge crossing kg → L warns", () => {
    const r = validateScenario(
      [node("src", { unit: "kg" }), node("sink", { unit: "L" })],
      [edge("e1", "src", "sink")],
      settings(),
    );
    const mismatch = r.warnings.find((w) => w.code === "UOM_MISMATCH");
    expect(mismatch).toBeDefined();
    expect(mismatch?.message).toContain("kg");
    expect(mismatch?.message).toContain("L");
  });

  it("UOM_MISMATCH: same units on both ends stay clean", () => {
    const r = validateScenario(
      [node("src", { unit: "kg" }), node("sink", { unit: "kg" })],
      [edge("e1", "src", "sink")],
      settings(),
    );
    expect(r.warnings.find((w) => w.code === "UOM_MISMATCH")).toBeUndefined();
  });

  it("UOM_MISMATCH: empty unit on either side is silent (default = parts)", () => {
    const r = validateScenario(
      [node("src", { unit: "kg" }), node("sink")],
      [edge("e1", "src", "sink")],
      settings(),
    );
    expect(r.warnings.find((w) => w.code === "UOM_MISMATCH")).toBeUndefined();
  });
});
