/**
 * VROL-1014 — Sustainability card. Renders when at least one station
 * declared energyPerCycleJ / waterPerCycleL / co2ePerCycleG. Shows
 * line totals, per-station breakdown bars, and a per-unit intensity
 * metric (e.g. "J / kg" when the sink unit is kg).
 *
 * Engine math is unchanged — the card just reads perStationEnergyJ
 * etc. arrays (added on ChainResult in VROL-1014) alongside the
 * existing totals.
 */

import type { ChainResult } from "@/engine";
import { GlossaryTerm } from "@/components/ui/glossary-term";

interface Props {
  readonly result: ChainResult;
  readonly stationLabels: readonly string[];
  /** VROL-1014 — sink unit + ratio drive the intensity metric label. */
  readonly throughputUnit?: string;
  readonly unitsPerPart?: number;
}

interface Metric {
  readonly key: "energy" | "water" | "co2e";
  readonly label: string;
  readonly total: number;
  readonly perStation: readonly number[];
  readonly fmt: (n: number) => string;
  readonly unit: string;
}

function fmtNumber(n: number, digits = 1): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function SustainabilityCard({
  result,
  stationLabels,
  throughputUnit = "parts",
  unitsPerPart = 1,
}: Props) {
  const metrics: readonly Metric[] = [
    {
      key: "energy",
      label: "Energy",
      total: result.totalEnergyJ,
      perStation: result.perStationEnergyJ,
      fmt: (n) =>
        n >= 1_000_000 ? `${fmtNumber(n / 1_000_000)} MJ` : `${fmtNumber(n / 1_000)} kJ`,
      unit: "J",
    },
    {
      key: "water",
      label: "Water",
      total: result.totalWaterL,
      perStation: result.perStationWaterL,
      fmt: (n) => `${fmtNumber(n)} L`,
      unit: "L",
    },
    {
      key: "co2e",
      label: "CO₂e",
      total: result.totalCO2eG,
      perStation: result.perStationCO2eG,
      fmt: (n) => (n >= 1000 ? `${fmtNumber(n / 1000)} kg` : `${fmtNumber(n)} g`),
      unit: "g",
    },
  ];
  // Only render the card when at least one metric is non-zero. Empty
  // sustainability scenarios stay invisible — no decorative card.
  const anyNonZero = metrics.some((m) => m.total > 0);
  if (!anyNonZero) return null;
  // Per-unit intensity: total / (parts × unitsPerPart) = total / units
  // produced. Falls back to "parts" when the user hasn't declared a
  // unit. Only meaningful for completed > 0.
  const totalUnits = result.completed * unitsPerPart;
  const unitLabel = throughputUnit && throughputUnit.length > 0 ? throughputUnit : "parts";
  return (
    <div
      className="border-border bg-card/50 space-y-3 rounded-md border p-3"
      data-testid="sustainability-card"
    >
      <div className="text-foreground flex items-center justify-between text-sm font-medium">
        <span>Sustainability · per-station + per-unit</span>
        <span className="text-muted-foreground text-[10px]">
          {result.completed.toLocaleString()} parts produced
        </span>
      </div>
      {metrics.map((m) => {
        if (m.total <= 0) return null;
        const stationTotals = m.perStation;
        const max = stationTotals.reduce((acc, v) => (v > acc ? v : acc), 0);
        const intensity = totalUnits > 0 ? m.total / totalUnits : 0;
        return (
          <div key={m.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-foreground text-xs font-medium">{m.label}</span>
              <div className="flex items-baseline gap-3 text-[11px]">
                <span className="text-muted-foreground">
                  total{" "}
                  <strong className="text-foreground font-mono tabular-nums">
                    {m.fmt(m.total)}
                  </strong>
                </span>
                {intensity > 0 ? (
                  <span className="text-muted-foreground">
                    <GlossaryTerm term="sustainability-intensity">intensity</GlossaryTerm>{" "}
                    <strong className="text-foreground font-mono tabular-nums">
                      {fmtNumber(intensity, intensity < 10 ? 2 : 1)} {m.unit}/{unitLabel}
                    </strong>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="space-y-0.5">
              {stationTotals.map((v, i) => {
                if (max <= 0) return null;
                const widthPct = (v / max) * 100;
                const label = stationLabels[i] ?? `Station ${String(i + 1)}`;
                return (
                  <div
                    key={`${m.key}:${String(i)}`}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <span className="text-muted-foreground w-24 shrink-0 truncate text-right">
                      {label}
                    </span>
                    <div className="bg-muted/40 relative h-2.5 flex-1 rounded">
                      {widthPct > 0 ? (
                        <div
                          className="bg-sim-running/70 absolute top-0 bottom-0 left-0 rounded"
                          style={{ width: `${widthPct.toFixed(2)}%` }}
                        />
                      ) : null}
                    </div>
                    <span className="text-foreground/80 w-20 shrink-0 text-right font-mono tabular-nums">
                      {m.fmt(v)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
