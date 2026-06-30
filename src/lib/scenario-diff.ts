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
  readonly category: "Station" | "Edge" | "Setting" | "Products" | "ToolPools" | "Output";
  readonly label: string;
  readonly aValue: string;
  readonly bValue: string;
  /**
   * VROL-1152 — optional signed delta. Output rows fill this with
   * (b - a) so the UI can render a tone-coded chip (green if delta is
   * "better" in the metric's natural direction; red if "worse").
   * Input rows leave it undefined.
   */
  readonly delta?: number;
  /**
   * For Output rows only: which direction is "good". The renderer
   * uses this to colour the delta chip green vs red. For input rows
   * it's undefined.
   */
  readonly betterDirection?: "higher" | "lower";
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

/**
 * VROL-369 / VROL-1152 — derive Output-category DiffRow entries from
 * two ChainResult objects. Each metric carries its direction so the
 * UI can colour deltas (throughput up = good; scrap down = good).
 *
 * Imported lazily via `type` to avoid pulling ChainResult into the
 * input-diff side of the file (no runtime cost).
 */
import type { ChainResult } from "@/engine";

interface KpiSpec {
  readonly label: string;
  readonly extract: (r: ChainResult) => number;
  readonly format: (v: number) => string;
  readonly betterDirection: "higher" | "lower";
}

const KPI_SPECS: readonly KpiSpec[] = [
  {
    label: "Throughput (parts/h)",
    extract: (r) => r.throughputLambda * 3_600_000,
    format: (v) => Math.round(v).toLocaleString(),
    betterDirection: "higher",
  },
  {
    label: "Line OEE",
    extract: (r) => r.lineOee,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    betterDirection: "higher",
  },
  {
    label: "Line scrap rate",
    extract: (r) => r.lineScrapRate,
    format: (v) => `${(v * 100).toFixed(2)}%`,
    betterDirection: "lower",
  },
  {
    label: "Avg time in system (ms)",
    extract: (r) => r.avgTimeInSystemW,
    format: (v) => Math.round(v).toLocaleString(),
    betterDirection: "lower",
  },
  {
    label: "Average WIP (parts)",
    extract: (r) => r.averageWipL,
    format: (v) => v.toFixed(1),
    betterDirection: "lower",
  },
  {
    label: "Energy per part (J)",
    // Energy/part = totalEnergyJ / completed when sustainability inputs declared.
    extract: (r) =>
      (r.totalEnergyJ ?? 0) > 0 && r.completed > 0 ? r.totalEnergyJ / r.completed : 0,
    format: (v) => (v > 0 ? Math.round(v).toLocaleString() : "—"),
    betterDirection: "lower",
  },
];

export function deriveKpiDeltaRows(a: ChainResult, b: ChainResult): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const spec of KPI_SPECS) {
    const av = spec.extract(a);
    const bv = spec.extract(b);
    // Skip energy row when both sides are 0 (no sustainability inputs).
    if (spec.label.startsWith("Energy") && av === 0 && bv === 0) continue;
    if (av === bv) continue;
    rows.push({
      category: "Output",
      label: spec.label,
      aValue: spec.format(av),
      bValue: spec.format(bv),
      delta: bv - av,
      betterDirection: spec.betterDirection,
    });
  }
  return rows;
}

/**
 * VROL-369 / VROL-1153 — full input + output rollup. The UI compare
 * sheet renders all four sections together; this helper bundles them
 * + a one-sentence summary highlighting the most-changed output.
 */
export interface ScenarioComparisonSummary {
  readonly inputRows: readonly DiffRow[];
  readonly outputRows: readonly DiffRow[];
  /** Short prose: "B beats A on throughput (+8 %) but uses more energy/part." */
  readonly summary: string;
}

export function summarizeScenarioComparison(
  a: ScenarioInput,
  b: ScenarioInput,
  aResult: ChainResult | null,
  bResult: ChainResult | null,
): ScenarioComparisonSummary {
  const inputRows = diffScenarios(a, b);
  const outputRows = aResult && bResult ? deriveKpiDeltaRows(aResult, bResult) : [];
  const summary = buildComparisonSummary(outputRows);
  return { inputRows, outputRows, summary };
}

function buildComparisonSummary(outputRows: readonly DiffRow[]): string {
  if (outputRows.length === 0) return "Both runs produced identical KPIs.";
  // Rank by relative magnitude of delta vs the A value. Throughput +8 %
  // and energy +1 J/part should rank throughput higher.
  const ranked = [...outputRows]
    .filter((r) => r.delta !== undefined && r.delta !== 0)
    .map((r) => {
      const av = parseAsFloat(r.aValue);
      const denom = Math.abs(av) > 1e-9 ? Math.abs(av) : 1;
      return { row: r, score: Math.abs(r.delta ?? 0) / denom };
    })
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return "Outputs match.";
  const lead = ranked[0]!;
  const dir =
    lead.row.delta! > 0
      ? lead.row.betterDirection === "higher"
        ? "improves"
        : "worsens"
      : lead.row.betterDirection === "higher"
        ? "worsens"
        : "improves";
  const pct = Math.round((lead.row.delta! / Math.max(1e-9, parseAsFloat(lead.row.aValue))) * 100);
  const signed = pct > 0 ? `+${String(pct)} %` : `${String(pct)} %`;
  return `B ${dir} ${lead.row.label.toLowerCase()} (${signed} vs A)${ranked.length > 1 ? `; ${String(ranked.length - 1)} other KPI${ranked.length - 1 === 1 ? "" : "s"} moved.` : "."}`;
}

function parseAsFloat(value: string): number {
  // Best-effort: strip commas + "%" / "ms" suffixes the formatters add.
  const stripped = value.replace(/,/g, "").replace(/[^0-9.-]/g, "");
  const n = Number(stripped);
  return Number.isFinite(n) ? n : 0;
}
