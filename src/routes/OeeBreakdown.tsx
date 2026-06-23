/**
 * VROL-675 — per-station OEE breakdown viz. Shows Availability × Performance
 * × Quality side-by-side so users can see which factor pulls a station's OEE
 * down. Stacked-segment design: each row is three colored bars whose widths
 * encode each sub-metric (0–100%).
 */

import type { ChainResult } from "@/engine";

interface OeeBreakdownProps {
  readonly result: ChainResult;
}

interface SegmentProps {
  readonly label: string;
  readonly pct: number;
  readonly colorClass: string;
}

function Segment({ label, pct, colorClass }: SegmentProps) {
  const display = Math.round(pct * 100);
  return (
    <div className="flex-1 space-y-1">
      <div className="text-muted-foreground flex items-center justify-between text-[10px]">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{display}%</span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className={`${colorClass} h-full rounded-full transition-[width]`}
          style={{ width: `${String(Math.max(0, Math.min(100, display)))}%` }}
        />
      </div>
    </div>
  );
}

export function OeeBreakdown({ result }: OeeBreakdownProps) {
  if (result.perStationOee.length === 0) return null;
  // VROL-897 — Both perStationLabels and perStationRunningPct are now emitted
  // by runChain in topology order, aligned by index with perStationOee.
  // The legacy fallback to result.bottlenecks[idx] (sorted DESC by runningPct)
  // mis-aligned label + util to the bars; only kept as a defensive fallback
  // for tests that hand-craft a partial ChainResult without the new fields.
  return (
    <div className="space-y-3" data-testid="oee-breakdown">
      {result.perStationOee.map((oee, idx) => {
        const label =
          result.perStationLabels?.[idx] ??
          result.bottlenecks[idx]?.label ??
          `Station ${String(idx)}`;
        const total = Math.round(oee.oee * 100);
        const util = result.perStationRunningPct?.[idx] ?? result.bottlenecks[idx]?.runningPct ?? 0;
        const utilPct = Math.round(util * 100);
        const lowUtil = util < 0.7;
        return (
          <div
            key={`${label}-${String(idx)}`}
            className="border-border bg-card space-y-2 rounded-md border p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-foreground text-sm font-medium">{label}</span>
              <div className="flex items-center gap-3 font-mono text-sm tabular-nums">
                <span
                  className={lowUtil ? "text-sim-down-foreground" : "text-muted-foreground"}
                  title="Share of the measurement window the station was actually in the Running state. Independent of OEE — captures starvation + blocking too."
                >
                  Util {utilPct}%
                </span>
                <span title="Availability × Performance × Quality. Measures losses while the station is allowed to run — does NOT include starvation / blocking.">
                  OEE {total}%
                </span>
              </div>
            </div>
            {lowUtil ? (
              <p className="text-muted-foreground text-[11px]">
                OEE looks high because it ignores starvation + blocking. This station only ran{" "}
                <span className="text-foreground font-mono tabular-nums">{utilPct}%</span> of the
                window — feeding it faster (or trimming downstream) is what would lift line
                throughput here.
              </p>
            ) : null}
            <div className="flex gap-3">
              <Segment label="Availability" pct={oee.availability} colorClass="bg-sim-running" />
              <Segment label="Performance" pct={oee.performance} colorClass="bg-sim-setup" />
              <Segment label="Quality" pct={oee.quality} colorClass="bg-sim-maintenance" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
