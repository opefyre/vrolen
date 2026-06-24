/**
 * VROL-675 — per-station OEE breakdown viz. Shows Availability × Performance
 * × Quality side-by-side so users can see which factor pulls a station's OEE
 * down. Stacked-segment design: each row is three colored bars whose widths
 * encode each sub-metric (0–100%).
 */

import type { ChainResult } from "@/engine";
import type { ReplicationSummary } from "@/lib/replications";
import { narrateOee } from "@/lib/narrate-oee";
import { GlossaryTerm } from "@/components/ui/glossary-term";

interface OeeBreakdownProps {
  readonly result: ChainResult;
  /** VROL-936 — when set, per-station rows show ± 95% CI half-widths. */
  readonly replicationSummary?: ReplicationSummary | null;
}

interface SegmentProps {
  readonly label: string;
  readonly pct: number;
  readonly colorClass: string;
  /** VROL-964 — wrap the label in a glossary tooltip when set. */
  readonly term?: string;
}

function Segment({ label, pct, colorClass, term }: SegmentProps) {
  const display = Math.round(pct * 100);
  return (
    <div className="flex-1 space-y-1">
      <div className="text-muted-foreground flex items-center justify-between text-[10px]">
        <span>{term ? <GlossaryTerm term={term}>{label}</GlossaryTerm> : label}</span>
        <span className="font-mono tabular-nums">{display}%</span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className={`${colorClass} h-full rounded-full transition-[width]`}
          style={{ width: `${String(Math.max(0, Math.min(100, display)))}%` }}
        />
      </div>
    </div>
  );
}

type ConstraintKey = "tempScrap" | "toolBlockedMs" | "bomStarved" | "skuRouted";

function getConstraint(result: ChainResult, idx: number, key: ConstraintKey): number {
  switch (key) {
    case "tempScrap":
      return result.perStationTempScrap?.[idx] ?? 0;
    case "toolBlockedMs":
      return result.perStationToolBlockedMs?.[idx] ?? 0;
    case "bomStarved":
      return result.perStationBomStarved?.[idx] ?? 0;
    case "skuRouted":
      return result.perStationSkuRouted?.[idx] ?? 0;
  }
}

function constraintLabel(key: ConstraintKey): string {
  switch (key) {
    case "tempScrap":
      return "Temp-spec scrap";
    case "toolBlockedMs":
      return "Tool-pool wait";
    case "bomStarved":
      return "BOM-starved";
    case "skuRouted":
      return "SKU-routed";
  }
}

function constraintTitle(key: ConstraintKey): string {
  switch (key) {
    case "tempScrap":
      return "Parts whose temperature fell outside the station's tempSpec window after the station's stationDeltaC was applied. Scrapped at this station.";
    case "toolBlockedMs":
      return "Total milliseconds this station spent Starved waiting for a unit from its shared tool pool (requiredToolPool). Direct loss vs. a dedicated tool.";
    case "bomStarved":
      return "Cycle attempts blocked because the station's bomFeeders entry had insufficient quantity on its feeder edge. Count of starvation events, not duration.";
    case "skuRouted":
      return "Completed parts whose productId matched an entry in this station's perSkuRouting. Currently a counter — full per-SKU dispatch is a follow-up.";
  }
}

function formatConstraint(key: ConstraintKey, value: number): string {
  if (key === "toolBlockedMs") return `${(value / 1000).toFixed(1)}s`;
  return value.toLocaleString();
}

const CONSTRAINT_KEYS: ConstraintKey[] = ["tempScrap", "toolBlockedMs", "bomStarved", "skuRouted"];

