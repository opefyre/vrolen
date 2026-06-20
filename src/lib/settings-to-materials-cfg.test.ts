import { describe, expect, it } from "vitest";

import { DEFAULT_RUN_SETTINGS, type MaterialsSettings } from "@/routes/editor-run-settings";

import { settingsToMaterialsCfg } from "./settings-to-materials-cfg";

function base(overrides: Partial<MaterialsSettings> = {}): MaterialsSettings {
  return { ...DEFAULT_RUN_SETTINGS.materials, enabled: true, ...overrides };
}

describe("settingsToMaterialsCfg (VROL-647)", () => {
  it("returns undefined when materials are disabled", () => {
    const cfg = settingsToMaterialsCfg({ ...base(), enabled: false }, 1);
    expect(cfg).toBeUndefined();
  });

  it("emits inventory + recipe at the requested station with no replenishments", () => {
    const cfg = settingsToMaterialsCfg(base({ bottles: 500, caps: 600 }), 2);
    expect(cfg).toBeDefined();
    expect(cfg!.initialInventory).toEqual([
      ["bottles", 500],
      ["caps", 600],
    ]);
    expect(cfg!.stationRecipes[0]?.stationIndex).toBe(2);
    expect(cfg!.replenishments).toBeUndefined();
    expect(cfg!.recurringReplenishments).toBeUndefined();
  });

  it("recipe qty per part comes from settings (VROL-293)", () => {
    const cfg = settingsToMaterialsCfg(base({ bottlesPerPart: 2, capsPerPart: 3 }), 1);
    expect(cfg!.stationRecipes[0]?.requirements).toEqual([
      { materialId: "bottles", qtyPerPart: 2 },
      { materialId: "caps", qtyPerPart: 3 },
    ]);
  });

  it("recipe drops a material when its qty per part is 0 (VROL-293)", () => {
    const cfg = settingsToMaterialsCfg(base({ bottlesPerPart: 1, capsPerPart: 0 }), 1);
    expect(cfg!.stationRecipes[0]?.requirements).toEqual([
      { materialId: "bottles", qtyPerPart: 1 },
    ]);
  });

  it("forwards one-shot + recurring replenishments + maxInventory cap", () => {
    const cfg = settingsToMaterialsCfg(
      base({
        replenishment: { enabled: true, atMs: 5_000, amount: 100 },
        recurring: [
          { material: "bottles", amount: 50, intervalMs: 60_000 },
          { material: "caps", amount: 20, intervalMs: 30_000, maxInventory: 200 },
        ],
      }),
      1,
    );
    expect(cfg!.replenishments).toEqual([{ materialId: "bottles", amount: 100, atMs: 5_000 }]);
    expect(cfg!.recurringReplenishments).toHaveLength(2);
    expect(cfg!.recurringReplenishments?.[0]).toMatchObject({
      materialId: "bottles",
      amount: 50,
      intervalMs: 60_000,
    });
    expect(cfg!.recurringReplenishments?.[1]).toMatchObject({
      materialId: "caps",
      amount: 20,
      intervalMs: 30_000,
      maxInventory: 200,
    });
  });
});
