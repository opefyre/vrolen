/**
 * Optimization search card — Simul8 OptQuest-light. Picks the (buffer
 * capacity × cycle multiplier on the bottleneck) combo that maximizes the
 * chosen objective across N seeds per cell.
 *
 * Renders either:
 *   • a heatmap of the chosen objective per cell, OR
 *   • a Pareto scatter (throughput vs time-in-system) with the dominating
 *     candidates highlighted.
 *
 * VROL-842 — adds an objective Select (max throughput / min TIS / max OEE /
 * max good parts/h / min WIP), a constraints panel (max TIS, max WIP) that
 * greys out infeasible cells and ignores them when picking the winner, and
 * a Heatmap/Pareto segmented toggle.
 *
 * VROL-849 — header / button / spinner / error states still live in
 * AnalyticsCardShell. This file owns the body.
 */

import { Crown } from "lucide-react";
import { useMemo, useState } from "react";

import { AnalyticsCardShell } from "@/components/results/AnalyticsCardShell";
import { Button } from "@/components/ui/button";
import { DurationInput } from "@/components/ui/duration-input";
import { NumberField } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OptimizationCandidate, OptimizationSummary, Stats } from "@/lib/optimization-search";
import { isOnFrontier, paretoFrontier } from "@/lib/pareto-frontier";
import { pickBest } from "@/lib/opt-pick-best";
import { useChartDimensions } from "@/lib/use-chart-dimensions";

import { HeatmapCellDrilldown } from "./DrilldownSheets";

