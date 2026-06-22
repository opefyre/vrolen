/**
 * Replications summary card — appears under the headline KPI tiles
 * when the user ran ≥2 replications. Shows mean ± 95 % CI per KPI in
 * the Arena house style (mean (95 % CI: [lo, hi])).
 *
 * VROL-849 — header / status / re-run live in AnalyticsCardShell. This
 * card has no Run handler of its own (replication count rides on the
 * main scenario run), so the status pill simply reads "Done" and the
 * Run button is suppressed.
 *
 * VROL-850 — when both summaries share an identical seed list we
 * default to paired t-test (CRN matched); otherwise we default to
 * Welch (independent samples). A user-facing toggle in the body lets
 * the user override and see the same KPIs under the other test.
 */

import { Scale, Sigma } from "lucide-react";
import { useMemo, useState } from "react";

import { AnalyticsCardShell } from "@/components/results/AnalyticsCardShell";
import { Button } from "@/components/ui/button";
import {
  pairedTConfidence,
  welchTConfidence,
  type PairedComparisonResult,
} from "@/lib/comparison-stats";
import { noisinessSignal, seedsMatch, type ReplicationSummary } from "@/lib/replications";

type TestMode = "paired" | "welch";

export function ReplicationsCard({
  summary,
  baseline,
}: {
  readonly summary: ReplicationSummary;
  readonly baseline?: ReplicationSummary;
}) {
  if (summary.n < 2) return null;
  const noise = noisinessSignal(summary);
  const noiseTone =
    noise > 0.1
      ? "text-sim-down-foreground"
      : noise > 0.03
        ? "text-sim-setup-foreground"
        : "text-sim-running";
  const noiseLabel =
    noise > 0.1 ? "noisy — consider more reps" : noise > 0.03 ? "moderate noise" : "tight";
  return (
    <AnalyticsCardShell
      id="replications"
      title={
        <>
          <Sigma className="h-4 w-4" aria-hidden /> Replications · 95% CI
        </>
      }
      description={`${String(summary.n)} replications, mean ± 95% confidence half-width.`}
      status="done"
      statusLabel={`CV ${(noise * 100).toFixed(1)}% · ${noiseLabel}`}
    >
      <ReplicationsBody
        summary={summary}
        {...(baseline ? { baseline } : {})}
        noiseTone={noiseTone}
      />
    </AnalyticsCardShell>
  );
}

