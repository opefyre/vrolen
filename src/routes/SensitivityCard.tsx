/**
 * Sensitivity tornado plot card — appears under the Replications card
 * in the Overview tab. User clicks "Run sweep" to fire ±20% cycle-time
 * perturbations on every station and see which one moves throughput
 * the most. Sorted so the widest bar is on top (a tornado).
 *
 * The compute happens in the parent (engine access, baseline opts). This
 * card is the visual surface — pass `summary` for results, `onRun` to
 * fire the sweep, `running` for the spinner state.
 */

import { Play, Tornado } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SensitivitySummary } from "@/lib/sensitivity-sweep";

interface SensitivityCardProps {
  readonly summary: SensitivitySummary | null;
  readonly running: boolean;
  readonly onRun: () => void;
}

export function SensitivityCard({ summary, running, onRun }: SensitivityCardProps) {
  return (
    <Card id="sensitivity">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="font-heading flex items-center gap-2 text-base">
            <Tornado className="h-4 w-4" aria-hidden /> Sensitivity · tornado
          </CardTitle>
          <CardDescription>
            Vary each station&rsquo;s cycle time ±20% and rank by throughput swing. Widest bar =
            biggest lever.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" disabled={running} onClick={onRun} className="gap-1">
          <Play className="h-3.5 w-3.5" aria-hidden />
          {running ? "Sweeping…" : summary ? "Re-run sweep" : "Run sweep"}
        </Button>
      </CardHeader>
      <CardContent>
        {!summary ? (
          <p className="text-muted-foreground text-sm">
            Click <strong>Run sweep</strong> to fan out 2 × stations engine runs and rank where
            cycle-time changes hurt or help throughput most.
          </p>
        ) : (
          <SensitivityBody summary={summary} />
        )}
      </CardContent>
    </Card>
  );
}

function SensitivityBody({ summary }: { readonly summary: SensitivitySummary }) {
  if (summary.rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No varying-cycle-time stations available to sweep.
      </p>
    );
  }
  const fmt = (n: number) => Math.round(n).toLocaleString();
  // Find the widest swing absolute; that defines the bar scale.
  const maxSwing = summary.rows.reduce((m, r) => Math.max(m, r.swingPerHour), 0);
  // For each row the bar runs from (low - center) to (high - center)
  // expressed as a fraction of (maxSwing). Center = baselinePerHour.
  const base = summary.baselinePerHour;
  const halfBarWidthPct = 45; // bar can span 45% on each side of center
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground flex items-center justify-between text-[11px]">
        <span>
          Baseline ={" "}
          <strong className="text-foreground font-mono tabular-nums">{fmt(base)} /h</strong>
        </span>
        <span>
          Perturbation ±{Math.round((1 - summary.lowMultiplier) * 100)}% · sweep took{" "}
          {summary.elapsedMs.toFixed(0)} ms
        </span>
      </div>
      <div className="space-y-1.5">
        {summary.rows.map((row) => {
          const lowOffset = row.lowPerHour - base;
          const highOffset = row.highPerHour - base;
          const lowPct = maxSwing > 0 ? (lowOffset / maxSwing) * halfBarWidthPct : 0;
          const highPct = maxSwing > 0 ? (highOffset / maxSwing) * halfBarWidthPct : 0;
          const left = 50 + Math.min(lowPct, highPct);
          const width = Math.abs(highPct - lowPct);
          const helpsWhenSlower = row.lowPerHour < row.highPerHour;
          const barColor = helpsWhenSlower ? "bg-sim-running/70" : "bg-sim-down/70";
          return (
            <div
              key={row.stationLabel}
              className="flex items-center gap-2 text-[11px]"
              title={`${row.stationLabel}: ${fmt(row.lowPerHour)}/h (low) → ${fmt(row.highPerHour)}/h (high)`}
            >
              <div className="text-foreground/80 w-28 shrink-0 truncate text-right font-medium">
                {row.stationLabel}
              </div>
              <div className="bg-muted/40 relative h-4 flex-1 rounded">
                {/* Centerline (= baseline). */}
                <div className="bg-border absolute top-0 bottom-0 left-1/2 w-px" />
                <div
                  className={`absolute top-0 bottom-0 rounded ${barColor}`}
                  style={{ left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%` }}
                />
              </div>
              <div className="text-muted-foreground w-24 shrink-0 text-right font-mono tabular-nums">
                ±{fmt(row.swingPerHour / 2)}/h
              </div>
              <div
                className={`w-12 shrink-0 text-right font-mono tabular-nums ${row.swingPct >= 5 ? "text-foreground" : "text-muted-foreground"}`}
              >
                {row.swingPct.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground text-[10px]">
        Bars span the throughput between the low and high run. Color = does slowing it down help
        (green) or hurt (red) throughput.
      </p>
    </div>
  );
}
