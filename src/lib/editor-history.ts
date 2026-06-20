/**
 * VROL-309 — editor history primitives.
 *
 * Pure data + reducer for the past/future undo stacks. EditorPage owns the
 * live state (nodes / edges / settings) and uses this module to push
 * snapshots, undo, redo. Kept module-pure so it can be unit-tested without
 * a React renderer.
 *
 * Snapshots are reference snapshots — we trust the rest of the app to
 * treat nodes/edges/settings as immutable (which it does today: setNodes
 * always replaces the array). No deep-clone is needed.
 */

import type { Edge, Node } from "@xyflow/react";

import type { RunSettings } from "@/routes/editor-run-settings";

/** Snapshot of the three pieces of state covered by undo. */
export interface EditorSnapshot {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  readonly settings: RunSettings;
}

export interface EditorHistory {
  readonly past: readonly EditorSnapshot[];
  readonly future: readonly EditorSnapshot[];
}

/** Newest history entries live at the END of past[]; pop pulls the newest. */
export const EMPTY_HISTORY: EditorHistory = { past: [], future: [] };

/** Cap on stored snapshots to avoid unbounded memory growth. */
export const MAX_HISTORY = 100;

/**
 * Push a snapshot of the just-replaced state onto past[] + clear future[].
 * Called after a meaningful change is committed; the `previous` arg is
 * the state BEFORE the change.
 */
export function recordChange(history: EditorHistory, previous: EditorSnapshot): EditorHistory {
  const past = [...history.past, previous];
  // Cap from the front so newest entries are always retained.
  const trimmed = past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past;
  return { past: trimmed, future: [] };
}

export interface UndoResult {
  readonly history: EditorHistory;
  /** Snapshot to apply after undo; null if nothing to undo. */
  readonly applied: EditorSnapshot | null;
}

/**
 * Undo — pop newest snapshot off past[], push the current live state onto
 * future[], return the snapshot to apply.
 */
export function undo(history: EditorHistory, current: EditorSnapshot): UndoResult {
  if (history.past.length === 0) return { history, applied: null };
  const last = history.past[history.past.length - 1]!;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
    },
    applied: last,
  };
}

/**
 * Redo — pop newest snapshot off future[], push current onto past[], return
 * snapshot to apply.
 */
export function redo(history: EditorHistory, current: EditorSnapshot): UndoResult {
  if (history.future.length === 0) return { history, applied: null };
  const next = history.future[history.future.length - 1]!;
  return {
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
    },
    applied: next,
  };
}

export function canUndo(history: EditorHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: EditorHistory): boolean {
  return history.future.length > 0;
}

/**
 * VROL-659 — JSON-safe serialization of history for sessionStorage. Nodes
 * + edges + settings are already plain-object shapes; no custom types or
 * Maps to worry about. Returns a string the caller stores under whatever
 * key they like.
 */
export function serializeHistory(h: EditorHistory): string {
  return JSON.stringify({ past: h.past, future: h.future });
}

/**
 * Parse a previously-serialized history. Returns EMPTY_HISTORY on bad
 * input so a corrupt sessionStorage payload never breaks the editor.
 */
export function deserializeHistory(raw: string | null): EditorHistory {
  if (!raw) return EMPTY_HISTORY;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY_HISTORY;
    const obj = parsed as { past?: unknown; future?: unknown };
    const past = Array.isArray(obj.past) ? (obj.past as EditorSnapshot[]) : [];
    const future = Array.isArray(obj.future) ? (obj.future as EditorSnapshot[]) : [];
    // Apply the same cap on hydrate so a malformed payload with thousands
    // of snapshots can't blow up memory.
    return {
      past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
      future: future.length > MAX_HISTORY ? future.slice(future.length - MAX_HISTORY) : future,
    };
  } catch {
    return EMPTY_HISTORY;
  }
}
