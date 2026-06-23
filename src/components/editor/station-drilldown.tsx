/**
 * VROL-894 — per-station analytics drilldown Sheet.
 *
 * Clicking a station only opens the Inspector for editing. There was no way to
 * ask "what is THIS station doing in the latest run?" — all analytics surfaces
 * were line-level. This Sheet gives one station its own report: Util + OEE
 * breakdown, state mix, throughput-out chart, buffer pressure into/out of it,
 * and a station-specific recommendation. The Inspector keeps owning editing;
 * these two intents stay separate.
 */

import { StateMixBar } from "@/components/canvas/state-mix-bar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ChainResult } from "@/engine/chain-harness";
import { Sparkline } from "@/routes/Sparkline";

interface StationDrilldownProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly nodeId: string | null;
  readonly nodeLabel: string;
  readonly nodeTypeLabel: string;
  readonly result: ChainResult | null;
  readonly chainNodeIds: readonly string[] | null;
  readonly edges: ReadonlyArray<{
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly sourceLabel?: string;
    readonly targetLabel?: string;
    readonly fillL?: number;
    readonly capacity?: number;
  }>;
  /**
   * VROL-912 — engine edge keys ("sourceNodeId→targetNodeId"), index-aligned
   * with result.samples[].perEdgeBufferFill. Lets the drilldown render per-edge
   * buffer-fill sparklines without a separate index lookup. When undefined the
   * buffer-fill sparklines hide and the section falls back to text.
   */
  readonly edgeKeys?: readonly string[];
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function buildRecommendation(state: string, sharePct: number): string {
  const sharePctStr = `${(sharePct * 100).toFixed(0)}%`;
  switch (state) {
    case "Running":
      if (sharePct >= 0.9) {
        return `This station is the binding constraint (running ${sharePctStr}). Reducing its cycle time or adding parallel capacity is the only lever that lifts line throughput.`;
      }
      return `Running ${sharePctStr} of the window — healthy headroom. The line's binding constraint is somewhere else.`;
    case "Starved":
      return `Starved ${sharePctStr} of the window — upstream can't keep this station fed. Look at the immediate upstream station and/or grow the buffer in front of it.`;
    case "BlockedOut":
    case "Blocked":
      return `Blocked ${sharePctStr} of the window — downstream can't take parts fast enough. The fix lives downstream: reduce the next station's cycle, add parallel capacity, or grow the buffer after this one.`;
    case "Down":
      return `Down ${sharePctStr} of the window — unplanned breakdowns are eating availability. Raise MTBF (preventive maintenance), lower MTTR (parts pre-staged), or duplicate.`;
    case "Setup":
      return `Setup ${sharePctStr} of the window — changeovers are dominating. SMED on the setup distribution, reduce product variety, or batch similar runs.`;
    case "Maintenance":
      return `Maintenance ${sharePctStr} of the window — planned windows are large relative to the horizon. Consider running them off-shift.`;
    case "Idle":
    default:
      return `Idle ${sharePctStr} of the window — this station has no work assigned. Check shift coverage and skill assignments.`;
  }
}

const STATE_KEYS_FOR_RATIO = [
  "Running",
  "Setup",
  "Idle",
  "BlockedOut",
  "Starved",
  "Maintenance",
  "Down",
] as const;

