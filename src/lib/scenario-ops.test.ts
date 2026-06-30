/**
 * VROL-355 / VROL-1156 — scenario-ops tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _clearStoreForTests, listScenarios, loadScenario, saveScenario } from "./scenario-store";
import { duplicateScenario, validateScenarioName } from "./scenario-ops";
import { DEFAULT_RUN_SETTINGS } from "@/routes/editor-run-settings";

beforeEach(() => {
  _clearStoreForTests();
});
afterEach(() => {
  _clearStoreForTests();
});

function seed(name = "A") {
  saveScenario(name, {
    graph: { nodes: [], edges: [] },
    settings: DEFAULT_RUN_SETTINGS,
    notes: "src notes",
  });
}

describe("validateScenarioName (VROL-1151)", () => {
  it("ok on a reasonable name", () => {
    expect(validateScenarioName("Bottling line v2", [])).toEqual({ ok: true });
  });

  it("rejects empty / whitespace-only", () => {
    const r = validateScenarioName("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });

  it("rejects > 60 chars", () => {
    const r = validateScenarioName("a".repeat(61));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-long");
  });

  it("rejects control characters", () => {
    const r = validateScenarioName("bad\x00name");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("control-char");
  });

  it("rejects reserved prefixes (case-insensitive)", () => {
    const r1 = validateScenarioName("vrolen.internal");
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("reserved");
    const r2 = validateScenarioName("VROLEN-INTERNAL-X");
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("reserved");
  });

  it("rejects duplicates against the supplied list", () => {
    const r = validateScenarioName("A", ["A", "B"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate");
  });

  it("uses current store as the duplicate-check default when no list supplied", () => {
    seed("Existing");
    const r = validateScenarioName("Existing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate");
  });

  it("accepts a tab character (not a control reject)", () => {
    expect(validateScenarioName("Col\tName", []).ok).toBe(true);
  });
});

describe("duplicateScenario (VROL-1150)", () => {
  it("copies graph + settings + notes under the new name", () => {
    seed("Src");
    duplicateScenario("Src", "Copy");
    expect(
      listScenarios()
        .map((s) => s.name)
        .sort(),
    ).toEqual(["Copy", "Src"]);
    const copy = loadScenario("Copy");
    expect(copy?.notes).toBe("src notes");
  });

  it("throws source-missing when the source doesn't exist", () => {
    expect(() => duplicateScenario("Ghost", "X")).toThrow(/not found/);
  });

  it("throws invalid-name when new name fails validation (duplicate)", () => {
    seed("Src");
    seed("Existing");
    expect(() => duplicateScenario("Src", "Existing")).toThrow(/already exists/);
  });

  it("throws invalid-name when new name is empty", () => {
    seed("Src");
    expect(() => duplicateScenario("Src", "  ")).toThrow(/empty/);
  });

  it("trims the new name before saving", () => {
    seed("Src");
    duplicateScenario("Src", "  Copy  ");
    expect(loadScenario("Copy")).toBeTruthy();
  });
});
