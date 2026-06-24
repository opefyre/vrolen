/**
 * VROL-974 — per-station six-loss stacked bar. Renders one row per
 * station with five colored segments (breakdown / setup / minor stop /
 * speed loss / defect). All-zero categories disappear via opacity 0.
 */

import type { ChainResult } from "@/engine";
import { computeSixLoss, totalLossMs, type SixLossRow } from "@/lib/six-loss";

interface Props {
  readonly result: ChainResult;
}

interface SegmentSpec {
  readonly key: keyof Omit<SixLossRow, "stationLabel">;
  readonly label: string;
  readonly color: string;
}

const SEGMENTS: readonly SegmentSpec[] = [
  { key: "breakdownMs", label: "Breakdown", color: "bg-sim-down" },
  { key: "setupMs", label: "Setup", color: "bg-sim-setup" },
  { key: "minorStopMs", label: "Minor stop", color: "bg-sim-blocked-out" },
  { key: "speedLossMs", label: "Speed loss", color: "bg-sim-maintenance" },
  { key: "defectMs", label: "Defect", color: "bg-sim-starved" },
];

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function SixLossBreakdown({ result }: Props) {
  const rows = computeSixLoss(result);
  if (rows.length === 0) return null;
  const grandMax = Math.max(1, ...rows.map(totalLossMs));
  // Hide segments that are zero across every station.
  const visibleSegments = SEGMENTS.filter((seg) => rows.some((row) => row[seg.key] > 0));
  if (visibleSegments.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="six-loss-row">
      <div className="text-foreground text-xs font-medium">Six big losses (Nakajima)</div>
      <div className="space-y-1.5">
        {rows.map((row) => {
          const total = totalLossMs(row);
          if (total === 0) return null;
          return (
            <div key={row.stationLabel} className="flex items-center gap-2 text-[11px]">
              <div className="text-foreground/80 w-28 shrink-0 truncate text-right">
                {row.stationLabel}
              </div>
              <div className="bg-muted/40 relative flex h-3 flex-1 overflow-hidden rounded">
                {SEGMENTS.map((seg) => {
                  const ms = row[seg.key];
                  const widthPct = (ms / grandMax) * 100;
                  if (ms === 0) return null;
                  return (
                    <div
                      key={seg.key}
                      className={`${seg.color} h-full`}
                      style={{ width: `${widthPct.toFixed(2)}%` }}
                      title={`${seg.label}: ${fmt(ms)}`}
                    />
                  );
                })}
              </div>
              <div className="text-muted-foreground w-16 shrink-0 text-right font-mono tabular-nums">
                {fmt(total)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
        {visibleSegments.map((seg) => (
          <span key={seg.key} className="flex items-center gap-1.5">
            <span className={`${seg.color} inline-block h-2 w-3 rounded-sm`} aria-hidden />
            <span>{seg.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
