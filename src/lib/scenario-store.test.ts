import type { Edge, Node } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_RUN_SETTINGS } from "@/routes/editor-run-settings";

import {
  _clearStoreForTests,
  deleteScenario,
  listScenarios,
  loadScenario,
  saveScenario,
} from "./scenario-store";

const sampleNodes: Node[] = [
  { id: "n1", position: { x: 0, y: 0 }, data: { label: "A" } },
  { id: "n2", position: { x: 200, y: 0 }, data: { label: "B" } },
];
const sampleEdges: Edge[] = [{ id: "n1-n2", source: "n1", target: "n2" }];

beforeEach(() => {
  _clearStoreForTests();
});

describe("scenario-store", () => {
  it("round-trips a scenario through save → list → load", () => {
    saveScenario("baseline", {
      graph: { nodes: sampleNodes, edges: sampleEdges },
      settings: DEFAULT_RUN_SETTINGS,
      savedAtMs: 1000,
    });
    const summaries = listScenarios();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.name).toBe("baseline");
    expect(summaries[0]?.nodeCount).toBe(2);
    expect(summaries[0]?.edgeCount).toBe(1);
    const loaded = loadScenario("baseline");
    expect(loaded?.graph.nodes).toEqual(sampleNodes);
    expect(loaded?.graph.edges).toEqual(sampleEdges);
  });

  it("sorts list output by savedAt descending (newest first)", () => {
    saveScenario("old", {
      graph: { nodes: sampleNodes, edges: sampleEdges },
      settings: DEFAULT_RUN_SETTINGS,
      savedAtMs: 100,
    });
    saveScenario("new", {
      graph: { nodes: sampleNodes, edges: sampleEdges },
      settings: DEFAULT_RUN_SETTINGS,
      savedAtMs: 5000,
    });
    const summaries = listScenarios();
    expect(summaries.map((s) => s.name)).toEqual(["new", "old"]);
  });

  it("overwrites a scenario when saving under the same name", () => {
    saveScenario("dup", {
      graph: { nodes: sampleNodes, edges: sampleEdges },
      settings: DEFAULT_RUN_SETTINGS,
      savedAtMs: 100,
    });
    const updatedNodes = [
      ...sampleNodes,
      { id: "n3", position: { x: 400, y: 0 }, data: {} } as Node,
    ];
    saveScenario("dup", {
      graph: { nodes: updatedNodes, edges: sampleEdges },
      settings: DEFAULT_RUN_SETTINGS,
      savedAtMs: 200,
    });
    expect(listScenarios()).toHaveLength(1);
    expect(loadScenario("dup")?.graph.nodes).toHaveLength(3);
  });

  it("rejects empty / whitespace-only names", () => {
    expect(() =>
      saveScenario("   ", {
        graph: { nodes: [], edges: [] },
        settings: DEFAULT_RUN_SETTINGS,
        savedAtMs: 0,
      }),
    ).toThrow(/empty/i);
  });

  it("deleteScenario removes the entry and reports whether it existed", () => {
    saveScenario("toDelete", {
      graph: { nodes: sampleNodes, edges: sampleEdges },
      settings: DEFAULT_RUN_SETTINGS,
      savedAtMs: 100,
    });
    expect(deleteScenario("toDelete")).toBe(true);
    expect(loadScenario("toDelete")).toBeNull();
    expect(deleteScenario("toDelete")).toBe(false); // already gone
  });

  it("trims surrounding whitespace from names on save", () => {
    saveScenario("  spaced  ", {
      graph: { nodes: sampleNodes, edges: sampleEdges },
      settings: DEFAULT_RUN_SETTINGS,
      savedAtMs: 100,
    });
    expect(loadScenario("spaced")).not.toBeNull();
  });
});
