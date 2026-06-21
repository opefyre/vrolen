/**
 * Replications summary card — appears under the headline KPI tiles
 * when the user ran ≥2 replications. Shows mean ± 95 % CI per KPI in
 * the Arena house style (mean (95 % CI: [lo, hi])).
 */

import { Scale, Sigma } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pairedTConfidence } from "@/lib/comparison-stats";
import type { ReplicationSummary } from "@/lib/replications";
import { noisinessSignal } from "@/lib/replications";

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
    <Card id="replications">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="font-heading flex items-center gap-2 text-base">
            <Sigma className="h-4 w-4" aria-hidden /> Replications · 95% CI
          </CardTitle>
          <CardDescription>
            {`${String(summary.n)} replications, mean ± 95% confidence half-width.`}
          </CardDescription>
        </div>
        <span className={`mt-1 font-mono text-[10px] ${noiseTone}`}>
          CV {(noise * 100).toFixed(1)}% · {noiseLabel}
        </span>
      </CardHeader>
      <CardContent>
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
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {k.format(k.mean)}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-right font-mono tabular-nums">
                    {k.format(k.halfWidth95)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {k.format(k.low95)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {k.format(k.high95)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {baseline ? <PairedDeltaSection summary={summary} baseline={baseline} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Paired-t CI of (current - baseline) per matched KPI. The baseline is
 * the previous multi-rep run; we treat the two as paired because they
 * shared the same seeds (CRN). If KPI labels mismatch, we skip silently.
 */
function PairedDeltaSection({
  summary,
  baseline,
}: {
  readonly summary: ReplicationSummary;
  readonly baseline: ReplicationSummary;
}) {
  // Match KPIs by label.
  const rows = summary.kpis
    .map((cur) => {
      const base = baseline.kpis.find((k) => k.label === cur.label);
      if (!base) return null;
      const result = pairedTConfidence(base.values, cur.values);
      if (!result) return null;
      return { kpi: cur, baseKpi: base, result };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return null;
  return (
    <div className="border-border bg-background/40 mt-3 rounded-md border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Scale className="text-muted-foreground h-3.5 w-3.5" aria-hidden />
        <span className="text-sm font-medium">vs previous run (paired 95% CI)</span>
        <span className="text-muted-foreground text-[10px]">{baseline.n} matched seeds</span>
      </div>
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
        Paired t-test on per-replication differences. Significance = the 95% CI excludes zero.
      </p>
    </div>
  );
}
