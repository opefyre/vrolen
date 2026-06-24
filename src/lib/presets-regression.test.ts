/**
 * VROL-472 — preset regression suite. Every preset runs with a fixed
 * seed; key KPIs are snapshotted via vitest. Any drift fails the test
 * so unintended engine behavior changes during refactors are caught.
 *
 * Updating a snapshot requires `pnpm test -u` and an explicit PR review —
 * no silent updates.
 */

import { describe, expect, it } from "vitest";

import { PRESETS } from "./presets";
import { runScenario } from "./run-scenario";

function summary(presetId: string) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`Preset "${presetId}" not found`);
  // Pick the first station as the materials anchor (matches typical
  // first-load UI behavior). Doesn't matter for presets that don't
  // enable materials.
  const firstStation = preset.graph.nodes[0]?.id ?? null;
  const outcome = runScenario(
    [...preset.graph.nodes],
    [...preset.graph.edges],
    preset.settings,
    firstStation,
  );
  if (!("result" in outcome)) {
    const msg = "message" in outcome ? outcome.message : "";
    throw new Error(`Preset "${presetId}" failed to run: ${outcome.kind} ${msg}`);
  }
  const r = outcome.result;
  // Round throughput + OEE to 6 decimals so seed-independent tiny FP
  // noise doesn't cause spurious snapshot misses. Counts stay exact.
  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
  return {
    completed: r.completed,
    throughputPartsPerHour: Math.round(r.throughputLambda * 3_600_000),
    lineOee: round(r.lineOee),
    avgTimeInSystemMs: Math.round(r.avgTimeInSystemW),
    bottleneckLabel: r.bottlenecks[0]?.label ?? null,
    bottleneckReason: r.bottlenecks[0]?.primaryReason ?? null,
  };
}

describe("preset regression (VROL-472)", () => {
  for (const preset of PRESETS) {
    it(`preset "${preset.id}" KPI summary matches snapshot`, () => {
      expect(summary(preset.id)).toMatchSnapshot();
    });
  }

  it("every preset runs without throwing + reports a non-negative count", () => {
    // Some presets (e.g., source-rate) deliberately produce 0 parts in the
    // measurement window because their first arrival happens during warmup.
    // The snapshot is the regression detector; this test just guards
    // against engine throws on any preset's config.
    for (const preset of PRESETS) {
      const s = summary(preset.id);
      expect(s.completed).toBeGreaterThanOrEqual(0);
    }
  });
});
