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
  /**
   * VROL-1214 — run-average result (pre-interpolation). When provided the
   * HUD labels the primary throughput as AVG (matching the header pill and
   * KPI cards) and shows the interpolated 5-second rolling value as INST.
   * Prevents the "HUD shows 0.0/h while KPI shows 13.9k/h" mismatch when
   * no parts complete in the current 5s window.
   */
  readonly runResult?: ChainResult | null;
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
  runResult,
  simTimeMs,
  bottleneckAt,
  bottleneckLabel,
  wrapperWidth,
  wrapperHeight,
  heatmapOn,
  onToggleHeatmap,
}: Props) {
  const showClock = simTimeMs !== undefined;
  // VROL-1214 — primary throughput is the run average (matches the header
  // pill + KPI card). When the caller passes runResult we surface the
  // 5-second rolling instantaneous value as a smaller secondary chip so
  // the reader sees BOTH signals honestly labelled — never a naked "0.0/h"
  // sitting next to a populated OEE.
  const primarySource = runResult ?? result;
  const throughputPrimary = primarySource ? fmtRate(primarySource.throughputLambda) : "—";
  const primaryLabel = runResult ? "Avg / h" : "Throughput";
  const instLambda = result?.throughputLambda;
  const hasSeparateInst =
    runResult !== undefined &&
    runResult !== null &&
    result !== null &&
    instLambda !== undefined &&
    Math.abs(instLambda - runResult.throughputLambda) > 1e-9;
  const throughputInst = hasSeparateInst && instLambda !== undefined ? fmtRate(instLambda) : null;
  const oeePct = result ? `${(result.lineOee * 100).toFixed(1)}%` : "—";
  const wipStr = result ? `${(result.lineAverageWipL ?? 0).toFixed(1)}` : "—";

  // VROL-1213 — the original dashed arrow from the HUD panel to the
  // sprite mis-read as "pointing into empty canvas" whenever the camera
  // hadn't fitted the topology yet (see VROL-1213 fit-view). Replaced
  // with a pulsing ring directly around the target sprite plus a tiny
  // "Bottleneck: X" label pinned above it. Reads as "look at THIS
  // station" without depending on the arrow's straight-line endpoint.
  const ringActive =
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
        <div
          className="flex items-baseline gap-1.5"
          title={
            hasSeparateInst
              ? "Avg = run-average throughput (matches the header pill and KPI card). Inst = 5-second rolling instantaneous."
              : "Run-average throughput."
          }
        >
          <span className="text-muted-foreground text-[10px] tracking-wide uppercase">
            {primaryLabel}
          </span>
          <span className="text-foreground font-mono font-semibold tabular-nums">
            {throughputPrimary}
          </span>
          {throughputInst ? (
            <span
              className="text-muted-foreground/80 ml-1 font-mono text-[10px] tabular-nums"
              data-testid="playback-hud-inst-throughput"
            >
              inst {throughputInst}
            </span>
          ) : null}
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

      {/* VROL-1213 — bottleneck marker: pulsing ring on the target
          sprite + a compact label above. Reads as "look at THIS
          station" and never points into empty canvas. */}
      {ringActive && bottleneckAt ? (
        <svg
          className="pointer-events-none absolute inset-0"
          width={wrapperWidth}
          height={wrapperHeight}
          data-testid="playback-hud-bottleneck-arrow"
          aria-hidden
        >
          <g transform={`translate(${String(bottleneckAt.x)} ${String(bottleneckAt.y)})`}>
            {/* Outer pulsing ring — CSS animation via inline style. */}
            <circle
              r={26}
              fill="none"
              stroke="#f97316"
              strokeWidth={3}
              strokeDasharray="6 4"
              opacity={0.9}
            >
              <animate attributeName="r" values="24;32;24" dur="1.6s" repeatCount="indefinite" />
              <animate
                attributeName="opacity"
                values="0.9;0.4;0.9"
                dur="1.6s"
                repeatCount="indefinite"
              />
            </circle>
            {/* Solid inner ring so the target is legible even mid-pulse. */}
            <circle r={22} fill="none" stroke="#f97316" strokeWidth={2} opacity={0.85} />
            {bottleneckLabel
              ? (() => {
                  // Approximate label width — 7 px per glyph is close
                  // enough for ui-monospace at 11 px.
                  const labelText = `Bottleneck: ${bottleneckLabel}`;
                  const w = Math.max(120, labelText.length * 7 + 12);
                  const h = 20;
                  return (
                    <g transform="translate(0 -34)">
                      <rect
                        x={-w / 2}
                        y={-h / 2}
                        width={w}
                        height={h}
                        rx={4}
                        fill="#fff"
                        fillOpacity={0.92}
                        stroke="#f97316"
                        strokeWidth={1}
                      />
                      <text
                        y={4}
                        fill="#9a3412"
                        fontSize={11}
                        fontFamily="ui-monospace, monospace"
                        textAnchor="middle"
                        fontWeight={600}
                      >
                        {labelText}
                      </text>
                    </g>
                  );
                })()
              : null}
          </g>
        </svg>
      ) : null}
    </div>
  );
}
