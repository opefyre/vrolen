/**
 * /editor Run-settings shape + persistence.
 *
 * Kept apart from EditorPage.tsx so the load/save helpers are unit-testable
 * and the type lives in one place. The drawer UI uses these values; the Run
 * button reads from them.
 *
 * Materials are applied to whichever node is currently selected in the
 * inspector — that selection isn't persisted here, only the on/off + the
 * quantity numbers.
 */

const STORAGE_KEY = "vrolen.editor-run-settings";

export interface MaterialsSettings {
  enabled: boolean;
  bottles: number;
  caps: number;
  replenishment: {
    enabled: boolean;
    atMs: number;
    amount: number;
  };
}

export interface BreakdownsSettings {
  enabled: boolean;
  mtbfMs: number;
  mttrMs: number;
}

export interface WorkerEntry {
  name: string;
  skills: string[];
  shiftEndMs: number;
}

export interface WorkersSettings {
  enabled: boolean;
  list: WorkerEntry[];
  /**
   * @deprecated Kept for back-compat with older payloads. The list field is
   * canonical from VROL-587 onward; mergeWithDefaults migrates the old shape
   * (count + shared skills) into list and drops these fields after.
   */
  count?: number;
  shiftEndMs?: number;
  skills?: string[];
}

export interface RunSettings {
  horizonMs: number;
  warmupMs: number;
  seed: number;
  interStationBufferCapacity: number;
  materials: MaterialsSettings;
  breakdowns: BreakdownsSettings;
  workers: WorkersSettings;
}

export const DEFAULT_RUN_SETTINGS: RunSettings = {
  horizonMs: 60_000,
  warmupMs: 5_000,
  seed: 0xc0ffee,
  interStationBufferCapacity: 10,
  materials: {
    enabled: false,
    bottles: 1000,
    caps: 1000,
    replenishment: {
      enabled: false,
      atMs: 10_000,
      amount: 500,
    },
  },
  breakdowns: {
    enabled: false,
    mtbfMs: 10_000,
    mttrMs: 2_000,
  },
  workers: {
    enabled: false,
    list: [{ name: "Worker 1", skills: ["any"], shiftEndMs: 60_000 }],
  },
};

export function loadRunSettings(): RunSettings {
  if (typeof window === "undefined") return DEFAULT_RUN_SETTINGS;
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (!raw) return DEFAULT_RUN_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<RunSettings>;
    return mergeWithDefaults(parsed);
  } catch {
    return DEFAULT_RUN_SETTINGS;
  }
}

export function saveRunSettings(s: RunSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Persistence unavailable; in-memory is fine.
  }
}

export function mergeWithDefaults(parsed: Partial<RunSettings>): RunSettings {
  const m: Partial<MaterialsSettings> = parsed.materials ?? {};
  const r: Partial<MaterialsSettings["replenishment"]> = m.replenishment ?? {};
  const b: Partial<BreakdownsSettings> = parsed.breakdowns ?? {};
  const w: Partial<WorkersSettings> = parsed.workers ?? {};
  return {
    horizonMs: parsed.horizonMs ?? DEFAULT_RUN_SETTINGS.horizonMs,
    warmupMs: parsed.warmupMs ?? DEFAULT_RUN_SETTINGS.warmupMs,
    seed: parsed.seed ?? DEFAULT_RUN_SETTINGS.seed,
    interStationBufferCapacity:
      parsed.interStationBufferCapacity ?? DEFAULT_RUN_SETTINGS.interStationBufferCapacity,
    materials: {
      enabled: m.enabled ?? DEFAULT_RUN_SETTINGS.materials.enabled,
      bottles: m.bottles ?? DEFAULT_RUN_SETTINGS.materials.bottles,
      caps: m.caps ?? DEFAULT_RUN_SETTINGS.materials.caps,
      replenishment: {
        enabled: r.enabled ?? DEFAULT_RUN_SETTINGS.materials.replenishment.enabled,
        atMs: r.atMs ?? DEFAULT_RUN_SETTINGS.materials.replenishment.atMs,
        amount: r.amount ?? DEFAULT_RUN_SETTINGS.materials.replenishment.amount,
      },
    },
    breakdowns: {
      enabled: b.enabled ?? DEFAULT_RUN_SETTINGS.breakdowns.enabled,
      mtbfMs: b.mtbfMs ?? DEFAULT_RUN_SETTINGS.breakdowns.mtbfMs,
      mttrMs: b.mttrMs ?? DEFAULT_RUN_SETTINGS.breakdowns.mttrMs,
    },
    workers: {
      enabled: w.enabled ?? DEFAULT_RUN_SETTINGS.workers.enabled,
      list: migrateWorkerList(w),
    },
  };
}

/**
 * Bring legacy WorkersSettings (count + shared skills + shiftEndMs) up to the
 * canonical list shape. New saves go through the list directly; this function
 * only kicks in when a localStorage payload from before VROL-587 is loaded.
 */
function migrateWorkerList(w: Partial<WorkersSettings>): WorkerEntry[] {
  if (Array.isArray(w.list) && w.list.length > 0) {
    return w.list
      .filter((e): e is WorkerEntry => !!e && typeof e === "object")
      .map((e) => ({
        name: typeof e.name === "string" && e.name.length > 0 ? e.name : "Worker",
        skills:
          Array.isArray(e.skills) && e.skills.length > 0
            ? e.skills.filter((s): s is string => typeof s === "string")
            : ["any"],
        shiftEndMs: typeof e.shiftEndMs === "number" && e.shiftEndMs > 0 ? e.shiftEndMs : 60_000,
      }));
  }
  const legacyCount = typeof w.count === "number" && w.count >= 1 ? Math.floor(w.count) : 1;
  const legacySkills =
    Array.isArray(w.skills) && w.skills.length > 0
      ? w.skills.filter((s): s is string => typeof s === "string")
      : ["any"];
  const legacyShift = typeof w.shiftEndMs === "number" && w.shiftEndMs > 0 ? w.shiftEndMs : 60_000;
  return Array.from({ length: legacyCount }, (_, i) => ({
    name: `Worker ${String(i + 1)}`,
    skills: [...legacySkills],
    shiftEndMs: legacyShift,
  }));
}
