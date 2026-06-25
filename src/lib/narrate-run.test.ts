import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { narrateRun } from "./narrate-run";

function fakeResult(overrides: Partial<ChainResult> = {}): ChainResult {
  return {
    completed: 100,
    elapsedMs: 60_000,
    averageWipL: 5,
    throughputLambda: 100 / 60_000,
    avgTimeInSystemW: 500,
    perStationCompleted: [120, 100],
    perStationScrapped: [0, 0],
    perStationReworked: [0, 0],
    lineScrapRate: 0,
    lineReworkRate: 0,
    bottlenecks: [
      {
        stationId: "s1" as unknown as ChainResult["bottlenecks"][number]["stationId"],
        label: "Capper",
        runningPct: 0.98,
        primaryReason: "running",
        primaryReasonPct: 0.98,
        breakdown: [
          { state: "Running", pct: 0.98 },
          { state: "Starved", pct: 0.02 },
        ],
      },
    ],
    perStationOee: [
      {
        availability: 1,
        performance: 0.5,
        quality: 1,
        oee: 0.5,
        runTimeMs: 60_000,
        downTimeMs: 0,
        goodParts: 120,
        totalParts: 120,
        idealCycleTimeMs: 100,
      },
      {
        availability: 1,
        performance: 0.98,
        quality: 1,
        oee: 0.98,
        runTimeMs: 60_000,
        downTimeMs: 0,
        goodParts: 100,
        totalParts: 100,
        idealCycleTimeMs: 200,
      },
    ],
    lineOee: 0.7,
    bottleneckStationIdx: 1,
    aggregateBufferWipL: 2,
    perEdgeFlowed: [120, 100],
    samples: [],
    perStationCapacity: [1, 1],
    ...overrides,
  };
}

