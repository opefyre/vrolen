/**
 * Per-scenario run history (VROL-600).
 *
 * Keeps the last N compact run summaries per scenario name in localStorage.
 * After each successful run on /editor, if a scenario name is active, push a
 * summary here. The drawer surfaces the list under each saved scenario.
 *
 * Phase 0: localStorage only. Cloud sync (E10) will write the same shape to
 * Supabase. In-memory cache is canonical; localStorage is best-effort
 * persistence — works around happy-dom's flaky shim, same pattern as
 * scenario-store.
 */

const STORAGE_KEY = "vrolen.run-history";
const MAX_RUNS_PER_SCENARIO = 5;

import type { Edge, Node } from "@xyflow/react";

import type { RunSettings } from "@/routes/editor-run-settings";

export interface RunHistoryEntry {
  readonly completed: number;
  readonly throughputLambda: number;
  readonly lineOee: number;
  readonly avgTimeInSystemW: number;
  readonly runAtMs: number;
  /**
   * Snapshot of the graph + settings at the moment of this run (VROL-611).
   * Optional for back-compat with entries persisted before this field landed —
   * those entries can be listed but not replayed.
   */
  readonly payload?: {
    readonly graph: { readonly nodes: readonly Node[]; readonly edges: readonly Edge[] };
    readonly settings: RunSettings;
  };
}

type Store = Record<string, RunHistoryEntry[]>;

let cache: Store | null = null;

function hydrate(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Store;
    }
  } catch {
    // happy-dom shim or quota — fall through to in-memory only.
  }
  return {};
}

function readStore(): Store {
  if (cache === null) cache = hydrate();
  return cache;
}

function writeStore(store: Store): void {
  cache = store;
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

export function addRun(scenarioName: string, entry: RunHistoryEntry): void {
  const trimmed = scenarioName.trim();
  if (!trimmed) return;
  const store = { ...readStore() };
  const prev = store[trimmed] ?? [];
  // Newest first; cap to MAX_RUNS_PER_SCENARIO.
  store[trimmed] = [entry, ...prev].slice(0, MAX_RUNS_PER_SCENARIO);
  writeStore(store);
}

export function listRuns(scenarioName: string): readonly RunHistoryEntry[] {
  return readStore()[scenarioName] ?? [];
}

export function clearRuns(scenarioName: string): void {
  const store = readStore();
  if (!(scenarioName in store)) return;
  const next = { ...store };
  delete next[scenarioName];
  writeStore(next);
}

/** Test seam — reset both cache and localStorage to a known empty state. */
export function _clearAllForTests(): void {
  cache = {};
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.removeItem?.(STORAGE_KEY);
  } catch {
    // ignore
  }
}
