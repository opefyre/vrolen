/**
 * Persisted comparison runs (VROL-654).
 *
 * Mirrors run-history's pattern: in-memory cache + localStorage best-effort
 * persistence + a test seam. Comparisons are session-scoped today; this
 * layer lets users navigate away (close tab, switch route) and come back
 * to the same diff.
 *
 * Cap of 5 most-recent comparisons keeps localStorage small. Snapshots
 * serialize the FULL ChainResult of each side — that's the only way to
 * re-render charts + tiles without re-running. Maps inside ChainResult
 * (perProductCompleted) JSON-stringify to {} which is harmless for the
 * compare sheet, which doesn't read those fields.
 */

const STORAGE_KEY = "vrolen.comparison-history";
const MAX_COMPARISONS = 5;

import type { ChainResult } from "@/engine";

export interface ComparisonEntry {
  readonly id: string;
  readonly savedAtMs: number;
  readonly aName: string;
  readonly aResult: ChainResult;
  readonly aStationLabels: readonly string[];
  readonly bName: string;
  readonly bResult: ChainResult;
  readonly bStationLabels: readonly string[];
  readonly horizonMs: number;
  readonly warmupMs: number;
}

let cache: ComparisonEntry[] | null = null;

function hydrate(): ComparisonEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as ComparisonEntry[];
  } catch {
    // happy-dom shim or quota — in-memory only.
  }
  return [];
}

function readStore(): ComparisonEntry[] {
  if (cache === null) cache = hydrate();
  return cache;
}

function writeStore(next: ComparisonEntry[]): void {
  cache = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function addComparison(entry: ComparisonEntry): void {
  // Newest first; cap to MAX_COMPARISONS (oldest evicted).
  const next = [entry, ...readStore()].slice(0, MAX_COMPARISONS);
  writeStore(next);
}

export function listComparisons(): readonly ComparisonEntry[] {
  return readStore();
}

export function removeComparison(id: string): void {
  const next = readStore().filter((c) => c.id !== id);
  writeStore(next);
}

/** Test seam — reset both cache and localStorage to a known empty state. */
export function _clearAllForTests(): void {
  cache = [];
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.removeItem?.(STORAGE_KEY);
  } catch {
    // ignore
  }
}
