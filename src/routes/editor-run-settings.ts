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
  /** VROL-293 — qty per part consumed by the recipe-anchor station. */
  bottlesPerPart: number;
  capsPerPart: number;
  replenishment: {
    enabled: boolean;
    atMs: number;
    amount: number;
  };
  /**
   * VROL-643 — recurring / finite-rate deliveries authored from the drawer.
   * Translated into engine recurringReplenishments at run time.
   * material: which scenario material is delivered (matches the keys used by
   *   the existing one-shot replenishment).
   * amount: units delivered per fire (>= 0).
   * intervalMs: time between fires (> 0).
   * maxInventory: optional cap that clamps the pool so a fire that arrives
   *   when the pool is at-cap is a no-op.
   */
  recurring: ReadonlyArray<{
    material: "bottles" | "caps";
    amount: number;
    intervalMs: number;
    maxInventory?: number;
  }>;
}

export interface BreakdownsSettings {
  enabled: boolean;
  mtbfMs: number;
  mttrMs: number;
}

export interface WorkerBreak {
  startMs: number;
  endMs: number;
}

export interface WorkerEntry {
  name: string;
  skills: string[];
  shiftEndMs: number;
  /**
   * Optional break windows during the shift (VROL-616). Each break has
   * inclusive startMs and exclusive endMs. Out-of-shift breaks are silently
   * ignored when computing labor utilization; UI validation enforces end > start.
   */
  breaks?: WorkerBreak[];
}

export interface ProductsSettings {
  enabled: boolean;
  list: { id: string; name: string; weight: number }[];
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

export interface SourceSettings {
  /** VROL-651 — when on, the engine source is finite-rate (VROL-648). */
  enabled: boolean;
  /** Constant inter-arrival time in ms. UI authors as minutes. */
  intervalMs: number;
  /** Parts pushed per arrival event. Default 1. */
  batchSize: number;
}

export interface RunSettings {
  horizonMs: number;
  warmupMs: number;
  seed: number;
  interStationBufferCapacity: number;
  materials: MaterialsSettings;
  breakdowns: BreakdownsSettings;
  workers: WorkersSettings;
  products: ProductsSettings;
  source: SourceSettings;
  /**
   * Persist the canvas's "Animate flow on edges" toggle across reloads
   * (VROL-607). UI-only — engine ignores this.
   */
  animateFlow: boolean;
  /**
   * Sampler interval for the engine timeseries (VROL-612). 0 → sampler off.
   * Values > 0 enable per-tick snapshots used by the throughput chart
   * (VROL-613) and per-station sparklines (VROL-614).
   */
  samplerIntervalMs: number;
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
    bottlesPerPart: 1,
    capsPerPart: 1,
    replenishment: {
      enabled: false,
      atMs: 10_000,
      amount: 500,
    },
    recurring: [],
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
  products: {
    enabled: false,
    list: [
      { id: "A", name: "Product A", weight: 60 },
      { id: "B", name: "Product B", weight: 40 },
    ],
  },
  animateFlow: false,
  samplerIntervalMs: 0,
  source: {
    enabled: false,
    intervalMs: 60_000,
    batchSize: 1,
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
      // VROL-293 — qty per part. Default to 1 for back-compat with saved
      // scenarios that predate this field.
      bottlesPerPart:
        typeof m.bottlesPerPart === "number" && m.bottlesPerPart >= 0
          ? m.bottlesPerPart
          : DEFAULT_RUN_SETTINGS.materials.bottlesPerPart,
      capsPerPart:
        typeof m.capsPerPart === "number" && m.capsPerPart >= 0
          ? m.capsPerPart
          : DEFAULT_RUN_SETTINGS.materials.capsPerPart,
      replenishment: {
        enabled: r.enabled ?? DEFAULT_RUN_SETTINGS.materials.replenishment.enabled,
        atMs: r.atMs ?? DEFAULT_RUN_SETTINGS.materials.replenishment.atMs,
        amount: r.amount ?? DEFAULT_RUN_SETTINGS.materials.replenishment.amount,
      },
      recurring: sanitizeRecurring(m.recurring),
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
    products: {
      enabled: parsed.products?.enabled ?? DEFAULT_RUN_SETTINGS.products.enabled,
      list:
        Array.isArray(parsed.products?.list) && parsed.products.list.length > 0
          ? parsed.products.list
              .filter(
                (p): p is { id: string; name: string; weight: number } =>
                  !!p && typeof p === "object",
              )
              .map((p) => ({
                id: typeof p.id === "string" && p.id.length > 0 ? p.id : "default",
                name: typeof p.name === "string" && p.name.length > 0 ? p.name : p.id,
                weight: typeof p.weight === "number" && p.weight > 0 ? p.weight : 1,
              }))
          : DEFAULT_RUN_SETTINGS.products.list.slice(),
    },
    animateFlow:
      typeof parsed.animateFlow === "boolean"
        ? parsed.animateFlow
        : DEFAULT_RUN_SETTINGS.animateFlow,
    samplerIntervalMs:
      typeof parsed.samplerIntervalMs === "number" && parsed.samplerIntervalMs >= 0
        ? Math.floor(parsed.samplerIntervalMs)
        : DEFAULT_RUN_SETTINGS.samplerIntervalMs,
    source: sanitizeSource(parsed.source),
  };
}

function sanitizeSource(raw: unknown): SourceSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_RUN_SETTINGS.source };
  const r = raw as Partial<SourceSettings>;
  const intervalMs =
    typeof r.intervalMs === "number" && Number.isFinite(r.intervalMs) && r.intervalMs > 0
      ? Math.floor(r.intervalMs)
      : DEFAULT_RUN_SETTINGS.source.intervalMs;
  const batchSize =
    typeof r.batchSize === "number" && Number.isFinite(r.batchSize) && r.batchSize >= 1
      ? Math.floor(r.batchSize)
      : DEFAULT_RUN_SETTINGS.source.batchSize;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_RUN_SETTINGS.source.enabled,
    intervalMs,
    batchSize,
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
      .map((e) => {
        const base: WorkerEntry = {
          name: typeof e.name === "string" && e.name.length > 0 ? e.name : "Worker",
          skills:
            Array.isArray(e.skills) && e.skills.length > 0
              ? e.skills.filter((s): s is string => typeof s === "string")
              : ["any"],
          shiftEndMs: typeof e.shiftEndMs === "number" && e.shiftEndMs > 0 ? e.shiftEndMs : 60_000,
        };
        const breaks = sanitizeBreaks(e.breaks);
        if (breaks.length > 0) base.breaks = breaks;
        return base;
      });
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

