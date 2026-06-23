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

import { X } from "lucide-react";

import { StateMixBar } from "@/components/canvas/state-mix-bar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ChainResult } from "@/engine/chain-harness";

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

export function StationDrilldown({
  open,
  onOpenChange,
  nodeId,
  nodeLabel,
  nodeTypeLabel,
  result,
  chainNodeIds,
  edges,
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
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close station report"
          onClick={() => {
            onOpenChange(false);
          }}
          className="absolute top-2 right-2 h-7 w-7"
        >
          <X className="h-4 w-4" />
        </Button>
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
            </section>

            {(inEdges.length > 0 || outEdges.length > 0) && (
              <section className="space-y-1.5">
                <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Buffer pressure
                </div>
                {inEdges.length > 0 ? (
                  <div className="text-foreground/80 space-y-0.5 text-xs">
                    <div className="text-muted-foreground text-[10px] uppercase">Incoming</div>
                    {inEdges.map((e) => {
                      const fill = e.fillL ?? 0;
                      const cap = e.capacity ?? 0;
                      const ratio = cap > 0 ? fill / cap : 0;
                      const label = `${e.sourceLabel ?? e.source} → ${e.targetLabel ?? e.target}`;
                      return (
                        <div key={e.id} className="flex justify-between">
                          <span className="truncate pr-2">{label}</span>
                          <span className="font-mono tabular-nums">
                            {cap > 0 ? `${pct(ratio)} full` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {outEdges.length > 0 ? (
                  <div className="text-foreground/80 space-y-0.5 text-xs">
                    <div className="text-muted-foreground text-[10px] uppercase">Outgoing</div>
                    {outEdges.map((e) => {
                      const fill = e.fillL ?? 0;
                      const cap = e.capacity ?? 0;
                      const ratio = cap > 0 ? fill / cap : 0;
                      const label = `${e.sourceLabel ?? e.source} → ${e.targetLabel ?? e.target}`;
                      return (
                        <div key={e.id} className="flex justify-between">
                          <span className="truncate pr-2">{label}</span>
                          <span className="font-mono tabular-nums">
                            {cap > 0 ? `${pct(ratio)} full` : "—"}
                          </span>
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