interface OptimizationCardProps {
  readonly summary: OptimizationSummary | null;
  readonly running: boolean;
  readonly onRun: () => void;
  readonly errorMessage?: string;
  readonly onApply?: (candidate: OptimizationCandidate) => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Objective + view types — file-local so the consumer surface stays minimal.
// ──────────────────────────────────────────────────────────────────────────────

type Objective =
  | "throughput-max"
  | "tis-min"
  | "oee-max"
  | "good-parts-max"
  | "wip-min"
  | "energy-min";

type ObjectiveDirection = "max" | "min";

interface ObjectiveSpec {
  readonly value: Objective;
  readonly label: string;
  readonly direction: ObjectiveDirection;
  readonly extract: (c: OptimizationCandidate) => number;
  /**
   * VROL-1060 — returns the Stats block for this objective on a
   * candidate. Used by the CI-aware picker tiebreak + the tooltip /
   * BestSummaryBar to surface the right CI alongside the right
   * objective.
   */
  readonly stats: (c: OptimizationCandidate) => Stats;
  readonly format: (v: number) => string;
  readonly unitTrailing: string;
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString();
const fmtMs = (n: number): string => `${Math.round(n).toLocaleString()} ms`;
const fmtPct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const fmtWip = (n: number): string => n.toFixed(1);

const OBJECTIVES: readonly ObjectiveSpec[] = [
  {
    value: "throughput-max",
    label: "Maximize throughput",
    direction: "max",
    extract: (c) => c.meanThroughputPerHour,
    stats: (c) => c.throughputStats,
    format: fmtInt,
    unitTrailing: "/h",
  },
  {
    value: "tis-min",
    label: "Minimize time-in-system",
    direction: "min",
    extract: (c) => c.meanTimeInSystemMs,
    stats: (c) => c.timeInSystemStats,
    format: fmtMs,
    unitTrailing: "",
  },
  {
    value: "oee-max",
    label: "Maximize line efficiency",
    direction: "max",
    extract: (c) => c.meanLineOee,
    stats: (c) => c.oeeStats,
    format: fmtPct,
    unitTrailing: "",
  },
  {
    value: "good-parts-max",
    label: "Maximize good parts per hour",
    direction: "max",
    extract: (c) => c.meanGoodPartsPerHour,
    stats: (c) => c.goodPartsStats,
    format: fmtInt,
    unitTrailing: "/h",
  },
  {
    value: "wip-min",
    label: "Minimize WIP",
    direction: "min",
    extract: (c) => c.meanAvgWipL,
    stats: (c) => c.wipStats,
    format: fmtWip,
    unitTrailing: "parts",
  },
  // VROL-1037 — sustainability objective. Pairs with VROL-1036 which
  // added meanEnergyIntensityJPerPart on each candidate. Stays hidden
  // for scenarios without sustainability inputs (extractor returns 0
  // and the heatmap collapses) — but doesn't break anything when
  // selected on a no-energy scenario.
  {
    value: "energy-min",
    label: "Minimize energy / part",
    direction: "min",
    extract: (c) => c.meanEnergyIntensityJPerPart,
    stats: (c) => c.energyIntensityStats,
    format: (v) => `${Math.round(v).toLocaleString()} J`,
    unitTrailing: "/part",
  },
];

function isObjective(value: string): value is Objective {
  return OBJECTIVES.some((o) => o.value === value);
}

type ChartView = "heatmap" | "pareto";

// ──────────────────────────────────────────────────────────────────────────────
// Constraint helpers — file-local so the body can call them.
// ──────────────────────────────────────────────────────────────────────────────

interface Constraints {
  /** Upper bound on mean time-in-system (ms). null = no constraint. */
  readonly maxTimeInSystemMs: number | null;
  /** Upper bound on mean average WIP (parts). null = no constraint. */
  readonly maxAvgWipL: number | null;
  /**
   * VROL-1055 — upper bound on mean energy intensity (J / part).
   * null = no constraint. Lets users ask "max throughput subject to
   * ≤ X J / part" for sustainability-aware optimization.
   */
  readonly maxEnergyIntensityJPerPart: number | null;
}

function isFeasible(c: OptimizationCandidate, k: Constraints): boolean {
  if (k.maxTimeInSystemMs !== null && c.meanTimeInSystemMs > k.maxTimeInSystemMs) return false;
  if (k.maxAvgWipL !== null && c.meanAvgWipL > k.maxAvgWipL) return false;
  if (
    k.maxEnergyIntensityJPerPart !== null &&
    c.meanEnergyIntensityJPerPart > k.maxEnergyIntensityJPerPart
  )
    return false;
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Card shell
// ──────────────────────────────────────────────────────────────────────────────

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
          Grid-search over buffer capacity × cycle-time on the bottleneck × tool-pool capacity
          delta. Averaged across seeds; pick from 6 objectives (throughput, time-in-system, OEE,
          good parts/h, WIP, energy / part).
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
          Click <strong>Run search</strong> to fire a 3-D sweep (buffer levels × cycle multipliers
          on the bottleneck × tool-pool capacity delta) and surface the best combo for this line.
          Switch the objective dropdown to optimise for time-in-system, OEE, good parts/h, WIP, or
          energy / part.
        </p>
      ) : (
        <OptimizationBody summary={summary} {...(onApply ? { onApply } : {})} />
      )}
    </AnalyticsCardShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Card body — objective selector + constraints + heatmap/pareto toggle.
// ──────────────────────────────────────────────────────────────────────────────

function OptimizationBody({
  summary,
  onApply,
}: {
  readonly summary: OptimizationSummary;
  readonly onApply?: (candidate: OptimizationCandidate) => void;
}) {
  const [cellDetail, setCellDetail] = useState<OptimizationCandidate | null>(null);
  const [objectiveValue, setObjectiveValue] = useState<Objective>("throughput-max");
  const [view, setView] = useState<ChartView>("heatmap");
  const [maxTisMs, setMaxTisMs] = useState<number>(0);
  const [maxWip, setMaxWip] = useState<number>(0);
  // VROL-1055 — sustainability constraint. 0 = disabled.
  const [maxEnergyIntensity, setMaxEnergyIntensity] = useState<number>(0);

  const objective = OBJECTIVES.find((o) => o.value === objectiveValue) ?? OBJECTIVES[0]!;
  const constraints: Constraints = {
    maxTimeInSystemMs: maxTisMs > 0 ? maxTisMs : null,
    maxAvgWipL: maxWip > 0 ? maxWip : null,
    maxEnergyIntensityJPerPart: maxEnergyIntensity > 0 ? maxEnergyIntensity : null,
  };

  const feasibleSet = useMemo<ReadonlySet<OptimizationCandidate>>(() => {
    const s = new Set<OptimizationCandidate>();
    for (const c of summary.candidates) {
      if (isFeasible(c, constraints)) s.add(c);
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- constraints is a derived object; the primitive deps below are the real inputs.
  }, [
    summary.candidates,
    constraints.maxTimeInSystemMs,
    constraints.maxAvgWipL,
    constraints.maxEnergyIntensityJPerPart,
  ]);

  const { winner, fromFeasible } = useMemo(
    () => pickBest(summary.candidates, objective, feasibleSet),
    [summary.candidates, objective, feasibleSet],
  );

  return (
    <div className="space-y-3">
      <ObjectiveBar
        objective={objective}
        onObjectiveChange={(v) => setObjectiveValue(v)}
        view={view}
        onViewChange={setView}
      />
      <ConstraintBar
        maxTisMs={maxTisMs}
        onMaxTisMsChange={setMaxTisMs}
        maxWip={maxWip}
        onMaxWipChange={setMaxWip}
        maxEnergyIntensity={maxEnergyIntensity}
        onMaxEnergyIntensityChange={setMaxEnergyIntensity}
        totalCandidates={summary.candidates.length}
        feasibleCount={feasibleSet.size}
      />
      <BestSummaryBar
        summary={summary}
        winner={winner}
        objective={objective}
        fromFeasible={fromFeasible}
        {...(onApply ? { onApply } : {})}
      />
      {view === "heatmap" ? (
        <HeatmapView
          summary={summary}
          winner={winner}
          objective={objective}
          feasibleSet={feasibleSet}
          onCellClick={(c) => setCellDetail(c)}
        />
      ) : (
        <ParetoView
          summary={summary}
          winner={winner}
          feasibleSet={feasibleSet}
          objective={objective}
          onDotClick={(c) => setCellDetail(c)}
        />
      )}
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

// ──────────────────────────────────────────────────────────────────────────────
// Objective + view toggle row
// ──────────────────────────────────────────────────────────────────────────────

function ObjectiveBar({
  objective,
  onObjectiveChange,
  view,
  onViewChange,
}: {
  readonly objective: ObjectiveSpec;
  readonly onObjectiveChange: (next: Objective) => void;
  readonly view: ChartView;
  readonly onViewChange: (next: ChartView) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-[240px] flex-1 flex-col gap-1">
        <label
          htmlFor="optimization-objective"
          className="text-muted-foreground text-xs font-medium select-none"
        >
          Objective
        </label>
        <Select
          value={objective.value}
          onValueChange={(v) => {
            if (typeof v === "string" && isObjective(v)) onObjectiveChange(v);
          }}
        >
          <SelectTrigger id="optimization-objective" aria-label="Objective">
            <SelectValue>{() => objective.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {OBJECTIVES.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div
        role="group"
        aria-label="Chart view"
        className="border-border inline-flex items-center gap-0.5 self-end rounded-md border p-0.5"
      >
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-pressed={view === "heatmap"}
          onClick={() => onViewChange("heatmap")}
          className={view === "heatmap" ? "bg-muted text-foreground" : "text-muted-foreground"}
        >
          Heatmap
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-pressed={view === "pareto"}
          onClick={() => onViewChange("pareto")}
          className={view === "pareto" ? "bg-muted text-foreground" : "text-muted-foreground"}
        >
          Pareto
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Constraint panel
// ──────────────────────────────────────────────────────────────────────────────

function ConstraintBar({
  maxTisMs,
  onMaxTisMsChange,
  maxWip,
  onMaxWipChange,
  maxEnergyIntensity,
  onMaxEnergyIntensityChange,
  totalCandidates,
  feasibleCount,
}: {
  readonly maxTisMs: number;
  readonly onMaxTisMsChange: (next: number) => void;
  readonly maxWip: number;
  readonly onMaxWipChange: (next: number) => void;
  readonly maxEnergyIntensity: number;
  readonly onMaxEnergyIntensityChange: (next: number) => void;
  readonly totalCandidates: number;
  readonly feasibleCount: number;
}) {
  const hasConstraints = maxTisMs > 0 || maxWip > 0 || maxEnergyIntensity > 0;
  return (
    <div className="border-border bg-muted/30 grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <DurationInput
        id="optimization-max-tis"
        label="Max time-in-system"
        valueMs={maxTisMs}
        onChangeMs={onMaxTisMsChange}
        min={0}
        defaultUnit="s"
        helperText="0 disables the constraint."
      />
      <NumberField
        id="optimization-max-wip"
        label="Max average WIP"
        value={maxWip}
        onChange={onMaxWipChange}
        min={0}
        step={1}
        helperText="0 disables the constraint."
      />
      <NumberField
        id="optimization-max-energy-intensity"
        label="Max energy / part (J)"
        value={maxEnergyIntensity}
        onChange={onMaxEnergyIntensityChange}
        min={0}
        step={10}
        helperText="0 disables the constraint."
      />
      <div className="text-muted-foreground self-end text-xs">
        {hasConstraints ? (
          <span>
            Feasible:{" "}
            <span className="text-foreground font-mono tabular-nums">{feasibleCount}</span> /{" "}
            <span className="font-mono tabular-nums">{totalCandidates}</span> cells
          </span>
        ) : (
          <span>No constraints — every cell is feasible.</span>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Best-summary callout
// ──────────────────────────────────────────────────────────────────────────────

function BestSummaryBar({
  summary,
  winner,
  objective,
  fromFeasible,
  onApply,
}: {
  readonly summary: OptimizationSummary;
  readonly winner: OptimizationCandidate;
  readonly objective: ObjectiveSpec;
  readonly fromFeasible: boolean;
  readonly onApply?: (candidate: OptimizationCandidate) => void;
}) {
  const baseline =
    summary.candidates.find(
      (c) => c.bufferCapacity === summary.currentCapacity && c.cycleMultiplier === 1,
    ) ?? null;
  const baselineValue = baseline ? objective.extract(baseline) : null;
  const winnerValue = objective.extract(winner);
  const deltaPct =
    baselineValue !== null && baselineValue !== 0
      ? ((winnerValue - baselineValue) / Math.abs(baselineValue)) * 100
      : null;
  const goodDelta =
    deltaPct === null ? null : objective.direction === "max" ? deltaPct >= 0 : deltaPct <= 0;
  const isBaseline =
    winner.bufferCapacity === summary.currentCapacity && winner.cycleMultiplier === 1;
  const showApply = onApply && !isBaseline;
  const multX = (m: number): string => `${m.toFixed(2)}×`;
  return (
    <div className="border-sim-running/30 bg-sim-running/5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
      <span className="text-foreground font-semibold">
        Best: WIP <span className="font-mono tabular-nums">{winner.bufferCapacity}</span> ·{" "}
        <span className="text-foreground">{summary.targetStationLabel}</span>{" "}
        <span className="font-mono tabular-nums">@{multX(winner.cycleMultiplier)}</span>
      </span>
      <span className="text-muted-foreground">
        {objective.format(winnerValue)}
        {objective.unitTrailing ? ` ${objective.unitTrailing}` : ""}
        {/* VROL-1060 — show ± half-width for whichever objective the
            user picked, not just throughput. Format the half-width
            with the objective's own formatter so units stay correct
            (ms, %, parts, J, etc.). */}
        {(() => {
          const s = objective.stats(winner);
          if (s.halfWidth95 <= 0) return null;
          return (
            <span className="text-muted-foreground/80 ml-1" data-testid="best-summary-ci">
              ± {objective.format(s.halfWidth95)}
              {objective.unitTrailing ? ` ${objective.unitTrailing}` : ""} (95 % CI)
            </span>
          );
        })()}
        {deltaPct !== null ? (
          <span className={goodDelta ? "text-sim-running ml-1" : "text-sim-down ml-1"}>
            ({deltaPct >= 0 ? "+" : ""}
            {deltaPct.toFixed(1)}% vs baseline)
          </span>
        ) : null}
      </span>
      {!fromFeasible ? (
        <span
          data-slot="infeasible-warning"
          className="text-sim-down border-sim-down/40 bg-sim-down/10 rounded border px-1.5 py-0.5 text-[10px]"
        >
          No feasible cells — showing best across all candidates
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
          onClick={() => onApply(winner)}
        >
          Apply best &amp; re-run
        </Button>
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Heatmap view — colours each cell by the active objective value.
// ──────────────────────────────────────────────────────────────────────────────

function HeatmapView({
  summary,
  winner,
  objective,
  feasibleSet,
  onCellClick,
}: {
  readonly summary: OptimizationSummary;
  readonly winner: OptimizationCandidate;
  readonly objective: ObjectiveSpec;
  readonly feasibleSet: ReadonlySet<OptimizationCandidate>;
  readonly onCellClick: (c: OptimizationCandidate) => void;
}) {
  const targetLabel = summary.targetStationLabel;
  const multX = (m: number): string => `${m.toFixed(2)}×`;
  const cellByKey = new Map<string, OptimizationCandidate>();
  for (const c of summary.candidates) {
    cellByKey.set(`${String(c.bufferCapacity)}|${String(c.cycleMultiplier)}`, c);
  }
  const values = summary.candidates.map((c) => objective.extract(c));
  const minV = values.length > 0 ? Math.min(...values) : 0;
  const maxV = values.length > 0 ? Math.max(...values) : 0;
  const heatFor = (v: number): { bg: string } => {
    if (maxV <= minV) return { bg: "bg-muted/40" };
    let ratio = (v - minV) / (maxV - minV);
    if (objective.direction === "min") ratio = 1 - ratio;
    if (ratio >= 0.85) return { bg: "bg-sim-running/70" };
    if (ratio >= 0.6) return { bg: "bg-sim-running/45" };
    if (ratio >= 0.35) return { bg: "bg-sim-setup/35" };
    if (ratio >= 0.15) return { bg: "bg-sim-blocked/25" };
    return { bg: "bg-sim-down/20" };
  };
  return (
    <>
      <div className="text-muted-foreground text-[11px]">
        Heatmap: rows = cycle multiplier on <span className="text-foreground">{targetLabel}</span>,
        columns = buffer capacity. Shaded by{" "}
        <span className="text-foreground">{objective.label.toLowerCase()}</span>; infeasible cells
        are muted.
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
                    const isWinner =
                      cell.bufferCapacity === winner.bufferCapacity &&
                      cell.cycleMultiplier === winner.cycleMultiplier;
                    const isCurrent =
                      cell.bufferCapacity === summary.currentCapacity && cell.cycleMultiplier === 1;
                    const feasible = feasibleSet.has(cell);
                    const heat = feasible
                      ? heatFor(objective.extract(cell))
                      : { bg: "bg-muted/30" };
                    const ringCls = isWinner
                      ? "ring-sim-running ring-2"
                      : isCurrent
                        ? "ring-foreground/40 ring-1"
                        : "";
                    const infeasibleCls = feasible
                      ? ""
                      : "opacity-50 text-muted-foreground line-through decoration-foreground/40";
                    return (
                      <td key={`c-${String(cap)}`} className="p-0">
                        <button
                          type="button"
                          data-slot="optimization-cell"
                          data-feasible={feasible ? "true" : "false"}
                          data-winner={isWinner ? "true" : "false"}
                          onClick={() => onCellClick(cell)}
                          className={`${heat.bg} ${ringCls} ${infeasibleCls} hover:ring-foreground/30 flex w-full cursor-pointer flex-col items-end justify-center rounded px-2 py-1.5 text-right transition-shadow hover:ring-2`}
                          title={`WIP ${String(cap)} @${multX(mult)} → ${objective.format(objective.extract(cell))}${objective.unitTrailing ? ` ${objective.unitTrailing}` : ""}${objective.stats(cell).halfWidth95 > 0 ? ` (${objective.format(objective.stats(cell).low95)}–${objective.format(objective.stats(cell).high95)} 95% CI)` : ""}${feasible ? "" : " · infeasible"}`}
                        >
                          <span className="font-mono text-[11px] tabular-nums">
                            {objective.format(objective.extract(cell))}
                          </span>
                          <span className="text-[9px] opacity-70">
                            {isWinner
                              ? "best"
                              : isCurrent
                                ? "now"
                                : feasible
                                  ? objective.unitTrailing || ""
                                  : "infeasible"}
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
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Pareto scatter view — throughput (Y) vs time-in-system (X).
// ──────────────────────────────────────────────────────────────────────────────

const PARETO_PAD = 24;

function ParetoView({
  summary,
  winner,
  feasibleSet,
  objective,
  onDotClick,
}: {
  readonly summary: OptimizationSummary;
  readonly winner: OptimizationCandidate;
  readonly feasibleSet: ReadonlySet<OptimizationCandidate>;
  readonly objective: ObjectiveSpec;
  readonly onDotClick: (c: OptimizationCandidate) => void;
}) {
  // VROL-1038 — X axis follows the active "minimize" objective so the
  // plot meaningfully visualises throughput-vs-cost. TIS is the
  // default (matches the original VROL-842 design); energy-min swaps
  // to J/part. Y always stays throughput so dots higher up = more
  // parts.
  const xExtract: (c: OptimizationCandidate) => number =
    objective.value === "energy-min"
      ? (c) => c.meanEnergyIntensityJPerPart
      : (c) => c.meanTimeInSystemMs;
  const xAxisLabel = objective.value === "energy-min" ? "energy / part (J)" : "time-in-system (ms)";
  const formatX: (v: number) => string =
    objective.value === "energy-min"
      ? (v) => `${Math.round(v).toLocaleString()} J`
      : (v) => `${Math.round(v).toLocaleString()} ms`;
  const {
    containerRef: svgRef,
    width: measuredW,
    height: measuredH,
  } = useChartDimensions<SVGSVGElement>({ width: 480, height: 220 });
  const VIEW_W = Math.max(280, measuredW);
  const VIEW_H = Math.max(180, measuredH);

  const frontier = useMemo(
    () => paretoFrontier(summary.candidates.filter((c) => feasibleSet.has(c))),
    [summary.candidates, feasibleSet],
  );

  const candidates = summary.candidates;
  const xs = candidates.map((c) => xExtract(c));
  const ys = candidates.map((c) => c.meanThroughputPerHour);
  const minX = xs.length > 0 ? Math.min(...xs) : 0;
  const maxX = xs.length > 0 ? Math.max(...xs) : 1;
  const minY = ys.length > 0 ? Math.min(...ys) : 0;
  const maxY = ys.length > 0 ? Math.max(...ys) : 1;
  const spanX = Math.max(1e-9, maxX - minX);
  const spanY = Math.max(1e-9, maxY - minY);

  const innerW = VIEW_W - PARETO_PAD * 2;
  const innerH = VIEW_H - PARETO_PAD * 2;
  const xOf = (v: number): number => PARETO_PAD + ((v - minX) / spanX) * innerW;
  const yOf = (v: number): number => PARETO_PAD + innerH - ((v - minY) / spanY) * innerH;

  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No candidates to plot — the search returned an empty grid.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-[11px]">
        Pareto scatter: X = {xAxisLabel}, Y = throughput. Dominating candidates are highlighted in
        the primary colour; everything else is muted. Click any dot for the combo detail.
      </div>
      <div className="border-border bg-card relative w-full rounded-md border p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
          preserveAspectRatio="none"
          className="block h-56 w-full"
          role="img"
          aria-label={`Pareto scatter: ${String(candidates.length)} candidates, ${String(frontier.length)} on the frontier.`}
        >
          {/* Gridlines */}
          {[0, 0.5, 1].map((frac) => {
            const y = PARETO_PAD + innerH * (1 - frac);
            return (
              <line
                key={`y-${String(frac)}`}
                x1={PARETO_PAD}
                y1={y}
                x2={VIEW_W - PARETO_PAD}
                y2={y}
                stroke="currentColor"
                strokeOpacity={frac === 0 ? 0.35 : 0.12}
                strokeDasharray={frac === 0 ? undefined : "2 2"}
                className="text-muted-foreground"
              />
            );
          })}
          {[0, 0.5, 1].map((frac) => {
            const x = PARETO_PAD + innerW * frac;
            return (
              <line
                key={`x-${String(frac)}`}
                x1={x}
                y1={PARETO_PAD}
                x2={x}
                y2={VIEW_H - PARETO_PAD}
                stroke="currentColor"
                strokeOpacity={frac === 0 || frac === 1 ? 0.25 : 0.1}
                strokeDasharray="2 2"
                className="text-muted-foreground"
              />
            );
          })}
          {/* Dots — render muted first, then frontier on top so they don't get clipped. */}
          {candidates.map((c, i) => {
            const onF = isOnFrontier(c, frontier);
            const feasible = feasibleSet.has(c);
            const isWinner =
              c.bufferCapacity === winner.bufferCapacity &&
              c.cycleMultiplier === winner.cycleMultiplier;
            const fill = onF ? "var(--primary)" : "var(--muted-foreground)";
            const opacity = feasible ? (onF ? 0.95 : 0.45) : 0.18;
            const radius = isWinner ? 6 : onF ? 4.5 : 3;
            return (
              <g key={`d-${String(i)}`}>
                <circle
                  cx={xOf(xExtract(c))}
                  cy={yOf(c.meanThroughputPerHour)}
                  r={radius}
                  fill={fill}
                  opacity={opacity}
                  stroke={isWinner ? "var(--primary)" : "transparent"}
                  strokeWidth={isWinner ? 1.5 : 0}
                />
                {/* Invisible larger hit target so clicks land. */}
                <circle
                  data-slot="pareto-dot"
                  data-frontier={onF ? "true" : "false"}
                  data-feasible={feasible ? "true" : "false"}
                  data-winner={isWinner ? "true" : "false"}
                  cx={xOf(xExtract(c))}
                  cy={yOf(c.meanThroughputPerHour)}
                  r={Math.max(8, radius + 4)}
                  fill="transparent"
                  className="cursor-pointer"
                  onClick={() => onDotClick(c)}
                >
                  <title>
                    {`WIP ${String(c.bufferCapacity)} @${c.cycleMultiplier.toFixed(2)}× · ${fmtInt(c.meanThroughputPerHour)} /h · ${formatX(xExtract(c))}${onF ? " · Pareto-optimal" : ""}${feasible ? "" : " · infeasible"}`}
                  </title>
                </circle>
              </g>
            );
          })}
        </svg>
        <div className="text-muted-foreground mt-1 flex items-center justify-between text-[10px]">
          <span>{xAxisLabel}</span>
          <span>throughput (/h)</span>
        </div>
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--primary)" }}
            />
            <span className="text-foreground">Pareto-optimal ({frontier.length})</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--muted-foreground)", opacity: 0.45 }}
            />
            <span>Dominated</span>
          </span>
        </div>
      </div>
    </div>
  );
}
