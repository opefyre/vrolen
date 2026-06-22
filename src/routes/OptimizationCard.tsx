/**
 * Optimization search card — Simul8 OptQuest-light. Picks the (buffer
 * capacity × cycle multiplier on the bottleneck) combo that maximizes mean
 * throughput across N seeds per cell.
 *
 * Renders a heatmap grid so the buyer can see the response surface, plus the
 * winner with deltas vs current setting and a runner-up for comparison.
 *
 * VROL-849 — header / button / spinner / error states now live in
 * AnalyticsCardShell. This file is the body only.
 */

import { Crown } from "lucide-react";
import { useState } from "react";

import { AnalyticsCardShell } from "@/components/results/AnalyticsCardShell";
import { Button } from "@/components/ui/button";
import type { OptimizationCandidate, OptimizationSummary } from "@/lib/optimization-search";

import { HeatmapCellDrilldown } from "./DrilldownSheets";

interface OptimizationCardProps {
  readonly summary: OptimizationSummary | null;
  readonly running: boolean;
  readonly onRun: () => void;
  readonly errorMessage?: string;
  readonly onApply?: (candidate: OptimizationCandidate) => void;
}

export function OptimizationCard({
  summary,
  running,
  onRun,
  errorMessage,
  onApply,
}: OptimizationCardProps) {
  const status = errorMessage
    ? ("error" as const)
    : running
      ? ("running" as const)
      : summary
        ? ("done" as const)
        : ("idle" as const);
  return (
    <AnalyticsCardShell
      id="optimization"
      title={
        <>
          <Crown className="h-4 w-4" aria-hidden /> Optimization · best combo
        </>
      }
      description={
        <>
          2-D grid-search over buffer capacity × cycle-time on the bottleneck. Averaged across
          seeds; the highest-throughput cell wins.
        </>
      }
      status={status}
      {...(running ? { statusLabel: "Searching…" } : {})}
      onRun={onRun}
      runLabel="Run search"
      {...(errorMessage ? { errorMessage } : {})}
    >
      {!summary ? (
        <p className="text-muted-foreground text-sm">
          Click <strong>Run search</strong> to fire a 2-D sweep (buffer levels × cycle multipliers
          on the bottleneck) and surface the best combo for this line.
        </p>
      ) : (
        <OptimizationBody summary={summary} {...(onApply ? { onApply } : {})} />
      )}
    </AnalyticsCardShell>
  );
}

