/**
 * Optimization search card — Simul8 OptQuest-light. Picks the buffer
 * capacity that maximizes mean throughput across N seeds per candidate.
 *
 * Shows the winner with deltas vs current setting, the runner-up for
 * comparison, and a tiny ASCII-style ranking of every candidate so the
 * tradeoff is visible (good if buyer asks "why this?")
 */

import { Crown, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OptimizationSummary } from "@/lib/optimization-search";

interface OptimizationCardProps {
  readonly summary: OptimizationSummary | null;
  readonly running: boolean;
  readonly onRun: () => void;
  readonly onApply?: (capacity: number) => void;
}

export function OptimizationCard({ summary, running, onRun, onApply }: OptimizationCardProps) {
  return (
    <Card id="optimization">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="font-heading flex items-center gap-2 text-base">
            <Crown className="h-4 w-4" aria-hidden /> Optimization · best buffer
          </CardTitle>
          <CardDescription>
            Grid-search buffer capacity over &times; 3 seeds each. Picks the combo that maximizes
            mean throughput.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" disabled={running} onClick={onRun} className="gap-1">
          <Play className="h-3.5 w-3.5" aria-hidden />
          {running ? "Searching…" : summary ? "Re-run search" : "Run search"}
        </Button>
      </CardHeader>
      <CardContent>
        {!summary ? (
          <p className="text-muted-foreground text-sm">
            Click <strong>Run search</strong> to fire ~21 engine runs (7 buffer levels × 3 seeds)
            and surface the best buffer capacity for this line.
          </p>
        ) : (
          <OptimizationBody summary={summary} onApply={onApply} />
        )}
      </CardContent>
    </Card>
  );
}

function OptimizationBody({
  summary,
  onApply,
}: {
  readonly summary: OptimizationSummary;
  readonly onApply?: (capacity: number) => void;
}) {
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const ms = (n: number) => `${Math.round(n).toLocaleString()} ms`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const best = summary.best;
  const runnerUp = summary.runnerUp;
  // Visual ranking — find max throughput for bar scaling.
  const maxTput = Math.max(...summary.candidates.map((c) => c.meanThroughputPerHour));
  const showApply = onApply && best.bufferCapacity !== summary.currentCapacity;
  return (
    <div className="space-y-3">
      <div className="border-sim-running/30 bg-sim-running/5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
        <span className="text-foreground font-semibold">
          Best: WIP <span className="font-mono tabular-nums">{best.bufferCapacity}</span>
        </span>
        <span className="text-muted-foreground">
          {fmt(best.meanThroughputPerHour)} /h · TIS {ms(best.meanTimeInSystemMs)} · scrap{" "}
          {pct(best.meanScrapRate)}
        </span>
        {runnerUp ? (
          <span className="text-muted-foreground text-xs">
            (runner-up WIP {runnerUp.bufferCapacity} · {fmt(runnerUp.meanThroughputPerHour)} /h)
          </span>
        ) : null}
        <span className="text-muted-foreground ml-auto text-xs">
          {summary.searchSize} runs · {summary.elapsedMs.toFixed(0)} ms
        </span>
        {showApply ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              onApply(best.bufferCapacity);
            }}
          >
            Apply WIP {best.bufferCapacity} &amp; re-run
          </Button>
        ) : null}
      </div>
      <div className="space-y-1">
        {summary.candidates.map((c) => {
          const isBest = c.bufferCapacity === best.bufferCapacity;
          const isCurrent = c.bufferCapacity === summary.currentCapacity;
          const pctOfMax = (c.meanThroughputPerHour / Math.max(1, maxTput)) * 100;
          return (
            <div key={c.bufferCapacity} className="flex items-center gap-2 text-[11px]">
              <div className="text-foreground/80 w-20 shrink-0 text-right font-mono tabular-nums">
                WIP {c.bufferCapacity}
                {isCurrent ? <span className="text-muted-foreground"> (now)</span> : null}
              </div>
              <div className="bg-muted/40 relative h-3 flex-1 overflow-hidden rounded">
                <div
                  className={isBest ? "bg-sim-running" : "bg-foreground/30"}
                  style={{ width: `${pctOfMax.toFixed(1)}%`, height: "100%" }}
                />
              </div>
              <div className="text-muted-foreground w-20 shrink-0 text-right font-mono tabular-nums">
                {fmt(c.meanThroughputPerHour)} /h
              </div>
              <div className="text-muted-foreground w-20 shrink-0 text-right font-mono tabular-nums">
                {ms(c.meanTimeInSystemMs)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
