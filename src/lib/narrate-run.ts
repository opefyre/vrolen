import type { ChainResult } from "@/engine";

/**
 * VROL-640 — auto-narrated run summary. Picks 1–3 noteworthy sentences from
 * a finished simulation so the user sees the headline story without
 * scrolling through every card.
 *
 * Always emits: bottleneck sentence (when at least one bottleneck candidate
 * exists). Conditionally emits: rework sentence when the line rework rate
 * is >= 2%; scrap sentence when the line scrap rate is >= 1%. When neither
 * fires, falls back to an OEE-band callout for low / excellent OEE runs so
 * the banner is never bottleneck-only.
 */

const REWORK_THRESHOLD = 0.02;
const SCRAP_THRESHOLD = 0.01;
const LOW_OEE_BAND = 0.4;
const HIGH_OEE_BAND = 0.85;

function bottleneckSentence(result: ChainResult): string | undefined {
  const top = result.bottlenecks[0];
  if (!top) return undefined;
  const label = top.label ?? `Station ${String(result.bottleneckStationIdx + 1)}`;
  const pct = Math.round(top.primaryReasonPct * 100);
  switch (top.primaryReason) {
    case "running":
      return `${label} is the bottleneck (running ${String(pct)}% of the time).`;
    case "starvation":
      return `${label} is the constraint — starved ${String(pct)}% of the time (upstream too slow).`;
    case "blocking":
      return `${label} is the constraint — blocked ${String(pct)}% of the time (downstream can't keep up).`;
    case "breakdown":
      return `${label} is the constraint — down ${String(pct)}% of the time.`;
    case "setup":
      return `${label} is the constraint — ${String(pct)}% of its time was setup / changeover.`;
    case "maintenance":
      return `${label} is the constraint — ${String(pct)}% of its time was in planned maintenance.`;
    case "idle":
      return `${label} is the constraint — idle ${String(pct)}% of the time.`;
  }
}

function reworkSentence(result: ChainResult): string | undefined {
  if (result.lineReworkRate < REWORK_THRESHOLD) return undefined;
  return `~${String(Math.round(result.lineReworkRate * 100))}% of parts were reworked at least once.`;
}

function scrapSentence(result: ChainResult): string | undefined {
  if (result.lineScrapRate < SCRAP_THRESHOLD) return undefined;
  return `~${String(Math.round(result.lineScrapRate * 100))}% of parts were scrapped.`;
}

/**
 * VROL-742 — combined quality-losses callout that names the worst station.
 * Only fires when scrap AND rework BOTH cross threshold — the single-source
 * sentences already cover the simple cases. Helps the reader localise loss
 * when multiple quality problems are present.
 */
function qualityLossLocaliser(result: ChainResult): string | undefined {
  if (result.lineScrapRate < SCRAP_THRESHOLD || result.lineReworkRate < REWORK_THRESHOLD) {
    return undefined;
  }
  let worstIdx = -1;
  let worstLoss = 0;
  for (let i = 0; i < result.perStationScrapped.length; i++) {
    const loss = (result.perStationScrapped[i] ?? 0) + (result.perStationReworked[i] ?? 0);
    if (loss > worstLoss) {
      worstLoss = loss;
      worstIdx = i;
    }
  }
  if (worstIdx === -1) return undefined;
  const label = result.bottlenecks[worstIdx]?.label ?? `Station ${String(worstIdx + 1)}`;
  return `Quality losses cluster at ${label}.`;
}

/**
 * VROL-743 — capacity-headroom sentence. When the bottleneck is running heavy
 * and another station is idle / starved most of the time, surface the headroom.
 */
function headroomSentence(result: ChainResult): string | undefined {
  const top = result.bottlenecks[0];
  if (!top || top.primaryReason !== "running") return undefined;
  // Find a non-bottleneck station with a high Idle / Starved share.
  const others = result.bottlenecks.filter((b) => b.stationId !== top.stationId);
  for (const b of others) {
    if (b.primaryReason === "starvation" || b.primaryReason === "idle") {
      const pct = Math.round(b.primaryReasonPct * 100);
      if (pct >= 40) {
        return `${b.label ?? "another station"} sits ${b.primaryReason} ${String(pct)}% of the time — there's headroom to absorb a faster pace.`;
      }
    }
  }
  return undefined;
}

