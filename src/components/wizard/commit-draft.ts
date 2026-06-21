/**
 * Turn a WizardDraft into ready-to-mount canvas nodes + edges + a
 * RunSettings patch. Linear chain layout — leftmost = first station,
 * 200 px stride to the right, all on the same Y.
 */

import type { Edge, Node } from "@xyflow/react";

import { constant } from "@/engine";

import type { RealismLevel, WizardCommit, WizardDraft } from "./wizard-types";

function realismToSettings(level: RealismLevel) {
  switch (level) {
    case "simple":
      return {
        breakdowns: { enabled: false, mtbfMs: 30 * 60 * 1000, mttrMs: 5 * 60 * 1000 },
        defaultDefectRate: 0,
      };
    case "realistic":
      return {
        breakdowns: { enabled: true, mtbfMs: 30 * 60 * 1000, mttrMs: 5 * 60 * 1000 },
        defaultDefectRate: 0.02,
      };
    case "stress":
      return {
        breakdowns: { enabled: true, mtbfMs: 10 * 60 * 1000, mttrMs: 8 * 60 * 1000 },
        defaultDefectRate: 0.05,
      };
  }
}

function makeStationKey(): string {
  return `sk_${Math.random().toString(36).slice(2, 10)}`;
}

export function commitDraft(draft: WizardDraft): WizardCommit {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const startX = 60;
  const stride = 220;
  const y = 200;
  const realism = realismToSettings(draft.realism);
  draft.stations.forEach((s, i) => {
    nodes.push({
      id: `n${String(i + 1)}`,
      type: "station",
      position: { x: startX + i * stride, y },
      data: {
        label: s.label,
        stationType: s.stationType,
        cycleDistribution: constant(s.cycleMs),
        defectRate: realism.defaultDefectRate,
        stationKey: makeStationKey(),
      },
    });
    if (i > 0) {
      edges.push({ id: `e${String(i)}`, source: `n${String(i)}`, target: `n${String(i + 1)}` });
    }
  });
  const intervalMs = Math.max(50, Math.round(60_000 / Math.max(1, draft.arrivalsPerMin)));
  return {
    nodes,
    edges,
    settingsPatch: {
      horizonMs: draft.horizonMs,
      interStationBufferCapacity: 10,
      source: { enabled: true, intervalMs, batchSize: 1 },
      breakdowns: realism.breakdowns,
      defaultDefectRate: realism.defaultDefectRate,
      samplerIntervalMs: Math.max(1_000, Math.round(draft.horizonMs / 600)),
    },
  };
}
