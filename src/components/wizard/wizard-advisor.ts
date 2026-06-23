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
