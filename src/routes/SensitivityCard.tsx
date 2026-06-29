/**
 * Sensitivity tornado plot card — appears under the Replications card
 * in the Overview tab. User clicks "Run sweep" to fire ±20% cycle-time
 * perturbations on every station and see which one moves throughput
 * the most. Sorted so the widest bar is on top (a tornado).
 *
 * The compute happens in the parent (engine access, baseline opts). This
 * card is the visual surface — pass `summary` for results, `onRun` to
 * fire the sweep, `running` for the spinner state.
 *
 * VROL-849 — header / button / spinner / error states now live in
 * AnalyticsCardShell. This file is the body only.
 */

import { Tornado } from "lucide-react";

import { AnalyticsCardShell } from "@/components/results/AnalyticsCardShell";
import { GlossaryTerm } from "@/components/ui/glossary-term";
import type { SensitivityRow, SensitivitySummary } from "@/lib/sensitivity-sweep";
import { classifyTornadoRow } from "@/lib/tornado-classify";

interface SensitivityCardProps {
  readonly summary: SensitivitySummary | null;
  readonly running: boolean;
  readonly onRun: () => void;
  readonly errorMessage?: string;
  /** Click a tornado row → open the row drilldown sheet (preferred). */
  readonly onClickRow?: (row: SensitivityRow) => void;
  /** VROL-896 — open the chart-level drilldown for the full tornado. */
  readonly onViewDetails?: () => void;
  /**
   * VROL-869 — sink unit label + unitsPerPart so the tornado reads in
   * the user's declared unit (kg/h, doses/h, etc.) instead of parts/h.
   * Optional; defaults to "parts" / 1 so existing scenarios are
   * unaffected.
   */
  readonly throughputUnit?: string;
  readonly unitsPerPart?: number;
}

export function SensitivityCard({
  summary,
  running,
  onRun,
  errorMessage,
  onClickRow,
  onViewDetails,
  throughputUnit,
  unitsPerPart,
}: SensitivityCardProps) {
  const status = errorMessage
    ? ("error" as const)
    : running
      ? ("running" as const)
      : summary
        ? ("done" as const)
        : ("idle" as const);
  return (
    <AnalyticsCardShell
      id="sensitivity"
      title={
        <>
          <Tornado className="h-4 w-4" aria-hidden /> Sensitivity · tornado
        </>
      }
      description={
        <>
          Vary each station&rsquo;s cycle time ±20% and rank by throughput swing. Widest bar =
          biggest lever.
        </>
      }
      status={status}
      {...(running ? { statusLabel: "Sweeping…" } : {})}
      onRun={onRun}
      runLabel="Run sweep"
      {...(errorMessage ? { errorMessage } : {})}
    >
      {!summary ? (
        <p className="text-muted-foreground text-sm">
          Click <strong>Run sweep</strong> to fan out 2 × stations engine runs and rank where
          cycle-time changes hurt or help throughput most.
        </p>
      ) : (
        <SensitivityBody
          summary={summary}
          {...(onClickRow ? { onClickRow } : {})}
          {...(onViewDetails ? { onViewDetails } : {})}
          {...(throughputUnit && throughputUnit.length > 0 ? { throughputUnit } : {})}
          {...(typeof unitsPerPart === "number" && unitsPerPart > 0 && unitsPerPart !== 1
            ? { unitsPerPart }
            : {})}
        />
      )}
    </AnalyticsCardShell>
  );
}

