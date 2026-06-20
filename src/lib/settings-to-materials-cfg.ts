/**
 * VROL-647 — single source of truth for translating drawer settings into the
 * engine's ChainMaterialConfig. EditorPage's canvas Run flow + run-scenario's
 * compare flow both call this so a future materials change touches one file,
 * not two.
 */

import { asMaterialId, type ChainMaterialConfig } from "@/engine";
import type { MaterialsSettings } from "@/routes/editor-run-settings";

const BOTTLES_ID = asMaterialId("bottles");
const CAPS_ID = asMaterialId("caps");

/**
 * Build a ChainMaterialConfig from drawer settings + the chain index of the
 * station that consumes materials. Returns undefined when materials are
 * disabled — callers should pass undefined straight through to runChain.
 *
 * stationIndex is whatever the caller resolved from the inspector selection;
 * passing a value outside the chain isn't this helper's concern (callers
 * already guard with their own UX before calling).
 */
export function settingsToMaterialsCfg(
  materials: MaterialsSettings,
  stationIndex: number,
): ChainMaterialConfig | undefined {
  if (!materials.enabled) return undefined;
  return {
    initialInventory: [
      [BOTTLES_ID, materials.bottles],
      [CAPS_ID, materials.caps],
    ],
    stationRecipes: [
      {
        stationIndex,
        // VROL-293 — qty per part is now user-controlled. Setting 0 drops
        // the requirement so a recipe of "bottle only" is a valid scenario.
        requirements: [
          ...(materials.bottlesPerPart > 0
            ? [{ materialId: BOTTLES_ID, qtyPerPart: materials.bottlesPerPart }]
            : []),
          ...(materials.capsPerPart > 0
            ? [{ materialId: CAPS_ID, qtyPerPart: materials.capsPerPart }]
            : []),
        ],
      },
    ],
    ...(materials.replenishment.enabled
      ? {
          replenishments: [
            {
              materialId: BOTTLES_ID,
              amount: materials.replenishment.amount,
              atMs: materials.replenishment.atMs,
            },
          ],
        }
      : {}),
    ...(materials.recurring.length > 0
      ? {
          recurringReplenishments: materials.recurring.map((r) => ({
            materialId: r.material === "caps" ? CAPS_ID : BOTTLES_ID,
            amount: r.amount,
            intervalMs: r.intervalMs,
            ...(r.maxInventory !== undefined ? { maxInventory: r.maxInventory } : {}),
          })),
        }
      : {}),
  };
}
