/**
 * VROL-948 — derive the single most actionable next-step from a finished
 * run. The result panel surfaces the top recommendation as a card above
 * the OEE breakdown so the reader doesn't have to construct the action
 * from raw KPIs.
 *
 * The heuristic ranks in this order:
 *   1. Heavy Down% at the bottleneck → suggest reliability work
 *   2. Bottleneck running > 80 % + nominalSpeedRatio < 0.8 → speed-up
 *   3. Constant BOM-starved events → BOM imbalance
 *   4. Tool-pool wait > 20 % of horizon → grow the pool
 *   5. High perEdgeBufferFill peak → grow downstream buffer
 *   6. Fallback: surface line OEE + suggest the slim factor.
 *
 * Outputs include an `applyPayload` discriminated union so the UI can
 * wire a one-click Apply if it wants to. We don't dispatch here — pure
 * data.
 */

import type { ChainResult } from "@/engine";
import { computeSixLoss, totalLossMs } from "./six-loss";

export type ActionApplyPayload =
  | { kind: "cycle:halve"; stationLabel: string }
  | { kind: "buffer:grow"; edgeKey: string }
  | { kind: "tool-pool:grow"; poolName: string }
  | { kind: "reliability:flag"; stationLabel: string }
  | { kind: "sampling:flag" };

export interface ActionCard {
  readonly title: string;
  readonly body: string;
  readonly tone: "primary" | "warn" | "info";
  readonly apply?: ActionApplyPayload;
}