export function SensitivityBody({
  summary,
  onClickRow,
  onViewDetails,
  throughputUnit = "parts",
  unitsPerPart = 1,
}: {
  readonly summary: SensitivitySummary;
  readonly onClickRow?: (row: SensitivityRow) => void;
  readonly onViewDetails?: () => void;
  /** VROL-869 — sink unit + ratio for display-only conversion. */
  readonly throughputUnit?: string;
  readonly unitsPerPart?: number;
}) {
  if (summary.rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No varying-cycle-time stations available to sweep.
      </p>
    );
  }
  // VROL-869 — UoM-aware display: multiply per-hour values by sink's
  // unitsPerPart so a dairy line tornado reads in kg/h. Default 1 +
  // "parts" keeps existing scenarios unchanged.
  const fmt = (n: number) => Math.round(n * unitsPerPart).toLocaleString();
  // Find the widest swing absolute; that defines the bar scale.
  const maxSwing = summary.rows.reduce((m, r) => Math.max(m, r.swingPerHour), 0);
  // For each row the bar runs from (low - center) to (high - center)
  // expressed as a fraction of (maxSwing). Center = baselinePerHour.
  const base = summary.baselinePerHour;
  const unitLabel = throughputUnit && throughputUnit.length > 0 ? throughputUnit : "parts";
  const halfBarWidthPct = 45; // bar can span 45% on each side of center
  // VROL-793 — sort by absolute magnitude descending so noise-floor bars
  // sink to the bottom. The sweep already sorts that way, but sorting here
  // too means we're robust to upstream changes.
  const sortedRows = [...summary.rows].sort((a, b) => b.swingPerHour - a.swingPerHour);
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-[11px]">
        <span>
          Baseline ={" "}
          <strong className="text-foreground font-mono tabular-nums">
            {fmt(base)} {unitLabel}/h
          </strong>
        </span>
        <div className="flex items-center gap-2">
          <span>
            Perturbation ±{Math.round((1 - summary.lowMultiplier) * 100)}% · sweep took{" "}
            {summary.elapsedMs.toFixed(0)} ms
          </span>
          {onViewDetails ? (
            <button
              type="button"
              onClick={onViewDetails}
              aria-label="View details"
              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              View details
            </button>
          ) : null}
        </div>
      </div>
      <div className="space-y-1.5">
        {sortedRows.map((row) => {
          const lowOffset = row.lowPerHour - base;
          const highOffset = row.highPerHour - base;
          const lowPct = maxSwing > 0 ? (lowOffset / maxSwing) * halfBarWidthPct : 0;
          const highPct = maxSwing > 0 ? (highOffset / maxSwing) * halfBarWidthPct : 0;
          const left = 50 + Math.min(lowPct, highPct);
          const width = Math.abs(highPct - lowPct);
          const tone = classifyTornadoRow(row, maxSwing);
          const barColor =
            tone === "positive"
              ? "bg-sim-running/70"
              : tone === "negative"
                ? "bg-sim-down/70"
                : "bg-muted-foreground/30";
          const toneLabel =
            tone === "positive"
              ? "Speeding up helps throughput"
              : tone === "negative"
                ? "Slowing down helps throughput"
                : "Below noise floor — not statistically meaningful for this run";
          const Wrapper = onClickRow ? "button" : "div";
          const wrapperProps = onClickRow
            ? {
                type: "button" as const,
                onClick: () => {
                  onClickRow(row);
                },
                className:
                  "hover:bg-accent/40 flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-[11px] transition-colors",
              }
            : { className: "flex items-center gap-2 text-[11px]" };
          return (
            <Wrapper
              key={row.stationLabel}
              {...wrapperProps}
              data-tone={tone}
              title={`${row.stationLabel}: ${fmt(row.lowPerHour)}/h (low) → ${fmt(row.highPerHour)}/h (high) · ${toneLabel}${onClickRow ? " · click for detail" : ""}`}
            >
              <div
                className={`w-28 shrink-0 truncate text-right font-medium ${tone === "noise" ? "text-muted-foreground" : "text-foreground/80"}`}
              >
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
                className={`w-12 shrink-0 text-right font-mono tabular-nums ${
                  tone === "noise"
                    ? "text-muted-foreground"
                    : row.swingPct >= 5
                      ? "text-foreground"
                      : "text-muted-foreground"
                }`}
              >
                {row.swingPct.toFixed(1)}%
              </div>
            </Wrapper>
          );
        })}
      </div>
      {/* VROL-793 — colour-key legend so the divergent scale + noise-floor
          grey are self-explanatory. Sits below the bars where the user
          looks once they've scanned the chart. */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        <span className="flex items-center gap-1.5">
          <span className="bg-sim-running/70 inline-block h-2 w-3 rounded-sm" aria-hidden />
          <span>Speed up = more throughput</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-sim-down/70 inline-block h-2 w-3 rounded-sm" aria-hidden />
          <span>Slow down = less</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-muted-foreground/30 inline-block h-2 w-3 rounded-sm" aria-hidden />
          <span>Below noise floor</span>
        </span>
      </div>
      {/* VROL-938 — constraint-dimension rows: BOM qty + tool-pool capacity.
          Same horizontal bar pattern as the cycle-time tornado, but the
          'positive' tone means a higher constraint value helped throughput,
          which is the more intuitive read for these dimensions. */}
      {summary.constraintRows.length > 0 ? (
        <div
          className="border-border space-y-1.5 border-t pt-2"
          data-testid="sensitivity-constraints"
        >
          <div className="text-muted-foreground text-[11px] font-medium">Constraint dimensions</div>
          {summary.constraintRows.map((row, idx) => {
            const lowOffset = row.lowPerHour - base;
            const highOffset = row.highPerHour - base;
            const constraintMax = Math.max(
              maxSwing,
              summary.constraintRows.reduce((m, r) => Math.max(m, r.swingPerHour), 0),
            );
            const lowPct = constraintMax > 0 ? (lowOffset / constraintMax) * halfBarWidthPct : 0;
            const highPct = constraintMax > 0 ? (highOffset / constraintMax) * halfBarWidthPct : 0;
            const left = 50 + Math.min(lowPct, highPct);
            const width = Math.abs(highPct - lowPct);
            // Higher capacity / higher BOM qty → "high" run. If high beats low,
            // raising the constraint helped → positive tone.
            const tone =
              row.highPerHour > row.lowPerHour
                ? "positive"
                : row.highPerHour < row.lowPerHour
                  ? "negative"
                  : "noise";
            const barColor =
              tone === "positive"
                ? "bg-sim-running/70"
                : tone === "negative"
                  ? "bg-sim-down/70"
                  : "bg-muted-foreground/30";
            return (
              <div
                key={`${row.kind}-${String(idx)}`}
                className="flex items-center gap-2 text-[11px]"
                data-tone={tone}
                title={`${row.label}: ${fmt(row.lowPerHour)}/h (low) → ${fmt(row.highPerHour)}/h (high)`}
              >
                <div
                  className="text-foreground/80 w-28 shrink-0 truncate text-right font-medium"
                  data-testid={`sensitivity-row-${row.kind}`}
                >
                  {/* VROL-1047 — surface the station-capacity glossary
                      entry on the capacity rows so users can hover to
                      learn what the lever means. */}
                  {row.kind === "stationCapacity" ? (
                    <GlossaryTerm term="station-capacity">{row.label}</GlossaryTerm>
                  ) : (
                    row.label
                  )}
                </div>
                <div className="bg-muted/40 relative h-4 flex-1 rounded">
                  <div className="bg-border absolute top-0 bottom-0 left-1/2 w-px" />
                  <div
                    className={`absolute top-0 bottom-0 rounded ${barColor}`}
                    style={{ left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%` }}
                  />
                </div>
                <div className="text-muted-foreground w-24 shrink-0 text-right font-mono tabular-nums">
                  ±{fmt(row.swingPerHour / 2)}/h
                </div>
                <div className="text-muted-foreground w-12 shrink-0 text-right font-mono tabular-nums">
                  {row.swingPct.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
