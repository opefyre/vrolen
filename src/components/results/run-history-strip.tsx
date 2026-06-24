/**
 * VROL-949 — horizontal strip of the last N runs for the active
 * scenario. Each cell shows compact KPIs (completed, throughput/h, line
 * OEE) and a delta vs the previous run. Read-only; clicking a cell is a
 * future enhancement (would open the run in compare-mode against the
 * current result).
 */

import { listRuns, type RunHistoryEntry } from "@/lib/run-history";

interface Props {
  readonly scenarioName: string | null;
  /** VROL-960 — when set, each cell becomes a button that fires this with the entry. */
  readonly onCompare?: (entry: RunHistoryEntry) => void;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function fmtPerHr(throughputLambda: number): string {
  return `${Math.round(throughputLambda * 3_600_000).toLocaleString()}/h`;
}

function tone(curr: number, prev: number, higherIsBetter: boolean): string {
  if (Math.abs(curr - prev) < 1e-9) return "text-muted-foreground";
  const up = curr > prev;
  const good = higherIsBetter ? up : !up;
  return good ? "text-sim-running-foreground" : "text-sim-down-foreground";
}

export function RunHistoryStrip({ scenarioName, onCompare }: Props) {
  if (!scenarioName) return null;
  const runs: readonly RunHistoryEntry[] = listRuns(scenarioName);
  if (runs.length < 2) return null;
  // Newest-first per addRun; show oldest → newest left-to-right.
  const ordered = [...runs].reverse();
  return (
    <div
      className="border-border bg-card/50 flex gap-2 overflow-x-auto rounded-md border p-2"
      data-testid="run-history-strip"
    >
      <div className="text-muted-foreground shrink-0 self-center text-[10px] font-medium uppercase">
        Last {String(ordered.length)} runs
      </div>
      {ordered.map((entry, i) => {
        const prev = i > 0 ? ordered[i - 1] : null;
        const isLast = i === ordered.length - 1;
        const Wrapper = onCompare && !isLast ? "button" : "div";
        const cellProps =
          onCompare && !isLast
            ? {
                type: "button" as const,
                onClick: () => {
                  onCompare(entry);
                },
                className:
                  "border-border bg-background hover:bg-accent/40 min-w-[7rem] shrink-0 rounded-md border p-1.5 text-left transition-colors",
              }
            : {
                className:
                  "border-border bg-background min-w-[7rem] shrink-0 rounded-md border p-1.5",
              };
        return (
          <Wrapper
            key={`${String(entry.runAtMs)}-${String(i)}`}
            {...cellProps}
            title={
              onCompare && !isLast
                ? `${new Date(entry.runAtMs).toLocaleString()} — click to compare against current`
                : new Date(entry.runAtMs).toLocaleString()
            }
          >
            <div className="text-muted-foreground text-[10px]">#{String(i + 1)}</div>
            <div className="font-mono text-xs tabular-nums">{fmtPerHr(entry.throughputLambda)}</div>
            <div
              className={`font-mono text-[10px] tabular-nums ${prev ? tone(entry.throughputLambda, prev.throughputLambda, true) : "text-muted-foreground"}`}
            >
              OEE {pct(entry.lineOee)}
            </div>
            {entry.bottleneckLabel ? (
              <div className="text-muted-foreground truncate text-[10px]">
                bn: {entry.bottleneckLabel}
              </div>
            ) : null}
          </Wrapper>
        );
      })}
    </div>
  );
}
