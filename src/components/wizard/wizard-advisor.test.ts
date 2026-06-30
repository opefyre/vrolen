import { describe, expect, it } from "vitest";

import { constant } from "@/engine";

import { defaultDraft } from "./wizard-types";
import type { WizardDraft } from "./wizard-types";
import { analyzeWizardDraft } from "./wizard-advisor";

function withStation(
  draft: WizardDraft,
  idx: number,
  patch: Partial<WizardDraft["stations"][number]>,
): WizardDraft {
  return {
    ...draft,
    stations: draft.stations.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
  };
}

describe("analyzeWizardDraft (VROL-795)", () => {
  it("returns nothing for a sensible default draft", () => {
    const warnings = analyzeWizardDraft(defaultDraft());
    // Defaults are tuned to be neutral — no advisor warnings.
    expect(warnings).toEqual([]);
  });

  it("flags suspiciously-fast cycle (< 50ms)", () => {
    const draft = withStation(defaultDraft(), 0, { cycleDistribution: constant(10) });
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id.startsWith("cycle-too-fast-"))).toBe(true);
  });

  it("flags suspiciously-slow cycle (> 1 hour)", () => {
    const draft = withStation(defaultDraft(), 0, { cycleDistribution: constant(2 * 3_600_000) });
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id.startsWith("cycle-too-slow-"))).toBe(true);
  });

  it("flags very high defect rate (> 30%)", () => {
    const draft = withStation(defaultDraft(), 0, { defectRate: 0.5 });
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id.startsWith("defect-too-high-"))).toBe(true);
  });

  it("flags MTTR exceeding MTBF in the realism step", () => {
    const draft: WizardDraft = {
      ...defaultDraft(),
      breakdowns: { enabled: true, mtbfMs: 60_000, mttrMs: 600_000 },
    };
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id === "mttr-exceeds-mtbf")).toBe(true);
  });

  it("flags warm-up taking more than half the horizon", () => {
    const draft: WizardDraft = {
      ...defaultDraft(),
      horizonMs: 100_000,
      warmupMs: 80_000,
    };
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id === "warmup-too-large")).toBe(true);
  });

  it("does NOT flag warm-up when breakdowns are disabled (no MTTR/MTBF check)", () => {
    const draft: WizardDraft = {
      ...defaultDraft(),
      breakdowns: { enabled: false, mtbfMs: 10, mttrMs: 100_000 },
    };
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id === "mttr-exceeds-mtbf")).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Sprint 182 — VROL-1079 → VROL-1085: 7 new advisor warnings.
  // Each rule gets a positive (predicate fires) + a negative case.
  // ────────────────────────────────────────────────────────────────────────

  it("VROL-1079 — buffer-cap-extreme fires when buffer > 1000", () => {
    const draft: WizardDraft = {
      ...defaultDraft(),
      interStationBufferCapacity: 5_000,
    };
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id === "buffer-cap-extreme")).toBe(true);
  });

  it("VROL-1079 — buffer-cap-extreme hidden at sensible values", () => {
    const draft: WizardDraft = {
      ...defaultDraft(),
      interStationBufferCapacity: 50,
    };
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id === "buffer-cap-extreme")).toBe(false);
  });

  it("VROL-1080 — setup-dominates-cycle fires when setup > 2× cycle", () => {
    // Default station has cycle 50-150ms ish; force a known cycle + setup.
    const draft = withStation(defaultDraft(), 0, {
      cycleDistribution: constant(100),
      setupDistribution: constant(500),
    });
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id.startsWith("setup-dominates-cycle-"))).toBe(true);
  });

  it("VROL-1080 — setup-dominates-cycle hidden when setup is short", () => {
    const draft = withStation(defaultDraft(), 0, {
      cycleDistribution: constant(100),
      setupDistribution: constant(50),
    });
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id.startsWith("setup-dominates-cycle-"))).toBe(false);
  });

  it("VROL-1081 — replications-very-high fires above 20", () => {
    const draft: WizardDraft = { ...defaultDraft(), replications: 30 };
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id === "replications-very-high")).toBe(true);
  });

  it("VROL-1081 — replications-very-high hidden in the typical range", () => {
    const draft: WizardDraft = { ...defaultDraft(), replications: 5 };
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id === "replications-very-high")).toBe(false);
  });

  it("VROL-1082 — reps-one-with-stochastic fires when reps=1 + non-constant cycle", () => {
    const draft = withStation({ ...defaultDraft(), replications: 1 }, 0, {
      cycleDistribution: { kind: "uniform", min: 50, max: 150 },
    });
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id === "reps-one-with-stochastic")).toBe(true);
  });

  it("VROL-1082 — reps-one-with-stochastic hidden when all cycles are constant", () => {
    const draft = withStation({ ...defaultDraft(), replications: 1 }, 0, {
      cycleDistribution: constant(100),
    });
    // Also make sure the default draft's other stations are constant.
    const fixed: WizardDraft = {
      ...draft,
      stations: draft.stations.map((s) => ({
        ...s,
        cycleDistribution: constant(100),
      })),
    };
    const w = analyzeWizardDraft(fixed);
    expect(w.some((x) => x.id === "reps-one-with-stochastic")).toBe(false);
  });

  it("VROL-1082 — reps-one-with-stochastic hidden when reps > 1 even with stochastic cycles", () => {
    const draft = withStation({ ...defaultDraft(), replications: 5 }, 0, {
      cycleDistribution: { kind: "uniform", min: 50, max: 150 },
    });
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id === "reps-one-with-stochastic")).toBe(false);
  });

  it("VROL-1083 — defect-no-rework fires when defectRate > 10% and no rework target", () => {
    const draft = withStation(defaultDraft(), 0, {
      defectRate: 0.15,
      reworkTargetId: null,
    });
    const w = analyzeWizardDraft(draft);
    expect(w.some((x) => x.id.startsWith("defect-no-rework-"))).toBe(true);
  });

  it("VROL-1083 — defect-no-rework hidden when a rework target is set", () => {
    // Use the second station's id as a valid rework target.
    const draft = defaultDraft();
    const targetId = draft.stations[1]?.id ?? draft.stations[0]?.id;
    const patched = withStation(draft, 0, {
      defectRate: 0.15,
      reworkTargetId: targetId ?? null,
    });
    const w = analyzeWizardDraft(patched);
    expect(w.some((x) => x.id.startsWith("defect-no-rework-"))).toBe(false);
  });

  it("VROL-1084 — single-station-line fires when stations.length === 1", () => {
    const draft = defaultDraft();
    const single: WizardDraft = { ...draft, stations: [draft.stations[0]!] };
    const w = analyzeWizardDraft(single);
    expect(w.some((x) => x.id === "single-station-line")).toBe(true);
  });

  it("VROL-1084 — single-station-line hidden with ≥ 2 stations", () => {
    const w = analyzeWizardDraft(defaultDraft());
    expect(w.some((x) => x.id === "single-station-line")).toBe(false);
  });

  it("VROL-1085 — product-zero-weight fires when any product has weight 0", () => {
    const draft = defaultDraft();
    const patched: WizardDraft = {
      ...draft,
      products: draft.products.map((p, i) => (i === 0 ? { ...p, weight: 0 } : p)),
    };
    const w = analyzeWizardDraft(patched);
    expect(w.some((x) => x.id.startsWith("product-zero-weight-"))).toBe(true);
  });

  it("VROL-1085 — product-zero-weight hidden when every product has positive weight", () => {
    const w = analyzeWizardDraft(defaultDraft());
    expect(w.some((x) => x.id.startsWith("product-zero-weight-"))).toBe(false);
  });
});
