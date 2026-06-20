/**
 * Cost & revenue card — translates engine output into CFO language.
 * Headline KPI tiles (Revenue / Total cost / Gross margin / $ per good part)
 * + a per-station drill-down table.
 *
 * Hidden when no station has any cost / revenue inputs.
 */

import { DollarSign } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CostSummary } from "@/lib/cost-economics";

const usd = (n: number, digits = 0): string =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export function CostCard({ summary }: { readonly summary: CostSummary }) {
  const marginPct = summary.revenue > 0 ? (summary.grossMargin / summary.revenue) * 100 : 0;
  const marginTone = summary.grossMargin >= 0 ? "text-sim-running" : "text-sim-down-foreground";
  const tile = (label: string, value: string, hint?: string, tone?: string) => (
    <div className="border-border bg-background/40 rounded-md border p-3">
      <div className="text-muted-foreground text-xs tracking-wide uppercase">{label}</div>
      <div className={`font-mono text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      {hint ? <div className="text-muted-foreground text-[11px]">{hint}</div> : null}
    </div>
  );
  return (
    <Card id="cost-revenue">
      <CardHeader>
        <CardTitle className="font-heading flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4" aria-hidden /> Cost &amp; revenue
        </CardTitle>
        <CardDescription>
          {`Over the ${summary.horizonHours.toFixed(2)}h horizon. Configure $/h, $/cycle, $/scrap, $/good part in the Inspector.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tile("Revenue", usd(summary.revenue), "completed × $/good part")}
          {tile("Total cost", usd(summary.totalCost), "time + cycles + scrap")}
          {tile(
            "Gross margin",
            usd(summary.grossMargin),
            `${marginPct.toFixed(1)}% of revenue`,
            marginTone,
          )}
          {tile("$ per good part", usd(summary.perGoodPart, 2), "fully-loaded unit cost")}
        </div>
        {summary.breakEvenThroughputPerHour !== null ? (
          <div className="text-muted-foreground bg-background/30 border-border rounded-md border border-dashed p-2 text-xs">
            Break-even throughput at the avg $/good-part price ={" "}
            <strong className="text-foreground font-mono tabular-nums">
              {summary.breakEvenThroughputPerHour.toFixed(0)} /h
            </strong>
            .
          </div>
        ) : null}
        {summary.perStation.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left text-xs tracking-wide uppercase">
                  <th className="py-2 pr-3 font-medium">Station</th>
                  <th className="px-3 py-2 text-right font-medium">Time cost</th>
                  <th className="px-3 py-2 text-right font-medium">Cycle cost</th>
                  <th className="px-3 py-2 text-right font-medium">Scrap cost</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.perStation.map((row) => (
                  <tr key={row.stationLabel} className="border-border/50 border-b last:border-0">
                    <td className="py-2 pr-3">{row.stationLabel}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {usd(row.costHour, 2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {usd(row.costCycles, 2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {usd(row.costScrap, 2)}
                    </td>
                    <td className="text-foreground px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {usd(row.total, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
