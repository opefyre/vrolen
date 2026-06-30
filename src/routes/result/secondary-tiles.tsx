import type { ChainResult } from "@/engine";

/**
 * VROL-1187 (Sprint 195) — secondary tiles disclosure extracted from
 * ResultPanel.tsx. Wraps the optional theoretical-yield + sustainability
 * tiles in a <details open> so users can collapse them once they've
 * absorbed the headline KPIs above. Renders nothing when neither
 * yield-below-1 nor any sustainability total is present.
 */
export function ResultSecondaryTiles({ result }: { readonly result: ChainResult }) {
  const yieldShown = result.theoreticalYield !== undefined && result.theoreticalYield < 1;
  const sustainShown =
    (result.totalEnergyJ ?? 0) > 0 || (result.totalWaterL ?? 0) > 0 || (result.totalCO2eG ?? 0) > 0;
  if (!yieldShown && !sustainShown) return null;
  const fmt = (n: number, digits = 1) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const energyKWh = (result.totalEnergyJ ?? 0) / 3_600_000;
  return (
    <details open data-testid="result-secondary-tiles" className="space-y-2">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs tracking-wide uppercase select-none">
        Quality + sustainability tiles
      </summary>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {yieldShown ? (
          <div className="border-border bg-card rounded-md border p-3">
            <div className="text-muted-foreground text-xs tracking-wide uppercase">
              Theoretical yield
            </div>
            <div className="font-mono text-xl font-semibold tabular-nums">
              {fmt((result.theoreticalYield ?? 1) * 100)}%
            </div>
            <div className="text-muted-foreground text-xs">good / (good + scrap)</div>
          </div>
        ) : null}
        {sustainShown ? (
          <>
            <div className="border-border bg-card rounded-md border p-3">
              <div className="text-muted-foreground text-xs tracking-wide uppercase">Energy</div>
              <div className="font-mono text-xl font-semibold tabular-nums">
                {fmt(energyKWh, energyKWh > 100 ? 0 : 1)}
              </div>
              <div className="text-muted-foreground text-xs">kWh total</div>
            </div>
            <div className="border-border bg-card rounded-md border p-3">
              <div className="text-muted-foreground text-xs tracking-wide uppercase">Water</div>
              <div className="font-mono text-xl font-semibold tabular-nums">
                {fmt(result.totalWaterL ?? 0, 1)}
              </div>
              <div className="text-muted-foreground text-xs">L total</div>
            </div>
            <div className="border-border bg-card rounded-md border p-3">
              <div className="text-muted-foreground text-xs tracking-wide uppercase">CO₂e</div>
              <div className="font-mono text-xl font-semibold tabular-nums">
                {fmt((result.totalCO2eG ?? 0) / 1000, 1)}
              </div>
              <div className="text-muted-foreground text-xs">kg total</div>
            </div>
          </>
        ) : null}
      </div>
    </details>
  );
}