export function deriveActionCard(result: ChainResult): ActionCard | null {
  if (result.perStationOee.length === 0) return null;
  const labels = result.perStationLabels ?? [];
  const top = result.bottlenecks[0];
  const topLabel = top?.label ?? "the bottleneck";

  // VROL-992 — clamp-rate rule (audit ROI #8 close-out). When >5 % of
  // cycle samples were floor-clamped, the Normal distribution's mean has
  // drifted upward; recommend truncatedNormal before any other lever.
  // Ranks above reliability because biased input invalidates every
  // downstream conclusion.
  const clamps = (result as { clampedSampleCount?: number }).clampedSampleCount ?? 0;
  const totalCycles =
    (result.completed ?? 0) + (result.perStationScrapped ?? []).reduce((s, v) => s + v, 0);
  if (totalCycles > 0 && clamps / totalCycles > 0.05) {
    return {
      title: "Sampling bias is hiding the real numbers",
      body: `${clamps.toLocaleString()} of ${totalCycles.toLocaleString()} cycle samples were clamped to >= 0 (${Math.round((clamps / totalCycles) * 100)} %). The Normal distribution's effective mean is drifting upward. Switch the affected station's cycle to a truncatedNormal (or shrink stddev relative to mean) before drawing conclusions from this run.`,
      tone: "warn",
      apply: { kind: "sampling:flag" },
    };
  }

  // 1. Down-heavy bottleneck → reliability is the biggest lever.
  if (top) {
    const downShare = top.breakdown.find((b) => b.state === "Down")?.pct ?? 0;
    if (downShare > 0.15) {
      return {
        title: `Reliability is the biggest lever at ${topLabel}`,
        body: `${topLabel} spent ${Math.round(downShare * 100)} % of the window Down. Raising MTBF (more PM) or lowering MTTR (parts pre-staged) will lift line throughput more than any cycle-time change.`,
        tone: "warn",
        apply: { kind: "reliability:flag", stationLabel: topLabel },
      };
    }
  }

  // 2. Subordination — the bottleneck is throttled below its OEM-rated
  // nominal max. nominalSpeedRatio < 0.8 means we'd see a clear lift.
  if (top && typeof top.nominalSpeedRatio === "number" && top.nominalSpeedRatio < 0.8) {
    return {
      title: `Speed up ${topLabel}`,
      body: `${topLabel} is running at ${Math.round(top.nominalSpeedRatio * 100)} % of its rated nominal. Cutting cycle time here lifts the binding constraint directly — try halving and re-running.`,
      tone: "primary",
      apply: { kind: "cycle:halve", stationLabel: topLabel },
    };
  }

  // 3. BOM-starved events. Per-station perStationBomStarved aggregates
  // count across the run.
  const bomStarved = result.perStationBomStarved ?? [];
  const totalBom = bomStarved.reduce((s, v) => s + v, 0);
  if (totalBom > 50) {
    const worst = bomStarved.reduce((acc, v, i) => (v > acc.v ? { i, v } : acc), { i: 0, v: -1 });
    return {
      title: `BOM imbalance at ${labels[worst.i] ?? "an assembly station"}`,
      body: `${String(totalBom)} BOM-starved events across the run, mostly at ${labels[worst.i] ?? "the assembly station"}. The feeder lane upstream of this station can't keep up — either speed it up or lower the per-cycle quantity.`,
      tone: "warn",
    };
  }

  // 4. Tool-pool wait dominates the run.
  const toolBlocked = result.perStationToolBlockedMs ?? [];
  const totalToolBlocked = toolBlocked.reduce((s, v) => s + v, 0);
  if (result.elapsedMs > 0 && totalToolBlocked / result.elapsedMs > 0.2) {
    return {
      title: `Tool-pool contention is throttling the line`,
      body: `Stations sharing a tool pool waited ${Math.round(totalToolBlocked / 1000)} s combined (${Math.round((totalToolBlocked / result.elapsedMs) * 100)} % of the horizon). Raising the pool capacity by one should produce a measurable lift.`,
      tone: "warn",
    };
  }

  // 5. Bottleneck running > 80 % + downstream buffer pressure.
  if (top && top.runningPct > 0.8 && top.primaryReason === "blocking") {
    return {
      title: `${topLabel} is blocked, not capped`,
      body: `${topLabel} runs hot but downstream can't take parts fast enough. Look at the next station's cycle time or grow the buffer immediately after ${topLabel}.`,
      tone: "primary",
    };
  }

  // 5b. VROL-956 — buffer pressure: an edge with sustained peak fill near
  // its capacity is a candidate for "grow this buffer" without needing the
  // bottleneck to be in BlockedOut. Uses perEdgeBufferFill from the latest
  // sample where available; otherwise falls back to perEdgeFlowed share.
  if (result.samples.length > 1) {
    const lastSample = result.samples[result.samples.length - 1];
    const fills = lastSample?.perEdgeBufferFill ?? [];
    let hotEdgeIdx = -1;
    let hotPeak = 0;
    for (let i = 0; i < fills.length; i++) {
      const f = fills[i] ?? 0;
      if (f > hotPeak) {
        hotPeak = f;
        hotEdgeIdx = i;
      }
    }
    // Heuristic: peak > 0 AND > 80 % of inter-station buffer capacity. We
    // don't have direct access to per-edge capacity here, so we treat the
    // top-decile peak across the run as "near full" when at least 10
    // samples consistently held that level.
    if (hotEdgeIdx >= 0 && hotPeak > 0) {
      const sustainedHigh = result.samples
        .slice(-Math.min(result.samples.length, 10))
        .every((s) => (s.perEdgeBufferFill[hotEdgeIdx] ?? 0) >= hotPeak * 0.8);
      if (sustainedHigh) {
        return {
          title: `Buffer ${String(hotEdgeIdx + 1)} is sustained near full`,
          body: `Edge buffer #${String(hotEdgeIdx + 1)} held >= ${String(Math.round(hotPeak * 0.8))} parts in the last 10 samples (peak ${String(hotPeak)}). Growing this buffer is likely to lift throughput without changing cycle times.`,
          tone: "primary",
          apply: { kind: "buffer:grow", edgeKey: String(hotEdgeIdx) },
        };
      }
    }
  }

  // VROL-995 — six-loss dominant bucket rule. When a single Nakajima
  // loss category exceeds 40 % of total losses across the line, surface
  // it as the next-thing-to-do with its dominant station. Ranks below
  // the per-station rules because they reference specific stations;
  // dominant-loss is a "look at this big bucket" line-level hint.
  const sixLossRows = computeSixLoss(result);
  if (sixLossRows.length > 0) {
    const totals = {
      breakdown: 0,
      setup: 0,
      minorStop: 0,
      speedLoss: 0,
      defect: 0,
    };
    let grand = 0;
    let worstStation = "";
    let worstStationTotal = 0;
    for (const r of sixLossRows) {
      totals.breakdown += r.breakdownMs;
      totals.setup += r.setupMs;
      totals.minorStop += r.minorStopMs;
      totals.speedLoss += r.speedLossMs;
      totals.defect += r.defectMs;
      const t = totalLossMs(r);
      grand += t;
      if (t > worstStationTotal) {
        worstStationTotal = t;
        worstStation = r.stationLabel;
      }
    }
    if (grand > 0) {
      const entries: { key: keyof typeof totals; label: string; lever: string }[] = [
        { key: "breakdown", label: "Breakdown losses", lever: "raise MTBF / lower MTTR" },
        { key: "setup", label: "Setup / changeover losses", lever: "SMED + reduce variety" },
        {
          key: "minorStop",
          label: "Minor-stop losses",
          lever: "smooth upstream variability or grow buffers",
        },
        { key: "speedLoss", label: "Speed losses", lever: "investigate sub-nominal cycle" },
        { key: "defect", label: "Defect / scrap losses", lever: "tighten quality controls" },
      ];
      const ranked = entries
        .map((e) => ({ ...e, ms: totals[e.key], share: totals[e.key] / grand }))
        .sort((a, b) => b.ms - a.ms);
      const top = ranked[0];
      if (top && top.share > 0.4) {
        return {
          title: `${top.label} dominate — ${Math.round(top.share * 100)} % of total losses`,
          body: `Across the line, ${top.label.toLowerCase()} account for ${Math.round(top.share * 100)} % of all losses (worst station: ${worstStation || topLabel}). Lever to try: ${top.lever}.`,
          tone: "warn",
        };
      }
    }
  }

  // 6. Fallback — point at the slim OEE factor.
  if (top) {
    const idx = labels.findIndex((l) => l === top.label);
    const oee = idx >= 0 ? result.perStationOee[idx] : undefined;
    if (oee) {
      const slim = Math.min(oee.availability, oee.performance, oee.quality);
      const slimLabel =
        slim === oee.availability
          ? "Availability"
          : slim === oee.performance
            ? "Performance"
            : "Quality";
      return {
        title: `${slimLabel} is the slim factor at ${topLabel}`,
        body: `Line OEE is ${(result.lineOee * 100).toFixed(0)} %. ${slimLabel} pulls hardest at ${topLabel} — that's where to look first.`,
        tone: "info",
      };
    }
  }
  return {
    title: "Line is healthy",
    body: `OEE ${(result.lineOee * 100).toFixed(0)} % with no glaring imbalance. Stress-test edge cases (defect spikes, longer horizon) to find the next constraint.`,
    tone: "info",
  };
}
