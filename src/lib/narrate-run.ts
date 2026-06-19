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

function oeeBandSentence(result: ChainResult): string | undefined {
  const pct = Math.round(result.lineOee * 100);
  if (result.lineOee < LOW_OEE_BAND) {
    return `Low utilization (${String(pct)}% line OEE) — look at the bottleneck.`;
  }
  if (result.lineOee >= HIGH_OEE_BAND) {
    return `Excellent OEE (${String(pct)}%) — line is well balanced.`;
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
  if (!rework && !scrap && !cap && !src) {
    const band = oeeBandSentence(result);
    if (band) out.push(band);
  }
  return out;
}