describe("narrateRun (VROL-640)", () => {
  it("emits bottleneck + capacity hint when bottleneck is running at capacity=1 (VROL-652)", () => {
    const sentences = narrateRun(fakeResult());
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toBe("Capper is the bottleneck (running 98% of the time).");
    expect(sentences[1]).toContain("Consider raising parallel cycles");
  });

  it("emits the rework sentence when lineReworkRate is at or above 2%", () => {
    const sentences = narrateRun(
      fakeResult({
        lineReworkRate: 0.07,
        perStationReworked: [0, 7],
      }),
    );
    // bottleneck + capacity hint + rework = 3 sentences.
    expect(sentences).toHaveLength(3);
    expect(sentences[2]).toContain("7%");
    expect(sentences[2]).toContain("reworked");
  });

  it("emits all of bottleneck + cap hint + rework + scrap and skips the OEE-band line", () => {
    const sentences = narrateRun(
      fakeResult({
        lineReworkRate: 0.1,
        lineScrapRate: 0.05,
        perStationReworked: [0, 10],
        perStationScrapped: [0, 5],
      }),
    );
    // VROL-742 adds a quality-loss localiser sentence when both losses fire.
    expect(sentences).toHaveLength(5);
    expect(sentences[2]).toContain("reworked");
    expect(sentences[3]).toContain("scrapped");
    expect(sentences[4]).toContain("Quality losses cluster");
    expect(sentences.some((s) => /OEE/i.test(s))).toBe(false);
  });

  it("falls back to a low-OEE band sentence when no other hint fires", () => {
    // Override bottleneck to a non-running reason so the capacity hint
    // doesn't fire and the OEE-band fallback can be exercised.
    const sentences = narrateRun(
      fakeResult({
        lineOee: 0.25,
        bottlenecks: [
          {
            stationId: "s1" as unknown as ChainResult["bottlenecks"][number]["stationId"],
            label: "Capper",
            runningPct: 0.4,
            primaryReason: "idle",
            primaryReasonPct: 0.5,
            breakdown: [
              { state: "Idle", pct: 0.5 },
              { state: "Running", pct: 0.4 },
            ],
          },
        ],
      }),
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[1]).toContain("Low utilization");
    expect(sentences[1]).toContain("25%");
  });

  it("emits 'bottleneck-bound' when line OEE is high but stations idle too much", () => {
    // High line OEE with a station that only runs 40% of the time. We used
    // to claim 'Excellent OEE — well balanced' here, which was a lie — OEE
    // hides starvation + blocking, so 'high OEE' alone doesn't mean
    // balanced. The fix downgrades that line to a 'bottleneck-bound' hint
    // and surfaces the worst utilisation %.
    const sentences = narrateRun(
      fakeResult({
        lineOee: 0.9,
        bottlenecks: [
          {
            stationId: "s1" as unknown as ChainResult["bottlenecks"][number]["stationId"],
            label: "Capper",
            runningPct: 0.4,
            primaryReason: "idle",
            primaryReasonPct: 0.5,
            breakdown: [
              { state: "Idle", pct: 0.5 },
              { state: "Running", pct: 0.4 },
            ],
          },
        ],
      }),
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[1]).toContain("bottleneck-bound");
    expect(sentences[1]).toContain("Capper");
    expect(sentences[1]).toContain("40%");
  });

  it("still emits 'well balanced' when every station's runningPct >= 70%", () => {
    // primaryReason !== "running" so capacityHint + headroomSentence don't
    // fire and the OEE-band sentence reaches the output. All stations are
    // running >= 70%, so the new 'well balanced' branch should hit.
    const sentences = narrateRun(
      fakeResult({
        lineOee: 0.92,
        bottlenecks: [
          {
            stationId: "s1" as unknown as ChainResult["bottlenecks"][number]["stationId"],
            label: "A",
            runningPct: 0.95,
            primaryReason: "starvation",
            primaryReasonPct: 0.05,
            breakdown: [{ state: "Running", pct: 0.95 }],
          },
          {
            stationId: "s2" as unknown as ChainResult["bottlenecks"][number]["stationId"],
            label: "B",
            runningPct: 0.85,
            primaryReason: "blocking",
            primaryReasonPct: 0.15,
            breakdown: [{ state: "Running", pct: 0.85 }],
          },
        ],
      }),
    );
    expect(sentences[sentences.length - 1]).toContain("Excellent OEE");
    expect(sentences[sentences.length - 1]).toContain("well balanced");
  });

  it("capacity hint switches to 'already at capacity N' when capacity > 1 (VROL-652)", () => {
    const sentences = narrateRun(
      fakeResult({
        perStationCapacity: [1, 3],
      }),
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[1]).toContain("Already at capacity 3");
    expect(sentences[1]).toContain("speed up the cycle");
  });

  it("source-rate hint fires when sourceArrivalsFired set + bottleneck is starvation (VROL-652)", () => {
    const sentences = narrateRun(
      fakeResult({
        sourceArrivalsFired: 60,
        bottlenecks: [
          {
            stationId: "s1" as unknown as ChainResult["bottlenecks"][number]["stationId"],
            label: "Filler",
            runningPct: 0.4,
            primaryReason: "starvation",
            primaryReasonPct: 0.55,
            breakdown: [
              { state: "Starved", pct: 0.55 },
              { state: "Running", pct: 0.4 },
            ],
          },
        ],
      }),
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[1]).toContain("Source rate is the gate");
  });

  it("source-rate hint does NOT fire when source was off (sourceArrivalsFired undefined) (VROL-652)", () => {
    const sentences = narrateRun(
      fakeResult({
        bottlenecks: [
          {
            stationId: "s1" as unknown as ChainResult["bottlenecks"][number]["stationId"],
            label: "Filler",
            runningPct: 0.4,
            primaryReason: "starvation",
            primaryReasonPct: 0.55,
            breakdown: [
              { state: "Starved", pct: 0.55 },
              { state: "Running", pct: 0.4 },
            ],
          },
        ],
      }),
    );
    expect(sentences.some((s) => /Source rate/.test(s))).toBe(false);
  });

  it("uses starvation phrasing when the bottleneck's primary reason is starvation", () => {
    const sentences = narrateRun(
      fakeResult({
        bottlenecks: [
          {
            stationId: "s1" as unknown as ChainResult["bottlenecks"][number]["stationId"],
            label: "Capper",
            runningPct: 0.4,
            primaryReason: "starvation",
            primaryReasonPct: 0.55,
            breakdown: [
              { state: "Starved", pct: 0.55 },
              { state: "Running", pct: 0.4 },
            ],
          },
        ],
      }),
    );
    expect(sentences[0]).toContain("starved 55%");
    expect(sentences[0]).toContain("upstream too slow");
  });

  it("returns an empty list when there are no bottleneck candidates", () => {
    const sentences = narrateRun(fakeResult({ bottlenecks: [] }));
    expect(sentences).toEqual([]);
  });

  // ─── VROL-1034 — sustainability sentence ────────────────────────────
  it("VROL-1034 — appends an energy-intensity sentence when sustainability is declared", () => {
    const sentences = narrateRun(
      fakeResult({
        totalEnergyJ: 1_000_000,
        perStationEnergyJ: [200_000, 800_000],
        perStationLabels: ["Filler", "Capper"],
      }),
    );
    const sus = sentences.find((s) => s.toLowerCase().includes("energy intensity"));
    expect(sus).toBeDefined();
    // 1 MJ / 100 parts = 10 kJ/part.
    expect(sus).toContain("10.0 kJ/part");
    // Capper carries 80 % of the total — narration names it.
    expect(sus).toContain("Capper");
    expect(sus).toContain("80 %");
  });

  it("VROL-1034 — silent when no sustainability data is present", () => {
    const sentences = narrateRun(fakeResult());
    const sus = sentences.find((s) => s.toLowerCase().includes("energy intensity"));
    expect(sus).toBeUndefined();
  });

  it("VROL-1034 — silent below 1 kJ total energy floor", () => {
    const sentences = narrateRun(fakeResult({ totalEnergyJ: 500, perStationEnergyJ: [500, 0] }));
    expect(sentences.find((s) => s.toLowerCase().includes("energy intensity"))).toBeUndefined();
  });

  it("VROL-1034 — when distribution is balanced, names no dominant station", () => {
    const sentences = narrateRun(
      fakeResult({
        totalEnergyJ: 1_000_000,
        perStationEnergyJ: [350_000, 350_000, 300_000],
        perStationLabels: ["A", "B", "C"],
      }),
    );
    const sus = sentences.find((s) => s.toLowerCase().includes("energy intensity"));
    expect(sus).toBeDefined();
    // Highest share = 35 %, below the 40 % threshold → no station name.
    expect(sus).not.toMatch(/carries/);
  });
});
