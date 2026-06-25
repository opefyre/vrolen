/**
 * VROL-994 — structured diff between two scenario payloads. Surfaces
 * what changed at the configuration layer (cycle, defect, capacity,
 * settings) so the comparison sheet shows both INPUT deltas and OUTPUT
 * deltas. Closes a frequent audit observation that A-vs-B compare
 * tells you the result but not the cause.
 *
 * Pure derivation. UI renders the rows; this lib only produces them.
 */

import type { Edge, Node } from "@xyflow/react";
import { meanOf, type Distribution } from "@/engine";
import type { RunSettings } from "@/routes/editor-run-settings";

export interface DiffRow {
  readonly category: "Station" | "Edge" | "Setting" | "Products" | "ToolPools";
  readonly label: string;
  readonly aValue: string;
  readonly bValue: string;
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function distLabel(d: Distribution | undefined | null): string {
  if (!d) return "—";
  const m = meanOf(d);
  return `${d.kind}(μ≈${fmt(m, 1)})`;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

interface ScenarioInput {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  readonly settings: RunSettings;
}

export function diffScenarios(a: ScenarioInput, b: ScenarioInput): DiffRow[] {
  const rows: DiffRow[] = [];

  // Stations — match by id; report cycle / defect / capacity diffs.
  const byId = (ns: readonly Node[]) => new Map(ns.map((n) => [n.id, n]));
  const aMap = byId(a.nodes);
  const bMap = byId(b.nodes);
  const stationIds = new Set([...aMap.keys(), ...bMap.keys()]);
  for (const id of stationIds) {
    const na = aMap.get(id);
    const nb = bMap.get(id);
    const labelA = (na?.data as { label?: string } | undefined)?.label ?? id;
    const labelB = (nb?.data as { label?: string } | undefined)?.label ?? id;
    if (labelA !== labelB) {
      rows.push({
        category: "Station",
        label: `${id} · label`,
        aValue: labelA,
        bValue: labelB,
      });
    }
    const dA = (na?.data as { cycleDistribution?: Distribution } | undefined)?.cycleDistribution;
    const dB = (nb?.data as { cycleDistribution?: Distribution } | undefined)?.cycleDistribution;
    if (JSON.stringify(dA ?? null) !== JSON.stringify(dB ?? null)) {
      rows.push({
        category: "Station",
        label: `${labelA} · cycle`,
        aValue: distLabel(dA),
        bValue: distLabel(dB),
      });
    }
    const drA = num((na?.data as { defectRate?: unknown } | undefined)?.defectRate);
    const drB = num((nb?.data as { defectRate?: unknown } | undefined)?.defectRate);
    if (Math.abs(drA - drB) > 1e-9) {
      rows.push({
        category: "Station",
        label: `${labelA} · defect`,
        aValue: `${fmt(drA * 100, 1)} %`,
        bValue: `${fmt(drB * 100, 1)} %`,
      });
    }
    const cA = num((na?.data as { capacity?: unknown } | undefined)?.capacity, 1);
    const cB = num((nb?.data as { capacity?: unknown } | undefined)?.capacity, 1);
    if (cA !== cB) {
      rows.push({
        category: "Station",
        label: `${labelA} · capacity`,
        aValue: String(cA),
        bValue: String(cB),
      });
    }
    // VROL-1035 — batch-fire / UoM / sustainability fields. Same diff
    // pattern as cycle / defect / capacity; each fires only when the
    // value differs between A and B.
    const bsA = num((na?.data as { batchSize?: unknown } | undefined)?.batchSize, 1);
    const bsB = num((nb?.data as { batchSize?: unknown } | undefined)?.batchSize, 1);
    if (bsA !== bsB) {
      rows.push({
        category: "Station",
        label: `${labelA} · batchSize`,
        aValue: String(bsA),
        bValue: String(bsB),
      });
    }
    const uA = String((na?.data as { unit?: unknown } | undefined)?.unit ?? "");
    const uB = String((nb?.data as { unit?: unknown } | undefined)?.unit ?? "");
    if (uA !== uB) {
      rows.push({
        category: "Station",
        label: `${labelA} · unit`,
        aValue: uA || "—",
        bValue: uB || "—",
      });
    }
    const uppA = num((na?.data as { unitsPerPart?: unknown } | undefined)?.unitsPerPart, 1);
    const uppB = num((nb?.data as { unitsPerPart?: unknown } | undefined)?.unitsPerPart, 1);
    if (Math.abs(uppA - uppB) > 1e-9) {
      rows.push({
        category: "Station",
        label: `${labelA} · unitsPerPart`,
        aValue: fmt(uppA, 3),
        bValue: fmt(uppB, 3),
      });
    }
    const eA = num((na?.data as { energyPerCycleJ?: unknown } | undefined)?.energyPerCycleJ);
    const eB = num((nb?.data as { energyPerCycleJ?: unknown } | undefined)?.energyPerCycleJ);
    if (Math.abs(eA - eB) > 1e-9) {
      rows.push({
        category: "Station",
        label: `${labelA} · energy/cycle (J)`,
        aValue: fmt(eA, 0),
        bValue: fmt(eB, 0),
      });
    }
    const wA = num((na?.data as { waterPerCycleL?: unknown } | undefined)?.waterPerCycleL);
    const wB = num((nb?.data as { waterPerCycleL?: unknown } | undefined)?.waterPerCycleL);
    if (Math.abs(wA - wB) > 1e-9) {
      rows.push({
        category: "Station",
        label: `${labelA} · water/cycle (L)`,
        aValue: fmt(wA, 3),
        bValue: fmt(wB, 3),
      });
    }
    const co2A = num((na?.data as { co2ePerCycleG?: unknown } | undefined)?.co2ePerCycleG);
    const co2B = num((nb?.data as { co2ePerCycleG?: unknown } | undefined)?.co2ePerCycleG);
    if (Math.abs(co2A - co2B) > 1e-9) {
      rows.push({
        category: "Station",
        label: `${labelA} · CO₂e/cycle (g)`,
        aValue: fmt(co2A, 1),
        bValue: fmt(co2B, 1),
      });
    }
  }

  // Edge count delta (cheap shape check; deep-diff is for a later sprint).
  if (a.edges.length !== b.edges.length) {
    rows.push({
      category: "Edge",
      label: "Edge count",
      aValue: String(a.edges.length),
      bValue: String(b.edges.length),
    });
  }

  // Top-line settings.
  const settingFields: { label: string; pick: (s: RunSettings) => string }[] = [
    { label: "Horizon (ms)", pick: (s) => String(s.horizonMs) },
    { label: "Warmup (ms)", pick: (s) => String(s.warmupMs) },
    { label: "Seed", pick: (s) => String(s.seed) },
    {
      label: "Inter-station buffer cap",
      pick: (s) => String(s.interStationBufferCapacity),
    },
    {
      label: "Breakdowns",
      pick: (s) =>
        s.breakdowns.enabled
          ? `on (MTBF ${String(s.breakdowns.mtbfMs)} / MTTR ${String(s.breakdowns.mttrMs)} ms)`
          : "off",
    },
    {
      label: "Replications",
      pick: (s) => String(s.replications),
    },
  ];
  for (const f of settingFields) {
    const va = f.pick(a.settings);
    const vb = f.pick(b.settings);
    if (va !== vb) {
      rows.push({ category: "Setting", label: f.label, aValue: va, bValue: vb });
    }
  }

  // Tool pools — count + named differences.
  const ap = a.settings.toolPools ?? [];
  const bp = b.settings.toolPools ?? [];
  if (ap.length !== bp.length) {
    rows.push({
      category: "ToolPools",
      label: "Pool count",
      aValue: String(ap.length),
      bValue: String(bp.length),
    });
  }
  const poolByName = (xs: typeof ap) => new Map(xs.map((p) => [p.name, p.capacity]));
  const apMap = poolByName(ap);
  const bpMap = poolByName(bp);
  for (const name of new Set([...apMap.keys(), ...bpMap.keys()])) {
    const ca = apMap.get(name);
    const cb = bpMap.get(name);
    if (ca !== cb) {
      rows.push({
        category: "ToolPools",
        label: `${name} capacity`,
        aValue: ca === undefined ? "—" : String(ca),
        bValue: cb === undefined ? "—" : String(cb),
      });
    }
  }

  // Products.
  const aProdsLen = a.settings.products.list.length;
  const bProdsLen = b.settings.products.list.length;
  if (aProdsLen !== bProdsLen) {
    rows.push({
      category: "Products",
      label: "SKU count",
      aValue: String(aProdsLen),
      bValue: String(bProdsLen),
    });
  }

  return rows;
}
