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

/**
 * VROL-1054 — ordinal helper for capacity-bump titles ("Add a 3rd
 * Filler"). Engine caps capacity at 10 so we only need 1-10.
 */
function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${String(n)}th`;
  switch (n % 10) {
    case 1:
      return `${String(n)}st`;
    case 2:
      return `${String(n)}nd`;
    case 3:
      return `${String(n)}rd`;
    default:
      return `${String(n)}th`;
  }
}

export type ActionApplyPayload =
  | { kind: "cycle:halve"; stationLabel: string }
  | { kind: "buffer:grow"; edgeKey: string }
  | { kind: "tool-pool:grow"; poolName: string }
  | { kind: "reliability:flag"; stationLabel: string }
  | { kind: "sampling:flag" }
  // VROL-998 — uniform cycle scale across every station (used by the
  // multi-lever goal-mode picker). Distinct from cycle:halve which
  // targets a single named station.
  | { kind: "cycle:scaleAll"; multiplier: number }
  // VROL-998 — additive bump to every named tool pool's capacity.
  // Distinct from tool-pool:grow which targets a single named pool.
  | { kind: "tool-pool:scaleAll"; delta: number }
  // VROL-1032 — multiplicative scale on energyPerCycleJ for a single
  // station. Lets the energy-hotspot action card move a real lever.
  | { kind: "energy:scale"; stationLabel: string; multiplier: number }
  // VROL-1041 — set the named station's parallel capacity. The
  // canonical TOC move when a single-server bottleneck is running
  // hot: add a second server (or third). Engine clamps capacity ∈
  // [1, 10], so the apply handler caps at 10.
  | { kind: "capacity:set"; stationLabel: string; capacity: number }
  // VROL-1044 — uniform additive bump to every station's capacity.
  // Used by multi-lever goal mode when capacityDelta > 0 is the
  // best path to the target. Engine clamps each station's cap at 10.
  | { kind: "capacity:scaleAll"; delta: number }
  /**
   * VROL-1103 — generic informational flag for rules that hint at a
   * setting elsewhere rather than mutate the scenario. Carries a
   * `hint` string the EditorPage handler shows as a toast.info, plus
   * an optional `stationLabel` for "this is about station X" framing.
   * Sprint 185 introduced six rules that all needed an info nudge;
   * sharing one payload kind keeps the union flat rather than adding
   * six near-identical variants.
   */
  | { kind: "tip:flag"; hint: string; stationLabel?: string };

export interface ActionCard {
  readonly title: string;
  readonly body: string;
  readonly tone: "primary" | "warn" | "info";
  readonly apply?: ActionApplyPayload;
}

/**
 * VROL-1010 — optional per-station inputs the engine doesn't carry on
 * ChainResult. perStationBatchSize is aligned with result.perStationOee
 * (and result.perStationLabels) and unlocks the batch-fire rule below.
 * Empty / missing → existing rules behave unchanged.
 */
export interface ActionCardOpts {
  readonly perStationBatchSize?: readonly number[];
}

export function deriveActionCard(
  result: ChainResult,
  opts: ActionCardOpts = {},
): ActionCard | null {
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

  // VROL-1010 — Batch-fire starvation. When the bottleneck is a
  // batch-fire station (batchSize > 1) AND its starved share is high,
  // the plate isn't filling fast enough. Two specific levers: raise
  // upstream rate OR shrink the batch.
  if (top && opts.perStationBatchSize) {
    const idx = labels.findIndex((l) => l === top.label);
    const bs = idx >= 0 ? (opts.perStationBatchSize[idx] ?? 1) : 1;
    if (bs > 1) {
      const starvedShare = top.breakdown.find((b) => b.state === "Starved")?.pct ?? 0;
      if (starvedShare > 0.3) {
        return {
          title: `${topLabel} is waiting on a partial batch`,
          body: `${topLabel} fires a cycle only when ${String(bs)} parts are queued, and it spent ${Math.round(starvedShare * 100)} % of the run Starved waiting for the plate to fill. Two levers: speed up the upstream station that feeds it, or shrink batchSize (smaller plates fire more often).`,
          tone: "warn",
        };
      }
    }
  }

  // VROL-1041 — capacity bump for a saturated bottleneck.
  // VROL-1054 — generalised to any cap ∈ [1, 9]: when the bottleneck
  // is running > 80 % AND the engine accepts another server, suggest
  // cap+1. Ranks above subordination because it doesn't need a
  // nominal-speed-ratio measurement to fire — running-pct is enough.
  if (top && top.runningPct > 0.8 && Array.isArray(result.perStationCapacity)) {
    const idx = labels.findIndex((l) => l === top.label);
    const cap = idx >= 0 ? (result.perStationCapacity[idx] ?? 1) : 1;
    if (cap >= 1 && cap < 10) {
      const nextCap = cap + 1;
      const titleVerb =
        cap === 1 ? `Add a second ${topLabel}` : `Add a ${ordinal(nextCap)} ${topLabel}`;
      return {
        title: titleVerb,
        body: `${topLabel} is the bottleneck and ran ${Math.round(top.runningPct * 100)} % of the window at capacity ${String(cap)} — every parallel server is saturated. Raising to capacity ${String(nextCap)} adds a server and lifts the binding constraint by roughly ${String(Math.round((1 / cap) * 100))} %; if you can't physically duplicate, fall back to cycle:halve.`,
        tone: "primary",
        apply: { kind: "capacity:set", stationLabel: topLabel, capacity: nextCap },
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

  // VROL-1021 — sustainability hotspot. When one station carries >60 %
  // of total line energy AND the line has non-trivial energy
  // consumption, that station is the lever — drop energyPerCycleJ or
  // reduce its cycles. Ranks above the line-level six-loss rule
  // because it's actionable on a specific station.
  if (result.totalEnergyJ > 1000 && result.perStationEnergyJ?.length) {
    const perStationE = result.perStationEnergyJ;
    let maxIdx = -1;
    let maxJ = 0;
    for (let i = 0; i < perStationE.length; i++) {
      const v = perStationE[i] ?? 0;
      if (v > maxJ) {
        maxJ = v;
        maxIdx = i;
      }
    }
    if (maxIdx >= 0 && maxJ / result.totalEnergyJ > 0.6) {
      const hotspotLabel = labels[maxIdx] ?? `Station ${String(maxIdx + 1)}`;
      const pct = Math.round((maxJ / result.totalEnergyJ) * 100);
      return {
        title: `Energy hotspot at ${hotspotLabel} — ${String(pct)} % of line total`,
        body: `${hotspotLabel} consumed ${Math.round(maxJ / 1000).toLocaleString()} kJ — the dominant share of the line's energy. Two levers: lower energyPerCycleJ on this station (more efficient equipment, lower set-point), or reduce its cycles (less rework / scrap upstream so the station fires less).`,
        tone: "warn",
        // VROL-1032 — 25 % cut on this station's energy is the
        // canonical first try; the apply handler rounds to nearest
        // integer J when persisting back to station.data.
        apply: { kind: "energy:scale", stationLabel: hotspotLabel, multiplier: 0.75 },
      };
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

  // ────────────────────────────────────────────────────────────────────
  // VROL-1104 → VROL-1109 (Sprint 185) — six informational rules
  // covering scenarios the structural rules above don't catch. Each
  // emits a tip:flag payload (introduced in VROL-1103); the EditorPage
  // handler surfaces the hint as a toast.info. Ordered by impact:
  // scrap invalidates conclusions, low-OEE points at A/P/Q breakdown,
  // WIP / idle-source / setup / per-edge-buffer are diagnostic flags.
  // Sits between the structural rules and the slim-factor fallback so
  // it fires when no specific lever matched but a clear systemic
  // signal is present.
  // ────────────────────────────────────────────────────────────────────

  // VROL-1104 — high-scrap. Above 5 % line scrap, defect work outpaces
  // cycle tuning. Surfaces BEFORE the slim-factor fallback because the
  // user needs to address scrap before reading the OEE breakdown.
  if ((result.lineScrapRate ?? 0) > 0.05) {
    const worstScrapIdx = (() => {
      const totals = result.perStationScrapped ?? [];
      let max = 0;
      let pick = -1;
      for (let i = 0; i < totals.length; i++) {
        const v = totals[i] ?? 0;
        if (v > max) {
          max = v;
          pick = i;
        }
      }
      return pick;
    })();
    const worstLabel = labels[worstScrapIdx] ?? topLabel;
    return {
      title: `Scrap rate ${(result.lineScrapRate * 100).toFixed(1)} %`,
      body: `Defective parts are above 5 % of total output. At this level, defect root-cause work outpaces cycle tuning — open Inspector → Defects at ${worstLabel} (highest scrap count) to see what's driving it.`,
      tone: "warn",
      apply: {
        kind: "tip:flag",
        hint: `Open Inspector → Defects at ${worstLabel} to investigate the scrap source.`,
        stationLabel: worstLabel,
      },
    };
  }

  // VROL-1105 — low line OEE (< 50 %). Distinct from the slim-factor
  // fallback below: that one runs at any OEE and identifies which
  // FACTOR is slim. This one fires only at structurally low OEE and
  // hints the user at the BREAKDOWN card (which surfaces A/P/Q +
  // Util/TEEP together) rather than fishing in the bottleneck.
  if ((result.lineOee ?? 1) < 0.5) {
    return {
      title: `Line OEE is ${(result.lineOee * 100).toFixed(0)} %`,
      body: "Below 50 %, the line is structurally constrained. Open the OEE breakdown card to see which factor — Availability (breakdowns / maintenance), Performance (slow cycles / micro-stops), Quality (scrap) — is the slim one before chasing cycle-time changes.",
      tone: "warn",
      apply: {
        kind: "tip:flag",
        hint: "Open the OEE breakdown card on the result panel.",
      },
    };
  }

  // VROL-1106 — WIP pile-up. averageWipL > 3 × station count means
  // buffers are swelling because downstream isn't pulling fast enough.
  // Tighten a downstream buffer cap or open the bottleneck before
  // adding more cycle.
  const stationCount = result.perStationOee.length;
  if (stationCount > 0 && (result.averageWipL ?? 0) > 3 * stationCount) {
    return {
      title: `WIP averaging ${result.averageWipL.toFixed(1)} parts`,
      body: `Average WIP is ${result.averageWipL.toFixed(1)} across ${String(stationCount)} stations — buffers are swelling because downstream isn't pulling fast enough. Tighten a downstream buffer cap or accelerate the bottleneck before adding more upstream cycle.`,
      tone: "warn",
      apply: {
        kind: "tip:flag",
        hint: "Lower interStationBufferCapacity in run settings, or open the bottleneck inspector to raise its cycle / capacity.",
      },
    };
  }

  // VROL-1107 — idle-source (upstream-limited). Source idle > 50 %
  // means the line is starving on supply, not blocked by a slow mid-
  // chain station. Different fix — speed up the source.
  const sourceState = result.perStationStateMs?.[0];
  if (sourceState) {
    let total = 0;
    for (const v of Object.values(sourceState)) total += v;
    const idleFraction = total > 0 ? (sourceState["Idle"] ?? 0) / total : 0;
    if (idleFraction > 0.5) {
      const sourceLabel = labels[0] ?? "the source";
      return {
        title: "Line is upstream-limited",
        body: `${sourceLabel} is idle ${(idleFraction * 100).toFixed(0)} % of the run — downstream is starving on supply, not blocked by a slow mid-chain station. Speed up the source cycle or raise its capacity before chasing downstream bottlenecks.`,
        tone: "info",
        apply: {
          kind: "tip:flag",
          hint: `Open Inspector → Cycle on ${sourceLabel} and reduce its cycle time.`,
          stationLabel: sourceLabel,
        },
      };
    }
  }

  // VROL-1108 — setup dominates cycle. If any station's per-rep setup
  // exceeds 2 × its cycle time (taken from perStationStateMs), the
  // line's throughput is governed by changeovers, not work.
  for (let i = 0; i < (result.perStationStateMs?.length ?? 0); i++) {
    const stateMs = result.perStationStateMs?.[i];
    if (!stateMs) continue;
    const setupMs = stateMs["Setup"] ?? 0;
    const runningMs = stateMs["Running"] ?? 0;
    if (runningMs > 0 && setupMs > 2 * runningMs) {
      const stationLabel = labels[i] ?? `Station ${String(i + 1)}`;
      return {
        title: `Changeovers swamp work at ${stationLabel}`,
        body: `${stationLabel} spent ${Math.round(setupMs / 1000)} s in Setup vs ${Math.round(runningMs / 1000)} s Running — setup is dominating throughput. Reduce setupDistribution or consolidate the product mix so the line changes over less often.`,
        tone: "warn",
        apply: {
          kind: "tip:flag",
          hint: `Open Inspector → Setup distribution on ${stationLabel}.`,
          stationLabel,
        },
      };
    }
  }

  // VROL-1109 — per-edge buffer saturation. Any sample's
  // perEdgeBufferFill[i] / interStationBufferCapacity > 0.95 for
  // > 50 % of samples means one queue is the choke point. Suggest the
  // per-edge bufferCapacity override (S178) rather than raising the
  // global buffer line-wide.
  // We don't know the global cap from ChainResult alone — use the max
  // observed fill across all samples + edges as a proxy. When ANY fill
  // sits near a steady max, the buffer is likely capped.
  if (result.samples && result.samples.length >= 4) {
    const edgeCount = result.samples[0]?.perEdgeBufferFill.length ?? 0;
    let saturated: number | null = null;
    for (let edgeIdx = 0; edgeIdx < edgeCount; edgeIdx++) {
      let peak = 0;
      for (const s of result.samples) {
        const fill = s.perEdgeBufferFill[edgeIdx] ?? 0;
        if (fill > peak) peak = fill;
      }
      if (peak === 0) continue;
      let nearPeakCount = 0;
      for (const s of result.samples) {
        const fill = s.perEdgeBufferFill[edgeIdx] ?? 0;
        if (fill / peak >= 0.95) nearPeakCount++;
      }
      if (nearPeakCount > result.samples.length * 0.5) {
        saturated = edgeIdx;
        break;
      }
    }
    if (saturated !== null) {
      return {
        title: `Buffer on edge ${String(saturated + 1)} is saturating`,
        body: `One inter-station buffer sat near its cap for most of the run. Raising the global interStationBufferCapacity affects every edge; the per-edge bufferCapacity field (S178) lets you raise it on JUST this buffer without growing the WIP envelope line-wide.`,
        tone: "info",
        apply: {
          kind: "tip:flag",
          hint: `Set bufferCapacity on edge ${String(saturated + 1)} in the scenario JSON to raise just this buffer.`,
        },
      };
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
