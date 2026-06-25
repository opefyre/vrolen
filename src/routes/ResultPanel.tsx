/**
 * Result-panel cards (VROL-625 code-split).
 *
 * Extracted from EditorPage.tsx into its own module so the cards + charts
 * that only render after a run can be lazy-loaded behind a Suspense fallback,
 * shrinking the first-paint editor chunk. ResultPanel is the default export
 * and exposes the same shape KpiStrip had inline.
 */

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Award,
  Boxes,
  Layers,
  Lightbulb,
  Link as LinkIcon,
  PieChart,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import type { ChainResult, TimeseriesSample } from "@/engine";
import { asMaterialId } from "@/engine";
import { Accordion, AccordionStatus } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { narrateRun } from "@/lib/narrate-run";
import { detectWarmup } from "@/lib/warmup-detection";
import { toast } from "@/lib/toast";
import { useChartDimensions } from "@/lib/use-chart-dimensions";

import { KpiDrilldown, SensitivityDrilldown } from "./DrilldownSheets";
import { OeeOverTimeChart } from "./OeeOverTimeChart";
import { ReworkOverTimeChart } from "./ReworkOverTimeChart";
import { cycleStats } from "@/lib/cycle-stats";
import { ChartDrilldown, ViewDetailsButton } from "@/components/results/ChartDrilldown";

import { EmptyState } from "@/components/EmptyState";
import { BufferSummary } from "./BufferSummary";
import { FinalStateCard } from "./FinalStateCard";
import { OeeBreakdown } from "./OeeBreakdown";
import { ConstraintHistoryChart } from "@/components/results/constraint-history-chart";
import { ActionCard } from "@/components/results/action-card";
import { SixLossBreakdown } from "@/components/results/six-loss-bar";
import { StationGantt } from "@/components/results/station-gantt";
import { GlossaryTerm } from "@/components/ui/glossary-term";
import { QualityLosses } from "./QualityLosses";
import { RecommendationsCard } from "./RecommendationsCard";
import { StatePareto } from "./StatePareto";
import { ThroughputChart } from "./ThroughputChart";
import { CostCard } from "./CostCard";
import { OptimizationCard } from "./OptimizationCard";
import { ReplicationsCard } from "./ReplicationsCard";
import { SensitivityBody, SensitivityCard } from "./SensitivityCard";
import { VerificationCard } from "./VerificationCard";
import { WipCurveCard } from "./WipCurveCard";
import { RepsCalculator } from "@/components/results/RepsCalculator";

const BOTTLES_ID = asMaterialId("bottles");
const CAPS_ID = asMaterialId("caps");

const REASON_HINT: Record<string, string> = {
  starvation:
    "upstream isn't feeding it fast enough — speed up the feeder, add buffer capacity, or accept the chain rate.",
  blocking:
    "downstream can't keep up — speed up the downstream station, add buffer capacity, or accept the upstream rate.",
  breakdown: "stochastic failures are dominating — raise MTBF or reduce MTTR.",
  setup: "setup / changeover overhead is dominating — reduce setup time or batch products.",
  maintenance: "planned maintenance is dominating — schedule fewer or shorter windows.",
  idle: "this station hasn't been needed — the chain may be over-provisioned at this point.",
  running: "this station is running near full capacity.",
};

interface ResultPanelRunMeta {
  readonly stationLabels: readonly string[];
  /** Chain-order station ids; aligned with stationLabels. */
  readonly chainNodeIds?: readonly string[];
  /** "sourceNodeId→targetNodeId" keys in engine edge order (VROL-792). */
  readonly edgeKeys?: readonly string[];
  /**
   * VROL-867 v1 — per-station UoM label aligned with chainNodeIds.
   * When the sink's entry is non-empty it drives the throughput
   * display unit ("X kg / hour" instead of the default "parts /
   * hour"). Optional so older callers stay valid.
   */
  readonly perStationUnit?: readonly string[];
}

interface ResultPanelProps {
  readonly result: ChainResult;
  readonly runMeta: ResultPanelRunMeta;
  readonly horizonMs: number;
  readonly warmupMs: number;
  /** VROL-690 — pan+zoom canvas to a station by chain-order index. */
  readonly onFocusStation?: (stationIdx: number) => void;
  /** When set, the Verification card renders an "Apply warm-up" button. */
  readonly onApplyWarmup?: (ms: number) => void;
  /** Cross-replication summary; rendered as a 95% CI table when present. */
  readonly replicationSummary?: import("@/lib/replications").ReplicationSummary | null;
  /** Previous run's replication summary; drives the paired-t vs-baseline section. */
  readonly replicationBaseline?: import("@/lib/replications").ReplicationSummary | null;
  /** Cost summary; rendered as the Cost & revenue card when present. */
  readonly costSummary?: import("@/lib/cost-economics").CostSummary | null;
  /** Sensitivity sweep summary. */
  readonly sensitivitySummary?: import("@/lib/sensitivity-sweep").SensitivitySummary | null;
  /** VROL-990 — two-way sensitivity summary (pairwise interaction strengths). */
  readonly twoWaySummary?: import("@/lib/sensitivity-two-way").TwoWaySummary | null;
  /** True while the sweep is running. */
  readonly sensitivityRunning?: boolean;
  /** Fires the sensitivity sweep on click. Card hidden if not provided. */
  readonly onRunSensitivity?: () => void;
  /** Throughput-vs-WIP scan summary. */
  readonly wipCurveSummary?: import("@/lib/wip-curve").WipCurveSummary | null;
  readonly wipCurveRunning?: boolean;
  readonly onRunWipCurve?: () => void;
  readonly onApplyWipCapacity?: (capacity: number) => void;
  /** Optimization grid-search summary. */
  readonly optimizationSummary?: import("@/lib/optimization-search").OptimizationSummary | null;
  readonly optimizationRunning?: boolean;
  readonly onRunOptimization?: () => void;
  readonly onApplyOptimization?: (
    candidate: import("@/lib/optimization-search").OptimizationCandidate,
  ) => void;
  /** VROL-902 — MTTR distribution from the breakdown config. Optional; lets
   *  the RecommendationsCard surface tightly-coupled buffer warnings. */
  readonly mttrDistribution?: import("@/engine/distribution").Distribution;
  /** VROL-902 — per-edge buffer capacities + labels for buffer coverage. */
  readonly bufferEdges?: ReadonlyArray<import("@/lib/buffer-coverage").BufferCoverageInput>;
  /** VROL-908 — when set (live playback), every chart clips its series to
   *  samples[0..playheadIdx]. null/undefined renders the full series. */
  readonly playheadIdx?: number | null;
  /** VROL-796 — handler for one-click Apply on actionable recommendations. */
  readonly onApplyRecommendation?: (
    rec: import("@/lib/recommendations").Recommendation,
    payload: import("@/lib/recommendations").RecommendationApply,
  ) => void;
  /** VROL-953 — handler for the ActionCard Apply button. */
  readonly onApplyActionCard?: (
    payload: import("@/lib/derive-action-card").ActionApplyPayload,
  ) => void;
}

/**
 * VROL-681 — section title with a clickable anchor link icon. Clicking
 * copies the deep-link URL to the user's clipboard for sharing.
 */