function oeeBandSentence(result: ChainResult): string | undefined {
  const pct = Math.round(result.lineOee * 100);
  if (result.lineOee < LOW_OEE_BAND) {
    return `Low utilization (${String(pct)}% line efficiency) — look at the bottleneck.`;
  }
  // "Well balanced" is a strong claim — only emit when EVERY station is
  // actually running a high % of the time. OEE alone hides starvation +
  // blocking, so a 100% line OEE can sit on top of a chain where some
  // stations sit idle most of the time. Require every station's running
  // share to be >= 70% before we say balanced.
  if (result.lineOee >= HIGH_OEE_BAND) {
    const minRunning = result.bottlenecks.reduce((m, b) => Math.min(m, b.runningPct), 1);
    if (minRunning >= 0.7) {
      return `Excellent OEE (${String(pct)}%) — line is well balanced.`;
    }
    // High OEE but not balanced — the line is bottleneck-bound. Surface that
    // truth instead of mislabelling it as balanced. Find the least-running
    // station so the user sees the spread.
    const least = result.bottlenecks.reduce(
      (worst, b) => (b.runningPct < worst.runningPct ? b : worst),
      result.bottlenecks[0]!,
    );
    const leastPct = Math.round(least.runningPct * 100);
    return `OEE ${String(pct)}% looks high, but the line is bottleneck-bound — ${least.label ?? "downstream"} only runs ${String(leastPct)}% of the time.`;
  }
  return undefined;
}

/**
 * VROL-652 — capacity-aware remediation hint. Appended (not replaced) when
 * the bottleneck is saturated on its own cycle so the user has a concrete
 * next step. capacity=1 → suggest raising parallel cycles; capacity>1 →
 * already-parallel, suggest shortening the cycle.
 */
function capacityHint(result: ChainResult): string | undefined {
  const top = result.bottlenecks[0];
  if (!top || top.primaryReason !== "running") return undefined;
  const idx = result.bottleneckStationIdx;
  const capacity = result.perStationCapacity?.[idx] ?? 1;
  if (capacity === 1) return "Consider raising parallel cycles on this station.";
  return `Already at capacity ${String(capacity)} — speed up the cycle instead.`;
}

/**
 * VROL-652 — source-rate remediation hint. Fires when finite-rate source
 * was used AND the bottleneck is starvation (upstream is the gate). Pairs
 * with the capacity hint — both can land in the same run.
 */
function sourceRateHint(result: ChainResult): string | undefined {
  if (result.sourceArrivalsFired === undefined) return undefined;
  const top = result.bottlenecks[0];
  if (!top || top.primaryReason !== "starvation") return undefined;
  return "Source rate is the gate — shorten the inter-arrival or raise batch size.";
}

/**
 * VROL-1034 — sustainability sentence. Fires only when the line
 * declared energy inputs (> 1 kJ total). Calls out the intensity per
 * unit (J/kg, J/dose…) and, when one station carries > 40 % of the
 * total, names it. Lands at the END of the paragraph so the
 * throughput-first ordering of the existing sentences is preserved.
 */
function sustainabilitySentence(result: ChainResult): string | undefined {
  if (!(result.totalEnergyJ > 1000) || result.completed <= 0) return undefined;
  const intensityJ = result.totalEnergyJ / result.completed;
  const fmtIntensity =
    intensityJ >= 1_000_000
      ? `${(intensityJ / 1_000_000).toFixed(1)} MJ/part`
      : intensityJ >= 1_000
        ? `${(intensityJ / 1_000).toFixed(1)} kJ/part`
        : `${intensityJ.toFixed(0)} J/part`;
  const perStation = result.perStationEnergyJ ?? [];
  const labels = result.perStationLabels ?? [];
  let maxIdx = -1;
  let maxJ = 0;
  for (let i = 0; i < perStation.length; i++) {
    const v = perStation[i] ?? 0;
    if (v > maxJ) {
      maxJ = v;
      maxIdx = i;
    }
  }
  const dominantShare = result.totalEnergyJ > 0 ? maxJ / result.totalEnergyJ : 0;
  if (maxIdx >= 0 && dominantShare > 0.4) {
    const label = labels[maxIdx] ?? `Station ${String(maxIdx + 1)}`;
    return `Energy intensity ${fmtIntensity}; ${label} carries ${String(Math.round(dominantShare * 100))} % of the total.`;
  }
  return `Energy intensity ${fmtIntensity}.`;
}

export function narrateRun(result: ChainResult): readonly string[] {
  const out: string[] = [];
  const bottleneck = bottleneckSentence(result);
  if (bottleneck) out.push(bottleneck);
  const cap = capacityHint(result);
  if (cap) out.push(cap);
  const src = sourceRateHint(result);
  if (src) out.push(src);
  const rework = reworkSentence(result);
  const scrap = scrapSentence(result);
  if (rework) out.push(rework);
  if (scrap) out.push(scrap);
  const localiser = qualityLossLocaliser(result);
  // VROL-756 — skip when the localiser names the same station as the bottleneck
  // sentence — the user already knows the bottleneck label.
  const topLabel = result.bottlenecks[0]?.label;
  if (localiser && (!topLabel || !localiser.includes(topLabel))) out.push(localiser);
  const headroom = headroomSentence(result);
  if (headroom) out.push(headroom);
  if (!rework && !scrap && !cap && !src && !headroom) {
    const band = oeeBandSentence(result);
    if (band) out.push(band);
  }
  // VROL-1034 — sustainability lands last so it never displaces a
  // throughput-improvement signal.
  const sustainability = sustainabilitySentence(result);
  if (sustainability) out.push(sustainability);
  return out;
}
