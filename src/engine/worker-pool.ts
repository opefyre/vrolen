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
      if (!hasAllSkills(worker, requiredSkills)) continue;
      this.assigned.add(worker.id);
      return worker;
    }
    return null;
  }

  /** Release a previously-requested worker back into the pool. */
  release(workerId: ResourceId): void {
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
