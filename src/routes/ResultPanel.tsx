/**
 * Result-panel cards (VROL-625 code-split).
 *
 * Extracted from EditorPage.tsx into its own module so the cards + charts
 * that only render after a run can be lazy-loaded behind a Suspense fallback,
 * shrinking the first-paint editor chunk. ResultPanel is the default export
 * and exposes the same shape KpiStrip had inline.
 */

import type { ChainResult } from "@/engine";
import { asMaterialId } from "@/engine";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { OeeOverTimeChart } from "./OeeOverTimeChart";
import { ThroughputChart } from "./ThroughputChart";

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
}

interface ResultPanelProps {
  readonly result: ChainResult;
  readonly runMeta: ResultPanelRunMeta;
  readonly horizonMs: number;
  readonly warmupMs: number;
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

function ProductMixCard({ result }: { result: ChainResult }) {
  const entries = [...(result.perProductCompleted?.entries() ?? [])].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">Product mix at sink</CardTitle>
        <CardDescription>
          Per-product completion counts. Compare to the configured intent in the Products section of
          Run settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

function BottleneckExplanationCard({ result }: { result: ChainResult }) {
  if (result.bottlenecks.length === 0) return null;
  const sorted = [...result.bottlenecks].sort((a, b) => b.runningPct - a.runningPct);
  const head = sorted[0];
  if (!head) return null;

  const fmtPct = (pct: number) => (pct * 100).toLocaleString("en-US", { maximumFractionDigits: 1 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">Bottleneck analysis</CardTitle>
        <CardDescription>Auto-narrated from the per-station state breakdown.</CardDescription>
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

export function ResultPanel({ result, runMeta, horizonMs, warmupMs }: ResultPanelProps) {
  const tile = (label: string, value: string, hint?: string) => (
    <div className="border-border bg-card rounded-md border p-3">
      <div className="text-muted-foreground text-xs tracking-wide uppercase">{label}</div>
      <div className="font-mono text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div> : null}
    </div>
  );
  const throughputPerHour = result.throughputLambda * 3_600_000;
  const fmt = (n: number, digits = 1) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const totalScrapped = result.perStationScrapped.reduce((a, b) => a + b, 0);
  const totalReworked = result.perStationReworked.reduce((a, b) => a + b, 0);
  const totalBreakdowns = (result.perStationBreakdowns ?? []).reduce((a, b) => a + b, 0);
  const finalByMat = result.materialFinal ? new Map(result.materialFinal) : null;
  const finalBottles = finalByMat?.get(BOTTLES_ID) ?? null;
  const finalCaps = finalByMat?.get(CAPS_ID) ?? null;
  const hasMaterials = result.materialFinal !== undefined;
  const hasBreakdowns = result.perStationBreakdowns !== undefined;
  const hasLabor = result.laborUtilization !== undefined;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tile("Completed", result.completed.toLocaleString(), "during measurement window")}
        {tile("Throughput", fmt(throughputPerHour, 0), "parts / hour")}
        {tile("Line OEE", `${fmt(result.lineOee * 100)}%`, "geometric mean")}
        {tile("Time-in-system", `${fmt(result.avgTimeInSystemW, 0)} ms`, "average W per part")}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">Per-station completed</CardTitle>
          <CardDescription>
            Counts at each station in topology order. Lower values downstream usually mean
            BlockedOut or warm-up bleed; lower upstream means Starved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
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
          </div>
        </CardContent>
      </Card>

      <BottleneckExplanationCard result={result} />

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">Throughput over time</CardTitle>
          <CardDescription>
            Cumulative parts that exited the system, sampled at the configured interval (VROL-613).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThroughputChart samples={result.samples} horizonMs={horizonMs} warmupMs={warmupMs} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">Bottleneck state over time</CardTitle>
          <CardDescription>
            How the rate-limiting station's state mix evolved across the run (VROL-620).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OeeOverTimeChart
            samples={result.samples}
            stationLabels={runMeta.stationLabels}
            bottleneckStationIdx={result.bottleneckStationIdx}
            horizonMs={horizonMs}
            warmupMs={warmupMs}
          />
        </CardContent>
      </Card>

      {result.perProductCompleted && result.perProductCompleted.size > 0 ? (
        <ProductMixCard result={result} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">Per-station state breakdown</CardTitle>
          <CardDescription>
            Time-weighted share of each state across the measurement window. Hover a segment to see
            exact percentages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {result.bottlenecks.map((b) => (
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
                  {state}
                </span>
              ),
            )}
          </div>
        </CardContent>
      </Card>
      {hasMaterials || hasBreakdowns || hasLabor || totalScrapped > 0 || totalReworked > 0 ? (
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
                `${fmt(result.lineReworkRate * 100, 1)}% rerouted vs scrapped (VROL-628)`,
              )
            : null}
        </div>
      ) : null}
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
}: {
  aName: string;
  aResult: ChainResult;
  aStationLabels: readonly string[];
  bName: string;
  bResult: ChainResult;
  bStationLabels: readonly string[];
  horizonMs: number;
  warmupMs: number;
}) {
  const fmt = (n: number, digits = 1) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  type Row = {
    label: string;
    a: number;
    b: number;
    fmt: (n: number) => string;
    hideDiffWhenZero?: boolean;
  };
  const rows: Row[] = [
    {
      label: "Completed",
      a: aResult.completed,
      b: bResult.completed,
      fmt: (n) => n.toLocaleString(),
    },
    {
      label: "Throughput (parts/hour)",
      a: aResult.throughputLambda * 3_600_000,
      b: bResult.throughputLambda * 3_600_000,
      fmt: (n) => fmt(n, 0),
    },
    { label: "Line OEE", a: aResult.lineOee, b: bResult.lineOee, fmt: (n) => `${fmt(n * 100)}%` },
    {
      label: "Avg time-in-system (ms)",
      a: aResult.avgTimeInSystemW,
      b: bResult.avgTimeInSystemW,
      fmt: (n) => fmt(n, 0),
    },
    {
      label: "Line scrap rate",
      a: aResult.lineScrapRate,
      b: bResult.lineScrapRate,
      fmt: (n) => `${fmt(n * 100)}%`,
    },
  ];
  if (aResult.laborUtilization !== undefined || bResult.laborUtilization !== undefined) {
    rows.push({
      label: "Labor util",
      a: aResult.laborUtilization ?? 0,
      b: bResult.laborUtilization ?? 0,
      fmt: (n) => `${fmt(n * 100)}%`,
    });
  }

  const aHasSamples = aResult.samples.length > 1;
  const bHasSamples = bResult.samples.length > 1;
  const showChartRow = aHasSamples || bHasSamples;
  return (
    <div className="space-y-4">
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
              return (
                <tr key={row.label} className="border-border/50 border-b last:border-0">
                  <td className="py-2 pr-3">{row.label}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{row.fmt(row.a)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{row.fmt(row.b)}</td>
                  <td
                    className={`py-2 pl-3 text-right font-mono tabular-nums ${
                      delta === 0
                        ? "text-muted-foreground"
                        : isUp
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
