/**
 * Result-panel cards (VROL-625 code-split).
 *
 * Extracted from EditorPage.tsx into its own module so the cards + charts
 * that only render after a run can be lazy-loaded behind a Suspense fallback,
 * shrinking the first-paint editor chunk. ResultPanel is the default export
 * and exposes the same shape KpiStrip had inline.
 */

import {
  Activity,
  Award,
  Boxes,
  Layers,
  Lightbulb,
  Link as LinkIcon,
  PieChart,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import type { ChainResult } from "@/engine";
import { asMaterialId } from "@/engine";
import { Accordion, AccordionStatus } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { narrateRun } from "@/lib/narrate-run";
import { toast } from "@/lib/toast";

import { OeeOverTimeChart } from "./OeeOverTimeChart";
import { ReworkOverTimeChart } from "./ReworkOverTimeChart";
import { cycleStats } from "@/lib/cycle-stats";

import { BufferSummary } from "./BufferSummary";
import { FinalStateCard } from "./FinalStateCard";
import { OeeBreakdown } from "./OeeBreakdown";
import { QualityLosses } from "./QualityLosses";
import { RecommendationsCard } from "./RecommendationsCard";
import { StatePareto } from "./StatePareto";
import { ThroughputChart } from "./ThroughputChart";

const BOTTLES_ID = asMaterialId("bottles");
const CAPS_ID = asMaterialId("caps");

const REASON_HINT: Record<string, string> = {
  starvation:
    "upstream isn't feeding it fast enough — speed up the feeder, add buffer capacity, or accept the chain rate.",
  blocking:
    "downstream can't keep up — speed up the downstream station, add buffer capacity, or accept the upstream rate.",
  breakdown: "stochastic failures are dominating — raise MTBF or reduce MTTR.",
  setup: "setup / changeover overhead is dominating — reduce setup time or batch products.",
  maintenance: "planned maintenance is dominating — schedule fewer or shorter windows.",
  idle: "this station hasn't been needed — the chain may be over-provisioned at this point.",
  running: "this station is running near full capacity.",
};

interface ResultPanelRunMeta {
  readonly stationLabels: readonly string[];
}

interface ResultPanelProps {
  readonly result: ChainResult;
  readonly runMeta: ResultPanelRunMeta;
  readonly horizonMs: number;
  readonly warmupMs: number;
  /** VROL-690 — pan+zoom canvas to a station by chain-order index. */
  readonly onFocusStation?: (stationIdx: number) => void;
}

/**
 * VROL-681 — section title with a clickable anchor link icon. Clicking
 * copies the deep-link URL to the user's clipboard for sharing.
 */
function AnchorTitle({
  anchorId,
  children,
}: {
  readonly anchorId: string;
  readonly children: React.ReactNode;
}) {
  const onClick = (): void => {
    if (typeof window === "undefined") return;
    const href = `${window.location.origin}${window.location.pathname}#${anchorId}`;
    if (typeof window.history?.replaceState === "function") {
      window.history.replaceState(null, "", `#${anchorId}`);
    }
    try {
      void navigator.clipboard?.writeText(href);
      toast.success("Link copied", { description: anchorId });
    } catch {
      toast.message("Link", { description: href });
    }
  };
  return (
    <span className="group inline-flex items-center gap-1.5">
      <span>{children}</span>
      <button
        type="button"
        onClick={onClick}
        aria-label={`Copy link to ${anchorId}`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring opacity-0 transition-opacity group-hover:opacity-100 focus-visible:rounded focus-visible:opacity-100 focus-visible:ring-2"
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function stateColor(state: string): string {
  switch (state) {
    case "Running":
      return "bg-sim-running";
    case "Starved":
      return "bg-sim-starved";
    case "BlockedOut":
      return "bg-sim-blocked";
    case "Down":
      return "bg-sim-down";
    case "Setup":
      return "bg-sim-setup";
    case "Maintenance":
      return "bg-sim-maintenance";
    case "Idle":
    default:
      return "bg-sim-idle";
  }
}

/** Inner body for the product-mix accordion (no Card wrapper of its own). */
function ProductMixBody({ result }: { result: ChainResult }) {
  const entries = [...(result.perProductCompleted?.entries() ?? [])].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="space-y-2">
      {entries.map(([productId, n]) => {
        const pct = total > 0 ? (n / total) * 100 : 0;
        return (
          <div key={productId} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-foreground/80">{productId}</span>
              <span className="font-mono tabular-nums">
                {n.toLocaleString()} ({pct.toFixed(1)}%)
              </span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className="bg-sim-running h-full rounded-full"
                style={{ width: `${String(pct)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InsightsBanner({ result }: { result: ChainResult }) {
  const sentences = narrateRun(result);
  if (sentences.length === 0) return null;
  // VROL-684 — copy narrative as markdown bullet list.
  const copyMarkdown = (): void => {
    const md = sentences.map((s) => `- ${s}`).join("\n");
    try {
      void navigator.clipboard?.writeText(md);
      toast.success("Insights copied as markdown");
    } catch {
      toast.error("Copy failed", { description: "Clipboard not available" });
    }
  };
  return (
    <Card aria-label="Run insights" className="border-sim-running/40 bg-sim-running/5 border-l-4">
      <CardContent className="flex items-start gap-3 py-3">
        <Lightbulb className="text-sim-running mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <ul className="space-y-1 text-sm leading-snug">
          {sentences.map((s, i) => (
            <li key={i} className="text-foreground/90">
              {s}
            </li>
          ))}
        </ul>
        <button
          type="button"
          aria-label="Copy insights as markdown"
          onClick={copyMarkdown}
          className="text-muted-foreground hover:text-foreground ml-auto shrink-0 text-xs underline-offset-2 hover:underline"
        >
          Copy MD
        </button>
      </CardContent>
    </Card>
  );
}

function BottleneckExplanationCard({
  result,
  bottleneckStationIdx,
  onFocusStation,
}: {
  readonly result: ChainResult;
  readonly bottleneckStationIdx?: number;
  readonly onFocusStation?: (stationIdx: number) => void;
}) {
  if (result.bottlenecks.length === 0) return null;
  const sorted = [...result.bottlenecks].sort((a, b) => b.runningPct - a.runningPct);
  const head = sorted[0];
  if (!head) return null;

  const fmtPct = (pct: number) => (pct * 100).toLocaleString("en-US", { maximumFractionDigits: 1 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading flex items-center justify-between gap-2 text-base">
          <span>Bottleneck analysis</span>
          {/* VROL-690 — click-to-zoom on the bottleneck station. */}
          {onFocusStation && typeof bottleneckStationIdx === "number" ? (
            <button
              type="button"
              onClick={() => {
                onFocusStation(bottleneckStationIdx);
              }}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
            >
              Locate on canvas
            </button>
          ) : null}
        </CardTitle>
        <CardDescription>Where the line is constrained.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          <p>
            <strong>{head.label ?? String(head.stationId)}</strong> is the constraint —{" "}
            <span className="font-mono tabular-nums">{fmtPct(head.runningPct)}%</span> of time spent
            Running. Whatever drives this station's rate caps the line.
          </p>
          {sorted.slice(1).map((b) => {
            const hint = REASON_HINT[b.primaryReason] ?? "";
            return (
              <p key={String(b.stationId)} className="text-muted-foreground">
                <strong className="text-foreground">{b.label ?? String(b.stationId)}</strong> spends{" "}
                <span className="font-mono tabular-nums">{fmtPct(b.primaryReasonPct)}%</span> in{" "}
                <span className="font-medium">{b.primaryReason}</span> — {hint}
              </p>
            );
          })}
          <p className="text-muted-foreground border-border border-t pt-2">
            <strong className="text-foreground">Recommendation:</strong>{" "}
            {head.primaryReason === "running"
              ? `Speed up ${head.label ?? "the bottleneck"} (lower its cycle time) to lift the entire chain. Other stations have idle capacity.`
              : `Reduce ${head.primaryReason} on ${head.label ?? "the bottleneck"} — that's its dominant non-Running state.`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function ResultPanel({
  result,
  runMeta,
  horizonMs,
  warmupMs,
  onFocusStation,
}: ResultPanelProps) {
  // VROL-720 — help-link anchor mapping. Routes to /help (same-tab) with a
  // hash so the matching definition scrolls into view.
  const helpAnchor = (label: string): string | null => {
    const map: Record<string, string> = {
      Completed: "/help",
      Throughput: "/help",
      "Line OEE": "/help",
      "Time-in-system": "/help",
    };
    return map[label] ?? null;
  };
  const tile = (label: string, value: string, hint?: string) => {
    const href = helpAnchor(label);
    return (
      <div className="border-border bg-card relative overflow-hidden rounded-md border p-3">
        {/* Backdrop sparklines were removed — they had no axis context
            and confused readers. The Throughput tab shows the proper
            chart with labeled axes. */}
        <div className="text-muted-foreground flex items-center justify-between text-xs tracking-wide uppercase">
          <span>{label}</span>
          {href ? (
            <a
              href={href}
              aria-label={`What is ${label}?`}
              className="hover:text-foreground rounded-full px-1 text-[10px]"
              title="Open glossary"
            >
              ?
            </a>
          ) : null}
        </div>
        <div className="font-mono text-xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div> : null}
      </div>
    );
  };
  const throughputPerHour = result.throughputLambda * 3_600_000;
  const fmt = (n: number, digits = 1) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const totalScrapped = result.perStationScrapped.reduce((a, b) => a + b, 0);
  const totalReworked = result.perStationReworked.reduce((a, b) => a + b, 0);
  const totalBreakdowns = (result.perStationBreakdowns ?? []).reduce((a, b) => a + b, 0);
  // Per-tab content is shown directly — each tab is single-topic, so an
  // outer accordion would be a redundant toggle layer.
  // Only show the rework chart when at least one station had rework AND the
  // sampler ran. Otherwise the section is pointless noise.
  const reworkActiveStationCount = result.perStationReworked.reduce(
    (n, c) => n + (c > 0 ? 1 : 0),
    0,
  );
  const showReworkChart = reworkActiveStationCount > 0 && result.samples.length >= 2;
  const finalByMat = result.materialFinal ? new Map(result.materialFinal) : null;
  const finalBottles = finalByMat?.get(BOTTLES_ID) ?? null;
  const finalCaps = finalByMat?.get(CAPS_ID) ?? null;
  const hasMaterials = result.materialFinal !== undefined;
  const hasBreakdowns = result.perStationBreakdowns !== undefined;
  const hasLabor = result.laborUtilization !== undefined;
  // Tabbed drill-down. Default to Overview (the actionable view).
  type TabId = "overview" | "throughput" | "oee" | "states" | "quality" | "buffers" | "stations";
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const tabs: { id: TabId; label: string; icon: typeof Activity }[] = [
    { id: "overview", label: "Overview", icon: Lightbulb },
    { id: "throughput", label: "Throughput", icon: Activity },
    { id: "oee", label: "OEE", icon: Award },
    { id: "states", label: "States", icon: PieChart },
    { id: "quality", label: "Quality", icon: ShieldCheck },
    { id: "buffers", label: "Buffers", icon: Boxes },
    { id: "stations", label: "Stations", icon: Layers },
  ];
  return (
    <div className="space-y-3">
      <InsightsBanner result={result} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tile("Completed", result.completed.toLocaleString(), "during measurement window")}
        {tile("Throughput", fmt(throughputPerHour, 0), "parts / hour")}
        {tile("Line OEE", `${fmt(result.lineOee * 100)}%`, "geometric mean")}
        {tile("Time-in-system", `${fmt(result.avgTimeInSystemW, 0)} ms`, "average W per part")}
      </div>

      {/* Tab strip — replaces the previous wall of stacked cards with
          progressive disclosure. Each tab renders a single focused view
          below; the user picks what they want to see. */}
      <div
        role="tablist"
        aria-label="Result details"
        className="border-border bg-card flex flex-wrap gap-1 overflow-x-auto rounded-md border p-1"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setActiveTab(t.id);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-sim-running/15 text-sim-running"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>
      {/* Cycle-time stats line shown only on the Overview + Stations tabs
          (it's a headline number, not chart-y). */}
      {activeTab === "overview" || activeTab === "stations"
        ? (() => {
            const cs = cycleStats(result);
            if (cs.meanMs === 0) return null;
            return (
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span>
                  <strong className="text-foreground font-mono">{fmt(cs.medianMs, 0)} ms</strong>{" "}
                  median cycle
                </span>
                <span>
                  <strong className="text-foreground font-mono">{fmt(cs.meanMs, 0)} ms</strong> mean
                </span>
                <span>
                  <strong className="text-foreground font-mono">{fmt(cs.minMs, 0)} ms</strong> min ·{" "}
                  <strong className="text-foreground font-mono">{fmt(cs.maxMs, 0)} ms</strong> max
                </span>
              </div>
            );
          })()
        : null}
      {activeTab === "stations" ? (
        <Card id="per-station-completed">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="per-station-completed">Per-station completed</AnchorTitle>
            </CardTitle>
            <CardDescription>{`${String(result.perStationCompleted.length)} station${
              result.perStationCompleted.length === 1 ? "" : "s"
            } during the measurement window.`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.perStationCompleted.map((count, i) => {
              const label = runMeta.stationLabels[i] ?? `Station ${String(i + 1)}`;
              const max = Math.max(...result.perStationCompleted, 1);
              const pct = (count / max) * 100;
              const scrap = result.perStationScrapped[i] ?? 0;
              const rework = result.perStationReworked[i] ?? 0;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-foreground/80">{label}</span>
                    <span className="font-mono tabular-nums">
                      {count.toLocaleString()}
                      {scrap > 0 ? (
                        <span className="text-sim-down-foreground ml-2 text-xs">
                          · {scrap.toLocaleString()} scrap
                        </span>
                      ) : null}
                      {rework > 0 ? (
                        <span className="text-sim-setup-foreground ml-2 text-xs">
                          · {rework.toLocaleString()} rework
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-sim-running h-full rounded-full transition-[width]"
                      style={{ width: `${String(pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "overview" ? (
        <>
          <BottleneckExplanationCard
            result={result}
            bottleneckStationIdx={result.bottleneckStationIdx}
            {...(onFocusStation ? { onFocusStation } : {})}
          />
          <Card id="recommendations">
            <CardHeader>
              <CardTitle className="font-heading text-base">
                <AnchorTitle anchorId="recommendations">Recommendations</AnchorTitle>
              </CardTitle>
              <CardDescription>Ranked by expected impact on throughput.</CardDescription>
            </CardHeader>
            <CardContent>
              <RecommendationsCard result={result} />
            </CardContent>
          </Card>
          <Card id="final-state-overview">
            <CardHeader>
              <CardTitle className="font-heading text-base">Final state</CardTitle>
              <CardDescription>Each station's dominant state at horizon end.</CardDescription>
            </CardHeader>
            <CardContent>
              <FinalStateCard result={result} stationLabels={runMeta.stationLabels} />
            </CardContent>
          </Card>
        </>
      ) : null}

      {activeTab === "states" ? (
        <Card id="state-pareto">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="state-pareto">State Pareto</AnchorTitle>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatePareto result={result} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "oee" ? (
        <Card id="oee-breakdown">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="oee-breakdown">OEE breakdown</AnchorTitle>
            </CardTitle>
            <CardDescription>
              Availability × Performance × Quality per station. The slim factor is the lever.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OeeBreakdown result={result} />
          </CardContent>
        </Card>
      ) : null}

      {/* Quality losses: only on the Quality tab (auto-hides anyway when zero). */}
      {activeTab === "quality" &&
      result.perStationScrapped.reduce((a, b) => a + b, 0) +
        result.perStationReworked.reduce((a, b) => a + b, 0) >
        0 ? (
        <Card id="quality-losses">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="quality-losses">Quality losses</AnchorTitle>
            </CardTitle>
            <CardDescription>Scrap (red) + rework (yellow) per station.</CardDescription>
          </CardHeader>
          <CardContent>
            <QualityLosses result={result} stationLabels={runMeta.stationLabels} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "buffers" ? (
        <Card id="buffer-summary">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="buffer-summary">Buffer fill</AnchorTitle>
            </CardTitle>
            <CardDescription>Average + peak fill per inter-station edge.</CardDescription>
          </CardHeader>
          <CardContent>
            <BufferSummary result={result} />
          </CardContent>
        </Card>
      ) : null}

      {/* Final-state card now lives only in the Overview tab (rendered earlier). */}

      {activeTab === "throughput" ? (
        <Card id="throughput">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="throughput">Throughput over time</AnchorTitle>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ThroughputChart samples={result.samples} horizonMs={horizonMs} warmupMs={warmupMs} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "oee" ? (
        <Card id="bottleneck-state">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="bottleneck-state">Bottleneck state over time</AnchorTitle>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <OeeOverTimeChart
              samples={result.samples}
              stationLabels={runMeta.stationLabels}
              bottleneckStationIdx={result.bottleneckStationIdx}
              horizonMs={horizonMs}
              warmupMs={warmupMs}
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "quality" && showReworkChart ? (
        <Card id="rework-over-time">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="rework-over-time">Rework over time</AnchorTitle>
            </CardTitle>
            <CardDescription>{`Cumulative rework across ${String(reworkActiveStationCount)} station${
              reworkActiveStationCount === 1 ? "" : "s"
            }.`}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReworkOverTimeChart
              samples={result.samples}
              stationLabels={runMeta.stationLabels}
              horizonMs={horizonMs}
              warmupMs={warmupMs}
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "stations" &&
      result.perProductCompleted &&
      result.perProductCompleted.size > 0 ? (
        <Card id="product-mix">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="product-mix">Product mix at sink</AnchorTitle>
            </CardTitle>
            <CardDescription>{`${String(result.perProductCompleted.size)} product${
              result.perProductCompleted.size === 1 ? "" : "s"
            } completed during the run.`}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProductMixBody result={result} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "states" ? (
        <Card id="per-station-state-breakdown">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              <AnchorTitle anchorId="per-station-state-breakdown">
                Per-station state breakdown
              </AnchorTitle>
            </CardTitle>
            <CardDescription>
              Time-weighted % per station across the measurement window.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {result.bottlenecks.map((b) => (
                <div key={String(b.stationId)} className="space-y-1">
                  <div className="text-foreground/80 text-sm">{b.label ?? String(b.stationId)}</div>
                  <div className="bg-muted flex h-2 overflow-hidden rounded-full">
                    {b.breakdown
                      .filter((seg) => seg.pct > 0.001)
                      .map((seg) => (
                        <div
                          key={seg.state}
                          title={`${seg.state}: ${(seg.pct * 100).toFixed(1)}%`}
                          className={`h-full ${stateColor(seg.state)}`}
                          style={{ width: `${String(seg.pct * 100)}%` }}
                        />
                      ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-muted-foreground mt-3 flex flex-wrap gap-2 text-xs">
              {["Running", "Setup", "Maintenance", "Down", "BlockedOut", "Starved", "Idle"].map(
                (state) => (
                  <span key={state} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-sm ${stateColor(state)}`} />
                    {state}
                  </span>
                ),
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {activeTab === "overview" &&
      (hasMaterials || hasBreakdowns || hasLabor || totalScrapped > 0 || totalReworked > 0) ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {finalBottles !== null
            ? tile(
                "Bottles left",
                finalBottles.toLocaleString(),
                finalBottles === 0 ? "depleted" : "of starting inventory",
              )
            : null}
          {finalCaps !== null
            ? tile(
                "Caps left",
                finalCaps.toLocaleString(),
                finalCaps === 0 ? "depleted" : "of starting inventory",
              )
            : null}
          {hasBreakdowns
            ? tile("Breakdowns", totalBreakdowns.toLocaleString(), "total across chain")
            : null}
          {result.replenishmentsFired !== undefined
            ? tile(
                "Replenishments",
                result.replenishmentsFired.toLocaleString(),
                "fired during run",
              )
            : null}
          {hasLabor
            ? tile(
                "Labor util",
                `${fmt((result.laborUtilization ?? 0) * 100, 1)}%`,
                "total worker-busy / capacity",
              )
            : null}
          {totalScrapped > 0
            ? tile(
                "Scrap",
                totalScrapped.toLocaleString(),
                `${fmt(result.lineScrapRate * 100, 1)}% line scrap rate`,
              )
            : null}
          {totalReworked > 0
            ? tile(
                "Rework",
                totalReworked.toLocaleString(),
                `${fmt(result.lineReworkRate * 100, 1)}% rerouted vs scrapped`,
              )
            : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Side-by-side scenario comparison (VROL-617 + 624). Rides in this module so
 * the chart components don't get pulled into the main editor chunk just to
 * support compare.
 */
export function ComparisonTable({
  aName,
  aResult,
  aStationLabels,
  bName,
  bResult,
  bStationLabels,
  horizonMs,
  warmupMs,
}: {
  aName: string;
  aResult: ChainResult;
  aStationLabels: readonly string[];
  bName: string;
  bResult: ChainResult;
  bStationLabels: readonly string[];
  horizonMs: number;
  warmupMs: number;
}) {
  const fmt = (n: number, digits = 1) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  // VROL-653 — collapse the dense scalar table behind an accordion. KPI delta
  // tiles + charts stay always-visible at the top.
  const [allDeltasOpen, setAllDeltasOpen] = useState(false);

  type Row = {
    label: string;
    a: number;
    b: number;
    fmt: (n: number) => string;
    higherIsBetter: boolean;
    hideDiffWhenZero?: boolean;
  };
  const rows: Row[] = [
    {
      label: "Completed",
      a: aResult.completed,
      b: bResult.completed,
      fmt: (n) => n.toLocaleString(),
      higherIsBetter: true,
    },
    {
      label: "Throughput (parts/hour)",
      a: aResult.throughputLambda * 3_600_000,
      b: bResult.throughputLambda * 3_600_000,
      fmt: (n) => fmt(n, 0),
      higherIsBetter: true,
    },
    {
      label: "Line OEE",
      a: aResult.lineOee,
      b: bResult.lineOee,
      fmt: (n) => `${fmt(n * 100)}%`,
      higherIsBetter: true,
    },
    {
      label: "Avg time-in-system (ms)",
      a: aResult.avgTimeInSystemW,
      b: bResult.avgTimeInSystemW,
      fmt: (n) => fmt(n, 0),
      higherIsBetter: false,
    },
    {
      label: "Line scrap rate",
      a: aResult.lineScrapRate,
      b: bResult.lineScrapRate,
      fmt: (n) => `${fmt(n * 100)}%`,
      higherIsBetter: false,
    },
  ];
  if (aResult.laborUtilization !== undefined || bResult.laborUtilization !== undefined) {
    rows.push({
      label: "Labor util",
      a: aResult.laborUtilization ?? 0,
      b: bResult.laborUtilization ?? 0,
      fmt: (n) => `${fmt(n * 100)}%`,
      higherIsBetter: true,
    });
  }

  const aHasSamples = aResult.samples.length > 1;
  const bHasSamples = bResult.samples.length > 1;
  const showChartRow = aHasSamples || bHasSamples;

  // VROL-653 — top-line KPI delta tiles (the 4 metrics users care about most).
  // VROL-679 — `higherIsBetter` lets us color deltas by *direction-aware*
  // semantics (down time-in-system = green, up time-in-system = red).
  const kpiTiles: readonly {
    readonly label: string;
    readonly a: number;
    readonly b: number;
    readonly fmtVal: (n: number) => string;
    readonly higherIsBetter: boolean;
  }[] = [
    {
      label: "Completed",
      a: aResult.completed,
      b: bResult.completed,
      fmtVal: (n: number) => n.toLocaleString(),
      higherIsBetter: true,
    },
    {
      label: "Throughput/h",
      a: aResult.throughputLambda * 3_600_000,
      b: bResult.throughputLambda * 3_600_000,
      fmtVal: (n: number) => fmt(n, 0),
      higherIsBetter: true,
    },
    {
      label: "Line OEE",
      a: aResult.lineOee,
      b: bResult.lineOee,
      fmtVal: (n: number) => `${fmt(n * 100)}%`,
      higherIsBetter: true,
    },
    {
      label: "Time-in-sys",
      a: aResult.avgTimeInSystemW,
      b: bResult.avgTimeInSystemW,
      fmtVal: (n: number) => `${fmt(n, 0)} ms`,
      higherIsBetter: false,
    },
  ];

  // VROL-745 — single-line ratio summary so the headline is the first thing the user reads.
  const ratioLine = (() => {
    const tA = aResult.throughputLambda * 3_600_000;
    const tB = bResult.throughputLambda * 3_600_000;
    if (tA <= 0) return null;
    const ratio = tB / tA;
    const pct = (ratio * 100).toFixed(0);
    return ratio >= 1
      ? `B delivers ${pct}% of A's throughput (▲ ${((ratio - 1) * 100).toFixed(0)}% better).`
      : `B delivers ${pct}% of A's throughput (▼ ${((1 - ratio) * 100).toFixed(0)}% worse).`;
  })();

  return (
    <div className="space-y-4">
      {ratioLine ? <p className="text-foreground/80 text-sm">{ratioLine}</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpiTiles.map((t) => {
          const delta = t.b - t.a;
          const pctDelta = t.a !== 0 ? (delta / Math.abs(t.a)) * 100 : 0;
          const isUp = delta > 0;
          // VROL-679 — direction-aware coloring. For time-in-system, ▼ is good.
          const betterForB = t.higherIsBetter ? delta > 0 : delta < 0;
          const colorClass =
            delta === 0
              ? "text-muted-foreground"
              : betterForB
                ? "text-sim-running-foreground"
                : "text-sim-down-foreground";
          return (
            <div key={t.label} className="border-border bg-card rounded-md border p-3">
              <div className="text-muted-foreground text-xs tracking-wide uppercase">{t.label}</div>
              <div className="font-mono text-base font-semibold tabular-nums">{t.fmtVal(t.b)}</div>
              <div className={`mt-0.5 text-xs ${colorClass}`}>
                {delta === 0
                  ? `= ${t.fmtVal(t.a)}`
                  : `${isUp ? "▲" : "▼"} ${t.fmtVal(Math.abs(delta))}${
                      t.a !== 0 ? ` (${fmt(pctDelta, 0)}%)` : ""
                    } vs A`}
              </div>
            </div>
          );
        })}
      </div>
      <Accordion
        title="All scalar deltas"
        status={
          <AccordionStatus tone="configured">
            {`${String(rows.length)} metric${rows.length === 1 ? "" : "s"} · B vs A`}
          </AccordionStatus>
        }
        expanded={allDeltasOpen}
        onToggle={() => {
          setAllDeltasOpen((v) => !v);
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs tracking-wide uppercase">
                <th className="py-2 pr-3 font-medium">Metric</th>
                <th className="px-3 py-2 text-right font-medium" title={aName}>
                  A · {aName.length > 12 ? `${aName.slice(0, 11)}…` : aName}
                </th>
                <th className="px-3 py-2 text-right font-medium">B · {bName}</th>
                <th className="py-2 pl-3 text-right font-medium">Δ (B−A)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const delta = row.b - row.a;
                const pctDelta = row.a !== 0 ? (delta / Math.abs(row.a)) * 100 : 0;
                const isUp = delta > 0;
                const betterForB = row.higherIsBetter ? delta > 0 : delta < 0;
                return (
                  <tr key={row.label} className="border-border/50 border-b last:border-0">
                    <td className="py-2 pr-3">{row.label}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {row.fmt(row.a)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {row.fmt(row.b)}
                    </td>
                    <td
                      className={`py-2 pl-3 text-right font-mono tabular-nums ${
                        delta === 0
                          ? "text-muted-foreground"
                          : betterForB
                            ? "text-sim-running-foreground"
                            : "text-sim-down-foreground"
                      }`}
                    >
                      {delta === 0 ? "0" : `${isUp ? "+" : ""}${row.fmt(delta)}`}
                      {row.a !== 0 && delta !== 0 ? (
                        <span className="text-muted-foreground ml-1">({fmt(pctDelta, 0)}%)</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Accordion>
      {showChartRow ? (
        <div className="space-y-3">
          <div className="border-border space-y-2 rounded-md border p-3">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Throughput over time
            </div>
            <ThroughputChart
              samples={aHasSamples ? aResult.samples : bResult.samples}
              {...(aHasSamples && bHasSamples ? { secondarySamples: bResult.samples } : {})}
              primaryLabel={`A · ${aName}`}
              secondaryLabel={`B · ${bName}`}
              horizonMs={horizonMs}
              warmupMs={warmupMs}
            />
            {!aHasSamples || !bHasSamples ? (
              <p className="text-muted-foreground text-[11px]">
                {!aHasSamples && !bHasSamples
                  ? "Enable Sample throughput over time in Run settings to compare curves."
                  : !aHasSamples
                    ? `A · ${aName} has no samples — showing only B.`
                    : `B · ${bName} has no samples — showing only A.`}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border-border space-y-2 rounded-md border p-3">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Bottleneck state · A · {aName}
              </div>
              <OeeOverTimeChart
                samples={aResult.samples}
                stationLabels={aStationLabels}
                bottleneckStationIdx={aResult.bottleneckStationIdx}
                horizonMs={horizonMs}
                warmupMs={warmupMs}
              />
            </div>
            <div className="border-border space-y-2 rounded-md border p-3">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Bottleneck state · B · {bName}
              </div>
              <OeeOverTimeChart
                samples={bResult.samples}
                stationLabels={bStationLabels}
                bottleneckStationIdx={bResult.bottleneckStationIdx}
                horizonMs={horizonMs}
                warmupMs={warmupMs}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ResultPanel;
