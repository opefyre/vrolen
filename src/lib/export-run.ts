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
 * Build a per-station CSV summary. One header row, then one row per station.
 * Columns: label, completed, scrapped, runningPct, primaryReason,
 * primaryReasonPct, oee, availability, performance, quality.
 */
export function chainResultToCsv(result: ChainResult, meta: RunExportMeta): string {
  const headers = [
    "label",
    "completed",
    "scrapped",
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
    // bottlenecks[i] doesn't correspond to station i by chain order — find by label.
    const bn = result.bottlenecks.find((b) => (b.label ?? "") === label) ?? result.bottlenecks[i];
    const oee = result.perStationOee[i];
    lines.push(
      [
        csvQuote(label),
        String(completed),
        String(scrapped),
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
