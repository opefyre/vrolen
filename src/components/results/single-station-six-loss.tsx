/**
 * VROL-973 (Sprint 196) — single-station six-loss decomposition for
 * the per-station drilldown. The line-level `SixLossBreakdown`
 * (VROL-974) shows every station in one stacked grid; this compact
 * variant shows only the selected station's breakdown so the
 * drilldown can answer "where is THIS station losing time?" without
 * leaving the per-station view.
 */

import type { ChainResult } from "@/engine";
import { computeSixLoss, totalLossMs, type SixLossRow } from "@/lib/six-loss";

interface Props {
  readonly result: ChainResult;
  readonly stationIdx: number;
}

interface SegmentSpec {
  readonly key: keyof Omit<SixLossRow, "stationLabel">;
  readonly label: string;
  readonly color: string;
  readonly pillar: "A" | "P" | "Q";
}

const SEGMENTS: readonly SegmentSpec[] = [
  { key: "breakdownMs", label: "Breakdown", color: "bg-sim-down", pillar: "A" },
  { key: "setupMs", label: "Setup", color: "bg-sim-setup", pillar: "A" },
  { key: "minorStopMs", label: "Minor stop", color: "bg-sim-blocked-out", pillar: "P" },
  { key: "speedLossMs", label: "Speed loss", color: "bg-sim-maintenance", pillar: "P" },
  { key: "defectMs", label: "Defect", color: "bg-sim-starved", pillar: "Q" },
];

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function SingleStationSixLoss({ result, stationIdx }: Props) {
  if (stationIdx < 0) return null;
  const row = computeSixLoss(result)[stationIdx];
  if (!row) return null;
  const total = totalLossMs(row);
  if (total < 1) return null;
  const visibleSegments = SEGMENTS.filter((s) => row[s.key] > 0);
  if (visibleSegments.length === 0) return null;
  return (
    <section className="space-y-1.5" data-testid="single-station-six-loss">
      <div className="text-muted-foreground flex items-baseline justify-between text-[11px] font-medium tracking-wide uppercase">
        <span>Six-loss decomposition</span>
        <span className="text-foreground font-mono normal-case tabular-nums">{fmt(total)}</span>
      </div>
      <div className="bg-muted/40 relative flex h-3 w-full overflow-hidden rounded">
        {SEGMENTS.map((seg) => {
          const ms = row[seg.key];
          if (ms === 0) return null;
          const widthPct = (ms / total) * 100;
          return (
            <div
              key={seg.key}
              className={`${seg.color} h-full`}
              style={{ width: `${widthPct.toFixed(2)}%` }}
              title={`${seg.label} (${seg.pillar}): ${fmt(ms)}`}
            />
          );
        })}
      </div>
      <ul className="text-muted-foreground space-y-0.5 text-[10px]">
        {visibleSegments.map((seg) => {
          const ms = row[seg.key];
          const pct = (ms / total) * 100;
          return (
            <li key={seg.key} className="flex items-center gap-2">
              <span className={`${seg.color} inline-block h-2 w-3 rounded-sm`} aria-hidden />
              <span className="flex-1">
                {seg.label} <span className="opacity-60">({seg.pillar})</span>
              </span>
              <span className="font-mono tabular-nums">
                {fmt(ms)} · {pct.toFixed(0)}%
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-[10px] leading-snug">
        A = Availability · P = Performance · Q = Quality. Largest bucket = best lever for this
        station.
      </p>
    </section>
  );
}
