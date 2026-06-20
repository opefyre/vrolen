import { beforeEach, describe, expect, it } from "vitest";

import { buildBundle, importBundle, isBundle, type ScenarioBundle } from "./scenario-bundle";
import { _clearStoreForTests, listScenarios, saveScenario } from "./scenario-store";

beforeEach(() => {
  _clearStoreForTests();
});

const emptyPayload = {
  graph: { nodes: [], edges: [] },
  settings: { horizonMs: 1000, warmupMs: 0 } as never,
};

describe("scenario-bundle", () => {
  it("buildBundle round-trips the saved scenarios", () => {
    saveScenario("alpha", emptyPayload);
    saveScenario("beta", emptyPayload);
    const b = buildBundle(123);
    expect(b.kind).toBe("vrolen-scenario-bundle");
    expect(b.version).toBe(1);
    expect(b.exportedAtMs).toBe(123);
    expect(b.scenarios).toHaveLength(2);
  });

  it("isBundle rejects junk", () => {
    expect(isBundle({})).toBe(false);
    expect(isBundle({ kind: "other", version: 1, scenarios: [] })).toBe(false);
    expect(isBundle(buildBundle(1))).toBe(true);
  });

  it("importBundle with skip leaves existing alone", () => {
    saveScenario("alpha", emptyPayload);
    const bundle: ScenarioBundle = buildBundle(1);
    saveScenario("alpha", {
      ...emptyPayload,
      settings: { horizonMs: 9999, warmupMs: 0 } as never,
    });
    const summary = importBundle(bundle, new Set(["alpha"]), "skip");
    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
    // didn't overwrite
    expect(listScenarios()[0]?.name).toBe("alpha");
  });

  it("importBundle with overwrite replaces existing", () => {
    saveScenario("alpha", emptyPayload);
    const bundle = buildBundle(1);
    saveScenario("alpha", {
      ...emptyPayload,
      settings: { horizonMs: 9999, warmupMs: 0 } as never,
    });
    const summary = importBundle(bundle, new Set(["alpha"]), "overwrite");
    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(0);
  });

  it("respects the selected name set", () => {
    saveScenario("alpha", emptyPayload);
    saveScenario("beta", emptyPayload);
    const bundle = buildBundle(1);
    _clearStoreForTests();
    const summary = importBundle(bundle, new Set(["alpha"]), "overwrite");
    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(listScenarios().map((s) => s.name)).toEqual(["alpha"]);
  });
});
