/**
 * VROL-786 — smoke tests for the shortcuts SoT.
 *
 * Confirms the export shape is intact and a couple of anchor entries exist
 * so a careless `git revert` can't silently strip the list.
 */

import { describe, expect, it } from "vitest";

import { SHORTCUTS, SHORTCUTS_FLAT } from "./shortcuts";

describe("shortcuts SoT", () => {
  it("exports at least one group with at least one item", () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0);
    for (const group of SHORTCUTS) {
      expect(group.group).toBeTruthy();
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.keys).toBeTruthy();
        expect(item.action).toBeTruthy();
      }
    }
  });

  it("includes the load-bearing anchors", () => {
    const actions = SHORTCUTS_FLAT.map((s) => s.action.toLowerCase());
    expect(actions).toContain("run simulation");
    expect(actions).toContain("undo");
    expect(actions).toContain("save active scenario");
  });

  it("SHORTCUTS_FLAT length equals the sum of group item counts", () => {
    const summed = SHORTCUTS.reduce((acc, g) => acc + g.items.length, 0);
    expect(SHORTCUTS_FLAT.length).toBe(summed);
  });
});
