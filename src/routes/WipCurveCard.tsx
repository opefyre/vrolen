/**
 * Throughput-vs-WIP card — the Factory-Physics chart that turns the
 * "how much WIP do we actually need?" question into a one-screen answer.
 *
 * Plots two series:
 *   - Throughput per hour vs buffer capacity (rises, then flattens)
 *   - Avg time-in-system vs buffer capacity (linear inflation past knee)
 *
 * Annotates the knee + current capacity + best-throughput points.
 */

import { Activity, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WipCurveSummary } from "@/lib/wip-curve";

interface WipCurveCardProps {
  readonly summary: WipCurveSummary | null;
  readonly running: boolean;
  readonly onRun: () => void;
  readonly onApplyCapacity?: (capacity: number) => void;
}

export function WipCurveCard({ summary, running, onRun, onApplyCapacity }: WipCurveCardProps) {
  return (
    <Card id="wip-curve">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="font-heading flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" aria-hidden /> Throughput vs WIP
          </CardTitle>
          <CardDescription>
            Sweep inter-station buffer capacity and find the throughput knee. More WIP past the knee
            only inflates time-in-system.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" disabled={running} onClick={onRun} className="gap-1">
          <Play className="h-3.5 w-3.5" aria-hidden />
          {running ? "Scanning…" : summary ? "Re-run scan" : "Run scan"}
        </Button>
      </CardHeader>
      <CardContent>
        {!summary ? (
          <p className="text-muted-foreground text-sm">
            Click <strong>Run scan</strong> to re-run the engine across buffer sizes
            <span className="font-mono"> 1, 2, 4, 8, 16, 32, 64, 128</span> and plot the curve.
          </p>
        ) : (
          <WipCurveBody summary={summary} onApplyCapacity={onApplyCapacity} />
        )}
      </CardContent>
    </Card>
  );
}

function WipCurveBody({
  summary,
  onApplyCapacity,
}: {
  readonly summary: WipCurveSummary;
  readonly onApplyCapacity?: (capacity: number) => void;
}) {
  const W = 640;
  const H = 200;
  const PAD_L = 48;
  const PAD_R = 48;
  const PAD_T = 12;
  const PAD_B = 28;
  // Map by log2(capacity) for nicer spacing across 1..128.
  const xs = summary.points.map((p) => Math.log2(Math.max(1, p.bufferCapacity)));
  const tputs = summary.points.map((p) => p.throughputPerHour);
  const tisys = summary.points.map((p) => p.avgTimeInSystemMs);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const tMax = Math.max(1, ...tputs);
  const wMax = Math.max(1, ...tisys);
  const xPx = (x: number) =>
    PAD_L + ((x - xMin) / Math.max(0.0001, xMax - xMin)) * (W - PAD_L - PAD_R);
  const tPx = (t: number) => PAD_T + (1 - t / tMax) * (H - PAD_T - PAD_B);
  const wPx = (w: number) => PAD_T + (1 - w / wMax) * (H - PAD_T - PAD_B);

  const tputPath = summary.points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xPx(xs[i]!).toFixed(1)} ${tPx(p.throughputPerHour).toFixed(1)}`,
    )
    .join(" ");
  const tisyPath = summary.points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xPx(xs[i]!).toFixed(1)} ${wPx(p.avgTimeInSystemMs).toFixed(1)}`,
    )
    .join(" ");
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const knee = summary.kneePoint;
  const best = summary.bestPoint;
  return (
    <div className="space-y-3">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span>
          Knee at WIP ={" "}
          <strong className="text-foreground font-mono tabular-nums">{knee.bufferCapacity}</strong>{" "}
          → {fmt(knee.throughputPerHour)} /h, {fmt(knee.avgTimeInSystemMs)} ms
        </span>
        <span>
          Max throughput {fmt(best.throughputPerHour)} /h at WIP ={" "}
          <strong className="text-foreground font-mono tabular-nums">{best.bufferCapacity}</strong>
        </span>
        <span>
          Current WIP setting ={" "}
          <strong className="text-foreground font-mono tabular-nums">
            {summary.currentCapacity}
          </strong>
        </span>
        <span className="ml-auto">scan {summary.elapsedMs.toFixed(0)} ms</span>
      </div>
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="text-foreground w-full">
        {/* y-axis labels (throughput on left, time-in-system on right). */}
        <text x="4" y={PAD_T + 4} className="fill-sim-running text-[9px]" textAnchor="start">
          {fmt(tMax)} /h
        </text>
        <text x={W - 4} y={PAD_T + 4} className="fill-muted-foreground text-[9px]" textAnchor="end">
          {fmt(wMax)} ms
        </text>
        {/* Knee + best vertical guides */}
        <line
          x1={xPx(Math.log2(Math.max(1, knee.bufferCapacity)))}
          x2={xPx(Math.log2(Math.max(1, knee.bufferCapacity)))}
          y1={PAD_T}
          y2={H - PAD_B}
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeDasharray="3 3"
        />
        <line
          x1={xPx(Math.log2(Math.max(1, summary.currentCapacity)))}
          x2={xPx(Math.log2(Math.max(1, summary.currentCapacity)))}
          y1={PAD_T}
          y2={H - PAD_B}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={2}
        />
        {/* X axis ticks. */}
        {summary.points.map((p, i) => (
          <g key={p.bufferCapacity}>
            <line
              x1={xPx(xs[i]!)}
              x2={xPx(xs[i]!)}
              y1={H - PAD_B}
              y2={H - PAD_B + 3}
              stroke="currentColor"
              strokeOpacity={0.4}
            />
            <text
              x={xPx(xs[i]!)}
              y={H - PAD_B + 14}
              className="fill-muted-foreground text-[9px]"
              textAnchor="middle"
            >
              {p.bufferCapacity}
            </text>
          </g>
        ))}
        {/* Time-in-system (right axis) — drawn first so throughput overlays. */}
        <path d={tisyPath} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} />
        {summary.points.map((p, i) => (
          <circle
            key={`w-${p.bufferCapacity}`}
            cx={xPx(xs[i]!)}
            cy={wPx(p.avgTimeInSystemMs)}
            r={2}
            className="fill-muted-foreground"
          />
        ))}
        {/* Throughput curve — primary. */}
        <path d={tputPath} fill="none" className="stroke-sim-running" strokeWidth={2.5} />
        {summary.points.map((p, i) => (
          <circle
            key={`t-${p.bufferCapacity}`}
            cx={xPx(xs[i]!)}
            cy={tPx(p.throughputPerHour)}
            r={3}
            className="fill-sim-running"
          />
        ))}
        {/* Knee marker. */}
        <circle
          cx={xPx(Math.log2(Math.max(1, knee.bufferCapacity)))}
          cy={tPx(knee.throughputPerHour)}
          r={5}
          fill="none"
          className="stroke-foreground"
          strokeWidth={1.5}
        />
      </svg>
      <div className="text-muted-foreground flex items-center gap-3 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="bg-sim-running inline-block h-2 w-3 rounded" /> Throughput
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-muted-foreground inline-block h-2 w-3 rounded" /> Time-in-system
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-foreground/80 inline-block h-2 w-3 rounded border" /> Current WIP
        </span>
        {onApplyCapacity && knee.bufferCapacity !== summary.currentCapacity ? (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={() => {
              onApplyCapacity(knee.bufferCapacity);
            }}
          >
            Apply knee (WIP {knee.bufferCapacity}) &amp; re-run
          </Button>
        ) : null}
      </div>
    </div>
  );
}
