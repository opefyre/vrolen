/**
 * Click-to-drill detail sheets. Each one takes a target (KPI / tornado row /
 * heatmap cell) and renders rich per-point detail in a side Sheet:
 *
 *   • KpiDrilldown        — per-replication histogram + CI + 5-number summary
 *   • SensitivityDrilldown — −20% / baseline / +20% throughput cards + apply
 *   • HeatmapCellDrilldown — single (cap, multiplier) cell deltas + apply
 *
 * They're presentational; data + apply callbacks come from the parent.
 */

import { ArrowDown, ArrowUp, Crown, MapPin, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ReplicationKpi } from "@/lib/replications";
import type { OptimizationCandidate, OptimizationSummary } from "@/lib/optimization-search";
import type { SensitivityRow, SensitivitySummary } from "@/lib/sensitivity-sweep";

// ──────────────────────────────────────────────────────────────────────────────
// KPI drilldown
// ──────────────────────────────────────────────────────────────────────────────

interface KpiDrilldownProps {
  readonly kpi: ReplicationKpi | null;
  readonly onClose: () => void;
}

export function KpiDrilldown({ kpi, onClose }: KpiDrilldownProps) {
  return (
    <Sheet
      open={kpi !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        <SheetHeader className="pr-7">
          <SheetTitle className="flex items-center gap-2">
            {kpi?.label ?? "KPI"} · per-replication detail
          </SheetTitle>
        </SheetHeader>
        {kpi ? <KpiDrilldownBody kpi={kpi} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function KpiDrilldownBody({ kpi }: { readonly kpi: ReplicationKpi }) {
  const values = [...kpi.values].sort((a, b) => a - b);
  const n = values.length;
  const fmt = kpi.format;
  const at = (q: number): number => {
    if (n === 0) return 0;
    const idx = Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))));
    return values[idx] ?? 0;
  };
  const median = at(0.5);
  const p25 = at(0.25);
  const p75 = at(0.75);
  const min = values[0] ?? 0;
  const max = values[n - 1] ?? 0;
  const iqr = p75 - p25;
  // Histogram
  const BINS = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(n))));
  const span = Math.max(1e-9, max - min);
  const binWidth = span / BINS;
  const bins: number[] = Array.from({ length: BINS }, () => 0);
  for (const v of values) {
    const k = Math.min(BINS - 1, Math.floor((v - min) / binWidth));
    bins[k] = (bins[k] ?? 0) + 1;
  }
  const maxBin = Math.max(...bins, 1);
  // CI box
  const ciSpan = kpi.high95 - kpi.low95;
  const rangeSpan = max - min;
  const ciStart = rangeSpan > 0 ? ((kpi.low95 - min) / rangeSpan) * 100 : 0;
  const ciWidth = rangeSpan > 0 ? (ciSpan / rangeSpan) * 100 : 100;
  return (
    <div className="space-y-4 px-4 pb-6">
      <div className="border-border bg-card grid grid-cols-2 gap-3 rounded-md border p-3 text-sm">
        <div>
          <div className="text-muted-foreground text-[10px] tracking-wide uppercase">Mean</div>
          <div className="font-mono text-lg font-semibold tabular-nums">{fmt(kpi.mean)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
            95% half-width
          </div>
          <div className="font-mono text-lg font-semibold tabular-nums">
            ± {fmt(kpi.halfWidth95)}
          </div>
        </div>
        <div className="col-span-2 text-xs">
          <span className="text-muted-foreground">95% CI: </span>
          <span className="font-mono tabular-nums">
            [{fmt(kpi.low95)}, {fmt(kpi.high95)}]
          </span>
          <span className="text-muted-foreground"> · n = {n} replications</span>
        </div>
      </div>
      <div>
        <div className="text-muted-foreground mb-1 text-[11px] tracking-wide uppercase">
          Distribution across replications
        </div>
        <svg
          viewBox="0 0 220 80"
          preserveAspectRatio="none"
          className="text-sim-running block h-24 w-full"
        >
          {/* CI band */}
          <rect
            x={(ciStart / 100) * 220}
            y={2}
            width={(ciWidth / 100) * 220}
            height={76}
            fill="currentColor"
            fillOpacity={0.08}
          />
          {bins.map((c, i) => {
            const x = (i / BINS) * 220 + 1;
            const w = 220 / BINS - 2;
            const h = (c / maxBin) * 70;
            const y = 78 - h;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={w}
                height={h}
                fill="currentColor"
                fillOpacity={0.7}
                rx={1}
              />
            );
          })}
          {/* Mean line */}
          <line
            x1={rangeSpan > 0 ? ((kpi.mean - min) / rangeSpan) * 220 : 110}
            x2={rangeSpan > 0 ? ((kpi.mean - min) / rangeSpan) * 220 : 110}
            y1={2}
            y2={78}
            stroke="currentColor"
            strokeWidth={1.5}
          />
        </svg>
        <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
          <span className="font-mono tabular-nums">{fmt(min)}</span>
          <span className="font-mono tabular-nums">{fmt(max)}</span>
        </div>
        <p className="text-muted-foreground mt-1 text-[10px]">
          Bars = histogram. Faded band = 95% CI. Vertical line = mean.
        </p>
      </div>
      <div className="border-border rounded-md border p-3">
        <div className="text-muted-foreground mb-2 text-[11px] tracking-wide uppercase">
          5-number summary
        </div>
        <dl className="grid grid-cols-5 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground text-[10px]">Min</dt>
            <dd className="font-mono tabular-nums">{fmt(min)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-[10px]">p25</dt>
            <dd className="font-mono tabular-nums">{fmt(p25)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-[10px]">Median</dt>
            <dd className="font-mono tabular-nums">{fmt(median)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-[10px]">p75</dt>
            <dd className="font-mono tabular-nums">{fmt(p75)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-[10px]">Max</dt>
            <dd className="font-mono tabular-nums">{fmt(max)}</dd>
          </div>
        </dl>
        <div className="text-muted-foreground mt-2 text-[10px]">
          IQR (p75−p25) = <span className="font-mono tabular-nums">{fmt(iqr)}</span> · stddev{" "}
          <span className="font-mono tabular-nums">{fmt(kpi.stddev)}</span>
        </div>
      </div>
      <div className="border-border rounded-md border p-3">
        <div className="text-muted-foreground mb-2 text-[11px] tracking-wide uppercase">
          Per-replication values
        </div>
        <div className="grid grid-cols-4 gap-x-2 gap-y-1 text-[11px] sm:grid-cols-5">
          {kpi.values.map((v, i) => (
            <div key={i} className="font-mono tabular-nums">
              <span className="text-muted-foreground">#{i + 1}</span>{" "}
              <span className="text-foreground">{fmt(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Sensitivity drilldown
// ──────────────────────────────────────────────────────────────────────────────

interface SensitivityDrilldownProps {
  readonly row: SensitivityRow | null;
  readonly summary: SensitivitySummary | null;
  readonly onClose: () => void;
  readonly onFocusStation?: (idx: number) => void;
  readonly onApplyScale?: (stationIdx: number, factor: number) => void;
}

export function SensitivityDrilldown({
  row,
  summary,
  onClose,
  onFocusStation,
  onApplyScale,
}: SensitivityDrilldownProps) {
  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        <SheetHeader className="pr-7">
          <SheetTitle>{row?.stationLabel ?? "Station"} · sensitivity detail</SheetTitle>
        </SheetHeader>
        {row && summary ? (
          <SensitivityDrilldownBody
            row={row}
            summary={summary}
            {...(onFocusStation ? { onFocusStation } : {})}
            {...(onApplyScale ? { onApplyScale } : {})}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SensitivityDrilldownBody({
  row,
  summary,
  onFocusStation,
  onApplyScale,
}: {
  readonly row: SensitivityRow;
  readonly summary: SensitivitySummary;
  readonly onFocusStation?: (idx: number) => void;
  readonly onApplyScale?: (stationIdx: number, factor: number) => void;
}) {
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const baseline = summary.baselinePerHour;
  const lowDelta = row.lowPerHour - baseline;
  const highDelta = row.highPerHour - baseline;
  const lowPct = baseline > 0 ? (lowDelta / baseline) * 100 : 0;
  const highPct = baseline > 0 ? (highDelta / baseline) * 100 : 0;
  const helpsWhenSlower = row.lowPerHour < row.highPerHour;
  const lowScale = summary.lowMultiplier;
  const highScale = summary.highMultiplier;
  return (
    <div className="space-y-4 px-4 pb-6">
      <div className="border-border bg-card rounded-md border p-3 text-sm">
        <div className="text-foreground font-medium">{row.stationLabel}</div>
        <div className="text-muted-foreground text-xs">
          Vary this station's cycle time by ±{Math.round((1 - lowScale) * 100)}% and observe
          throughput.
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ScenarioCard
          label={`@${lowScale.toFixed(2)}× faster`}
          value={`${fmt(row.lowPerHour)} /h`}
          delta={lowPct}
          icon={lowDelta >= 0 ? "up" : "down"}
        />
        <ScenarioCard label="Baseline" value={`${fmt(baseline)} /h`} delta={0} icon="flat" />
        <ScenarioCard
          label={`@${highScale.toFixed(2)}× slower`}
          value={`${fmt(row.highPerHour)} /h`}
          delta={highPct}
          icon={highDelta >= 0 ? "up" : "down"}
        />
      </div>
      <div className="border-border rounded-md border p-3 text-xs">
        <div className="text-muted-foreground mb-1 text-[11px] tracking-wide uppercase">
          Interpretation
        </div>
        <p className="text-foreground/90">
          {helpsWhenSlower
            ? `Slowing this station HELPS throughput by ${Math.abs(highPct).toFixed(1)}%. This is a saturated downstream station — feeding it too fast just creates blocking.`
            : `Speeding this station HELPS throughput by ${Math.abs(lowPct).toFixed(1)}%. This station is the bottleneck (or near one) — a real improvement candidate.`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {onFocusStation ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => onFocusStation(row.stationIdx)}
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden /> Locate on canvas
          </Button>
        ) : null}
        {onApplyScale && !helpsWhenSlower ? (
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={() => onApplyScale(row.stationIdx, lowScale)}
          >
            <TrendingUp className="h-3.5 w-3.5" aria-hidden /> Apply {(lowScale * 100).toFixed(0)}%
            cycle &amp; re-run
          </Button>
        ) : null}
        {onApplyScale && helpsWhenSlower ? (
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={() => onApplyScale(row.stationIdx, highScale)}
          >
            <TrendingDown className="h-3.5 w-3.5" aria-hidden /> Apply{" "}
            {(highScale * 100).toFixed(0)}% cycle &amp; re-run
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ScenarioCard({
  label,
  value,
  delta,
  icon,
}: {
  readonly label: string;
  readonly value: string;
  readonly delta: number;
  readonly icon: "up" | "down" | "flat";
}) {
  const arrow =
    icon === "up" ? (
      <ArrowUp className="text-sim-running h-3 w-3" aria-hidden />
    ) : icon === "down" ? (
      <ArrowDown className="text-sim-down h-3 w-3" aria-hidden />
    ) : (
      <Minus className="text-muted-foreground h-3 w-3" aria-hidden />
    );
  const deltaClass =
    delta > 0.5 ? "text-sim-running" : delta < -0.5 ? "text-sim-down" : "text-muted-foreground";
  return (
    <div className="border-border bg-card rounded-md border p-2">
      <div className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</div>
      <div className="font-mono text-sm font-semibold tabular-nums">{value}</div>
      <div className={`mt-1 flex items-center gap-1 text-[10px] ${deltaClass}`}>
        {arrow}
        <span className="font-mono tabular-nums">
          {delta > 0 ? "+" : ""}
          {delta.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Heatmap cell drilldown
// ──────────────────────────────────────────────────────────────────────────────

interface HeatmapCellDrilldownProps {
  readonly candidate: OptimizationCandidate | null;
  readonly summary: OptimizationSummary | null;
  readonly onClose: () => void;
  readonly onApply?: (candidate: OptimizationCandidate) => void;
}

export function HeatmapCellDrilldown({
  candidate,
  summary,
  onClose,
  onApply,
}: HeatmapCellDrilldownProps) {
  return (
    <Sheet
      open={candidate !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        <SheetHeader className="pr-7">
          <SheetTitle className="flex items-center gap-2">
            <Crown className="h-4 w-4" aria-hidden /> Combo detail
          </SheetTitle>
        </SheetHeader>
        {candidate && summary ? (
          <HeatmapCellDrilldownBody
            candidate={candidate}
            summary={summary}
            {...(onApply ? { onApply } : {})}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function HeatmapCellDrilldownBody({
  candidate,
  summary,
  onApply,
}: {
  readonly candidate: OptimizationCandidate;
  readonly summary: OptimizationSummary;
  readonly onApply?: (candidate: OptimizationCandidate) => void;
}) {
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const ms = (n: number) => `${Math.round(n).toLocaleString()} ms`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const multX = (m: number) => `${m.toFixed(2)}×`;
  const baseline =
    summary.candidates.find(
      (c) => c.bufferCapacity === summary.currentCapacity && c.cycleMultiplier === 1,
    ) ?? null;
  const tputDelta =
    baseline && baseline.meanThroughputPerHour > 0
      ? ((candidate.meanThroughputPerHour - baseline.meanThroughputPerHour) /
          baseline.meanThroughputPerHour) *
        100
      : null;
  const tisDelta =
    baseline && baseline.meanTimeInSystemMs > 0
      ? ((candidate.meanTimeInSystemMs - baseline.meanTimeInSystemMs) /
          baseline.meanTimeInSystemMs) *
        100
      : null;
  const isBest =
    candidate.bufferCapacity === summary.best.bufferCapacity &&
    candidate.cycleMultiplier === summary.best.cycleMultiplier;
  const isBaseline =
    candidate.bufferCapacity === summary.currentCapacity && candidate.cycleMultiplier === 1;
  return (
    <div className="space-y-4 px-4 pb-6">
      <div className="border-border bg-card rounded-md border p-3 text-sm">
        <div className="text-foreground font-semibold">
          WIP {candidate.bufferCapacity} · {summary.targetStationLabel} @
          {multX(candidate.cycleMultiplier)}
        </div>
        <div className="text-muted-foreground mt-1 text-xs">
          {isBest ? (
            <span className="text-sim-running">★ Best cell in this search</span>
          ) : isBaseline ? (
            <span>Current baseline (no changes vs canvas)</span>
          ) : (
            <span>Alternative combo · click Apply to test it on the canvas</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatTile
          label="Throughput"
          value={`${fmt(candidate.meanThroughputPerHour)} /h`}
          delta={tputDelta}
          positiveIsGood
        />
        <StatTile
          label="Time in system"
          value={ms(candidate.meanTimeInSystemMs)}
          delta={tisDelta}
          positiveIsGood={false}
        />
        <StatTile
          label="Scrap rate"
          value={pct(candidate.meanScrapRate)}
          delta={null}
          positiveIsGood={false}
        />
      </div>
      <div className="text-muted-foreground text-[10px]">
        Means averaged across {candidate.replications} replications · deltas vs current canvas
        baseline (WIP {summary.currentCapacity} @1.00×).
      </div>
      {onApply ? (
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={() => onApply(candidate)}
            disabled={isBaseline}
          >
            Apply this combo &amp; re-run
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StatTile({
  label,
  value,
  delta,
  positiveIsGood,
}: {
  readonly label: string;
  readonly value: string;
  readonly delta: number | null;
  readonly positiveIsGood: boolean;
}) {
  const good = delta !== null && (positiveIsGood ? delta > 0.5 : delta < -0.5);
  const bad = delta !== null && (positiveIsGood ? delta < -0.5 : delta > 0.5);
  const cls = good ? "text-sim-running" : bad ? "text-sim-down" : "text-muted-foreground";
  return (
    <div className="border-border bg-card rounded-md border p-2">
      <div className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</div>
      <div className="font-mono text-sm font-semibold tabular-nums">{value}</div>
      {delta !== null ? (
        <div className={`mt-1 font-mono text-[10px] tabular-nums ${cls}`}>
          {delta > 0 ? "+" : ""}
          {delta.toFixed(1)}%
        </div>
      ) : (
        <div className="text-muted-foreground mt-1 text-[10px]">—</div>
      )}
    </div>
  );
}
