/**
 * Named scenario store (VROL-585).
 *
 * Bundles a graph (nodes + edges) plus run settings under a user-chosen name.
 * Persisted to localStorage under the single key `vrolen.scenarios` so the
 * whole set round-trips as one JSON blob.
 *
 * Phase 0: localStorage only. Cloud sync (E10) will write the same shape to
 * Supabase, so callers should keep using `saveScenario` / `loadScenario` and
 * the storage layer will be swapped underneath.
 */

import type { Edge, Node } from "@xyflow/react";

import type { RunSettings } from "@/routes/editor-run-settings";

const STORAGE_KEY = "vrolen.scenarios";

export interface ScenarioPayload {
  readonly graph: { nodes: Node[]; edges: Edge[] };
  readonly settings: RunSettings;
  readonly savedAtMs: number;
}

export interface ScenarioSummary {
  readonly name: string;
  readonly savedAtMs: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

type Store = Record<string, ScenarioPayload>;

// In-memory cache. localStorage acts as the persistence layer, but we read /
// write the cache for every call. Cache is hydrated from localStorage on
// first access (or after explicit reset via _clearStoreForTests).
let cache: Store | null = null;

function hydrateFromLocalStorage(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Store;
    }
  } catch {
    // ignore — happy-dom's localStorage shim is unreliable; in-memory is
    // canonical, persistence is best-effort.
  }
  return {};
}

function readStore(): Store {
  if (cache === null) cache = hydrateFromLocalStorage();
  return cache;
}

function writeStore(store: Store): void {
  cache = store;
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Persistence unavailable; in-memory is fine.
  }
}

export function listScenarios(): ScenarioSummary[] {
  const store = readStore();
  return Object.entries(store)
    .map(([name, p]) => ({
      name,
      savedAtMs: p.savedAtMs,
      nodeCount: p.graph.nodes.length,
      edgeCount: p.graph.edges.length,
    }))
    .sort((a, b) => b.savedAtMs - a.savedAtMs);
}

export function loadScenario(name: string): ScenarioPayload | null {
  const store = readStore();
  return store[name] ?? null;
}

export function saveScenario(
  name: string,
  payload: Omit<ScenarioPayload, "savedAtMs"> & {
    savedAtMs?: number;
  },
): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Scenario name cannot be empty");
  const store = readStore();
  store[trimmed] = {
    graph: payload.graph,
    settings: payload.settings,
    savedAtMs: payload.savedAtMs ?? performance.now(),
  };
  writeStore(store);
}

export function deleteScenario(name: string): boolean {
  const store = readStore();
  if (!(name in store)) return false;
  delete store[name];
  writeStore(store);
  return true;
}

/**
 * Test seam: clear everything in the store + reset the in-memory cache to
 * force a fresh hydrate on next access. Real usage should never need this.
 */
export function _clearStoreForTests(): void {
  cache = {};
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.removeItem?.(STORAGE_KEY);
  } catch {
    // ignore
  }
}