function ReplicationsBody({
  summary,
  baseline,
  noiseTone,
}: {
  readonly summary: ReplicationSummary;
  readonly baseline?: ReplicationSummary;
  readonly noiseTone: string;
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-border border-b text-left text-xs tracking-wide uppercase">
              <th className="py-2 pr-3 font-medium">KPI</th>
              <th className="px-3 py-2 text-right font-medium">Mean</th>
              <th className="px-3 py-2 text-right font-medium">± 95% CI</th>
              <th className="px-3 py-2 text-right font-medium">Low</th>
              <th className="px-3 py-2 text-right font-medium">High</th>
            </tr>
          </thead>
          <tbody>
            {summary.kpis.map((k) => (
              <tr key={k.label} className="border-border/50 border-b last:border-0">
                <td className="py-2 pr-3">{k.label}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{k.format(k.mean)}</td>
                <td className="text-muted-foreground px-3 py-2 text-right font-mono tabular-nums">
                  {k.format(k.halfWidth95)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{k.format(k.low95)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {k.format(k.high95)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className={`mt-2 inline-block font-mono text-[10px] ${noiseTone}`} aria-hidden />
      {baseline ? <DeltaSection summary={summary} baseline={baseline} /> : null}
    </>
  );
}

/**
 * Per-KPI delta of (current - baseline). Defaults to paired-t when both
 * runs used identical seed lists; otherwise Welch (independent samples).
 * A toggle lets the user override. We compare KPIs by label and skip
 * silently if a baseline KPI is missing.
 */
function DeltaSection({
  summary,
  baseline,
}: {
  readonly summary: ReplicationSummary;
  readonly baseline: ReplicationSummary;
}) {
  const matchedSeeds = seedsMatch(summary.seeds, baseline.seeds);
  const [mode, setMode] = useState<TestMode>(matchedSeeds ? "paired" : "welch");
  const rows = useMemo(() => {
    return summary.kpis
      .map((cur) => {
        const base = baseline.kpis.find((k) => k.label === cur.label);
        if (!base) return null;
        const result: PairedComparisonResult | null =
          mode === "paired"
            ? pairedTConfidence(base.values, cur.values)
            : welchTConfidence(base.values, cur.values);
        if (!result) return null;
        return { kpi: cur, result };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [summary, baseline, mode]);
  if (rows.length === 0) return null;
  const matchedSeedsLabel = matchedSeeds
    ? "Matched seeds — paired-t recommended"
    : "Independent seed lists — Welch-t recommended";
  return (
    <div className="border-border bg-background/40 mt-3 rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Scale className="text-muted-foreground h-3.5 w-3.5" aria-hidden />
        <span className="text-sm font-medium">
          vs previous run ({mode === "paired" ? "paired" : "Welch"} 95% CI)
        </span>
        <span className="text-muted-foreground text-[10px]">{baseline.n} reps</span>
        <div
          role="group"
          aria-label="Choose t-test"
          className="border-border ml-auto inline-flex overflow-hidden rounded-md border text-[10px]"
        >
          <Button
            type="button"
            size="sm"
            variant={mode === "paired" ? "secondary" : "ghost"}
            onClick={() => setMode("paired")}
            className="h-6 rounded-none px-2 text-[10px]"
            aria-pressed={mode === "paired"}
          >
            Paired t-test (vs baseline)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "welch" ? "secondary" : "ghost"}
            onClick={() => setMode("welch")}
            className="h-6 rounded-none px-2 text-[10px]"
            aria-pressed={mode === "welch"}
          >
            Welch t-test (independent samples)
          </Button>
        </div>
      </div>
      <div className="text-muted-foreground mb-2 text-[10px]">{matchedSeedsLabel}</div>
      <div className="space-y-1">
        {rows.map(({ kpi, result }) => {
          const fmt = kpi.format;
          const tone = result.significant
            ? result.meanDelta > 0
              ? "text-sim-running-foreground"
              : "text-sim-down-foreground"
            : "text-muted-foreground";
          const arrow = result.meanDelta > 0 ? "▲" : result.meanDelta < 0 ? "▼" : "=";
          return (
            <div key={kpi.label} className="flex items-center gap-2 text-[11px]">
              <div className="text-foreground/80 w-32 shrink-0 truncate">{kpi.label}</div>
              <div
                className={`w-32 shrink-0 font-mono tabular-nums ${tone}`}
                title={`Effect size dz=${result.cohensDz.toFixed(2)}`}
              >
                {arrow} {fmt(Math.abs(result.meanDelta))}
              </div>
              <div className="text-muted-foreground w-44 shrink-0 font-mono tabular-nums">
                95% CI [{fmt(result.low95)}, {fmt(result.high95)}]
              </div>
              <div className="text-muted-foreground w-20 shrink-0 font-mono tabular-nums">
                p = {formatPValue(result.pValue)}
              </div>
              <div
                className={`text-[10px] font-medium tracking-wide uppercase ${result.significant ? tone : "text-muted-foreground"}`}
              >
                {result.significant ? "significant" : "n.s."}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-2 text-[10px]">
        {mode === "paired"
          ? "Paired t-test on per-replication differences (d_i = current_i − baseline_i). Significance = the 95% CI excludes zero; p-value is two-sided."
          : "Welch t-test on independent samples (unequal variances, Welch–Satterthwaite df). Significance = the 95% CI excludes zero; p-value is two-sided."}
      </p>
    </div>
  );
}

function formatPValue(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.001) return "<0.001";
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(2);
}