export function StationDrilldown({
  open,
  onOpenChange,
  nodeId,
  nodeLabel,
  nodeTypeLabel,
  result,
  chainNodeIds,
  edges,
  edgeKeys,
}: StationDrilldownProps) {
  const stationIdx = result && chainNodeIds && nodeId ? chainNodeIds.indexOf(nodeId) : -1;
  const haveData = stationIdx >= 0 && result !== null;
  const oee = haveData ? result.perStationOee[stationIdx] : null;
  const runningPct = haveData ? (result.perStationRunningPct?.[stationIdx] ?? 0) : 0;
  const bottleneck = haveData ? result.bottlenecks.find((b) => b.stationId === nodeId) : null;
  const completed = haveData ? (result.perStationCompleted[stationIdx] ?? 0) : 0;
  const scrapped = haveData ? (result.perStationScrapped[stationIdx] ?? 0) : 0;
  const reworked = haveData ? (result.perStationReworked[stationIdx] ?? 0) : 0;
  const inEdges = nodeId ? edges.filter((e) => e.target === nodeId) : [];
  const outEdges = nodeId ? edges.filter((e) => e.source === nodeId) : [];
  const primary = bottleneck?.breakdown.reduce(
    (a, b) => (b.pct > a.pct ? b : a),
    bottleneck.breakdown[0] ?? { state: "Idle", pct: 0 },
  );
  const recommendation = primary ? buildRecommendation(primary.state, primary.pct) : null;

  // VROL-912 — derive per-station time series from result.samples. Empty arrays
  // when no sampler ran (sampler off in Run Settings); the chart sections
  // hide cleanly below.
  const samples = haveData ? (result.samples ?? []) : [];
  const completedSeries: number[] = [];
  const runningPctSeries: number[] = [];
  for (const s of samples) {
    completedSeries.push(s.perStationCompleted[stationIdx] ?? 0);
    const stateMs = s.perStationStateMs[stationIdx] ?? {};
    let total = 0;
    for (const k of STATE_KEYS_FOR_RATIO) total += stateMs[k] ?? 0;
    const ratio = total > 0 ? (stateMs.Running ?? 0) / total : 0;
    // Sparkline component skips peak <= 0; multiply by 100 so the curve is
    // visible (otherwise a 1.0 max would render as a single hairline pixel).
    runningPctSeries.push(ratio * 100);
  }
  const incomingEdgeBufferSeries = inEdges.map((e) => {
    const key = `${e.source}→${e.target}`;
    const idx = edgeKeys?.indexOf(key) ?? -1;
    return {
      edge: e,
      series: idx >= 0 ? samples.map((s) => s.perEdgeBufferFill[idx] ?? 0) : [],
    };
  });
  const outgoingEdgeBufferSeries = outEdges.map((e) => {
    const key = `${e.source}→${e.target}`;
    const idx = edgeKeys?.indexOf(key) ?? -1;
    return {
      edge: e,
      series: idx >= 0 ? samples.map((s) => s.perEdgeBufferFill[idx] ?? 0) : [],
    };
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[28rem] flex-col gap-0 overflow-y-auto sm:max-w-md"
        aria-label="Station report"
      >
        <SheetHeader className="space-y-1 pr-10">
          <SheetTitle className="font-heading text-base">
            {nodeLabel || "Station"}
            <span className="text-muted-foreground ml-2 font-mono text-[11px]">
              {nodeTypeLabel}
            </span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Per-station report for the latest run. Editing happens in the Inspector — this is
            read-only analytics.
          </SheetDescription>
        </SheetHeader>
        {/* VROL-912 follow-up — shadcn SheetContent renders its own X close
            button. We previously layered a second one on top, producing two
            close affordances. Drop ours; SheetHeader's pr-10 already reserves
            the space the built-in needs. */}
        {!haveData ? (
          <div className="text-muted-foreground p-4 text-sm">
            No run results for this station yet. Hit Run to populate the report.
          </div>
        ) : (
          <div className="space-y-4 p-4 text-sm">
            <section className="space-y-1.5">
              <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Headline
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="border-border bg-card rounded-md border p-2.5">
                  <div className="text-muted-foreground text-[10px] uppercase">Util</div>
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {pct(runningPct)}
                  </div>
                  <div className="text-muted-foreground text-[10px]">of measurement window</div>
                </div>
                <div className="border-border bg-card rounded-md border p-2.5">
                  <div className="text-muted-foreground text-[10px] uppercase">OEE</div>
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {oee ? pct(oee.oee) : "—"}
                  </div>
                  <div className="text-muted-foreground text-[10px]">A × P × Q</div>
                </div>
              </div>
            </section>

            <section className="space-y-1.5">
              <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                OEE breakdown
              </div>
              <div className="space-y-1">
                <div className="text-foreground/80 flex justify-between text-xs">
                  <span>Availability</span>
                  <span className="font-mono tabular-nums">
                    {oee ? pct(oee.availability) : "—"}
                  </span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-sim-running h-full rounded-full"
                    style={{ width: oee ? `${String(oee.availability * 100)}%` : "0%" }}
                  />
                </div>
                <div className="text-foreground/80 flex justify-between text-xs">
                  <span>Performance</span>
                  <span className="font-mono tabular-nums">{oee ? pct(oee.performance) : "—"}</span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-sim-setup h-full rounded-full"
                    style={{ width: oee ? `${String(oee.performance * 100)}%` : "0%" }}
                  />
                </div>
                <div className="text-foreground/80 flex justify-between text-xs">
                  <span>Quality</span>
                  <span className="font-mono tabular-nums">{oee ? pct(oee.quality) : "—"}</span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-sim-blocked h-full rounded-full"
                    style={{ width: oee ? `${String(oee.quality * 100)}%` : "0%" }}
                  />
                </div>
              </div>
            </section>

            {bottleneck && bottleneck.breakdown.length > 0 ? (
              <section className="space-y-1.5">
                <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  State mix
                </div>
                <StateMixBar
                  breakdown={bottleneck.breakdown.map((b) => ({
                    state: b.state,
                    pct: b.pct,
                  }))}
                  width={240}
                  height={14}
                />
                <ul className="text-foreground/80 mt-1 space-y-0.5 text-xs">
                  {bottleneck.breakdown
                    .filter((b) => b.pct > 0.001)
                    .map((b) => (
                      <li key={b.state} className="flex justify-between">
                        <span>{b.state === "BlockedOut" ? "Blocked" : b.state}</span>
                        <span className="font-mono tabular-nums">{(b.pct * 100).toFixed(1)}%</span>
                      </li>
                    ))}
                </ul>
              </section>
            ) : null}

            {/* VROL-901 — Speed section. Surfaces nominal vs operating cycle
                + the throttle %, so the user can see at a glance whether this
                station is subordinated, at max, or somewhere in between. */}
            {oee && oee.idealCycleTimeMs > 0 ? (
              <section className="space-y-1.5">
                <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Speed
                </div>
                {(() => {
                  const operatingMs = oee.idealCycleTimeMs;
                  const ratio = bottleneck?.nominalSpeedRatio ?? 1;
                  const nominalMs = ratio < 1 ? operatingMs * ratio : operatingMs;
                  const operatingPerHr = operatingMs > 0 ? 3_600_000 / operatingMs : 0;
                  const nominalPerHr = nominalMs > 0 ? 3_600_000 / nominalMs : 0;
                  const throttlePct = Math.round(ratio * 100);
                  const isThrottled = ratio < 0.95;
                  return (
                    <>
                      <ul className="text-foreground/80 space-y-0.5 text-xs">
                        <li className="flex justify-between">
                          <span>Nominal max (rated)</span>
                          <span className="font-mono tabular-nums">
                            {ratio < 1 ? `${Math.round(nominalPerHr).toLocaleString()} / h` : "—"}
                          </span>
                        </li>
                        <li className="flex justify-between">
                          <span>Operating</span>
                          <span className="font-mono tabular-nums">
                            {Math.round(operatingPerHr).toLocaleString()} / h
                          </span>
                        </li>
                        <li className="flex justify-between">
                          <span>Running at</span>
                          <span className="font-mono tabular-nums">{throttlePct}% of nominal</span>
                        </li>
                      </ul>
                      {isThrottled ? (
                        <p className="text-muted-foreground border-border bg-card mt-1 rounded-md border p-2 text-[11px] leading-relaxed">
                          This station is paced to the bottleneck — speeding it up alone wouldn't
                          lift throughput. That's the right call; running it flat-out would jam the
                          next station or burn MTBF for no gain.
                        </p>
                      ) : null}
                    </>
                  );
                })()}
              </section>
            ) : null}

            <section className="space-y-1.5">
              <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Throughput
              </div>
              <ul className="text-foreground/80 space-y-0.5 text-xs">
                <li className="flex justify-between">
                  <span>Completed</span>
                  <span className="font-mono tabular-nums">{completed.toLocaleString()}</span>
                </li>
                <li className="flex justify-between">
                  <span>Scrapped</span>
                  <span className="font-mono tabular-nums">{scrapped.toLocaleString()}</span>
                </li>
                <li className="flex justify-between">
                  <span>Reworked</span>
                  <span className="font-mono tabular-nums">{reworked.toLocaleString()}</span>
                </li>
              </ul>
              {/* VROL-912 — cumulative-completed sparkline for THIS station.
                  Unlike the line-total sparkline the user complained about,
                  this one is per-station and actually differs across nodes
                  when defects, scrap, or rework split the line completions. */}
              {completedSeries.length > 1 ? (
                <div className="mt-1.5">
                  <div className="text-muted-foreground text-[10px] uppercase">
                    Cumulative over time
                  </div>
                  <Sparkline series={completedSeries} width={240} height={36} unit="parts" />
                </div>
              ) : null}
            </section>

            {/* VROL-912 — running % over time. Tells the user how busy this
                station was MOMENT-TO-MOMENT, not just on average. A flat-near-
                100% curve marks the bottleneck; choppy curves mean the station
                was alternating busy ↔ starved/blocked. */}
            {runningPctSeries.length > 1 ? (
              <section className="space-y-1.5">
                <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Utilisation over time
                </div>
                <Sparkline series={runningPctSeries} width={240} height={36} unit="% running" />
                <p className="text-muted-foreground text-[10px] leading-snug">
                  Flat-near-the-top: this station is the constraint. Choppy: it's alternating
                  between busy and waiting on neighbours.
                </p>
              </section>
            ) : null}

            {(inEdges.length > 0 || outEdges.length > 0) && (
              <section className="space-y-1.5">
                <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Buffer pressure
                </div>
                {incomingEdgeBufferSeries.length > 0 ? (
                  <div className="text-foreground/80 space-y-1 text-xs">
                    <div className="text-muted-foreground text-[10px] uppercase">Incoming</div>
                    {incomingEdgeBufferSeries.map(({ edge: e, series }) => {
                      const label = `${e.sourceLabel ?? e.source} → ${e.targetLabel ?? e.target}`;
                      const peak = series.length > 0 ? Math.max(0, ...series) : 0;
                      return (
                        <div key={e.id} className="space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate pr-2">{label}</span>
                            <span className="text-muted-foreground font-mono tabular-nums">
                              {peak > 0 ? `peak ${peak}` : "—"}
                            </span>
                          </div>
                          {/* VROL-912 — per-edge fill sparkline. Picks up the
                              "buffer breathing" pattern that the static peak
                              alone hides (e.g., one big spike vs sustained
                              pressure look identical in the peak number). */}
                          {series.length > 1 ? (
                            <Sparkline series={series} width={240} height={24} unit="parts" />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {outgoingEdgeBufferSeries.length > 0 ? (
                  <div className="text-foreground/80 space-y-1 text-xs">
                    <div className="text-muted-foreground text-[10px] uppercase">Outgoing</div>
                    {outgoingEdgeBufferSeries.map(({ edge: e, series }) => {
                      const label = `${e.sourceLabel ?? e.source} → ${e.targetLabel ?? e.target}`;
                      const peak = series.length > 0 ? Math.max(0, ...series) : 0;
                      return (
                        <div key={e.id} className="space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate pr-2">{label}</span>
                            <span className="text-muted-foreground font-mono tabular-nums">
                              {peak > 0 ? `peak ${peak}` : "—"}
                            </span>
                          </div>
                          {series.length > 1 ? (
                            <Sparkline series={series} width={240} height={24} unit="parts" />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            )}

            {recommendation ? (
              <section className="space-y-1.5">
                <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Recommendation
                </div>
                <p className="border-sim-running/40 bg-sim-running/5 text-foreground/90 rounded-md border p-2.5 text-xs leading-relaxed">
                  {recommendation}
                </p>
              </section>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
