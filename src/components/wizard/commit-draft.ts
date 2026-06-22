/**
 * Turn a WizardDraft into ready-to-mount canvas nodes + edges + a
 * RunSettings patch.
 *
 * VROL-871 — driven entirely off the new 8-step draft. Stations carry
 * their own distributions, capacities, setup, maintenance, rework, and
 * required skill. Edges are authored explicitly on step 3, so the
 * commit just maps station ids → fresh canvas node ids and rewrites
 * each connection.
 *
 * Layout: tries a column-by-column topological layout. Stations with
 * no incoming edges anchor column 0; downstream columns are placed
 * `stride` px to the right with stations stacked vertically.
 */

import type { Edge, Node } from "@xyflow/react";

import type { Distribution } from "@/engine";

import type { WizardCommit, WizardConnection, WizardDraft, WizardStation } from "./wizard-types";

function makeStationKey(): string {
  return `sk_${Math.random().toString(36).slice(2, 10)}`;
}

/** Topological column index per station — Kahn's algorithm, columns = longest path from a source. */
function columnsByStationId(
  stations: readonly WizardStation[],
  connections: readonly WizardConnection[],
): Map<string, number> {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  stations.forEach((s) => {
    incoming.set(s.id, []);
    outgoing.set(s.id, []);
  });
  connections.forEach((e) => {
    incoming.get(e.targetId)?.push(e.sourceId);
    outgoing.get(e.sourceId)?.push(e.targetId);
  });
  const col = new Map<string, number>();
  const queue: string[] = [];
  stations.forEach((s) => {
    if ((incoming.get(s.id) ?? []).length === 0) {
      col.set(s.id, 0);
      queue.push(s.id);
    }
  });
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const curCol = col.get(cur) ?? 0;
    (outgoing.get(cur) ?? []).forEach((next) => {
      const prev = col.get(next);
      const candidate = curCol + 1;
      if (prev === undefined || candidate > prev) col.set(next, candidate);
      queue.push(next);
    });
  }
  stations.forEach((s) => {
    if (!col.has(s.id)) col.set(s.id, 0);
  });
  return col;
}

