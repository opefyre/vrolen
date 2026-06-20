/**
 * VROL-698 + VROL-699 — JSON bundle export / import for the full scenario
 * library. Bundle is a tagged JSON object so future versions can evolve
 * without ambiguity. Importing merges into the existing store using an
 * explicit conflict policy (overwrite | skip).
 */

import type { ScenarioPayload } from "./scenario-store";
import { listScenarios, loadScenario, saveScenario } from "./scenario-store";

export interface ScenarioBundle {
  readonly kind: "vrolen-scenario-bundle";
  readonly version: 1;
  readonly exportedAtMs: number;
  readonly scenarios: ReadonlyArray<{
    readonly name: string;
    readonly payload: ScenarioPayload;
  }>;
}

/**
 * VROL-704 — recursively sort object keys so the same set of scenarios
 * always serialises to a byte-identical bundle. Lets users diff exports
 * across time without spurious churn.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) out[k] = canonical((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

export function stringifyBundle(bundle: ScenarioBundle): string {
  return JSON.stringify(canonical(bundle), null, 2);
}

export function buildBundle(exportedAtMs: number): ScenarioBundle {
  const names = listScenarios().map((s) => s.name);
  const scenarios = names
    .map((name) => {
      const payload = loadScenario(name);
      return payload ? { name, payload } : null;
    })
    .filter((x): x is { name: string; payload: ScenarioPayload } => x !== null);
  return {
    kind: "vrolen-scenario-bundle",
    version: 1,
    exportedAtMs,
    scenarios,
  };
}

export interface ImportSummary {
  readonly imported: number;
  readonly skipped: number;
}

export function isBundle(value: unknown): value is ScenarioBundle {
  if (!value || typeof value !== "object") return false;
  const v = value as { kind?: unknown; version?: unknown; scenarios?: unknown };
  return v.kind === "vrolen-scenario-bundle" && v.version === 1 && Array.isArray(v.scenarios);
}

export type ConflictPolicy = "overwrite" | "skip";

export function importBundle(
  bundle: ScenarioBundle,
  selectedNames: ReadonlySet<string>,
  policy: ConflictPolicy,
): ImportSummary {
  const existing = new Set(listScenarios().map((s) => s.name));
  let imported = 0;
  let skipped = 0;
  for (const entry of bundle.scenarios) {
    if (!selectedNames.has(entry.name)) {
      skipped++;
      continue;
    }
    if (existing.has(entry.name) && policy === "skip") {
      skipped++;
      continue;
    }
    saveScenario(entry.name, {
      graph: entry.payload.graph,
      settings: entry.payload.settings,
      savedAtMs: entry.payload.savedAtMs,
      ...(entry.payload.notes !== undefined ? { notes: entry.payload.notes } : {}),
    });
    imported++;
  }
  return { imported, skipped };
}