function OptimizationBody({
  summary,
  onApply,
}: {
  readonly summary: OptimizationSummary;
  readonly onApply?: (candidate: OptimizationCandidate) => void;
}) {
  const [cellDetail, setCellDetail] = useState<OptimizationCandidate | null>(null);
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const ms = (n: number) => `${Math.round(n).toLocaleString()} ms`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const best = summary.best;
  const runnerUp = summary.runnerUp;
  const targetLabel = summary.targetStationLabel;
  const baselineThroughput = summary.candidates.find(
    (c) => c.bufferCapacity === summary.currentCapacity && c.cycleMultiplier === 1,
  )?.meanThroughputPerHour;
  const deltaPct =
    baselineThroughput && baselineThroughput > 0
      ? ((best.meanThroughputPerHour - baselineThroughput) / baselineThroughput) * 100
      : null;
  const isBaseline = best.bufferCapacity === summary.currentCapacity && best.cycleMultiplier === 1;
  const showApply = onApply && !isBaseline;
  const multX = (m: number) => `${m.toFixed(2)}×`;
  const cellByKey = new Map<string, OptimizationCandidate>();
  for (const c of summary.candidates) {
    cellByKey.set(`${String(c.bufferCapacity)}|${String(c.cycleMultiplier)}`, c);
  }
  const minTput = Math.min(...summary.candidates.map((c) => c.meanThroughputPerHour));
  const maxTput = Math.max(...summary.candidates.map((c) => c.meanThroughputPerHour));
  const heatFor = (tput: number): { bg: string; ring: boolean } => {
    if (maxTput <= minTput) return { bg: "bg-muted/40", ring: false };
    const ratio = (tput - minTput) / (maxTput - minTput);
    if (ratio >= 0.85) return { bg: "bg-sim-running/70", ring: false };
    if (ratio >= 0.6) return { bg: "bg-sim-running/45", ring: false };
    if (ratio >= 0.35) return { bg: "bg-sim-setup/35", ring: false };
    if (ratio >= 0.15) return { bg: "bg-sim-blocked/25", ring: false };
    return { bg: "bg-sim-down/20", ring: false };
  };
  return (
    <div className="space-y-3">
      <div className="border-sim-running/30 bg-sim-running/5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
        <span className="text-foreground font-semibold">
          Best: WIP <span className="font-mono tabular-nums">{best.bufferCapacity}</span> ·{" "}
          <span className="text-foreground">{targetLabel}</span>{" "}
          <span className="font-mono tabular-nums">@{multX(best.cycleMultiplier)}</span>
        </span>
        <span className="text-muted-foreground">
          {fmt(best.meanThroughputPerHour)} /h
          {deltaPct !== null ? (
            <span className={deltaPct >= 0 ? "text-sim-running ml-1" : "text-sim-down ml-1"}>
              ({deltaPct >= 0 ? "+" : ""}
              {deltaPct.toFixed(1)}% vs baseline)
            </span>
          ) : null}{" "}
          · TIS {ms(best.meanTimeInSystemMs)} · scrap {pct(best.meanScrapRate)}
        </span>
        {runnerUp ? (
          <span className="text-muted-foreground text-xs">
            (runner-up WIP {runnerUp.bufferCapacity} @{multX(runnerUp.cycleMultiplier)} ·{" "}
            {fmt(runnerUp.meanThroughputPerHour)} /h)
          </span>
        ) : null}
        <span className="text-muted-foreground ml-auto text-xs">
          {summary.searchSize} runs · {summary.elapsedMs.toFixed(0)} ms
        </span>
        {showApply ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              onApply(best);
            }}
          >
            Apply best &amp; re-run
          </Button>
        ) : null}
      </div>
      <div className="text-muted-foreground text-[11px]">
        Heatmap: rows = cycle multiplier on <span className="text-foreground">{targetLabel}</span>,
        columns = buffer capacity. Greener = higher throughput.
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-[11px]">
          <thead>
            <tr>
              <th className="text-muted-foreground w-20 text-left font-normal">{targetLabel}</th>
              {summary.bufferLevels.map((cap) => (
                <th
                  key={`h-${String(cap)}`}
                  className="text-muted-foreground font-mono font-normal tabular-nums"
                >
                  WIP {cap}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...summary.cycleMultipliers]
              .slice()
              .sort((a, b) => a - b)
              .map((mult) => (
                <tr key={`r-${String(mult)}`}>
                  <td className="text-foreground/80 font-mono tabular-nums">@{multX(mult)}</td>
                  {summary.bufferLevels.map((cap) => {
                    const cell = cellByKey.get(`${String(cap)}|${String(mult)}`);
                    if (!cell) return <td key={`c-${String(cap)}`} />;
                    const isBest =
                      cell.bufferCapacity === best.bufferCapacity &&
                      cell.cycleMultiplier === best.cycleMultiplier;
                    const isCurrent =
                      cell.bufferCapacity === summary.currentCapacity && cell.cycleMultiplier === 1;
                    const heat = heatFor(cell.meanThroughputPerHour);
                    return (
                      <td key={`c-${String(cap)}`} className="p-0">
                        <button
                          type="button"
                          onClick={() => setCellDetail(cell)}
                          className={`${heat.bg} ${isBest ? "ring-sim-running ring-2" : isCurrent ? "ring-foreground/40 ring-1" : ""} hover:ring-foreground/30 flex w-full cursor-pointer flex-col items-end justify-center rounded px-2 py-1.5 text-right transition-shadow hover:ring-2`}
                          title={`WIP ${String(cap)} @${multX(mult)} → ${fmt(cell.meanThroughputPerHour)} /h · TIS ${ms(cell.meanTimeInSystemMs)} · click for detail`}
                        >
                          <span className="text-foreground font-mono text-[11px] tabular-nums">
                            {fmt(cell.meanThroughputPerHour)}
                          </span>
                          <span className="text-muted-foreground text-[9px]">
                            {isBest ? "best" : isCurrent ? "now" : "/h"}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <HeatmapCellDrilldown
        candidate={cellDetail}
        summary={summary}
        onClose={() => setCellDetail(null)}
        {...(onApply
          ? {
              onApply: (c: OptimizationCandidate) => {
                onApply(c);
                setCellDetail(null);
              },
            }
          : {})}
      />
    </div>
  );
}
