/**
 * Worker pool with skill-based assignment + shift windows.
 *
 * Workers each carry a set of skill tags and a list of on-shift windows.
 * Stations declare required skills; when a station needs a worker, it asks
 * the pool for one matching its skills. The pool returns an available worker
 * (one whose skills cover the requirement AND who's currently on-shift AND
 * not already assigned), or null if none.
 *
 * Determinism: workers are checked in a stable insertion order, so the first
 * eligible worker wins. Same input sequence → same assignments.
 *
 * Phase 0 scope:
 *   - One worker per assignment (no team requirements)
 *   - request/release model — caller releases when the worker is done
 *   - "NoSkillAvailable" is not modeled as a separate StationState; it surfaces
 *     as a Starved transition with reason "no-skill-available", which the
 *     state machine already supports.
 */

import type { ResourceId } from "./ids";

export interface ShiftWindow {
  readonly startMs: number;
  readonly endMs: number;
}

export interface PoolWorker {
  readonly id: ResourceId;
  readonly name: string;
  readonly skills: readonly string[];
  readonly shifts: readonly ShiftWindow[];
  /**
   * Optional break windows (VROL-616). During a break the worker is unavailable
   * for new assignments — request() rejects them. Breaks outside the worker's
   * shift are silently ignored when computing labor utilization denominators.
   *
   * The pool does NOT yank workers mid-cycle: a break that starts while a
   * worker is mid-assignment kicks in only when the current cycle completes
   * (workers are released at handleCycleComplete; the next request() then sees
   * the break window).
   */
  readonly breaks?: readonly ShiftWindow[];
  /**
   * VROL-884 — skill tier label, free-form (e.g., "junior", "senior",
   * "trainee"). Display-only; not consumed by the engine. Defaults undefined.
   */
  readonly tier?: string;
  /**
   * VROL-884 — per-worker cycle multiplier. When set, the station cycle time
   * is multiplied by this value while the worker is assigned. junior=1.3
   * means the worker takes 30% longer than nominal; senior=0.85 means 15%
   * faster. Defaults to 1.0 (no effect). Validated as > 0 at run init.
   */
  readonly cycleMultiplier?: number;
}

export class WorkerPool {
  private readonly workers: PoolWorker[];
  private readonly assigned = new Set<ResourceId>();

  constructor(workers: readonly PoolWorker[]) {
    this.workers = [...workers];
  }

  /**
   * Find a worker that:
   *   - has ALL the required skills
   *   - is currently on-shift at timeMs
   *   - is not already assigned
   *
   * Returns the worker if found and atomically marks it assigned. Returns
   * null otherwise; the caller transitions the station to Starved with
   * reason "no-skill-available" (handled at the cycle-executor layer).
   */
  request(requiredSkills: readonly string[], timeMs: number): PoolWorker | null {
    for (const worker of this.workers) {
      if (this.assigned.has(worker.id)) continue;
      if (!this.isOnShift(worker, timeMs)) continue;
      // VROL-616 — workers on break are unavailable for NEW assignments.
      // (An already-running cycle isn't interrupted; release happens at
      // cycle complete, after which subsequent requests see the break window.)
      if (isOnBreak(worker, timeMs)) continue;
      if (!hasAllSkills(worker, requiredSkills)) continue;
      this.assigned.add(worker.id);
      return worker;
    }
    return null;
  }

  /**
   * Release a previously-requested worker back into the pool.
   *
   * The optional `timeMs` is unused by the base pool — it exists so
   * subclasses (e.g., the tracking pool in chain-harness) can record the
   * worker's accumulated busy time for utilization KPIs.
   */
  release(workerId: ResourceId, _timeMs?: number): void {
    void _timeMs;
    this.assigned.delete(workerId);
  }

  /** True if the worker has at least one shift window containing timeMs. */
  isOnShift(worker: PoolWorker, timeMs: number): boolean {
    for (const shift of worker.shifts) {
      if (timeMs >= shift.startMs && timeMs < shift.endMs) return true;
    }
    return false;
  }

  /** Diagnostic: count of currently assigned workers. */
  get activeAssignments(): number {
    return this.assigned.size;
  }
}

function hasAllSkills(worker: PoolWorker, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  const set = new Set(worker.skills);
  for (const skill of required) {
    if (!set.has(skill)) return false;
  }
  return true;
}

/**
 * True if any break window contains timeMs (VROL-616). Break-half-open
 * convention matches shifts: [startMs, endMs).
 */
export function isOnBreak(worker: PoolWorker, timeMs: number): boolean {
  if (!worker.breaks) return false;
  for (const brk of worker.breaks) {
    if (timeMs >= brk.startMs && timeMs < brk.endMs) return true;
  }
  return false;
}

/**
 * Compute the worker's effective availability ms within [windowStartMs,
 * windowEndMs] (VROL-616): time inside ANY shift, minus time inside ANY break
 * (intersected with a shift, since out-of-shift breaks don't reduce util).
 *
 * Both shift and break lists are merged on the fly so overlapping or
 * touching windows count once, not twice.
 */
export function effectiveAvailableMs(
  worker: PoolWorker,
  windowStartMs: number,
  windowEndMs: number,
): number {
  const onShift = intersectAndMerge(worker.shifts, windowStartMs, windowEndMs);
  if (onShift.length === 0) return 0;
  if (!worker.breaks || worker.breaks.length === 0) {
    return totalMs(onShift);
  }
  const onBreak = intersectAndMerge(worker.breaks, windowStartMs, windowEndMs);
  if (onBreak.length === 0) return totalMs(onShift);
  // Subtract: for each on-shift window, remove its intersection with merged breaks.
  let available = 0;
  for (const shift of onShift) {
    let shiftAvailable = shift.endMs - shift.startMs;
    for (const brk of onBreak) {
      const ovStart = Math.max(shift.startMs, brk.startMs);
      const ovEnd = Math.min(shift.endMs, brk.endMs);
      if (ovEnd > ovStart) shiftAvailable -= ovEnd - ovStart;
    }
    available += Math.max(0, shiftAvailable);
  }
  return available;
}

function intersectAndMerge(
  windows: readonly ShiftWindow[],
  windowStartMs: number,
  windowEndMs: number,
): ShiftWindow[] {
  const clipped: ShiftWindow[] = [];
  for (const w of windows) {
    const start = Math.max(w.startMs, windowStartMs);
    const end = Math.min(w.endMs, windowEndMs);
    if (end > start) clipped.push({ startMs: start, endMs: end });
  }
  if (clipped.length <= 1) return clipped;
  clipped.sort((a, b) => a.startMs - b.startMs);
  const merged: ShiftWindow[] = [];
  for (const w of clipped) {
    const last = merged[merged.length - 1];
    if (last && w.startMs <= last.endMs) {
      merged[merged.length - 1] = {
        startMs: last.startMs,
        endMs: Math.max(last.endMs, w.endMs),
      };
    } else {
      merged.push(w);
    }
  }
  return merged;
}

function totalMs(windows: readonly ShiftWindow[]): number {
  let sum = 0;
  for (const w of windows) sum += w.endMs - w.startMs;
  return sum;
}
