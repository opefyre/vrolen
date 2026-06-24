/**
 * VROL-986 — surfaces the Sprint 102 two-way sensitivity kernel as a
 * "Top interactions" card. Lists pairs ranked by interaction strength
 * (how much MORE the corner gains beat the sum of individual OAT gains).
 * Auto-computed when a one-way sweep is already available.
 */

import { useMemo } from "react";

import { runTwoWaySensitivity, type TwoWaySummary } from "@/lib/sensitivity-two-way";
import type { SensitivitySummary } from "@/lib/sensitivity-sweep";
import type { ChainOptions, Distribution } from "@/engine";

interface Props {
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly seed: number;
  readonly buildBaseOptions: () => ChainOptions;
  readonly stationCycleDistributions: readonly Distribution[];
  readonly stationLabels: readonly string[];
  readonly oneWaySummary: SensitivitySummary | null;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export function TwoWayInteractionsCard({
  horizonMs,
  warmupMs,
  seed,
  buildBaseOptions,
  stationCycleDistributions,
  stationLabels,
  oneWaySummary,
}: Props) {
  const summary: TwoWaySummary | null = useMemo(() => {
    if (!oneWaySummary || oneWaySummary.rows.length < 2) return null;
    return runTwoWaySensitivity({
      horizonMs,
      warmupMs,
      seed,
      buildBaseOptions,
      stationCycleDistributions,
      stationLabels,
      oneWayRows: oneWaySummary.rows,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oneWaySummary, horizonMs, warmupMs, seed]);

  if (!summary || summary.pairs.length === 0) return null;
  const top = summary.pairs.slice(0, 3);
  return (
    <div
      className="border-border bg-card/50 space-y-2 rounded-md border p-3"
      data-testid="two-way-card"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-foreground text-sm font-medium">Top interactions</h3>
        <span className="text-muted-foreground text-[10px]">
          {summary.searchSize} runs · {summary.elapsedMs.toFixed(0)} ms
        </span>
      </div>
      <p className="text-muted-foreground text-[11px] leading-snug">
        Pairs whose combined-effect beats the sum of their individual one-way swings. Bigger gap =
        stronger interaction (the levers reinforce each other).
      </p>
      <div className="space-y-1.5">
        {top.map((p, i) => (
          <div
            key={`${String(p.aIdx)}-${String(p.bIdx)}`}
            className="flex flex-wrap items-center gap-2 text-[11px]"
          >
            <div className="text-foreground/80 min-w-[10rem] font-medium">
              #{i + 1} {p.aLabel} <span className="text-muted-foreground">+</span> {p.bLabel}
            </div>
            <div className="text-muted-foreground">
              best corner{" "}
              <span className="text-foreground font-mono tabular-nums">
                {fmt(p.bestCornerPerHour)}/h
              </span>{" "}
              ({p.bestCornerMultipliers[0].toFixed(1)}x · {p.bestCornerMultipliers[1].toFixed(1)}x)
            </div>
            <div
              className={
                p.interactionStrength > 0
                  ? "text-sim-running-foreground font-mono tabular-nums"
                  : "text-muted-foreground font-mono tabular-nums"
              }
            >
              {p.interactionStrength > 0 ? "+" : ""}
              {fmt(p.interactionStrength)}/h vs OAT-sum
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
