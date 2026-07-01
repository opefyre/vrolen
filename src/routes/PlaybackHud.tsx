/**
 * VROL-232 (Sprint 199) — HUD overlay for the Playback view.
 *
 * React DOM on top of the WebGL canvas so styling + a11y + i18n
 * come free. Shows:
 *   • Simulated clock (H:MM:SS format when < 24h; else Day N, HH:MM)
 *   • KPI ticker — throughput / OEE / WIP
 *   • SVG bottleneck callout — arrow from a screen anchor to the
 *     bottleneck station's projected position
 *
 * The AC also mentions speed controls (1x/10x/60x/600x/max), but the
 * editor already owns playback speed via its scrubber, so exposing
 * duplicates here would be redundant. When the caller sends
 * `simTimeMs`, the clock ticks from that; otherwise the clock hides.
 */

import { Flame } from "lucide-react";

import type { ChainResult } from "@/engine";

interface Props {
  readonly result: ChainResult | null;
  readonly simTimeMs?: number;
  /** Screen coords (px in the wrapper) of the current bottleneck. */
  readonly bottleneckAt: { readonly x: number; readonly y: number } | null;
  readonly bottleneckLabel?: string;
  /** Wrapper size for laying out the callout arrow. */
  readonly wrapperWidth: number;
  readonly wrapperHeight: number;
  /** VROL-1191 — heatmap toggle state + handler. */
  readonly heatmapOn: boolean;
  readonly onToggleHeatmap: () => void;
}

function fmtSimClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const day = Math.floor(totalSec / 86_400);
  const hh = Math.floor((totalSec % 86_400) / 3_600);
  const mm = Math.floor((totalSec % 3_600) / 60);
  const ss = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (day > 0) return `Day ${String(day + 1)}, ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function fmtRate(perMs: number): string {
  const perHour = perMs * 3_600_000;
  if (perHour >= 1000) return `${(perHour / 1000).toFixed(1)}k / h`;
  if (perHour >= 10) return `${perHour.toFixed(0)} / h`;
  return `${perHour.toFixed(1)} / h`;
}

export function PlaybackHud({
  result,
  simTimeMs,
  bottleneckAt,
  bottleneckLabel,
  wrapperWidth,
  wrapperHeight,
  heatmapOn,
  onToggleHeatmap,
}: Props) {
  const showClock = simTimeMs !== undefined;
  const throughput = result ? fmtRate(result.throughputLambda) : "—";
  const oeePct = result ? `${(result.lineOee * 100).toFixed(1)}%` : "—";
  const wipStr = result ? `${(result.lineAverageWipL ?? 0).toFixed(1)}` : "—";

  // Anchor the arrow at the top-right corner of the HUD KPI panel so
  // the reader's eye already lives there.
  const anchor = { x: wrapperWidth - 24, y: 24 };
  const arrowActive =
    bottleneckAt !== null &&
    wrapperWidth > 0 &&
    wrapperHeight > 0 &&
    bottleneckAt.x >= 0 &&
    bottleneckAt.x <= wrapperWidth &&
    bottleneckAt.y >= 0 &&
    bottleneckAt.y <= wrapperHeight;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      role="region"
      aria-label="Playback HUD"
      data-testid="playback-hud"
    >
      {/* KPI ticker + clock — top-right, glassy panel. */}
      <div
        className="border-border pointer-events-auto absolute top-3 right-3 flex items-center gap-3 rounded-md border bg-white/85 px-3 py-1.5 text-xs shadow-sm backdrop-blur"
        data-testid="playback-hud-kpis"
      >
        {showClock ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-muted-foreground text-[10px] tracking-wide uppercase">Clock</span>
            <span className="text-foreground font-mono font-semibold tabular-nums">
              {fmtSimClock(simTimeMs ?? 0)}
            </span>
          </div>
        ) : null}
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground text-[10px] tracking-wide uppercase">
            Throughput
          </span>
          <span className="text-foreground font-mono font-semibold tabular-nums">{throughput}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground text-[10px] tracking-wide uppercase">OEE</span>
          <span className="text-foreground font-mono font-semibold tabular-nums">{oeePct}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground text-[10px] tracking-wide uppercase">WIP</span>
          <span className="text-foreground font-mono font-semibold tabular-nums">{wipStr}</span>
        </div>
        {/* VROL-1191 — heatmap toggle button. */}
        <button
          type="button"
          onClick={onToggleHeatmap}
          aria-pressed={heatmapOn}
          data-testid="playback-hud-heatmap-toggle"
          title={heatmapOn ? "Hide utilization heatmap" : "Show utilization heatmap"}
          className={`focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-6 w-6 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
            heatmapOn
              ? "bg-sim-down/20 text-sim-down"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Flame className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {/* Bottleneck callout — SVG arrow from the HUD panel toward the
          bottleneck station's screen position. */}
      {arrowActive && bottleneckAt ? (
        <svg
          className="pointer-events-none absolute inset-0"
          width={wrapperWidth}
          height={wrapperHeight}
          data-testid="playback-hud-bottleneck-arrow"
          aria-hidden
        >
          <defs>
            <marker
              id="bottleneck-head"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316" />
            </marker>
          </defs>
          <line
            x1={anchor.x}
            y1={anchor.y}
            x2={bottleneckAt.x}
            y2={bottleneckAt.y}
            stroke="#f97316"
            strokeWidth={2}
            strokeDasharray="6 4"
            markerEnd="url(#bottleneck-head)"
          />
          {bottleneckLabel ? (
            <text
              x={(anchor.x + bottleneckAt.x) / 2}
              y={(anchor.y + bottleneckAt.y) / 2 - 6}
              fill="#9a3412"
              fontSize={11}
              fontFamily="ui-monospace, monospace"
              textAnchor="middle"
            >
              Bottleneck: {bottleneckLabel}
            </text>
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}
