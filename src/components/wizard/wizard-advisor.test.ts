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
});