function AnchorTitle({
  anchorId,
  children,
}: {
  readonly anchorId: string;
  readonly children: React.ReactNode;
}) {
  const onClick = (): void => {
    if (typeof window === "undefined") return;
    const href = `${window.location.origin}${window.location.pathname}#${anchorId}`;
    if (typeof window.history?.replaceState === "function") {
      window.history.replaceState(null, "", `#${anchorId}`);
    }
    try {
      void navigator.clipboard?.writeText(href);
      toast.success("Link copied", { description: anchorId });
    } catch {
      toast.message("Link", { description: href });
    }
  };
  return (
    <span className="group inline-flex items-center gap-1.5">
      <span>{children}</span>
      <button
        type="button"
        onClick={onClick}
        aria-label={`Copy link to ${anchorId}`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring opacity-0 transition-opacity group-hover:opacity-100 focus-visible:rounded focus-visible:opacity-100 focus-visible:ring-2"
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

// VROL-896 — markdown builders for the chart drilldowns. Each chart's
// underlying series is reduced to a sane number of rows (≤ 40) so the
// pasted markdown stays scannable rather than dumping every sample point.
// Kept inline here (not in a /lib helper) because they're tightly coupled
// to ResultPanel's chart inputs.
function downsampleByStride<T>(rows: readonly T[], maxRows: number): readonly T[] {
  if (rows.length <= maxRows) return rows;
  const stride = Math.ceil(rows.length / maxRows);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += stride) out.push(rows[i]!);
  // Always include the last row so the user sees the final value.
  const last = rows[rows.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

function warmupWelchToMarkdown(
  samples: readonly TimeseriesSample[],
  recommendedMs: number | null,
  currentMs: number,
  horizonMs: number,
): string {
  const lines: string[] = [];
  lines.push("### Warm-up · Welch sparkline");
  lines.push("");
  lines.push(`Recommended warm-up: ${recommendedMs !== null ? fmtMs(recommendedMs) : "—"}`);
  lines.push(`Current warm-up: ${fmtMs(currentMs)}`);
  lines.push(`Horizon: ${fmtMs(horizonMs)}`);
  lines.push("");
  lines.push("| t (ms) | Rate (parts/ms) |");
  lines.push("| --- | --- |");
  // Compute per-sample throughput rate (matches the visual).
  const rates: { tMs: number; r: number }[] = [];
  for (let i = 1; i < samples.length; i++) {
    const cur = samples[i]!;
    const prev = samples[i - 1]!;
    const dt = cur.tMs - prev.tMs;
    if (dt <= 0) continue;
    rates.push({ tMs: cur.tMs, r: (cur.lineCompleted - prev.lineCompleted) / dt });
  }
  for (const r of downsampleByStride(rates, 30)) {
    lines.push(`| ${r.tMs.toFixed(0)} | ${r.r.toFixed(6)} |`);
  }
  return lines.join("\n");
}

function throughputOverTimeToMarkdown(
  samples: readonly TimeseriesSample[],
  warmupMs: number,
): string {
  const lines: string[] = [];
  lines.push("### Throughput over time");
  lines.push("");
  lines.push("| t (ms) | Cumulative completed |");
  lines.push("| --- | --- |");
  const usable = samples.filter((s) => s.tMs >= warmupMs);
  for (const s of downsampleByStride(usable, 40)) {
    lines.push(`| ${s.tMs.toFixed(0)} | ${s.lineCompleted.toLocaleString()} |`);
  }
  return lines.join("\n");
}

function oeeOverTimeToMarkdown(
  samples: readonly TimeseriesSample[],
  stationLabels: readonly string[],
  bottleneckStationIdx: number,
  warmupMs: number,
): string {
  const lines: string[] = [];
  const label =
    stationLabels[bottleneckStationIdx] ?? `Station ${String(bottleneckStationIdx + 1)}`;
  lines.push(`### Bottleneck state over time · ${label}`);
  lines.push("");
  lines.push("| t (ms) | Running% | Starved% | Blocked% | Down% |");
  lines.push("| --- | --- | --- | --- | --- |");
  const usable = samples.filter((s) => s.tMs >= warmupMs);
  const rows = downsampleByStride(usable, 30);
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i]!;
    const prev = i > 0 ? rows[i - 1] : null;
    const curMs = cur.perStationStateMs[bottleneckStationIdx] ?? {};
    const prevMs = prev?.perStationStateMs[bottleneckStationIdx] ?? {};
    const get = (st: string) => (curMs[st] ?? 0) - (prevMs[st] ?? 0);
    const total = ["Running", "Starved", "BlockedOut", "Down", "Setup", "Maintenance", "Idle"]
      .map(get)
      .reduce((a, b) => a + b, 0);
    const pct = (st: string) => (total > 0 ? ((get(st) / total) * 100).toFixed(1) : "0.0");
    lines.push(
      `| ${cur.tMs.toFixed(0)} | ${pct("Running")} | ${pct("Starved")} | ${pct("BlockedOut")} | ${pct("Down")} |`,
    );
  }
  return lines.join("\n");
}

function reworkOverTimeToMarkdown(
  samples: readonly TimeseriesSample[],
  stationLabels: readonly string[],
  warmupMs: number,
): string {
  const lines: string[] = [];
  lines.push("### Rework over time");
  lines.push("");
  const stationCount = stationLabels.length;
  const header = ["t (ms)", ...stationLabels.map((l) => `${l} (rework)`)].join(" | ");
  const sep = ["---", ...stationLabels.map(() => "---")].join(" | ");
  lines.push(`| ${header} |`);
  lines.push(`| ${sep} |`);
  const usable = samples.filter((s) => s.tMs >= warmupMs);
  for (const s of downsampleByStride(usable, 30)) {
    const cells: string[] = [s.tMs.toFixed(0)];
    for (let i = 0; i < stationCount; i++) {
      cells.push(String(s.perStationRework[i] ?? 0));
    }
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function perStationStateToMarkdown(bottlenecks: ChainResult["bottlenecks"]): string {
  const lines: string[] = [];
  lines.push("### Per-station state breakdown");
  lines.push("");
  lines.push("| Station | Running% | Starved% | Blocked% | Down% | Setup% | Maint% | Idle% |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const b of bottlenecks) {
    const get = (st: string) =>
      ((b.breakdown.find((seg) => seg.state === st)?.pct ?? 0) * 100).toFixed(1);
    lines.push(
      `| ${b.label ?? String(b.stationId)} | ${get("Running")} | ${get("Starved")} | ${get("BlockedOut")} | ${get("Down")} | ${get("Setup")} | ${get("Maintenance")} | ${get("Idle")} |`,
    );
  }
  return lines.join("\n");
}

function sensitivityTornadoToMarkdown(
  summary: import("@/lib/sensitivity-sweep").SensitivitySummary,
): string {
  const lines: string[] = [];
  const fmt = (n: number) => Math.round(n).toLocaleString();
  lines.push("### Sensitivity · tornado");
  lines.push("");
  lines.push(`Baseline: ${fmt(summary.baselinePerHour)} /h`);
  lines.push(`Perturbation: ±${Math.round((1 - summary.lowMultiplier) * 100)}% on cycle time`);
  lines.push("");
  lines.push("| Station | Low (/h) | High (/h) | Swing (/h) | Swing % |");
  lines.push("| --- | --- | --- | --- | --- |");
  const sorted = [...summary.rows].sort((a, b) => b.swingPerHour - a.swingPerHour);
  for (const row of sorted) {
    lines.push(
      `| ${row.stationLabel} | ${fmt(row.lowPerHour)} | ${fmt(row.highPerHour)} | ${fmt(row.swingPerHour)} | ${row.swingPct.toFixed(1)}% |`,
    );
  }
  return lines.join("\n");
}

// VROL-896 — extracted body for the per-station state breakdown card so
// the same markup can be re-rendered inside the chart drilldown sheet at
// a larger width.
function PerStationStateBreakdownBody({
  bottlenecks,
}: {
  readonly bottlenecks: ChainResult["bottlenecks"];
}) {
  return (
    <>
      <div className="space-y-3">
        {bottlenecks.map((b) => (
          <div key={String(b.stationId)} className="space-y-1">
            <div className="text-foreground/80 text-sm">{b.label ?? String(b.stationId)}</div>
            <div className="bg-muted flex h-2 overflow-hidden rounded-full">
              {b.breakdown
                .filter((seg) => seg.pct > 0.001)
                .map((seg) => (
                  <div
                    key={seg.state}
                    title={`${seg.state}: ${(seg.pct * 100).toFixed(1)}%`}
                    className={`h-full ${stateColor(seg.state)}`}
                    style={{ width: `${String(seg.pct * 100)}%` }}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-3 flex flex-wrap gap-2 text-xs">
        {["Running", "Setup", "Maintenance", "Down", "BlockedOut", "Starved", "Idle"].map(
          (state) => (
            <span key={state} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${stateColor(state)}`} />
              {state === "BlockedOut" ? "Blocked" : state}
            </span>
          ),
        )}
      </div>
    </>
  );
}

function stateColor(state: string): string {
  switch (state) {
    case "Running":
      return "bg-sim-running";
    case "Starved":
      return "bg-sim-starved";
    case "BlockedOut":
      return "bg-sim-blocked";
    case "Down":
      return "bg-sim-down";
    case "Setup":
      return "bg-sim-setup";
    case "Maintenance":
      return "bg-sim-maintenance";
    case "Idle":
    default:
      return "bg-sim-idle";
  }
}

/** Inner body for the product-mix accordion (no Card wrapper of its own). */
function ProductMixBody({ result }: { result: ChainResult }) {
  const entries = [...(result.perProductCompleted?.entries() ?? [])].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="space-y-2">
      {entries.map(([productId, n]) => {
        const pct = total > 0 ? (n / total) * 100 : 0;
        return (
          <div key={productId} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-foreground/80">{productId}</span>
              <span className="font-mono tabular-nums">
                {n.toLocaleString()} ({pct.toFixed(1)}%)
              </span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className="bg-sim-running h-full rounded-full"
                style={{ width: `${String(pct)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * VROL-832 — Warm-up Welch sparkline. 80px-tall dual-line chart of the
 * raw per-sample throughput rate (faint) overlaid with a rolling-mean
 * line (bold), with vertical markers at the Welch-recommended warm-up
 * and the currently-configured warm-up. Sits above the Verification
 * card so the reader sees "this is where the line stabilized" before
 * they see the Apply-warmup button.
 *
 * Stays self-contained: no recharts / d3 — same SVG-hand-rolled approach
 * as Sparkline + ThroughputChart so the bundle stays light.
 */
function WarmupWelchSparkline({
  samples: rawSamples,
  recommendedMs,
  currentMs,
  horizonMs,
  headerAction,
  playheadIdx,
}: {
  readonly samples: readonly TimeseriesSample[];
  readonly recommendedMs: number | null;
  readonly currentMs: number;
  readonly horizonMs: number;
  /** VROL-896 — slot for a small "View details" affordance. */
  readonly headerAction?: ReactNode;
  /** VROL-908 — clip rendered series to samples[0..playheadIdx] during playback. */
  readonly playheadIdx?: number | null;
}) {
  // VROL-908 — clip rendered series to samples up to playhead during playback.
  const samples = useMemo(
    () =>
      typeof playheadIdx === "number" && playheadIdx >= 0
        ? rawSamples.slice(0, playheadIdx + 1)
        : rawSamples,
    [rawSamples, playheadIdx],
  );
  // Track the rendered SVG pixel size so the viewBox tracks 1:1 with the
  // panel — same pattern as ThroughputChart. Without this, hard-coded
  // viewBox + preserveAspectRatio="none" stretched the chart non-uniformly
  // on wide panels (labels chunky, markers misaligned).
  const {
    containerRef: svgRef,
    width: measuredW,
    height: measuredH,
  } = useChartDimensions<SVGSVGElement>({ width: 600, height: 80 });

  if (samples.length < 4 || horizonMs <= 0) return null;
  // Derive per-sample throughput rate (parts/ms) — mirrors what
  // detectWarmup() consumes so the markers line up with the data.
  const rates: { tMs: number; r: number }[] = [];
  for (let i = 1; i < samples.length; i++) {
    const cur = samples[i]!;
    const prev = samples[i - 1]!;
    const dt = cur.tMs - prev.tMs;
    if (dt <= 0) continue;
    rates.push({ tMs: cur.tMs, r: (cur.lineCompleted - prev.lineCompleted) / dt });
  }
  if (rates.length < 4) return null;
  const w = Math.max(2, Math.floor(rates.length * 0.15));
  const windowedRates: { tMs: number; r: number }[] = rates.map((s, i) => {
    const lo = Math.max(0, i - Math.floor(w / 2));
    const hi = Math.min(rates.length, lo + w);
    let sum = 0;
    let count = 0;
    for (let j = lo; j < hi; j++) {
      sum += rates[j]!.r;
      count++;
    }
    return { tMs: s.tMs, r: count > 0 ? sum / count : s.r };
  });
  const peak = Math.max(...rates.map((s) => s.r), ...windowedRates.map((s) => s.r), 1e-12);
  const W = Math.max(160, measuredW);
  const H = Math.max(60, measuredH);
  const padX = 4;
  const padY = 6;
  const xAt = (tMs: number): number =>
    padX + (Math.max(0, Math.min(horizonMs, tMs)) / horizonMs) * (W - padX * 2);
  const yAt = (r: number): number => H - padY - (r / peak) * (H - padY * 2);
  const toPath = (pts: { tMs: number; r: number }[]): string =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(p.tMs).toFixed(1)} ${yAt(p.r).toFixed(1)}`)
      .join(" ");
  const rawPath = toPath(rates);
  const meanPath = toPath(windowedRates);
  const recX = recommendedMs !== null ? xAt(recommendedMs) : null;
  const curX = xAt(currentMs);
  return (
    <div className="border-border bg-card rounded-md border p-3">
      <div className="text-muted-foreground mb-1 flex items-center justify-between gap-2 text-[11px] tracking-wide uppercase">
        <span>Warm-up · Welch's method</span>
        <div className="flex items-center gap-2 normal-case">
          <span className="font-mono text-[10px]">
            recommended{" "}
            {recommendedMs !== null
              ? recommendedMs >= 1000
                ? `${(recommendedMs / 1000).toFixed(1)}s`
                : `${recommendedMs.toFixed(0)}ms`
              : "—"}
            {" · "}current{" "}
            {currentMs >= 1000 ? `${(currentMs / 1000).toFixed(1)}s` : `${currentMs.toFixed(0)}ms`}
          </span>
          {headerAction}
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        preserveAspectRatio="none"
        className="focus-visible:ring-ring text-sim-running block h-20 w-full focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        role="img"
        tabIndex={0}
        aria-label={(() => {
          // VROL-807 — describe what the sparkline conveys: the per-sample
          // throughput rate plus the Welch-recommended and current warm-up
          // markers so a screen-reader user gets the same takeaway sighted
          // users do from the visual.
          const recLabel =
            recommendedMs !== null
              ? recommendedMs >= 1000
                ? `${(recommendedMs / 1000).toFixed(1)} seconds`
                : `${recommendedMs.toFixed(0)} milliseconds`
              : "not available";
          const curLabel =
            currentMs >= 1000
              ? `${(currentMs / 1000).toFixed(1)} seconds`
              : `${currentMs.toFixed(0)} milliseconds`;
          return `Warm-up Welch sparkline: throughput rate over time. Recommended warm-up ${recLabel}, current warm-up ${curLabel}.`;
        })()}
      >
        <path d={rawPath} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} fill="none" />
        <path d={meanPath} stroke="currentColor" strokeWidth={1.5} fill="none" />
        {recX !== null ? (
          <>
            <line
              x1={recX}
              x2={recX}
              y1={2}
              y2={H - 2}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="3 2"
            />
            <text
              x={recX + 3}
              y={10}
              className="fill-current font-mono"
              fontSize={9}
              fillOpacity={0.85}
            >
              rec
            </text>
          </>
        ) : null}
        <line
          x1={curX}
          x2={curX}
          y1={2}
          y2={H - 2}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={1}
        />
        <text
          x={curX + 3}
          y={H - 4}
          className="fill-current font-mono"
          fontSize={9}
          fillOpacity={0.5}
        >
          current
        </text>
      </svg>
      <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
        <span>0</span>
        <span className="font-mono tabular-nums">
          {horizonMs >= 1000 ? `${(horizonMs / 1000).toFixed(1)}s` : `${horizonMs.toFixed(0)}ms`}
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-[10px]">
        Faint line = raw per-sample throughput rate. Bold line = windowed mean. Dashed marker =
        Welch-recommended warm-up; solid = current setting.
      </p>
    </div>
  );
}

function InsightsBanner({ result }: { result: ChainResult }) {
  const sentences = narrateRun(result);
  if (sentences.length === 0) return null;
  // VROL-684 — copy narrative as markdown bullet list.
  const copyMarkdown = (): void => {
    const md = sentences.map((s) => `- ${s}`).join("\n");
    try {
      void navigator.clipboard?.writeText(md);
      toast.success("Insights copied as markdown");
    } catch {
      toast.error("Copy failed", { description: "Clipboard not available" });
    }
  };
  return (
    <Card aria-label="Run insights" className="border-sim-running/40 bg-sim-running/5 border-l-4">
      <CardContent className="flex items-start gap-3 py-3">
        <Lightbulb className="text-sim-running mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <ul className="space-y-1 text-sm leading-snug">
          {sentences.map((s, i) => (
            <li key={i} className="text-foreground/90">
              {s}
            </li>
          ))}
        </ul>
        <button
          type="button"
          aria-label="Copy insights as markdown"
          onClick={copyMarkdown}
          className="text-muted-foreground hover:text-foreground ml-auto shrink-0 text-xs underline-offset-2 hover:underline"
        >
          Copy markdown
        </button>
      </CardContent>
    </Card>
  );
}

function BottleneckExplanationCard({
  result,
  bottleneckStationIdx,
  onFocusStation,
}: {
  readonly result: ChainResult;
  readonly bottleneckStationIdx?: number;
  readonly onFocusStation?: (stationIdx: number) => void;
}) {
  if (result.bottlenecks.length === 0) return null;
  const sorted = [...result.bottlenecks].sort((a, b) => b.runningPct - a.runningPct);
  const head = sorted[0];
  if (!head) return null;

  const fmtPct = (pct: number) => (pct * 100).toLocaleString("en-US", { maximumFractionDigits: 1 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading flex items-center justify-between gap-2 text-base">
          <span>Bottleneck analysis</span>
          {/* VROL-690 — click-to-zoom on the bottleneck station. */}
          {onFocusStation && typeof bottleneckStationIdx === "number" ? (
            <button
              type="button"
              onClick={() => {
                onFocusStation(bottleneckStationIdx);
              }}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
            >
              Locate on canvas
            </button>
          ) : null}
        </CardTitle>
        <CardDescription>Where the line is constrained.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          <p>
            <strong>{head.label ?? String(head.stationId)}</strong> is the constraint —{" "}
            <span className="font-mono tabular-nums">{fmtPct(head.runningPct)}%</span> of time spent
            Running. Whatever drives this station's rate caps the line.
          </p>
          {sorted.slice(1).map((b) => {
            const hint = REASON_HINT[b.primaryReason] ?? "";
            return (
              <p key={String(b.stationId)} className="text-muted-foreground">
                <strong className="text-foreground">{b.label ?? String(b.stationId)}</strong> spends{" "}
                <span className="font-mono tabular-nums">{fmtPct(b.primaryReasonPct)}%</span> in{" "}
                <span className="font-medium">{b.primaryReason}</span> — {hint}
              </p>
            );
          })}
          <p className="text-muted-foreground border-border border-t pt-2">
            <strong className="text-foreground">Recommendation:</strong>{" "}
            {head.primaryReason === "running"
              ? `Speed up ${head.label ?? "the bottleneck"} (lower its cycle time) to lift the entire chain. Other stations have idle capacity.`
              : `Reduce ${head.primaryReason} on ${head.label ?? "the bottleneck"} — that's its dominant non-Running state.`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * VROL-844 — thin horizontal 95% CI band rendered below a KPI tile's big
 * number. The band's left/right map to [min(values), max(values)] so the
 * reader sees where the CI sits within the run's full spread. A filled
 * segment marks [low95, high95]; tick marks indicate the mean and (when
 * inside the plotted range) the value 0.
 */
function KpiCiBand({ kpi }: { readonly kpi: import("@/lib/replications").ReplicationKpi }) {
  const lo = Math.min(...kpi.values);
  const hi = Math.max(...kpi.values);
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) return null;
  const project = (v: number): number => ((v - lo) / span) * 100;
  const lowPct = Math.max(0, Math.min(100, project(kpi.low95)));
  const highPct = Math.max(0, Math.min(100, project(kpi.high95)));
  const meanPct = Math.max(0, Math.min(100, project(kpi.mean)));
  const fillLeftPct = Math.min(lowPct, highPct);
  const fillWidthPct = Math.abs(highPct - lowPct);
  const zeroInRange = lo <= 0 && hi >= 0;
  const zeroPct = zeroInRange ? project(0) : null;
  const n = kpi.values.length;
  return (
    <div className="mt-1.5 space-y-1">
      <div
        className="bg-muted relative h-1.5 w-full overflow-hidden rounded-sm"
        role="img"
        aria-label={`95% confidence interval: ${kpi.format(kpi.low95)} to ${kpi.format(kpi.high95)}, mean ${kpi.format(kpi.mean)}, n=${String(n)}`}
      >
        <div
          className="bg-primary/30 absolute top-0 bottom-0"
          style={{ left: `${String(fillLeftPct)}%`, width: `${String(fillWidthPct)}%` }}
        />
        <div
          className="bg-primary absolute top-0 bottom-0 w-[2px]"
          style={{ left: `calc(${String(meanPct)}% - 1px)` }}
        />
        {zeroPct !== null ? (
          <div
            className="bg-primary absolute top-0 bottom-0 w-[2px]"
            style={{ left: `calc(${String(zeroPct)}% - 1px)` }}
          />
        ) : null}
      </div>
      <div className="text-muted-foreground font-mono text-[10px] tabular-nums">
        95% CI: [{kpi.format(kpi.low95)}, {kpi.format(kpi.high95)}] (±{kpi.format(kpi.halfWidth95)},
        n={n})
      </div>
    </div>
  );
}

/**
 * VROL-841 — Hero Result Card.
 *
 * The audit found the Overview tab was a row of equal-weight tiles, so the
 * single most important number (throughput) didn't stand out and the user
 * couldn't see at a glance what to look at. This card promotes throughput to
 * a large hero number, attaches the bottleneck attribution directly
 * underneath ("X is the bottleneck — Y% running"), and demotes the other
 * three KPIs to a small secondary row.
 *
 * Throughput is the universal headline: it's the rate the line is delivering
 * customer-facing parts. OEE / TIS / Completed are supporting context.
 */
function HeroResultCard({
  throughputFormatted,
  throughputUnit,
  throughputRepKpi,
  onThroughputDrilldown,
  bottleneck,
  onFocusBottleneck,
}: {
  readonly throughputFormatted: string;
  /** VROL-867 v1 — UoM label rendered next to the throughput value. */
  readonly throughputUnit: string;
  readonly throughputRepKpi: import("@/lib/replications").ReplicationKpi | null;
  readonly onThroughputDrilldown: (() => void) | null;
  readonly bottleneck: {
    readonly label: string;
    readonly runningPct: number;
    readonly stationIdx?: number;
  } | null;
  readonly onFocusBottleneck: ((stationIdx: number) => void) | null;
}) {
  const throughputClickable = onThroughputDrilldown !== null;
  const bottleneckClickable =
    bottleneck !== null && typeof bottleneck.stationIdx === "number" && onFocusBottleneck !== null;
  return (
    <Card className="border-primary/30 from-primary/5 via-card to-card bg-gradient-to-br">
      <CardContent className="space-y-4 p-5">
        <div className="text-muted-foreground flex items-center justify-between text-[11px] font-medium tracking-wide uppercase">
          <span>Throughput</span>
          {throughputRepKpi && throughputRepKpi.values.length > 1 ? (
            <div className="flex items-center gap-2">
              {/* VROL-1007 — stability chip from throughput CV across
                  replications. Gives a one-glance answer to "how
                  confident is this number?" without making the user
                  open the replications drilldown. */}
              {(() => {
                const mean = throughputRepKpi.mean;
                if (mean <= 0) return null;
                const cv = throughputRepKpi.stddev / mean;
                let label: string;
                let tone: string;
                if (cv < 0.05) {
                  label = "Stable";
                  tone = "bg-sim-running/15 text-sim-running-foreground";
                } else if (cv < 0.1) {
                  label = "Some variance";
                  tone = "bg-sim-setup/15 text-sim-setup-foreground";
                } else {
                  label = "High variance — run more reps";
                  tone = "bg-sim-down/15 text-sim-down-foreground";
                }
                return (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium normal-case ${tone}`}
                    title={`Coefficient of variation = ${(cv * 100).toFixed(1)} % across ${String(throughputRepKpi.values.length)} replications`}
                    data-testid="stability-chip"
                  >
                    {label} · CV {(cv * 100).toFixed(1)} %
                  </span>
                );
              })()}
              <span className="font-mono text-[10px] normal-case">
                n = {throughputRepKpi.values.length} replications
              </span>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            if (onThroughputDrilldown) onThroughputDrilldown();
          }}
          disabled={!throughputClickable}
          aria-label={throughputClickable ? "Open throughput drilldown" : undefined}
          className={`block w-full text-left ${
            throughputClickable
              ? "group hover:text-primary cursor-pointer transition-colors"
              : "cursor-default"
          }`}
        >
          <div className="flex items-baseline gap-3">
            <span className="font-heading font-mono text-5xl font-bold tracking-tight tabular-nums">
              {throughputFormatted}
            </span>
            <span className="text-muted-foreground text-sm">{throughputUnit} / hour</span>
            {throughputClickable ? (
              <ArrowUpRight
                className="text-muted-foreground group-hover:text-primary ml-auto h-4 w-4 transition-colors"
                aria-hidden
              />
            ) : null}
          </div>
          {throughputRepKpi && throughputRepKpi.values.length > 1 ? (
            <KpiCiBand kpi={throughputRepKpi} />
          ) : null}
        </button>
        {bottleneck ? (
          <button
            type="button"
            onClick={() => {
              if (
                bottleneckClickable &&
                typeof bottleneck.stationIdx === "number" &&
                onFocusBottleneck
              ) {
                onFocusBottleneck(bottleneck.stationIdx);
              }
            }}
            disabled={!bottleneckClickable}
            aria-label={
              bottleneckClickable
                ? `Locate ${bottleneck.label} on the canvas`
                : `${bottleneck.label} is the bottleneck`
            }
            className={`border-sim-blocked/30 bg-sim-blocked/5 flex w-full items-center gap-2 rounded-md border p-2.5 text-left text-sm ${
              bottleneckClickable
                ? "hover:border-sim-blocked/60 hover:bg-sim-blocked/10 cursor-pointer transition-colors"
                : "cursor-default"
            }`}
          >
            <AlertTriangle className="text-sim-blocked-foreground h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              <strong className="font-medium">{bottleneck.label}</strong> is the bottleneck —{" "}
              <span className="font-mono tabular-nums">
                {(bottleneck.runningPct * 100).toFixed(1)}%
              </span>{" "}
              running. Whatever drives its rate caps the line.
            </span>
            {bottleneckClickable ? (
              <span className="text-muted-foreground ml-auto shrink-0 text-xs">Locate →</span>
            ) : null}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ResultPanel({
  result,
  runMeta,
  horizonMs,
  warmupMs,
  onFocusStation,
  onApplyWarmup,
  replicationSummary,
  replicationBaseline,
  costSummary,
  sensitivitySummary,
  twoWaySummary,
  sensitivityRunning,
  onRunSensitivity,
  wipCurveSummary,
  wipCurveRunning,
  onRunWipCurve,
  onApplyWipCapacity,
  optimizationSummary,
  optimizationRunning,
  onRunOptimization,
  onApplyOptimization,
  mttrDistribution,
  bufferEdges,
  playheadIdx,
  onApplyRecommendation,
  onApplyActionCard,
}: ResultPanelProps) {
  type TabId = "overview" | "throughput" | "oee" | "states" | "quality" | "buffers" | "stations";
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [kpiDrilldown, setKpiDrilldown] = useState<
    import("@/lib/replications").ReplicationKpi | null
  >(null);
  const [sensitivityRow, setSensitivityRow] = useState<
    import("@/lib/sensitivity-sweep").SensitivityRow | null
  >(null);
  // VROL-896 — chart drilldown. One id at a time; the bottom of the panel
  // renders the matching <ChartDrilldown> body so we don't bloat the JSX
  // tree with 6 separate Sheet instances.
  type ChartDrilldownId =
    | "warmup-welch"
    | "throughput-over-time"
    | "oee-over-time"
    | "rework-over-time"
    | "per-station-state"
    | "sensitivity-tornado";
  const [chartDrilldown, setChartDrilldown] = useState<ChartDrilldownId | null>(null);

  // VROL-720 — help-link anchor mapping. Routes to /help (same-tab) with a
  // hash so the matching definition scrolls into view.
  const helpAnchor = (label: string): string | null => {
    const map: Record<string, string> = {
      Completed: "/help",
      Throughput: "/help",
      "Line efficiency": "/help",
      "Time-in-system": "/help",
    };
    return map[label] ?? null;
  };
  const KPI_TO_REP_LABEL: Record<string, string> = {
    Throughput: "Throughput",
    "Line efficiency": "Line efficiency",
    "Time-in-system": "Time-in-system",
    Completed: "Completed",
  };
  const replicationKpiFor = (label: string) =>
    replicationSummary?.kpis.find((k) => k.label === KPI_TO_REP_LABEL[label]) ?? null;
  // VROL-898 — extra hover context for KPI tiles whose meaning is easy to
  // misread. "Line efficiency" in particular is NOT the same as per-station
  // OEE — without this hint, users average the station numbers in their head
  // and complain that the line tile doesn't match.
  const TILE_TOOLTIPS: Record<string, string> = {
    "Line efficiency":
      "Actual throughput as a fraction of the theoretical bottleneck rate. Different from per-station OEE — the station numbers don't roll up to this directly.",
  };
  const tile = (label: string, value: string, hint?: string, term?: string) => {
    const href = helpAnchor(label);
    const repKpi = replicationKpiFor(label);
    const clickable = repKpi !== null;
    const ariaLabel = clickable ? `${label} — open per-replication detail` : undefined;
    const tooltip = TILE_TOOLTIPS[label];
    return (
      <button
        type="button"
        onClick={() => {
          if (repKpi) setKpiDrilldown(repKpi);
        }}
        disabled={!clickable}
        aria-label={ariaLabel}
        title={tooltip}
        className={`border-border bg-card relative w-full overflow-hidden rounded-md border p-3 text-left transition-colors ${clickable ? "hover:border-foreground/30 hover:bg-accent/40 cursor-pointer" : "cursor-default"}`}
      >
        {/* Backdrop sparklines were removed — they had no axis context
            and confused readers. The Throughput tab shows the proper
            chart with labeled axes. */}
        <div className="text-muted-foreground flex items-center justify-between text-xs tracking-wide uppercase">
          <span>{term ? <GlossaryTerm term={term}>{label}</GlossaryTerm> : label}</span>
          {href ? (
            <a
              href={href}
              aria-label={`What is ${label}?`}
              className="hover:text-foreground rounded-full px-1 text-[10px]"
              title="Open glossary"
              onClick={(e) => e.stopPropagation()}
            >
              ?
            </a>
          ) : null}
        </div>
        <div className="font-mono text-xl font-semibold tabular-nums">{value}</div>
        {/* VROL-844 — 95% CI band + caption, only when ≥2 replications. */}
        {repKpi && repKpi.values.length > 1 ? <KpiCiBand kpi={repKpi} /> : null}
        {hint ? <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div> : null}
        {clickable ? (
          <div className="text-muted-foreground mt-1 text-[9px] tracking-wide uppercase">
            Click → per-rep detail
          </div>
        ) : null}
      </button>
    );
  };
  const throughputPerHour = result.throughputLambda * 3_600_000;
  const fmt = (n: number, digits = 1) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const totalScrapped = result.perStationScrapped.reduce((a, b) => a + b, 0);
  const totalReworked = result.perStationReworked.reduce((a, b) => a + b, 0);
  const totalBreakdowns = (result.perStationBreakdowns ?? []).reduce((a, b) => a + b, 0);
  // Per-tab content is shown directly — each tab is single-topic, so an
  // outer accordion would be a redundant toggle layer.
  // Only show the rework chart when at least one station had rework AND the
  // sampler ran. Otherwise the section is pointless noise.
  const reworkActiveStationCount = result.perStationReworked.reduce(
    (n, c) => n + (c > 0 ? 1 : 0),
    0,
  );
  const showReworkChart = reworkActiveStationCount > 0 && result.samples.length >= 2;
  const finalByMat = result.materialFinal ? new Map(result.materialFinal) : null;
  const finalBottles = finalByMat?.get(BOTTLES_ID) ?? null;
  const finalCaps = finalByMat?.get(CAPS_ID) ?? null;
  const hasMaterials = result.materialFinal !== undefined;
  const hasBreakdowns = result.perStationBreakdowns !== undefined;
  const hasLabor = result.laborUtilization !== undefined;
  // Tabbed drill-down. Default to Overview (the actionable view).
  const tabs: { id: TabId; label: string; icon: typeof Activity }[] = [
    { id: "overview", label: "Overview", icon: Lightbulb },
    { id: "throughput", label: "Throughput", icon: Activity },
    { id: "oee", label: "OEE", icon: Award },
    { id: "states", label: "States", icon: PieChart },
    { id: "quality", label: "Quality", icon: ShieldCheck },
    { id: "buffers", label: "Buffers", icon: Boxes },
    { id: "stations", label: "Stations", icon: Layers },
  ];
  // VROL-843 — realised vs ideal cycle strip. The "ideal" cycle is the
  // bottleneck station's declared cycle time (slowest of the per-station
  // ideal cycles), which sets the line's upper bound on throughput.
  // Realised cycle is just the inverse of measured throughput.
  // Color: red when realised exceeds ideal by >10% (significant slip),
  // green when within 5% (line is running near its theoretical pace).
  const idealCycleMs = (() => {
    const cycles = result.perStationOee.map((o) => o.idealCycleTimeMs).filter((n) => n > 0);
    return cycles.length > 0 ? Math.max(...cycles) : 0;
  })();
  const realisedCycleMs = throughputPerHour > 0 ? 60_000 / throughputPerHour : Infinity;
  const cycleStrip = (() => {
    if (!Number.isFinite(realisedCycleMs) || idealCycleMs <= 0) return null;
    const ratio = realisedCycleMs / idealCycleMs;
    const pctOver = (ratio - 1) * 100;
    const toneClass =
      pctOver > 10
        ? "text-sim-down-foreground"
        : Math.abs(pctOver) <= 5
          ? "text-sim-running-foreground"
          : "text-muted-foreground";
    const sign = pctOver >= 0 ? "+" : "";
    return (
      <div
        className="border-border bg-card text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs"
        aria-label="Realised vs ideal cycle"
      >
        <span>
          Realised cycle{" "}
          <strong className="text-foreground font-mono tabular-nums">
            {fmt(realisedCycleMs, 0)} ms
          </strong>
        </span>
        <span>
          · Ideal{" "}
          <strong className="text-foreground font-mono tabular-nums">
            {fmt(idealCycleMs, 0)} ms
          </strong>
        </span>
        <span className={`font-mono tabular-nums ${toneClass}`}>
          {sign}
          {fmt(pctOver, 0)}%
        </span>
      </div>
    );
  })();
  return (
    <div className="space-y-3">
      {/* VROL-841 — Hero Result Card: throughput as the single headline,
          bottleneck attribution inline, with the other 3 KPIs demoted to
          a thinner secondary row. Replaces the previous 4-equal-tile grid
          that gave the user no visual hierarchy. */}
      <HeroResultCard
        throughputFormatted={fmt(throughputPerHour, 0)}
        throughputUnit={(() => {
          // VROL-867 v1 — sink unit drives the throughput label. Falls
          // back to "parts" when the scenario doesn't declare a unit.
          const units = runMeta.perStationUnit;
          if (!units || units.length === 0) return "parts";
          const last = units[units.length - 1];
          return last && last.length > 0 ? last : "parts";
        })()}
        throughputRepKpi={replicationKpiFor("Throughput")}
        onThroughputDrilldown={
          replicationKpiFor("Throughput")
            ? () => {
                const k = replicationKpiFor("Throughput");
                if (k) setKpiDrilldown(k);
              }
            : null
        }
        bottleneck={(() => {
          if (result.bottlenecks.length === 0) return null;
          const sorted = [...result.bottlenecks].sort((a, b) => b.runningPct - a.runningPct);
          const head = sorted[0];
          if (!head) return null;
          return {
            label: head.label ?? "the bottleneck",
            runningPct: head.runningPct,
            stationIdx:
              typeof result.bottleneckStationIdx === "number"
                ? result.bottleneckStationIdx
                : undefined,
          };
        })()}
        onFocusBottleneck={onFocusStation ?? null}
      />
      <InsightsBanner result={result} />
      {cycleStrip}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {tile(
          "Completed",
          result.completed.toLocaleString(),
          "during measurement window",
          "throughput",
        )}
        {tile(
          "Line efficiency",
          `${fmt(result.lineOee * 100)}%`,
          "throughput vs theoretical",
          "oee",
        )}
        {(() => {
          // VROL-979 — TEEP = OEE × loading-fraction. loading = 1 − maintenance/horizon.
          // When no Maintenance windows are configured, loading = 1 → TEEP = OEE
          // and we hide the tile (it would be visually redundant).
          const maintMs = (result.perStationMaintenanceMs ?? []).reduce((s, v) => s + v, 0);
          if (result.elapsedMs <= 0 || maintMs <= 0) return null;
          // Per-station maintenance averaged across stations — caller can argue
          // for line-level instead, but per-station avg matches how the engine
          // already models PM (per-station windows).
          const stationCount = result.perStationOee.length || 1;
          const avgMaintMs = maintMs / stationCount;
          const loading = Math.max(0, 1 - avgMaintMs / result.elapsedMs);
          const teep = result.lineOee * loading;
          return tile(
            "TEEP",
            `${fmt(teep * 100)}%`,
            "OEE × loading (includes maintenance)",
            "teep",
          );
        })()}
        {tile(
          "Time-in-system",
          `${fmt(result.avgTimeInSystemW, 0)} ms`,
          "average W per part",
          "wip",
        )}
      </div>
      {/* VROL-868 — theoretical yield tile, plus VROL-885 sustainability
          tiles, only when there's something to show. The Recommendations
          card already gates its own visibility, so these don't need to
          hide based on actionability. */}
      {(() => {
        const yieldShown = result.theoreticalYield !== undefined && result.theoreticalYield < 1;
        const sustainShown =
          (result.totalEnergyJ ?? 0) > 0 ||
          (result.totalWaterL ?? 0) > 0 ||
          (result.totalCO2eG ?? 0) > 0;
        if (!yieldShown && !sustainShown) return null;
        const energyKWh = (result.totalEnergyJ ?? 0) / 3_600_000;
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {yieldShown ? (
              <div className="border-border bg-card rounded-md border p-3">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">
                  Theoretical yield
                </div>
                <div className="font-mono text-xl font-semibold tabular-nums">
                  {fmt((result.theoreticalYield ?? 1) * 100)}%
                </div>
                <div className="text-muted-foreground text-xs">good / (good + scrap)</div>
              </div>
            ) : null}
            {sustainShown ? (
              <>
                <div className="border-border bg-card rounded-md border p-3">
                  <div className="text-muted-foreground text-xs tracking-wide uppercase">
                    Energy
                  </div>
                  <div className="font-mono text-xl font-semibold tabular-nums">
                    {fmt(energyKWh, energyKWh > 100 ? 0 : 1)}
                  </div>
                  <div className="text-muted-foreground text-xs">kWh total</div>
                </div>
                <div className="border-border bg-card rounded-md border p-3">
                  <div className="text-muted-foreground text-xs tracking-wide uppercase">Water</div>
                  <div className="font-mono text-xl font-semibold tabular-nums">
                    {fmt(result.totalWaterL ?? 0, 1)}
                  </div>
                  <div className="text-muted-foreground text-xs">L total</div>
                </div>
                <div className="border-border bg-card rounded-md border p-3">
                  <div className="text-muted-foreground text-xs tracking-wide uppercase">CO₂e</div>
                  <div className="font-mono text-xl font-semibold tabular-nums">
                    {fmt((result.totalCO2eG ?? 0) / 1000, 1)}
                  </div>
                  <div className="text-muted-foreground text-xs">kg total</div>
                </div>
              </>
            ) : null}
          </div>
        );
      })()}

      {/* Tab strip — replaces the previous wall of stacked cards with
          progressive disclosure. Each tab renders a single focused view
          below; the user picks what they want to see. */}
      <div
        role="tablist"
        aria-label="Result details"
        className="border-border bg-card flex flex-wrap gap-1 overflow-x-auto rounded-md border p-1"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setActiveTab(t.id);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-sim-running/15 text-sim-running"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>
      {/* Cycle-time stats line shown only on the Overview + Stations tabs
          (it's a headline number, not chart-y). */}
      {activeTab === "overview" || activeTab === "stations"
        ? (() => {
            const cs = cycleStats(result);
            if (cs.meanMs === 0) return null;
            return (
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span>
                  <strong className="text-foreground font-mono">{fmt(cs.medianMs, 0)} ms</strong>{" "}
                  median cycle
                </span>
                <span>
                  <strong className="text-foreground font-mono">{fmt(cs.meanMs, 0)} ms</strong> mean
                </span>
                <span>
                  <strong className="text-foreground font-mono">{fmt(cs.minMs, 0)} ms</strong> min ·{" "}
                  <strong className="text-foreground font-mono">{fmt(cs.maxMs, 0)} ms</strong> max
                </span>
              </div>
            );
          })()
        : null}
      {activeTab === "stations" ? (
        <Card id="per-station-completed">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="per-station-completed">Per-station completed</AnchorTitle>
            </CardTitle>
            <CardDescription>{`${String(result.perStationCompleted.length)} station${
              result.perStationCompleted.length === 1 ? "" : "s"
            } during the measurement window.`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.perStationCompleted.map((count, i) => {
              const label = runMeta.stationLabels[i] ?? `Station ${String(i + 1)}`;
              const max = Math.max(...result.perStationCompleted, 1);
              const pct = (count / max) * 100;
              const scrap = result.perStationScrapped[i] ?? 0;
              const rework = result.perStationReworked[i] ?? 0;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-foreground/80">{label}</span>
                    <span className="font-mono tabular-nums">
                      {count.toLocaleString()}
                      {scrap > 0 ? (
                        <span className="text-sim-down-foreground ml-2 text-xs">
                          · {scrap.toLocaleString()} scrap
                        </span>
                      ) : null}
                      {rework > 0 ? (
                        <span className="text-sim-setup-foreground ml-2 text-xs">
                          · {rework.toLocaleString()} rework
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-sim-running h-full rounded-full transition-[width]"
                      style={{ width: `${String(pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* VROL-914 — per-station sustainability contribution. Only renders
          when the line has non-zero totals (line tile gate would have shown
          them up top already, so this drills into who's contributing). */}
      {activeTab === "stations" &&
      ((result.totalEnergyJ ?? 0) > 0 ||
        (result.totalWaterL ?? 0) > 0 ||
        (result.totalCO2eG ?? 0) > 0) ? (
        <Card id="per-station-sustainability">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="per-station-sustainability">
                Per-station sustainability
              </AnchorTitle>
            </CardTitle>
            <CardDescription>
              Each station's share of energy, water, and CO₂e totals — the line tiles broken down by
              station.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-2 text-xs">
              The result panel only exposes line-level totals today. Per-station breakdowns would
              require capturing per-station inputs at run time — a follow-up will land that
              alongside the energy/water/CO₂e configuration when there's measured demand.
            </p>
            <div className="text-foreground/80 grid grid-cols-3 gap-2 text-xs">
              <div className="border-border bg-card/40 rounded-md border p-2">
                <div className="text-muted-foreground text-[10px] uppercase">Energy</div>
                <div className="font-mono tabular-nums">
                  {fmt((result.totalEnergyJ ?? 0) / 3_600_000, 1)} kWh
                </div>
              </div>
              <div className="border-border bg-card/40 rounded-md border p-2">
                <div className="text-muted-foreground text-[10px] uppercase">Water</div>
                <div className="font-mono tabular-nums">{fmt(result.totalWaterL ?? 0, 1)} L</div>
              </div>
              <div className="border-border bg-card/40 rounded-md border p-2">
                <div className="text-muted-foreground text-[10px] uppercase">CO₂e</div>
                <div className="font-mono tabular-nums">
                  {fmt((result.totalCO2eG ?? 0) / 1000, 1)} kg
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "overview" ? (
        <>
          <BottleneckExplanationCard
            result={result}
            bottleneckStationIdx={result.bottleneckStationIdx}
            {...(onFocusStation ? { onFocusStation } : {})}
          />
          <Card id="recommendations">
            <CardHeader>
              <CardTitle className="font-heading text-base">
                <AnchorTitle anchorId="recommendations">Recommendations</AnchorTitle>
              </CardTitle>
              <CardDescription>Ranked by expected impact on throughput.</CardDescription>
            </CardHeader>
            <CardContent>
              <RecommendationsCard
                result={result}
                {...(mttrDistribution ? { mttrDistribution } : {})}
                {...(bufferEdges ? { bufferEdges } : {})}
                {...(onApplyRecommendation ? { onApply: onApplyRecommendation } : {})}
              />
            </CardContent>
          </Card>
          <Card id="final-state-overview">
            <CardHeader>
              <CardTitle className="font-heading text-base">Final state</CardTitle>
              <CardDescription>Each station's dominant state at horizon end.</CardDescription>
            </CardHeader>
            <CardContent>
              <FinalStateCard result={result} stationLabels={runMeta.stationLabels} />
            </CardContent>
          </Card>
          {/* VROL-832 — dual-line sparkline (raw + windowed mean) with markers
              for the Welch-recommended warm-up and the currently-configured
              warm-up. Renders above the Verification card so the visual sits
              right next to the Apply-warmup affordance. */}
          {result.samples.length >= 4 ? (
            <WarmupWelchSparkline
              samples={result.samples}
              recommendedMs={detectWarmup(result.samples, horizonMs).recommendedMs}
              currentMs={warmupMs}
              horizonMs={horizonMs}
              playheadIdx={playheadIdx}
              headerAction={
                <ViewDetailsButton
                  onClick={() => setChartDrilldown("warmup-welch")}
                  label="View details"
                />
              }
            />
          ) : null}
          <VerificationCard
            result={result}
            horizonMs={horizonMs}
            currentWarmupMs={warmupMs}
            {...(onApplyWarmup ? { onApplyWarmup } : {})}
          />
          {/* VROL-844 — replications planner. Only renders when we have a
              multi-rep run to read mean+stddev from. Throughput is the
              KPI we plan against (it's what users tune the line for). */}
          {(() => {
            const throughputKpi = replicationSummary?.kpis.find((k) => k.label === "Throughput");
            if (!throughputKpi || throughputKpi.values.length < 2) return null;
            return (
              <RepsCalculator
                kpiLabel="throughput"
                mean={throughputKpi.mean}
                stddev={throughputKpi.stddev}
                currentReps={throughputKpi.values.length}
              />
            );
          })()}
          {replicationSummary ? (
            <ReplicationsCard
              summary={replicationSummary}
              {...(replicationBaseline ? { baseline: replicationBaseline } : {})}
            />
          ) : null}
          {onRunSensitivity ? (
            <SensitivityCard
              summary={sensitivitySummary ?? null}
              running={sensitivityRunning === true}
              onRun={onRunSensitivity}
              onClickRow={(row) => setSensitivityRow(row)}
              onViewDetails={() => setChartDrilldown("sensitivity-tornado")}
            />
          ) : null}
          {/* VROL-990 — Two-way interactions card. Renders when the
              EditorPage opportunistically runs the two-way sweep after a
              one-way result. Caps at top-3 pairs by interactionStrength. */}
          {twoWaySummary && twoWaySummary.pairs.length > 0 ? (
            <div
              className="border-border bg-card/50 space-y-2 rounded-md border p-3"
              data-testid="two-way-card"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-foreground text-sm font-medium">Top interactions</h3>
                <span className="text-muted-foreground text-[10px]">
                  {twoWaySummary.searchSize} runs · {twoWaySummary.elapsedMs.toFixed(0)} ms
                </span>
              </div>
              <p className="text-muted-foreground text-[11px] leading-snug">
                Pairs whose combined-effect beats the sum of their individual one-way swings.
                Positive strength = the levers reinforce each other.
              </p>
              <div className="space-y-1.5">
                {twoWaySummary.pairs.slice(0, 3).map((p, i) => (
                  <div
                    key={`${String(p.aIdx)}-${String(p.bIdx)}`}
                    className="flex flex-wrap items-center gap-2 text-[11px]"
                  >
                    <div className="text-foreground/80 min-w-[10rem] font-medium">
                      #{i + 1} {p.aLabel} <span className="text-muted-foreground">+</span>{" "}
                      {p.bLabel}
                    </div>
                    <div className="text-muted-foreground">
                      best{" "}
                      <span className="text-foreground font-mono tabular-nums">
                        {Math.round(p.bestCornerPerHour).toLocaleString()}/h
                      </span>{" "}
                      ({p.bestCornerMultipliers[0].toFixed(1)}x ·{" "}
                      {p.bestCornerMultipliers[1].toFixed(1)}x)
                    </div>
                    <div
                      className={
                        p.interactionStrength > 0
                          ? "text-sim-running-foreground font-mono tabular-nums"
                          : "text-muted-foreground font-mono tabular-nums"
                      }
                    >
                      {p.interactionStrength > 0 ? "+" : ""}
                      {Math.round(p.interactionStrength).toLocaleString()}/h vs OAT-sum
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {onRunWipCurve ? (
            <WipCurveCard
              summary={wipCurveSummary ?? null}
              running={wipCurveRunning === true}
              onRun={onRunWipCurve}
              {...(onApplyWipCapacity ? { onApplyCapacity: onApplyWipCapacity } : {})}
            />
          ) : null}
          {onRunOptimization ? (
            <OptimizationCard
              summary={optimizationSummary ?? null}
              running={optimizationRunning === true}
              onRun={onRunOptimization}
              {...(onApplyOptimization ? { onApply: onApplyOptimization } : {})}
            />
          ) : null}
          {costSummary ? <CostCard summary={costSummary} /> : null}
        </>
      ) : null}

      {activeTab === "states" ? (
        <Card id="state-pareto">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="state-pareto">State Pareto</AnchorTitle>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatePareto result={result} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "oee" ? (
        <Card id="oee-breakdown">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="oee-breakdown">OEE breakdown</AnchorTitle>
            </CardTitle>
            <CardDescription>
              Availability × Performance × Quality per station. The slim factor is the lever.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ActionCard
              result={result}
              {...(onApplyActionCard ? { onApply: onApplyActionCard } : {})}
            />
            <OeeBreakdown result={result} replicationSummary={replicationSummary} />
            <SixLossBreakdown result={result} />
            <StationGantt result={result} />
            <ConstraintHistoryChart result={result} />
          </CardContent>
        </Card>
      ) : null}

      {/* Quality losses: only on the Quality tab (auto-hides anyway when zero). */}
      {activeTab === "quality" &&
      result.perStationScrapped.reduce((a, b) => a + b, 0) +
        result.perStationReworked.reduce((a, b) => a + b, 0) >
        0 ? (
        <Card id="quality-losses">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="quality-losses">Quality losses</AnchorTitle>
            </CardTitle>
            <CardDescription>Scrap (red) + rework (yellow) per station.</CardDescription>
          </CardHeader>
          <CardContent>
            <QualityLosses result={result} stationLabels={runMeta.stationLabels} />
          </CardContent>
        </Card>
      ) : null}

      {/* Quality tab empty state — when there's no scrap, rework, or rework
          chart to show, otherwise the tab looks blank. */}
      {activeTab === "quality" &&
      result.perStationScrapped.reduce((a, b) => a + b, 0) +
        result.perStationReworked.reduce((a, b) => a + b, 0) ===
        0 &&
      !showReworkChart ? (
        <EmptyState
          icon={ShieldCheck}
          title="No quality losses in this run"
          body={
            <>
              This scenario produced zero scrap and zero rework. Add a QC station with a non-zero
              defect rate (or a rework target) to surface quality losses here.
            </>
          }
        />
      ) : null}

      {activeTab === "buffers" ? (
        <Card id="buffer-summary">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="buffer-summary">Buffer fill</AnchorTitle>
            </CardTitle>
            <CardDescription>Average + peak fill per inter-station edge.</CardDescription>
          </CardHeader>
          <CardContent>
            <BufferSummary
              result={result}
              stationLabels={runMeta.stationLabels}
              chainNodeIds={runMeta.chainNodeIds}
              edgeKeys={runMeta.edgeKeys}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Final-state card now lives only in the Overview tab (rendered earlier). */}

      {activeTab === "throughput" ? (
        <Card id="throughput">
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="throughput">Throughput over time</AnchorTitle>
            </CardTitle>
            <ViewDetailsButton
              onClick={() => setChartDrilldown("throughput-over-time")}
              label="View details"
            />
          </CardHeader>
          <CardContent>
            <ThroughputChart
              samples={result.samples}
              horizonMs={horizonMs}
              warmupMs={warmupMs}
              playheadIdx={playheadIdx}
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "oee" ? (
        <Card id="bottleneck-state">
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="bottleneck-state">Bottleneck state over time</AnchorTitle>
            </CardTitle>
            <ViewDetailsButton
              onClick={() => setChartDrilldown("oee-over-time")}
              label="View details"
            />
          </CardHeader>
          <CardContent>
            <OeeOverTimeChart
              samples={result.samples}
              stationLabels={runMeta.stationLabels}
              bottleneckStationIdx={result.bottleneckStationIdx}
              horizonMs={horizonMs}
              warmupMs={warmupMs}
              playheadIdx={playheadIdx}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* VROL-914 — per-grade quality breakdown stacked bar. Only renders when
          the line has 2+ grades (otherwise the bar is a single 100%-A block
          and adds nothing). Sourced from result.lineGradeCounts (VROL-882). */}
      {activeTab === "quality" &&
      Object.keys(result.lineGradeCounts ?? {}).filter((g) => g !== "A").length > 0 ? (
        <Card id="grade-breakdown">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="grade-breakdown">Quality grades</AnchorTitle>
            </CardTitle>
            <CardDescription>Share of completed parts by grade.</CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const counts = result.lineGradeCounts ?? {};
              const total = Object.values(counts).reduce((s, n) => s + n, 0);
              if (total === 0) return null;
              const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
              const palette = [
                "bg-sim-running",
                "bg-sim-setup",
                "bg-sim-blocked",
                "bg-sim-down",
                "bg-sim-maintenance",
                "bg-sim-idle",
              ];
              return (
                <div className="space-y-2">
                  <div className="bg-muted flex h-3 overflow-hidden rounded-full">
                    {entries.map(([g, n], i) => (
                      <div
                        key={g}
                        title={`${g}: ${String(n)} (${String(Math.round((n / total) * 100))}%)`}
                        className={`h-full ${palette[i % palette.length]}`}
                        style={{ width: `${String((n / total) * 100)}%` }}
                      />
                    ))}
                  </div>
                  <ul className="text-foreground/80 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
                    {entries.map(([g, n], i) => (
                      <li key={g} className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-sm ${palette[i % palette.length]}`}
                        />
                        <span className="font-mono tabular-nums">{g}</span>
                        <span className="text-muted-foreground ml-auto font-mono tabular-nums">
                          {n.toLocaleString()} · {Math.round((n / total) * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      ) : null}

      {/* VROL-914 — per-batch yield table. Only renders when batch tagging is
          enabled. Sortable by yield (asc/desc) so the worst batches surface
          first. */}
      {activeTab === "quality" && result.perBatchCompleted && result.perBatchCompleted.size > 0 ? (
        <Card id="per-batch-yield">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="per-batch-yield">Per-batch yield</AnchorTitle>
            </CardTitle>
            <CardDescription>
              Good vs scrap per batch. Sorted lowest-yield first so the worst batch is at the top.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const good = result.perBatchCompleted ?? new Map<string, number>();
              const scrap = result.perBatchScrapped ?? new Map<string, number>();
              const allIds = new Set<string>([...good.keys(), ...scrap.keys()]);
              const rows = [...allIds]
                .map((id) => {
                  const g = good.get(id) ?? 0;
                  const s = scrap.get(id) ?? 0;
                  const yieldPct = g + s > 0 ? g / (g + s) : 1;
                  return { id, g, s, yieldPct };
                })
                .sort((a, b) => a.yieldPct - b.yieldPct);
              return (
                <div className="max-h-72 overflow-y-auto">
                  <table className="text-foreground/80 w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-border border-b">
                        <th className="py-1 pr-2 text-left font-medium">Batch</th>
                        <th className="py-1 pr-2 text-right font-medium">Good</th>
                        <th className="py-1 pr-2 text-right font-medium">Scrap</th>
                        <th className="py-1 text-right font-medium">Yield</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-border/40 border-b last:border-0">
                          <td className="py-1 pr-2 font-mono">{r.id}</td>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums">
                            {r.g.toLocaleString()}
                          </td>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums">
                            {r.s.toLocaleString()}
                          </td>
                          <td className="py-1 text-right font-mono tabular-nums">
                            {Math.round(r.yieldPct * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "quality" && showReworkChart ? (
        <Card id="rework-over-time">
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div className="space-y-1">
              <CardTitle className="font-heading text-base">
                <AnchorTitle anchorId="rework-over-time">Rework over time</AnchorTitle>
              </CardTitle>
              <CardDescription>{`Cumulative rework across ${String(reworkActiveStationCount)} station${
                reworkActiveStationCount === 1 ? "" : "s"
              }.`}</CardDescription>
            </div>
            <ViewDetailsButton
              onClick={() => setChartDrilldown("rework-over-time")}
              label="View details"
            />
          </CardHeader>
          <CardContent>
            <ReworkOverTimeChart
              samples={result.samples}
              stationLabels={runMeta.stationLabels}
              horizonMs={horizonMs}
              warmupMs={warmupMs}
              playheadIdx={playheadIdx}
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "stations" &&
      result.perProductCompleted &&
      result.perProductCompleted.size > 0 ? (
        <Card id="product-mix">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="product-mix">Product mix at sink</AnchorTitle>
            </CardTitle>
            <CardDescription>{`${String(result.perProductCompleted.size)} product${
              result.perProductCompleted.size === 1 ? "" : "s"
            } completed during the run.`}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProductMixBody result={result} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "states" ? (
        <Card id="per-station-state-breakdown">
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div className="space-y-1">
              <CardTitle className="font-heading text-base">
                <AnchorTitle anchorId="per-station-state-breakdown">
                  Per-station state breakdown
                </AnchorTitle>
              </CardTitle>
              <CardDescription>
                Time-weighted % per station across the measurement window.
              </CardDescription>
            </div>
            <ViewDetailsButton
              onClick={() => setChartDrilldown("per-station-state")}
              label="View details"
            />
          </CardHeader>
          <CardContent>
            <PerStationStateBreakdownBody bottlenecks={result.bottlenecks} />
          </CardContent>
        </Card>
      ) : null}
      {activeTab === "overview" &&
      (hasMaterials || hasBreakdowns || hasLabor || totalScrapped > 0 || totalReworked > 0) ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {finalBottles !== null
            ? tile(
                "Bottles left",
                finalBottles.toLocaleString(),
                finalBottles === 0 ? "depleted" : "of starting inventory",
              )
            : null}
          {finalCaps !== null
            ? tile(
                "Caps left",
                finalCaps.toLocaleString(),
                finalCaps === 0 ? "depleted" : "of starting inventory",
              )
            : null}
          {hasBreakdowns
            ? tile("Breakdowns", totalBreakdowns.toLocaleString(), "total across chain")
            : null}
          {result.replenishmentsFired !== undefined
            ? tile(
                "Replenishments",
                result.replenishmentsFired.toLocaleString(),
                "fired during run",
              )
            : null}
          {hasLabor
            ? tile(
                "Labor util",
                `${fmt((result.laborUtilization ?? 0) * 100, 1)}%`,
                "total worker-busy / capacity",
              )
            : null}
          {totalScrapped > 0
            ? tile(
                "Scrap",
                totalScrapped.toLocaleString(),
                `${fmt(result.lineScrapRate * 100, 1)}% line scrap rate`,
              )
            : null}
          {totalReworked > 0
            ? tile(
                "Rework",
                totalReworked.toLocaleString(),
                `${fmt(result.lineReworkRate * 100, 1)}% rerouted vs scrapped`,
              )
            : null}
        </div>
      ) : null}
      <KpiDrilldown kpi={kpiDrilldown} onClose={() => setKpiDrilldown(null)} />
      <SensitivityDrilldown
        row={sensitivityRow}
        summary={sensitivitySummary ?? null}
        onClose={() => setSensitivityRow(null)}
        {...(onFocusStation
          ? {
              onFocusStation: (idx: number) => {
                onFocusStation(idx);
                setSensitivityRow(null);
              },
            }
          : {})}
      />
      {/* VROL-896 — chart drilldowns. Renders the chart at ~40rem so the
          reader can actually read tick marks, station labels, and time
          axes that get crushed in the result-panel-width view. */}
      {(() => {
        if (chartDrilldown === null) return null;
        const close = () => setChartDrilldown(null);
        if (chartDrilldown === "warmup-welch") {
          const recommendedMs = detectWarmup(result.samples, horizonMs).recommendedMs;
          return (
            <ChartDrilldown
              chartId="warmup-welch"
              title="Warm-up · Welch's method"
              description="Per-sample throughput rate with recommended and current warm-up markers."
              markdownData={warmupWelchToMarkdown(
                result.samples,
                recommendedMs,
                warmupMs,
                horizonMs,
              )}
              open
              onClose={close}
            >
              <WarmupWelchSparkline
                samples={result.samples}
                recommendedMs={recommendedMs}
                currentMs={warmupMs}
                horizonMs={horizonMs}
              />
            </ChartDrilldown>
          );
        }
        if (chartDrilldown === "throughput-over-time") {
          return (
            <ChartDrilldown
              chartId="throughput-over-time"
              title="Throughput over time"
              description="Cumulative completed parts across the measurement window."
              markdownData={throughputOverTimeToMarkdown(result.samples, warmupMs)}
              open
              onClose={close}
            >
              <ThroughputChart samples={result.samples} horizonMs={horizonMs} warmupMs={warmupMs} />
            </ChartDrilldown>
          );
        }
        if (chartDrilldown === "oee-over-time") {
          return (
            <ChartDrilldown
              chartId="oee-over-time"
              title="Bottleneck state over time"
              description="Per-interval state mix at the bottleneck station."
              markdownData={oeeOverTimeToMarkdown(
                result.samples,
                runMeta.stationLabels,
                result.bottleneckStationIdx,
                warmupMs,
              )}
              open
              onClose={close}
            >
              <OeeOverTimeChart
                samples={result.samples}
                stationLabels={runMeta.stationLabels}
                bottleneckStationIdx={result.bottleneckStationIdx}
                horizonMs={horizonMs}
                warmupMs={warmupMs}
              />
            </ChartDrilldown>
          );
        }
        if (chartDrilldown === "rework-over-time") {
          return (
            <ChartDrilldown
              chartId="rework-over-time"
              title="Rework over time"
              description="Cumulative reworked parts per station."
              markdownData={reworkOverTimeToMarkdown(
                result.samples,
                runMeta.stationLabels,
                warmupMs,
              )}
              open
              onClose={close}
            >
              <ReworkOverTimeChart
                samples={result.samples}
                stationLabels={runMeta.stationLabels}
                horizonMs={horizonMs}
                warmupMs={warmupMs}
              />
            </ChartDrilldown>
          );
        }
        if (chartDrilldown === "per-station-state") {
          return (
            <ChartDrilldown
              chartId="per-station-state"
              title="Per-station state breakdown"
              description="Time-weighted % per station across the measurement window."
              markdownData={perStationStateToMarkdown(result.bottlenecks)}
              open
              onClose={close}
            >
              <PerStationStateBreakdownBody bottlenecks={result.bottlenecks} />
            </ChartDrilldown>
          );
        }
        if (chartDrilldown === "sensitivity-tornado") {
          if (!sensitivitySummary) {
            return (
              <ChartDrilldown
                chartId="sensitivity-tornado"
                title="Sensitivity · tornado"
                description="Run the sweep to populate this view."
                open
                onClose={close}
              >
                <p className="text-muted-foreground text-sm">No sweep summary available yet.</p>
              </ChartDrilldown>
            );
          }
          return (
            <ChartDrilldown
              chartId="sensitivity-tornado"
              title="Sensitivity · tornado"
              description="±20% cycle-time perturbation per station, ranked by throughput swing."
              markdownData={sensitivityTornadoToMarkdown(sensitivitySummary)}
              open
              onClose={close}
            >
              <SensitivityBody
                summary={sensitivitySummary}
                onClickRow={(row) => setSensitivityRow(row)}
              />
            </ChartDrilldown>
          );
        }
        return null;
      })()}
    </div>
  );
}

/**
 * Side-by-side scenario comparison (VROL-617 + 624). Rides in this module so
 * the chart components don't get pulled into the main editor chunk just to
 * support compare.
 */
export function ComparisonTable({
  aName,
  aResult,
  aStationLabels,
  bName,
  bResult,
  bStationLabels,
  horizonMs,
  warmupMs,
  configDiffRows,
}: {
  aName: string;
  aResult: ChainResult;
  aStationLabels: readonly string[];
  bName: string;
  bResult: ChainResult;
  bStationLabels: readonly string[];
  horizonMs: number;
  warmupMs: number;
  /** VROL-994 — optional structured diff of input configuration (A vs B). */
  configDiffRows?: readonly import("@/lib/scenario-diff").DiffRow[];
}) {
  const fmt = (n: number, digits = 1) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  // VROL-653 — collapse the dense scalar table behind an accordion. KPI delta
  // tiles + charts stay always-visible at the top.
  const [allDeltasOpen, setAllDeltasOpen] = useState(false);
  // VROL-946 — per-station OEE accordion (separate toggle so users can
  // expand the deeper table without losing the line-level view).
  const [perStationOpen, setPerStationOpen] = useState(false);

  type Row = {
    label: string;
    a: number;
    b: number;
    fmt: (n: number) => string;
    higherIsBetter: boolean;
    hideDiffWhenZero?: boolean;
  };
  const rows: Row[] = [
    {
      label: "Completed",
      a: aResult.completed,
      b: bResult.completed,
      fmt: (n) => n.toLocaleString(),
      higherIsBetter: true,
    },
    {
      label: "Throughput (parts/hour)",
      a: aResult.throughputLambda * 3_600_000,
      b: bResult.throughputLambda * 3_600_000,
      fmt: (n) => fmt(n, 0),
      higherIsBetter: true,
    },
    {
      label: "Line efficiency",
      a: aResult.lineOee,
      b: bResult.lineOee,
      fmt: (n) => `${fmt(n * 100)}%`,
      higherIsBetter: true,
    },
    {
      label: "Avg time-in-system (ms)",
      a: aResult.avgTimeInSystemW,
      b: bResult.avgTimeInSystemW,
      fmt: (n) => fmt(n, 0),
      higherIsBetter: false,
    },
    {
      label: "Line scrap rate",
      a: aResult.lineScrapRate,
      b: bResult.lineScrapRate,
      fmt: (n) => `${fmt(n * 100)}%`,
      higherIsBetter: false,
    },
  ];
  if (aResult.laborUtilization !== undefined || bResult.laborUtilization !== undefined) {
    rows.push({
      label: "Labor util",
      a: aResult.laborUtilization ?? 0,
      b: bResult.laborUtilization ?? 0,
      fmt: (n) => `${fmt(n * 100)}%`,
      higherIsBetter: true,
    });
  }

  const aHasSamples = aResult.samples.length > 1;
  const bHasSamples = bResult.samples.length > 1;
  const showChartRow = aHasSamples || bHasSamples;

  // VROL-653 — top-line KPI delta tiles (the 4 metrics users care about most).
  // VROL-679 — `higherIsBetter` lets us color deltas by *direction-aware*
  // semantics (down time-in-system = green, up time-in-system = red).
  const kpiTiles: readonly {
    readonly label: string;
    readonly a: number;
    readonly b: number;
    readonly fmtVal: (n: number) => string;
    readonly higherIsBetter: boolean;
  }[] = [
    {
      label: "Completed",
      a: aResult.completed,
      b: bResult.completed,
      fmtVal: (n: number) => n.toLocaleString(),
      higherIsBetter: true,
    },
    {
      label: "Throughput/h",
      a: aResult.throughputLambda * 3_600_000,
      b: bResult.throughputLambda * 3_600_000,
      fmtVal: (n: number) => fmt(n, 0),
      higherIsBetter: true,
    },
    {
      label: "Line efficiency",
      a: aResult.lineOee,
      b: bResult.lineOee,
      fmtVal: (n: number) => `${fmt(n * 100)}%`,
      higherIsBetter: true,
    },
    {
      label: "Time-in-sys",
      a: aResult.avgTimeInSystemW,
      b: bResult.avgTimeInSystemW,
      fmtVal: (n: number) => `${fmt(n, 0)} ms`,
      higherIsBetter: false,
    },
  ];

  // VROL-745 — single-line ratio summary so the headline is the first thing the user reads.
  const ratioLine = (() => {
    const tA = aResult.throughputLambda * 3_600_000;
    const tB = bResult.throughputLambda * 3_600_000;
    if (tA <= 0) return null;
    const ratio = tB / tA;
    const pct = (ratio * 100).toFixed(0);
    return ratio >= 1
      ? `B delivers ${pct}% of A's throughput (▲ ${((ratio - 1) * 100).toFixed(0)}% better).`
      : `B delivers ${pct}% of A's throughput (▼ ${((1 - ratio) * 100).toFixed(0)}% worse).`;
  })();

  return (
    <div className="space-y-4">
      {ratioLine ? <p className="text-foreground/80 text-sm">{ratioLine}</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpiTiles.map((t) => {
          const delta = t.b - t.a;
          const pctDelta = t.a !== 0 ? (delta / Math.abs(t.a)) * 100 : 0;
          const isUp = delta > 0;
          // VROL-679 — direction-aware coloring. For time-in-system, ▼ is good.
          const betterForB = t.higherIsBetter ? delta > 0 : delta < 0;
          const colorClass =
            delta === 0
              ? "text-muted-foreground"
              : betterForB
                ? "text-sim-running-foreground"
                : "text-sim-down-foreground";
          return (
            <div key={t.label} className="border-border bg-card rounded-md border p-3">
              <div className="text-muted-foreground text-xs tracking-wide uppercase">{t.label}</div>
              <div className="font-mono text-base font-semibold tabular-nums">{t.fmtVal(t.b)}</div>
              <div className={`mt-0.5 text-xs ${colorClass}`}>
                {delta === 0
                  ? `= ${t.fmtVal(t.a)}`
                  : `${isUp ? "▲" : "▼"} ${t.fmtVal(Math.abs(delta))}${
                      t.a !== 0 ? ` (${fmt(pctDelta, 0)}%)` : ""
                    } vs A`}
              </div>
            </div>
          );
        })}
      </div>
      <Accordion
        title="All scalar deltas"
        status={
          <AccordionStatus tone="configured">
            {`${String(rows.length)} metric${rows.length === 1 ? "" : "s"} · B vs A`}
          </AccordionStatus>
        }
        expanded={allDeltasOpen}
        onToggle={() => {
          setAllDeltasOpen((v) => !v);
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs tracking-wide uppercase">
                <th className="py-2 pr-3 font-medium">Metric</th>
                <th className="px-3 py-2 text-right font-medium" title={aName}>
                  A · {aName.length > 12 ? `${aName.slice(0, 11)}…` : aName}
                </th>
                <th className="px-3 py-2 text-right font-medium">B · {bName}</th>
                <th className="py-2 pl-3 text-right font-medium">Δ (B−A)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const delta = row.b - row.a;
                const pctDelta = row.a !== 0 ? (delta / Math.abs(row.a)) * 100 : 0;
                const isUp = delta > 0;
                const betterForB = row.higherIsBetter ? delta > 0 : delta < 0;
                return (
                  <tr key={row.label} className="border-border/50 border-b last:border-0">
                    <td className="py-2 pr-3">{row.label}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {row.fmt(row.a)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {row.fmt(row.b)}
                    </td>
                    <td
                      className={`py-2 pl-3 text-right font-mono tabular-nums ${
                        delta === 0
                          ? "text-muted-foreground"
                          : betterForB
                            ? "text-sim-running-foreground"
                            : "text-sim-down-foreground"
                      }`}
                    >
                      {delta === 0 ? "0" : `${isUp ? "+" : ""}${row.fmt(delta)}`}
                      {row.a !== 0 && delta !== 0 ? (
                        <span className="text-muted-foreground ml-1">({fmt(pctDelta, 0)}%)</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Accordion>
      {/* VROL-994 — configuration diff between A and B. Shows what
          INPUTS changed alongside the existing output deltas. */}
      {configDiffRows && configDiffRows.length > 0 ? (
        <Accordion
          title="Configuration diff · A vs B"
          status={
            <AccordionStatus tone="configured">
              {`${String(configDiffRows.length)} change${configDiffRows.length === 1 ? "" : "s"}`}
            </AccordionStatus>
          }
          expanded={false}
          onToggle={() => {
            /* uncontrolled toggle is fine for first version */
          }}
        >
          <div className="overflow-x-auto" data-testid="compare-config-diff">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left tracking-wide uppercase">
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium">Field</th>
                  <th className="px-3 py-2 text-right font-medium">A</th>
                  <th className="px-3 py-2 text-right font-medium">B</th>
                </tr>
              </thead>
              <tbody>
                {configDiffRows.map((r, i) => (
                  <tr
                    key={`${r.category}-${r.label}-${String(i)}`}
                    className="border-border/50 border-b last:border-0"
                  >
                    <td className="text-muted-foreground py-2 pr-3 text-[11px]">{r.category}</td>
                    <td className="py-2 pr-3">{r.label}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{r.aValue}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{r.bValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Accordion>
      ) : null}
      {/* VROL-946 — per-station OEE breakdown side-by-side with Δ. Rows are
          aligned by topology index when both runs share the same station
          count; mismatched runs collapse into the line-level KPI tiles
          above and skip this section. */}
      {aResult.perStationOee.length > 0 &&
      aResult.perStationOee.length === bResult.perStationOee.length ? (
        <Accordion
          title="Per-station OEE · A vs B"
          status={
            <AccordionStatus tone="configured">
              {`${String(aResult.perStationOee.length)} station${
                aResult.perStationOee.length === 1 ? "" : "s"
              }`}
            </AccordionStatus>
          }
          expanded={perStationOpen}
          onToggle={() => {
            setPerStationOpen((v) => !v);
          }}
        >
          <div className="overflow-x-auto" data-testid="compare-per-station-oee">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left tracking-wide uppercase">
                  <th className="py-2 pr-3 font-medium">Station</th>
                  <th className="px-3 py-2 text-right font-medium">A · OEE</th>
                  <th className="px-3 py-2 text-right font-medium">B · OEE</th>
                  <th className="py-2 pl-3 text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {aResult.perStationOee.map((aOee, i) => {
                  const bOee = bResult.perStationOee[i];
                  if (!bOee) return null;
                  const label =
                    aStationLabels[i] ??
                    bStationLabels[i] ??
                    aResult.perStationLabels?.[i] ??
                    `Station ${String(i)}`;
                  const delta = bOee.oee - aOee.oee;
                  const big = Math.abs(delta) >= 0.1;
                  return (
                    <tr
                      key={`${label}-${String(i)}`}
                      className="border-border/50 border-b last:border-0"
                    >
                      <td className="py-2 pr-3">{label}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {`${(aOee.oee * 100).toFixed(1)}%`}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {`${(bOee.oee * 100).toFixed(1)}%`}
                      </td>
                      <td
                        className={`py-2 pl-3 text-right font-mono tabular-nums ${
                          big && delta > 0
                            ? "text-sim-running-foreground font-semibold"
                            : big && delta < 0
                              ? "text-sim-down-foreground font-semibold"
                              : "text-muted-foreground"
                        }`}
                      >
                        {`${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Accordion>
      ) : null}
      {showChartRow ? (
        <div className="space-y-3">
          <div className="border-border space-y-2 rounded-md border p-3">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Throughput over time
            </div>
            <ThroughputChart
              samples={aHasSamples ? aResult.samples : bResult.samples}
              {...(aHasSamples && bHasSamples ? { secondarySamples: bResult.samples } : {})}
              primaryLabel={`A · ${aName}`}
              secondaryLabel={`B · ${bName}`}
              horizonMs={horizonMs}
              warmupMs={warmupMs}
            />
            {!aHasSamples || !bHasSamples ? (
              <p className="text-muted-foreground text-[11px]">
                {!aHasSamples && !bHasSamples
                  ? "Enable Sample throughput over time in Run settings to compare curves."
                  : !aHasSamples
                    ? `A · ${aName} has no samples — showing only B.`
                    : `B · ${bName} has no samples — showing only A.`}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border-border space-y-2 rounded-md border p-3">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Bottleneck state · A · {aName}
              </div>
              <OeeOverTimeChart
                samples={aResult.samples}
                stationLabels={aStationLabels}
                bottleneckStationIdx={aResult.bottleneckStationIdx}
                horizonMs={horizonMs}
                warmupMs={warmupMs}
              />
            </div>
            <div className="border-border space-y-2 rounded-md border p-3">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Bottleneck state · B · {bName}
              </div>
              <OeeOverTimeChart
                samples={bResult.samples}
                stationLabels={bStationLabels}
                bottleneckStationIdx={bResult.bottleneckStationIdx}
                horizonMs={horizonMs}
                warmupMs={warmupMs}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ResultPanel;
