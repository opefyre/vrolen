/**
 * VROL-795 — wizard soft-warning advisor.
 *
 * Non-blocking nudges when physics flags suspect input — the user can still
 * proceed, but the wizard hints that something looks off so they can fix it
 * before hitting Run. Different from `validateWizardDraft()` which gates the
 * Next button: advisor warnings never block, they just inform.
 *
 * Returns warnings tagged by step so each step can show only its own warnings
 * inline. Steps without warnings render nothing.
 */

import { meanOf } from "@/engine";
import type { WizardDraft } from "./wizard-types";

export type WizardWarningSeverity = "info" | "warning";

export interface WizardWarning {
  readonly id: string;
  readonly step: "shape" | "stations" | "arrivals" | "products" | "realism" | "run-window";
  readonly severity: WizardWarningSeverity;
  readonly title: string;
  readonly body: string;
}

/**
 * Heuristics for "this input is technically valid but looks unusual." Each
 * predicate is conservative — false positives are worse than false negatives
 * because users learn to ignore noisy advisors.
 */
export function analyzeWizardDraft(draft: WizardDraft): readonly WizardWarning[] {
  const out: WizardWarning[] = [];

  // Stations — suspiciously fast / suspiciously slow / high defect.
  draft.stations.forEach((s, i) => {
    const cycleMs = meanOf(s.cycleDistribution);
    if (cycleMs > 0 && cycleMs < 50) {
      out.push({
        id: `cycle-too-fast-${String(i)}`,
        step: "stations",
        severity: "warning",
        title: `${s.label}: cycle ~${String(Math.round(cycleMs))} ms looks unusually fast`,
        body: "Real machines below 50ms are rare. Double-check the unit — milliseconds vs seconds is the typical typo.",
      });
    }
    if (cycleMs > 3_600_000) {
      out.push({
        id: `cycle-too-slow-${String(i)}`,
        step: "stations",
        severity: "warning",
        title: `${s.label}: cycle > 1 hour`,
        body: "If this isn't intentional (e.g. fermentation), check the unit — seconds vs milliseconds is the typical typo.",
      });
    }
    if (s.defectRate > 0.3) {
      out.push({
        id: `defect-too-high-${String(i)}`,
        step: "stations",
        severity: "warning",
        title: `${s.label}: defect rate ${String(Math.round(s.defectRate * 100))}%`,
        body: "More than ~30% defect usually indicates the line is broken in real life. The sim will still run; the output will be dominated by scrap.",
      });
    }
    if (s.parallelCapacity > 1 && s.parallelCapacity > draft.stations.length) {
      out.push({
        id: `cap-suspect-${String(i)}`,
        step: "stations",
        severity: "info",
        title: `${s.label}: ${String(s.parallelCapacity)} parallel cycles on a ${String(draft.stations.length)}-station line`,
        body: "Parallel capacity on a non-bottleneck station rarely lifts throughput. Worth checking.",
      });
    }
  });

  // Realism — MTTR > MTBF (machine broken more than running).
  if (draft.breakdowns.enabled) {
    if (draft.breakdowns.mttrMs > draft.breakdowns.mtbfMs) {
      out.push({
        id: "mttr-exceeds-mtbf",
        step: "realism",
        severity: "warning",
        title: "MTTR > MTBF",
        body: `Mean time to repair (${String(Math.round(draft.breakdowns.mttrMs / 60_000))}m) is longer than mean time between failures (${String(Math.round(draft.breakdowns.mtbfMs / 60_000))}m). The line will spend more time broken than running. Probably a unit mix-up.`,
      });
    }
    if (draft.breakdowns.mtbfMs < 60_000) {
      out.push({
        id: "mtbf-too-short",
        severity: "warning",
        step: "realism",
        title: "MTBF < 1 minute",
        body: "Machines breaking down every minute will dominate the run. Check the unit — minutes vs milliseconds is the typical typo.",
      });
    }
  }

  // VROL-1079 — interStationBufferCapacity > 1000 is almost always
  // over-allocated WIP envelope. Stretching the convergence to steady
  // state without helping throughput.
  if (draft.interStationBufferCapacity > 1000) {
    out.push({
      id: "buffer-cap-extreme",
      step: "run-window",
      severity: "info",
      title: `Inter-station buffer = ${String(draft.interStationBufferCapacity)} parts`,
      body: "Buffers above 1000 rarely lift throughput; they mostly mean the line takes longer to reach steady state, which biases short runs. Try 20-100 first; raise only if you see throughput clip.",
    });
  }

  // VROL-1080 — setup distribution mean > 2 × cycle mean. Changeovers
  // will swamp work; the line's throughput is governed by setup, not
  // cycle. Flag per station.
  draft.stations.forEach((s, i) => {
    if (!s.setupDistribution) return;
    const cycleMs = meanOf(s.cycleDistribution);
    const setupMs = meanOf(s.setupDistribution);
    if (cycleMs > 0 && setupMs > 2 * cycleMs) {
      out.push({
        id: `setup-dominates-cycle-${String(i)}`,
        step: "stations",
        severity: "warning",
        title: `${s.label}: setup ~${String(Math.round(setupMs))} ms vs cycle ~${String(Math.round(cycleMs))} ms`,
        body: "Changeover time is more than twice the cycle. Throughput will be governed by how often you change product, not how fast the station runs. Check the unit or reduce setup if it's wrong.",
      });
    }
  });

  // VROL-1081 — replications above 20 hit diminishing returns on CI
  // tightening (1/√n flattens out fast). Sub-1 % half-width does need
  // big N, but most users won't.
  if (draft.replications > 20) {
    out.push({
      id: "replications-very-high",
      step: "run-window",
      severity: "info",
      title: `Replications = ${String(draft.replications)}`,
      body: "Past ~10 reps the 95 % CI on throughput tightens slowly (half-width shrinks with 1/√n). 5-10 reps is the usual sweet spot; only crank higher if you need very tight bounds.",
    });
  }

  // VROL-1082 — wizard-side counterpart to the S180 stochastic-needs-
  // replications coach tip. Surface BEFORE the run so the user fixes
  // it pre-flight instead of finding out from the coach after.
  if (draft.replications === 1) {
    const stochasticStation = draft.stations.find((s) => s.cycleDistribution.kind !== "constant");
    if (stochasticStation) {
      out.push({
        id: "reps-one-with-stochastic",
        step: "run-window",
        severity: "info",
        title: "Single replication on stochastic cycle",
        body: `${stochasticStation.label} uses a ${stochasticStation.cycleDistribution.kind} cycle distribution. With replications=1 the output is one realisation — the throughput figure carries the sampling noise of the cycle distribution. Bump replications to 3+ to see the 95 % CI on the mean.`,
      });
    }
  }

  // VROL-1083 — high defect rate with no rework path. The bad parts
  // are all scrapped; yield = 1 − defectRate. If the user intended
  // rework they need to set the target.
  draft.stations.forEach((s, i) => {
    if (s.defectRate > 0.1 && !s.reworkTargetId) {
      out.push({
        id: `defect-no-rework-${String(i)}`,
        step: "stations",
        severity: "info",
        title: `${s.label}: ${String(Math.round(s.defectRate * 100))}% defect rate, no rework target`,
        body:
          "Defective parts are scrapped (not re-routed for rework). Yield will sit at ~" +
          `${String(Math.round((1 - s.defectRate) * 100))}%. Set a rework target on this station if you wanted them re-routed instead.`,
      });
    }
  });

  // VROL-1084 — one station total. No flow modeling possible; no
  // bottleneck, no WIP, no buffer dynamics. The user almost certainly
  // wants ≥ 2 stations.
  if (draft.stations.length === 1) {
    out.push({
      id: "single-station-line",
      step: "stations",
      severity: "info",
      title: "Only one station defined",
      body: "Vrolen models inter-station flow — bottlenecks, buffers, blocking. With one station there's no flow to model; the run will only produce throughput at the single cycle rate. Add ≥ 2 stations to see the interesting behaviour.",
    });
  }

  // VROL-1085 — product with weight = 0 is silently excluded from the
  // mix. The user probably meant to remove it or set a non-zero
  // weight; surface so they make the choice explicitly.
  draft.products.forEach((p, i) => {
    if (p.weight === 0) {
      out.push({
        id: `product-zero-weight-${String(i)}`,
        step: "products",
        severity: "warning",
        title: `Product "${p.name}" has weight = 0`,
        body: "A zero-weight product never appears in the production mix. Either give it a positive weight or remove it from the product list.",
      });
    }
  });

  // Run window — horizon too short for warmup to be useful.
  if (draft.warmupMs > 0 && draft.warmupMs > draft.horizonMs * 0.5) {
    out.push({
      id: "warmup-too-large",
      step: "run-window",
      severity: "info",
      title: "Warm-up > 50% of horizon",
      body: "Most of the run is excluded from measurement. Consider lengthening the horizon or reducing warm-up.",
    });
  }
  if (draft.horizonMs > 0 && draft.horizonMs < 60_000) {
    out.push({
      id: "horizon-too-short",
      step: "run-window",
      severity: "info",
      title: "Horizon < 1 minute",
      body: "Stochastic effects (warm-up, queueing, breakdowns) need a longer window to settle. The result KPIs may be noisy.",
    });
  }

  return out;
}
