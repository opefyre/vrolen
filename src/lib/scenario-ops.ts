/**
 * VROL-355 / VROL-1150-1151 — scenario operations layer.
 *
 * Sits on top of the existing scenario-store. Adds:
 *   - validateScenarioName() — pure name validator (length, charset,
 *     reserved prefix, uniqueness).
 *   - duplicateScenario() — read source, copy graph + settings under
 *     a new name. Throws structured ScenarioOpError so the UI can
 *     react to specific failure modes.
 *
 * Cloud sync (VROL-348 / 352) will route through these same
 * functions when the Supabase backend lands — pure helpers stay
 * unchanged.
 */

import { listScenarios, loadScenario, saveScenario } from "./scenario-store";

/** Reserved prefixes a user can't claim. */
const RESERVED_PREFIXES = ["vrolen.", "vrolen-internal-", "_"];
const NAME_MIN = 1;
const NAME_MAX = 60;

export type ScenarioNameValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "empty" | "too-long" | "control-char" | "reserved" | "duplicate";
      readonly message: string;
    };

/**
 * VROL-1151 — validate a scenario name in isolation. `existing`
 * defaults to the current store list when omitted so callers don't
 * need to thread it through. Pass `existing = []` to skip the
 * duplicate check (useful for previewing keystroke validation
 * inside a rename flow).
 */
export function validateScenarioName(
  name: string,
  existing?: readonly string[],
): ScenarioNameValidation {
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN) {
    return { ok: false, reason: "empty", message: "Name cannot be empty or whitespace-only." };
  }
  if (trimmed.length > NAME_MAX) {
    return {
      ok: false,
      reason: "too-long",
      message: `Name must be ≤ ${String(NAME_MAX)} characters.`,
    };
  }
  // Reject NUL + control chars so localStorage and any future SQL backend
  // don't get surprised. Allow tabs in case someone names a scenario
  // after a column header; everything else under U+0020 is suspect.
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i);
    if (c < 0x20 && c !== 0x09) {
      return {
        ok: false,
        reason: "control-char",
        message: "Name contains a control character.",
      };
    }
  }
  for (const prefix of RESERVED_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return {
        ok: false,
        reason: "reserved",
        message: `Names starting with "${prefix}" are reserved.`,
      };
    }
  }
  const list = existing ?? listScenarios().map((s) => s.name);
  if (list.includes(trimmed)) {
    return {
      ok: false,
      reason: "duplicate",
      message: `A scenario named "${trimmed}" already exists.`,
    };
  }
  return { ok: true };
}

export interface ScenarioOpError extends Error {
  readonly kind: "source-missing" | "invalid-name";
  readonly reason?: ScenarioNameValidation extends { ok: false; reason: infer R } ? R : never;
}

function opError(kind: ScenarioOpError["kind"], message: string, reason?: string): ScenarioOpError {
  const e = new Error(message) as Error & {
    kind?: ScenarioOpError["kind"];
    reason?: string;
  };
  e.kind = kind;
  if (reason !== undefined) e.reason = reason;
  return e as unknown as ScenarioOpError;
}

/**
 * VROL-1150 — copy the source scenario's graph + settings under a new
 * name. Throws ScenarioOpError on:
 *   - source not found ("source-missing")
 *   - new name fails validation ("invalid-name", with .reason set)
 *
 * Notes from the source carry over so the user doesn't lose context
 * when forking. lastUsedAtMs is reset (the duplicate starts fresh).
 */
export function duplicateScenario(sourceName: string, newName: string): void {
  const source = loadScenario(sourceName);
  if (!source) {
    throw opError("source-missing", `Scenario "${sourceName}" not found.`);
  }
  const v = validateScenarioName(newName);
  if (!v.ok) {
    throw opError("invalid-name", v.message, v.reason);
  }
  saveScenario(newName.trim(), {
    graph: source.graph,
    settings: source.settings,
    ...(source.notes ? { notes: source.notes } : {}),
  });
}
