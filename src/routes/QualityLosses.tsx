/**
 * VROL-723 — per-station scrap + rework bars. Compact horizontal table
 * showing where quality losses cluster. Hidden when the run had no
 * losses at all.
 */

import type { ChainResult } from "@/engine";

interface QualityLossesProps {
  readonly result: ChainResult;
  readonly stationLabels?: readonly string[];
}

export function QualityLosses({ result, stationLabels }: QualityLossesProps) {
  const totalScrap = result.perStationScrapped.reduce((a, b) => a + b, 0);
  const totalRework = result.perStationReworked.reduce((a, b) => a + b, 0);
  if (totalScrap + totalRework === 0) return null;
  const maxPer = Math.max(
    1,
    ...result.perStationScrapped.map((s, i) => s + (result.perStationReworked[i] ?? 0)),
  );
  return (
    <ul className="space-y-1.5" data-testid="quality-losses">
      {result.perStationScrapped.map((s, idx) => {
        const r = result.perStationReworked[idx] ?? 0;
        if (s + r === 0) return null;
        const label =
          stationLabels?.[idx] ?? result.bottlenecks[idx]?.label ?? `Station ${String(idx)}`;
        const scrapPct = Math.round((s / maxPer) * 100);
        const reworkPct = Math.round((r / maxPer) * 100);
        return (
          <li key={`${label}-${String(idx)}`} className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="truncate font-medium">{label}</span>
              <span className="text-muted-foreground font-mono tabular-nums">
                scrap {s.toLocaleString()} / rework {r.toLocaleString()}
              </span>
            </div>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
              <div className="bg-sim-down h-full" style={{ width: `${String(scrapPct)}%` }} />
              <div className="bg-sim-setup h-full" style={{ width: `${String(reworkPct)}%` }} />
              <div className="bg-muted h-full flex-1" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