export function commitDraft(draft: WizardDraft): WizardCommit {
  const startX = 60;
  const stride = 220;
  const rowStride = 140;
  const baseY = 200;
  const columns = columnsByStationId(draft.stations, draft.connections);

  // Group by column so we can stack vertically when a column has > 1.
  const byColumn = new Map<number, WizardStation[]>();
  draft.stations.forEach((s) => {
    const c = columns.get(s.id) ?? 0;
    const list = byColumn.get(c) ?? [];
    list.push(s);
    byColumn.set(c, list);
  });

  // Map wizard station id → canvas node id.
  const idMap = new Map<string, string>();
  draft.stations.forEach((s, i) => {
    idMap.set(s.id, `n${String(i + 1)}`);
  });

  const nodes: Node[] = [];
  draft.stations.forEach((s) => {
    const c = columns.get(s.id) ?? 0;
    const colList = byColumn.get(c) ?? [];
    const rowIdx = colList.indexOf(s);
    const yOffset = (rowIdx - (colList.length - 1) / 2) * rowStride;
    const dataExtras: Record<string, unknown> = {};
    if (s.parallelCapacity > 1) dataExtras["capacity"] = s.parallelCapacity;
    if (s.setupDistribution) dataExtras["setupDistribution"] = s.setupDistribution;
    if (s.requiredSkill.trim() !== "") dataExtras["skills"] = [s.requiredSkill.trim()];
    if (s.maintenanceWindows.length > 0)
      dataExtras["maintenanceWindows"] = s.maintenanceWindows.map((w) => ({ ...w }));
    if (s.reworkTargetId) {
      const mapped = idMap.get(s.reworkTargetId);
      if (mapped) dataExtras["reworkTargetNodeId"] = mapped;
      if (s.reworkPassLimit !== 3) dataExtras["reworkPassLimit"] = s.reworkPassLimit;
    }
    // Per-product cycle overrides — VROL-871.
    if (draft.productsEnabled) {
      const pp = draft.perProductCycles[s.id];
      if (pp && Object.keys(pp).length > 0) {
        const norm: Record<string, Distribution> = {};
        Object.entries(pp).forEach(([pid, d]) => {
          norm[pid] = d;
        });
        dataExtras["perProductCycles"] = norm;
      }
      const matrix = draft.changeoverMatrices[s.id];
      if (matrix && Object.keys(matrix).length > 0) {
        dataExtras["changeoverMatrix"] = matrix;
      }
    }
    nodes.push({
      id: idMap.get(s.id) ?? `n${String(nodes.length + 1)}`,
      type: "station",
      position: { x: startX + c * stride, y: baseY + yOffset },
      data: {
        label: s.label,
        stationType: s.stationType,
        cycleDistribution: s.cycleDistribution,
        defectRate: s.defectRate,
        stationKey: makeStationKey(),
        ...dataExtras,
      },
    });
  });

  const edges: Edge[] = draft.connections
    .map((e, i) => {
      const src = idMap.get(e.sourceId);
      const dst = idMap.get(e.targetId);
      if (!src || !dst) return null;
      return { id: `e${String(i + 1)}`, source: src, target: dst } as Edge;
    })
    .filter((x): x is Edge => x !== null);

  // Default defect rate falls out of the per-station defects; the patch
  // exposes the realism-block scalar for back-compat with EditorPage's
  // wizard handoff consumer.
  const defaultDefectRate = avgDefectRate(draft.stations);

  return {
    nodes,
    edges,
    settingsPatch: {
      horizonMs: draft.runWindow.horizonMs,
      warmupMs: draft.runWindow.warmupMs,
      seed: draft.runWindow.seed,
      interStationBufferCapacity: draft.runWindow.interStationBufferCapacity,
      replications: draft.runWindow.replications,
      source: {
        enabled: draft.arrivals.enabled,
        intervalMs: meanArrivalMs(draft.arrivals.interArrivalDist),
        batchSize: draft.arrivals.batchSize,
      },
      breakdowns: {
        enabled: draft.breakdowns.enabled,
        mtbfMs: draft.breakdowns.mtbfMs,
        mttrMs: draft.breakdowns.mttrMs,
      },
      defaultDefectRate,
      samplerIntervalMs: draft.runWindow.samplerIntervalMs,
      products: draft.productsEnabled
        ? {
            enabled: true,
            list: draft.products.map((p) => ({ id: p.id, name: p.name, weight: p.weight })),
          }
        : undefined,
      workers: draft.workersEnabled
        ? {
            enabled: true,
            list: draft.workers.map((w) => ({
              name: w.name,
              skills: [...w.skills],
              shiftEndMs: w.shiftEndMs,
            })),
          }
        : undefined,
      materials: draft.materials.enabled
        ? {
            enabled: true,
            bottles: draft.materials.bottles,
            caps: draft.materials.caps,
            bottlesPerPart: draft.materials.bottlesPerPart,
            capsPerPart: draft.materials.capsPerPart,
            replenishment: { ...draft.materials.replenishment },
            recurring: draft.materials.recurring.map((r) => ({ ...r })),
          }
        : undefined,
    },
  };
}

function avgDefectRate(stations: readonly WizardStation[]): number {
  if (stations.length === 0) return 0;
  let sum = 0;
  for (const s of stations) sum += s.defectRate;
  return sum / stations.length;
}

function meanArrivalMs(d: Distribution): number {
  switch (d.kind) {
    case "constant":
      return Math.max(50, Math.round(d.value));
    case "uniform":
      return Math.max(50, Math.round((d.min + d.max) / 2));
    case "normal":
      return Math.max(50, Math.round(d.mean));
    case "triangular":
      return Math.max(50, Math.round((d.min + d.mode + d.max) / 3));
    case "exponential":
      return Math.max(50, Math.round(1 / d.rate));
    case "lognormal":
      return Math.max(50, Math.round(Math.exp(d.mu + (d.sigma * d.sigma) / 2)));
    case "weibull":
    case "gamma":
      return Math.max(50, Math.round(d.shape * d.scale));
    case "empirical": {
      if (d.values.length === 0) return 1000;
      let sum = 0;
      for (const v of d.values) sum += v;
      return Math.max(50, Math.round(sum / d.values.length));
    }
  }
}
