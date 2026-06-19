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

  it("topology: multiple sources warn", () => {
    const r = validateScenario(
      [node("a"), node("b"), node("c")],
      [edge("e1", "a", "c"), edge("e2", "b", "c")],
      settings(),
    );
    expect(r.warnings.find((w) => w.code === "TOPO_MULTIPLE_SOURCES")).toBeDefined();
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
});
