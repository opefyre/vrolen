/**
 * VROL-1029 — verify the wizard commit pipeline stamps sustainability
 * inputs onto station.data when authored. Earlier wizard fields had
 * coverage via step-*.test.tsx; this file covers commit-draft directly.
 */
import { describe, expect, it } from "vitest";

import { commitDraft } from "./commit-draft";
import { defaultDraft, type WizardDraft } from "./wizard-types";

function draftWithSusStation(): WizardDraft {
  const base = defaultDraft();
  const stations = base.stations.map((s, i) =>
    i === 0
      ? {
          ...s,
          energyPerCycleJ: 1500,
          waterPerCycleL: 0.25,
          co2ePerCycleG: 4,
        }
      : s,
  );
  return { ...base, stations };
}

describe("commitDraft sustainability inputs (VROL-1029)", () => {
  it("stamps energy / water / CO₂e onto station.data when non-zero", () => {
    const draft = draftWithSusStation();
    const commit = commitDraft(draft);
    const firstStation = commit.nodes[0];
    expect(firstStation).toBeDefined();
    const data = firstStation?.data as {
      energyPerCycleJ?: number;
      waterPerCycleL?: number;
      co2ePerCycleG?: number;
    };
    expect(data.energyPerCycleJ).toBe(1500);
    expect(data.waterPerCycleL).toBe(0.25);
    expect(data.co2ePerCycleG).toBe(4);
  });

  it("omits the fields when zero / undefined (back-compat)", () => {
    const draft = defaultDraft();
    const commit = commitDraft(draft);
    const data = commit.nodes[0]?.data as {
      energyPerCycleJ?: number;
    };
    expect(data.energyPerCycleJ).toBeUndefined();
  });
});
