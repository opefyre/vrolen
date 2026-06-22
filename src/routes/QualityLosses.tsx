/**
 * VROL-723 — per-station scrap + rework bars. Compact horizontal table
 * showing where quality losses cluster. Hidden when the run had no
 * losses at all.
 *
 * VROL-794 — bars are now stacked good / rework / scrap with proportional
 * widths, so the user can read both the absolute losses and the share of
 * output that survived clean. Engine semantics:
 *   - perStationCompleted[i] = good parts that exited the station
 *   - perStationReworked[i]  = defectives routed to a rework target
 *   - perStationScrapped[i]  = defectives that hit scrap
 * Total processed at i = good + rework + scrap (mutually exclusive in the
 * cycle executor — see engine/cycle-execution.ts).
 */

import type { ChainResult } from "@/engine";

interface QualityLossesProps {
  readonly result: ChainResult;
  readonly stationLabels?: readonly string[];
}

function fmtPct(n: number): string {
  if (n <= 0) return "0%";
  if (n < 1) return "<1%";
  return `${String(Math.round(n))}%`;
}

export function QualityLosses({ result, stationLabels }: QualityLossesProps) {
  const totalScrap = result.perStationScrapped.reduce((a, b) => a + b, 0);
  const totalRework = result.perStationReworked.reduce((a, b) => a + b, 0);
  if (totalScrap + totalRework === 0) return null;
  return (
    <ul className="space-y-1.5" data-testid="quality-losses">
      {result.perStationScrapped.map((s, idx) => {
        const r = result.perStationReworked[idx] ?? 0;
        if (s + r === 0) return null;
        const good = Math.max(0, result.perStationCompleted[idx] ?? 0);
        const total = good + r + s;
        const label =
          stationLabels?.[idx] ?? result.bottlenecks[idx]?.label ?? `Station ${String(idx)}`;
        const goodPct = total > 0 ? (good / total) * 100 : 0;
        const reworkPct = total > 0 ? (r / total) * 100 : 0;
        const scrapPct = total > 0 ? (s / total) * 100 : 0;
        const tooltip = [
          `Good ${good.toLocaleString()} (${fmtPct(goodPct)})`,
          `Rework ${r.toLocaleString()} (${fmtPct(reworkPct)})`,
          `Scrap ${s.toLocaleString()} (${fmtPct(scrapPct)})`,
        ].join(" · ");
        return (
          <li key={`${label}-${String(idx)}`} className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="truncate font-medium">{label}</span>
              <span className="text-muted-foreground font-mono tabular-nums">
                scrap {s.toLocaleString()} / rework {r.toLocaleString()}
              </span>
            </div>
            <div
              className="bg-muted flex h-2 w-full overflow-hidden rounded-full"
              title={tooltip}
              role="img"
              aria-label={tooltip}
              data-testid={`quality-losses-bar-${String(idx)}`}
            >
              {goodPct > 0 ? (
                <div
                  className="bg-sim-running h-full"
                  style={{ width: `${String(goodPct)}%` }}
                  data-segment="good"
                />
              ) : null}
              {reworkPct > 0 ? (
                <div
                  className="bg-sim-setup h-full"
                  style={{ width: `${String(reworkPct)}%` }}
                  data-segment="rework"
                />
              ) : null}
              {scrapPct > 0 ? (
                <div
                  className="bg-sim-down h-full"
                  style={{ width: `${String(scrapPct)}%` }}
                  data-segment="scrap"
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
