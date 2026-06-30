/**
 * VROL-793 — tornado chart divergent colour scale + noise-floor grey.
 *
 * Exercises the `classifyTornadoRow` pure helper for the three tone outcomes
 * (positive / negative / noise) and asserts the rendered card paints the
 * bars accordingly and surfaces the legend underneath.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SensitivityRow, SensitivitySummary } from "@/lib/sensitivity-sweep";
import { classifyTornadoRow } from "@/lib/tornado-classify";

import { SensitivityCard } from "./SensitivityCard";

function row(overrides: Partial<SensitivityRow>): SensitivityRow {
  return {
    stationLabel: "Filler",
    stationIdx: 0,
    baselinePerHour: 1_000,
    lowPerHour: 1_200,
    highPerHour: 800,
    swingPerHour: 400,
    swingPct: 40,
    // VROL-1062 — Stats defaults: K=1 fixture → halfWidth=0 so
    // classifyTornadoRow falls back to the existing swing-vs-floor
    // path (preserves these tests' semantics).
    swingStats: { mean: -400, stddev: 0, halfWidth95: 0, low95: -400, high95: -400 },
    isSignificant: true,
    ...overrides,
  };
}

describe("classifyTornadoRow (VROL-793)", () => {
  it("returns 'positive' when speeding up the station (low multiplier) increases throughput", () => {
    const r = row({ lowPerHour: 1_200, highPerHour: 800, swingPerHour: 400 });
    expect(classifyTornadoRow(r, 400)).toBe("positive");
  });

  it("returns 'negative' when slowing the station down (high multiplier) increases throughput", () => {
    const r = row({ lowPerHour: 800, highPerHour: 1_200, swingPerHour: 400 });
    expect(classifyTornadoRow(r, 400)).toBe("negative");
  });

  it("returns 'noise' when swing is below 1% of the widest bar", () => {
    const r = row({ swingPerHour: 50 });
    expect(classifyTornadoRow(r, 10_000)).toBe("noise");
  });

  it("returns 'noise' when absolute swing is under 5 parts/h", () => {
    const r = row({ swingPerHour: 3 });
    // Even when this is the widest bar, it's still smaller than the absolute floor.
    expect(classifyTornadoRow(r, 3)).toBe("noise");
  });
});

describe("SensitivityCard tornado rendering (VROL-793)", () => {
  function makeSummary(rows: SensitivityRow[]): SensitivitySummary {
    return {
      baselinePerHour: 1_000,
      rows,
      constraintRows: [],
      lowMultiplier: 0.8,
      highMultiplier: 1.2,
      elapsedMs: 42,
    };
  }

  it("colours positive-impact bars green and negative-impact bars red, and tags noise rows muted", () => {
    const summary = makeSummary([
      row({
        stationLabel: "Filler",
        lowPerHour: 1_200,
        highPerHour: 800,
        swingPerHour: 400,
        swingPct: 40,
      }),
      row({
        stationLabel: "Capper",
        lowPerHour: 900,
        highPerHour: 1_100,
        swingPerHour: 200,
        swingPct: 20,
      }),
      row({
        stationLabel: "Labeler",
        lowPerHour: 1_001,
        highPerHour: 1_001.5,
        swingPerHour: 0.5,
        swingPct: 0.05,
      }),
    ]);
    const { container } = render(
      <SensitivityCard summary={summary} running={false} onRun={() => undefined} />,
    );
    const rowsWithTone = container.querySelectorAll("[data-tone]");
    const tones = Array.from(rowsWithTone).map((el) => el.getAttribute("data-tone"));
    // Sorted descending by absolute swing — Filler first, then Capper, then Labeler.
    expect(tones).toEqual(["positive", "negative", "noise"]);
  });

  it("sorts bars by absolute swing magnitude descending so noise drops to the bottom", () => {
    const summary = makeSummary([
      row({
        stationLabel: "Labeler",
        lowPerHour: 1_000.5,
        highPerHour: 1_001,
        swingPerHour: 0.5,
        swingPct: 0.05,
      }),
      row({
        stationLabel: "Filler",
        lowPerHour: 1_200,
        highPerHour: 800,
        swingPerHour: 400,
        swingPct: 40,
      }),
      row({
        stationLabel: "Capper",
        lowPerHour: 900,
        highPerHour: 1_100,
        swingPerHour: 200,
        swingPct: 20,
      }),
    ]);
    const { container } = render(
      <SensitivityCard summary={summary} running={false} onRun={() => undefined} />,
    );
    const labels = Array.from(container.querySelectorAll("[data-tone]")).map((el) => {
      const label = el.querySelector("div")?.textContent ?? "";
      return label.trim();
    });
    expect(labels).toEqual(["Filler", "Capper", "Labeler"]);
  });

  it("renders the divergent-colour legend underneath the bars", () => {
    const summary = makeSummary([
      row({
        stationLabel: "Filler",
        lowPerHour: 1_200,
        highPerHour: 800,
        swingPerHour: 400,
        swingPct: 40,
      }),
    ]);
    const { container } = render(
      <SensitivityCard summary={summary} running={false} onRun={() => undefined} />,
    );
    expect(container.textContent).toContain("Speed up = more throughput");
    expect(container.textContent).toContain("Slow down = less");
    expect(container.textContent).toContain("Below noise floor");
  });

  it("VROL-1048 — renders constraint section when rows is empty but constraintRows has data", () => {
    const summary: SensitivitySummary = {
      baselinePerHour: 1_000,
      rows: [],
      constraintRows: [
        {
          kind: "stationCapacity",
          label: "Mid capacity (1 ↔ 2)",
          lowPerHour: 1_000,
          highPerHour: 1_950,
          swingPerHour: 950,
          swingPct: 95,
        },
      ],
      lowMultiplier: 0.8,
      highMultiplier: 1.2,
      elapsedMs: 42,
    };
    const { container } = render(
      <SensitivityCard summary={summary} running={false} onRun={() => undefined} />,
    );
    expect(container.textContent).not.toContain(
      "No varying-cycle-time stations or constraint dimensions",
    );
    expect(container.textContent).toContain("Mid capacity");
  });

  it("VROL-1048 — empty state fires when BOTH groups are empty", () => {
    const summary: SensitivitySummary = {
      baselinePerHour: 1_000,
      rows: [],
      constraintRows: [],
      lowMultiplier: 0.8,
      highMultiplier: 1.2,
      elapsedMs: 0,
    };
    const { container } = render(
      <SensitivityCard summary={summary} running={false} onRun={() => undefined} />,
    );
    expect(container.textContent).toContain(
      "No varying-cycle-time stations or constraint dimensions",
    );
  });

  // VROL-1169 (UX audit H5) — direction glyph colour-independence.

  it("H5 — positive tone row renders ↑ glyph with aria-label 'speed-up helps'", () => {
    const summary: SensitivitySummary = {
      baselinePerHour: 1_000,
      lowMultiplier: 0.8,
      highMultiplier: 1.2,
      elapsedMs: 5,
      constraintRows: [],
      rows: [
        row({
          stationLabel: "Filler",
          lowPerHour: 1_500,
          highPerHour: 500,
          swingPerHour: 1_000,
          swingPct: 100,
        }),
      ],
    };
    const { getByTestId } = render(
      <SensitivityCard summary={summary} running={false} onRun={() => undefined} />,
    );
    const glyph = getByTestId("sens-direction-Filler");
    expect(glyph.textContent).toBe("↑");
    expect(glyph.getAttribute("aria-label")).toMatch(/speed-up/);
  });

  it("H5 — negative tone row renders ↓ glyph with aria-label 'slow-down helps'", () => {
    const summary: SensitivitySummary = {
      baselinePerHour: 1_000,
      lowMultiplier: 0.8,
      highMultiplier: 1.2,
      elapsedMs: 5,
      constraintRows: [],
      rows: [
        row({
          stationLabel: "Capper",
          lowPerHour: 500,
          highPerHour: 1_500,
          swingPerHour: 1_000,
          swingPct: 100,
        }),
      ],
    };
    const { getByTestId } = render(
      <SensitivityCard summary={summary} running={false} onRun={() => undefined} />,
    );
    const glyph = getByTestId("sens-direction-Capper");
    expect(glyph.textContent).toBe("↓");
    expect(glyph.getAttribute("aria-label")).toMatch(/slow-down/);
  });

  it("H5 — noise tone row renders • glyph with aria-label 'noise'", () => {
    const summary: SensitivitySummary = {
      baselinePerHour: 10_000,
      lowMultiplier: 0.8,
      highMultiplier: 1.2,
      elapsedMs: 5,
      constraintRows: [],
      // Tiny swing relative to widest bar → noise tone.
      rows: [
        row({
          stationLabel: "Pack",
          lowPerHour: 10_001,
          highPerHour: 10_000.5,
          swingPerHour: 0.5,
          swingPct: 0.005,
          swingStats: {
            mean: -0.5,
            stddev: 0,
            halfWidth95: 0,
            low95: -0.5,
            high95: -0.5,
          },
        }),
      ],
    };
    const { getByTestId } = render(
      <SensitivityCard summary={summary} running={false} onRun={() => undefined} />,
    );
    const glyph = getByTestId("sens-direction-Pack");
    expect(glyph.textContent).toBe("•");
    expect(glyph.getAttribute("aria-label")).toMatch(/noise/);
  });
});
