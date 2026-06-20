/**
 * Replications summary card — appears under the headline KPI tiles
 * when the user ran ≥2 replications. Shows mean ± 95 % CI per KPI in
 * the Arena house style (mean (95 % CI: [lo, hi])).
 */

import { Sigma } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReplicationSummary } from "@/lib/replications";
import { noisinessSignal } from "@/lib/replications";

export function ReplicationsCard({ summary }: { readonly summary: ReplicationSummary }) {
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
      </CardContent>
    </Card>
  );
}