export function OeeBreakdown({ result, replicationSummary }: OeeBreakdownProps) {
  if (result.perStationOee.length === 0) return null;

  // VROL-925 — Sprint 91 constraint rows. Hidden when every station has
  // zero on a given counter, so legacy lines stay uncluttered.
  const visibleConstraints = CONSTRAINT_KEYS.filter((k) =>
    result.perStationOee.some((_, idx) => getConstraint(result, idx, k) > 0),
  );

  // VROL-936 — per-station replication CI lookup.
  const ciByIdx = new Map((replicationSummary?.perStation ?? []).map((p) => [p.idx, p]));

  // VROL-952 — plain-language summary derived from the run.
  const narration = narrateOee(result);
  // VROL-897 — Both perStationLabels and perStationRunningPct are now emitted
  // by runChain in topology order, aligned by index with perStationOee.
  // The legacy fallback to result.bottlenecks[idx] (sorted DESC by runningPct)
  // mis-aligned label + util to the bars; only kept as a defensive fallback
  // for tests that hand-craft a partial ChainResult without the new fields.
  return (
    <div className="space-y-3" data-testid="oee-breakdown">
      {narration.length > 0 ? (
        <div
          className="border-border bg-card/50 text-foreground/90 space-y-1 rounded-md border p-3 text-xs leading-relaxed"
          data-testid="oee-narration"
        >
          {narration.map((n) => (
            <p key={n.key}>{n.text}</p>
          ))}
        </div>
      ) : null}
      {result.perStationOee.map((oee, idx) => {
        const label =
          result.perStationLabels?.[idx] ??
          result.bottlenecks[idx]?.label ??
          `Station ${String(idx)}`;
        const total = Math.round(oee.oee * 100);
        const util = result.perStationRunningPct?.[idx] ?? result.bottlenecks[idx]?.runningPct ?? 0;
        const utilPct = Math.round(util * 100);
        const lowUtil = util < 0.7;
        const ci = ciByIdx.get(idx);
        const ciSuffix = (halfWidth: number): string => {
          if (!ci || halfWidth <= 0) return "";
          return ` ±${(halfWidth * 100).toFixed(1)}`;
        };
        return (
          <div
            key={`${label}-${String(idx)}`}
            className="border-border bg-card space-y-2 rounded-md border p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-foreground text-sm font-medium">{label}</span>
              <div className="flex items-center gap-3 font-mono text-sm tabular-nums">
                <span
                  className={lowUtil ? "text-sim-down-foreground" : "text-muted-foreground"}
                  title="Share of the measurement window the station was actually in the Running state. Independent of OEE — captures starvation + blocking too."
                >
                  Util {utilPct}%
                </span>
                <span title="Availability × Performance × Quality. Measures losses while the station is allowed to run — does NOT include starvation / blocking.">
                  OEE {total}%{ciSuffix(ci?.halfWidth95Oee ?? 0)}
                </span>
              </div>
            </div>
            {lowUtil ? (
              <p className="text-muted-foreground text-[11px]">
                OEE looks high because it ignores starvation + blocking. This station only ran{" "}
                <span className="text-foreground font-mono tabular-nums">{utilPct}%</span> of the
                window — feeding it faster (or trimming downstream) is what would lift line
                throughput here.
              </p>
            ) : null}
            <div className="flex gap-3">
              <Segment
                label={`Availability${ciSuffix(ci?.halfWidth95Availability ?? 0)}`}
                pct={oee.availability}
                colorClass="bg-sim-running"
                term="availability"
              />
              <Segment
                label={`Performance${ciSuffix(ci?.halfWidth95Performance ?? 0)}`}
                pct={oee.performance}
                colorClass="bg-sim-setup"
                term="performance"
              />
              <Segment
                label={`Quality${ciSuffix(ci?.halfWidth95Quality ?? 0)}`}
                pct={oee.quality}
                colorClass="bg-sim-maintenance"
                term="quality"
              />
            </div>
            {visibleConstraints.length > 0 && (
              <div
                className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[10px]"
                data-testid="oee-constraints"
              >
                {visibleConstraints.map((key) => {
                  const v = getConstraint(result, idx, key);
                  if (v === 0) return null;
                  return (
                    <span key={key} title={constraintTitle(key)}>
                      {constraintLabel(key)}:{" "}
                      <span className="text-foreground font-mono tabular-nums">
                        {formatConstraint(key, v)}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
