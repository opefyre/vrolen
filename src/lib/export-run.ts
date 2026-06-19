/**
 * Helpers to dump a ChainResult to a downloadable file (VROL-596).
 *
 * Phase 0: client-side only. Build a Blob → ObjectURL → click an anchor →
 * revoke. No server involved.
 */

import type { ChainResult } from "@/engine";

export interface RunExportMeta {
  /** Station labels in chain order (matches ChainResult.perStationCompleted). */
  readonly stationLabels: readonly string[];
}

/**
 * Serialize a ChainResult to a JSON string. Maps are normalized to plain
 * objects so the output round-trips through JSON.parse without losing data.
 */
export function chainResultToJsonString(result: ChainResult): string {
  return JSON.stringify(result, mapAwareReplacer, 2);
}

function mapAwareReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  return value;
}

/**
 * CSV export mode (VROL-623).
 *
 * - "stations" (default) — one row per station with end-of-run KPIs. Original
 *   format from VROL-596; unchanged byte-for-byte.
 * - "samples" — one row per (sample, station) with per-state ms + completed
 *   counts + per-edge buffer fills. For taking the sampled timeseries into a
 *   notebook / Excel.
 */
export type CsvMode = "stations" | "samples";

interface ChainResultToCsvOptions extends RunExportMeta {
  readonly mode?: CsvMode;
}

/**
 * Build a per-station CSV summary. One header row, then one row per station.
 * Columns: label, completed, scrapped, runningPct, primaryReason,
 * primaryReasonPct, oee, availability, performance, quality.
 *
 * In "samples" mode (VROL-623), emits a wide per-sample-per-station table
 * with state-ms + buffer-fill columns instead. Header columns: tMs, station,
 * completed, [state]Ms columns (sorted), [edge#]Fill columns. Empty-samples
 * → header-only output.
 */
export function chainResultToCsv(result: ChainResult, meta: ChainResultToCsvOptions): string {
  if (meta.mode === "samples") {
    return chainSamplesToCsv(result, meta);
  }
  const headers = [
    "label",
    "completed",
    "scrapped",
    "reworked",
    "runningPct",
    "primaryReason",
    "primaryReasonPct",
    "oee",
    "availability",
    "performance",
    "quality",
  ];
  const lines: string[] = [headers.join(",")];

  // Bottlenecks are sorted by runningPct DESC; we want stations in chain
  // (label) order. Look up each station's bottleneck entry by stationId.
  for (let i = 0; i < result.perStationCompleted.length; i++) {
    const label = meta.stationLabels[i] ?? `Station ${String(i + 1)}`;
    const completed = result.perStationCompleted[i] ?? 0;
    const scrapped = result.perStationScrapped[i] ?? 0;
    const reworked = result.perStationReworked[i] ?? 0;
    // bottlenecks[i] doesn't correspond to station i by chain order — find by label.
    const bn = result.bottlenecks.find((b) => (b.label ?? "") === label) ?? result.bottlenecks[i];
    const oee = result.perStationOee[i];
    lines.push(
      [
        csvQuote(label),
        String(completed),
        String(scrapped),
        String(reworked),
        fmt(bn?.runningPct ?? 0),
        csvQuote(bn?.primaryReason ?? ""),
        fmt(bn?.primaryReasonPct ?? 0),
        fmt(oee?.oee ?? 0),
        fmt(oee?.availability ?? 0),
        fmt(oee?.performance ?? 0),
        fmt(oee?.quality ?? 0),
      ].join(","),
    );
  }
  return lines.join("\n");
}

/**
 * VROL-623 — samples-mode CSV. One row per (sample, station). Wide columns
 * for every state observed in any sample (alphabetically sorted) + every
 * edge's buffer fill at that sample.
 */
function chainSamplesToCsv(result: ChainResult, meta: RunExportMeta): string {
  // Collect the union of state names that appear in ANY sample. Alphabetically
  // sorted so column ordering is deterministic across runs.
  const stateSet = new Set<string>();
  for (const s of result.samples) {
    for (const stateMs of s.perStationStateMs) {
      for (const k of Object.keys(stateMs)) stateSet.add(k);
    }
  }
  const stateColumns = [...stateSet].sort();
  const edgeColumns = result.samples[0]?.perEdgeBufferFill.length ?? 0;
  // VROL-628 — surface the run-final per-station rework count alongside the
  // per-tick state-time. We don't have per-tick rework numbers from the
  // sampler; reporting the cumulative end-of-run value at every row is the
  // simplest honest answer for now (downstream consumers de-dup by station).
  const headers = [
    "tMs",
    "station",
    "completed",
    "reworked",
    ...stateColumns.map((s) => `${s}Ms`),
    ...Array.from({ length: edgeColumns }, (_, i) => `edge${String(i)}Fill`),
  ];
  const lines: string[] = [headers.join(",")];
  for (const sample of result.samples) {
    const N = sample.perStationCompleted.length;
    for (let stn = 0; stn < N; stn++) {
      const label = meta.stationLabels[stn] ?? `Station ${String(stn + 1)}`;
      const completed = sample.perStationCompleted[stn] ?? 0;
      const stateMs = sample.perStationStateMs[stn] ?? {};
      const reworked = result.perStationReworked[stn] ?? 0;
      const row = [
        String(sample.tMs),
        csvQuote(label),
        String(completed),
        String(reworked),
        ...stateColumns.map((s) => String(stateMs[s] ?? 0)),
        ...Array.from({ length: edgeColumns }, (_, i) => String(sample.perEdgeBufferFill[i] ?? 0)),
      ];
      lines.push(row.join(","));
    }
  }
  return lines.join("\n");
}

function csvQuote(s: string): string {
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    useGrouping: false,
  });
}

/**
 * Trigger a browser download of `content` as a file. Uses Blob + ObjectURL.
 * No-op when document isn't available (SSR, tests).
 */
export function downloadFile(filename: string, content: string, mime: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Suggested filename stem given the chain's primary label and a timestamp. */
export function suggestedFilenameStem(primaryLabel: string | undefined): string {
  const slug = (primaryLabel ?? "vrolen-run")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/T/, "-");
  return `${slug || "vrolen-run"}-${stamp.slice(0, 19)}`;
}
