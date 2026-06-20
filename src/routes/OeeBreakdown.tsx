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
  return (
    <div className="space-y-3" data-testid="oee-breakdown">
      {result.perStationOee.map((oee, idx) => {
        const label =
          result.perStationLabels?.[idx] ??
          result.bottlenecks[idx]?.label ??
          `Station ${String(idx)}`;
        const total = Math.round(oee.oee * 100);
        return (
          <div
            key={`${label}-${String(idx)}`}
            className="border-border bg-card space-y-2 rounded-md border p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-foreground text-sm font-medium">{label}</span>
              <span className="font-mono text-sm tabular-nums" title="A × P × Q">
                OEE {total}%
              </span>
            </div>
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
