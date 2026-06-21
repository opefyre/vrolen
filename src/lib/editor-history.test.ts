import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_RUN_SETTINGS } from "@/routes/editor-run-settings";

import {
  canRedo,
  canUndo,
  deserializeHistory,
  EMPTY_HISTORY,
  MAX_HISTORY,
  recordChange,
  redo,
  serializeHistory,
  snapshotKey,
  undo,
  type EditorSnapshot,
} from "./editor-history";

function snap(label: string, n = 0): EditorSnapshot {
  return {
    nodes: [{ id: label, position: { x: n, y: 0 }, data: { label } } as Node],
    edges: [] as Edge[],
    settings: DEFAULT_RUN_SETTINGS,
  };
}

describe("editor-history (VROL-309)", () => {
  it("recordChange pushes previous state to past[] + clears future[]", () => {
    let h = EMPTY_HISTORY;
    h = recordChange(h, snap("a"));
    h = recordChange(h, snap("b"));
    expect(h.past).toHaveLength(2);
    expect(h.past[0]?.nodes[0]?.id).toBe("a");
    expect(h.past[1]?.nodes[0]?.id).toBe("b");
    expect(h.future).toEqual([]);
  });

  it("undo applies the newest past entry + moves current to future[]", () => {
    let h = EMPTY_HISTORY;
    h = recordChange(h, snap("a"));
    h = recordChange(h, snap("b"));
    const live = snap("live");
    const result = undo(h, live);
    expect(result.applied?.nodes[0]?.id).toBe("b");
    expect(result.history.past).toHaveLength(1);
    expect(result.history.future).toHaveLength(1);
    expect(result.history.future[0]?.nodes[0]?.id).toBe("live");
  });

  it("undo returns null when there is nothing to undo", () => {
    const result = undo(EMPTY_HISTORY, snap("live"));
    expect(result.applied).toBeNull();
    expect(result.history.past).toEqual([]);
  });

  it("redo applies the newest future entry + moves current to past[]", () => {
    let h = EMPTY_HISTORY;
    h = recordChange(h, snap("a"));
    const u = undo(h, snap("live"));
    h = u.history;
    const result = redo(h, snap("after-undo"));
    expect(result.applied?.nodes[0]?.id).toBe("live");
    expect(result.history.future).toHaveLength(0);
    expect(result.history.past).toHaveLength(1);
  });

  it("recordChange after undo clears future[] (redo no longer available)", () => {
    let h = EMPTY_HISTORY;
    h = recordChange(h, snap("a"));
    h = undo(h, snap("live")).history;
    expect(canRedo(h)).toBe(true);
    h = recordChange(h, snap("after-fresh-change"));
    expect(canRedo(h)).toBe(false);
  });

  it("past[] caps at MAX_HISTORY, dropping oldest", () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < MAX_HISTORY + 5; i++) h = recordChange(h, snap(`s${String(i)}`));
    expect(h.past).toHaveLength(MAX_HISTORY);
    // Oldest dropped: first entry should be the 6th one we pushed (s5).
    expect(h.past[0]?.nodes[0]?.id).toBe("s5");
    expect(h.past[h.past.length - 1]?.nodes[0]?.id).toBe(`s${String(MAX_HISTORY + 4)}`);
  });

  it("serializeHistory + deserializeHistory round-trip (VROL-659)", () => {
    let h = EMPTY_HISTORY;
    h = recordChange(h, snap("a"));
    h = recordChange(h, snap("b"));
    const round = deserializeHistory(serializeHistory(h));
    expect(round.past).toHaveLength(2);
    expect(round.past[0]?.nodes[0]?.id).toBe("a");
    expect(round.future).toEqual([]);
  });

  it("deserializeHistory returns EMPTY_HISTORY on null / corrupt input (VROL-659)", () => {
    expect(deserializeHistory(null)).toEqual(EMPTY_HISTORY);
    expect(deserializeHistory("{not-json")).toEqual(EMPTY_HISTORY);
    expect(deserializeHistory("[]")).toEqual(EMPTY_HISTORY);
  });

  it("canUndo / canRedo reflect stack contents", () => {
    expect(canUndo(EMPTY_HISTORY)).toBe(false);
    expect(canRedo(EMPTY_HISTORY)).toBe(false);
    const after = recordChange(EMPTY_HISTORY, snap("a"));
    expect(canUndo(after)).toBe(true);
    expect(canRedo(after)).toBe(false);
  });
});

describe("snapshotKey (Sprint 86)", () => {
  function snapWith(overrides: Partial<Node>): EditorSnapshot {
    const base = snap("n");
    return {
      ...base,
      nodes: [{ ...(base.nodes[0] as Node), ...overrides }],
    };
  }
  it("same content → same key", () => {
    expect(snapshotKey(snap("a"))).toBe(snapshotKey(snap("a")));
  });
  it("different node label → different key", () => {
    expect(snapshotKey(snap("a"))).not.toBe(snapshotKey(snap("b")));
  });
  it("selection state does NOT change the key", () => {
    const k1 = snapshotKey(snapWith({ selected: false }));
    const k2 = snapshotKey(snapWith({ selected: true }));
    expect(k1).toBe(k2);
  });
  it("dragging state does NOT change the key", () => {
    const k1 = snapshotKey(snapWith({ dragging: false }));
    const k2 = snapshotKey(snapWith({ dragging: true }));
    expect(k1).toBe(k2);
  });
  it("measured size does NOT change the key", () => {
    const k1 = snapshotKey(snapWith({}));
    const k2 = snapshotKey(snapWith({ measured: { width: 180, height: 60 } }));
    expect(k1).toBe(k2);
  });
  it("sparklineSeries injected by sim run does NOT change the key", () => {
    const base = snap("n");
    const node = base.nodes[0] as Node;
    const k1 = snapshotKey(base);
    const k2 = snapshotKey({
      ...base,
      nodes: [
        {
          ...node,
          data: { ...(node.data as object), sparklineSeries: [1, 2, 3] },
        },
      ],
    });
    expect(k1).toBe(k2);
  });
  it("position change DOES change the key (real edit)", () => {
    const k1 = snapshotKey(snap("a", 0));
    const k2 = snapshotKey(snap("a", 100));
    expect(k1).not.toBe(k2);
  });
});