/**
 * Drop malformed recurring-delivery rows so a corrupt localStorage payload
 * can't crash the engine wiring. Material defaults to "bottles", amount
 * and intervalMs are coerced to safe defaults (no-op when amount = 0).
 */
function sanitizeRecurring(raw: unknown): MaterialsSettings["recurring"] {
  if (!Array.isArray(raw)) return [];
  const out: MaterialsSettings["recurring"][number][] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const e = r as {
      material?: unknown;
      amount?: unknown;
      intervalMs?: unknown;
      maxInventory?: unknown;
    };
    const material: "bottles" | "caps" = e.material === "caps" ? "caps" : "bottles";
    const amount =
      typeof e.amount === "number" && Number.isFinite(e.amount) && e.amount >= 0
        ? Math.floor(e.amount)
        : 0;
    const intervalMs =
      typeof e.intervalMs === "number" && Number.isFinite(e.intervalMs) && e.intervalMs > 0
        ? Math.floor(e.intervalMs)
        : 60_000;
    const entry: MaterialsSettings["recurring"][number] = { material, amount, intervalMs };
    if (
      typeof e.maxInventory === "number" &&
      Number.isFinite(e.maxInventory) &&
      e.maxInventory >= 0
    ) {
      out.push({ ...entry, maxInventory: Math.floor(e.maxInventory) });
    } else {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Strip malformed break entries (VROL-616): non-objects, non-numeric / negative
 * bounds, end <= start. Returns a fresh array so callers can safely mutate.
 */
function sanitizeBreaks(raw: unknown): WorkerBreak[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkerBreak[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const r = b as { startMs?: unknown; endMs?: unknown };
    if (
      typeof r.startMs !== "number" ||
      typeof r.endMs !== "number" ||
      !Number.isFinite(r.startMs) ||
      !Number.isFinite(r.endMs) ||
      r.startMs < 0 ||
      r.endMs <= r.startMs
    ) {
      continue;
    }
    out.push({ startMs: Math.floor(r.startMs), endMs: Math.floor(r.endMs) });
  }
  return out;
}
