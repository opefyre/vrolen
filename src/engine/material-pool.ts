/**
 * Material inventory pool.
 *
 * Tracks current quantity per material id. Stations declare their recipe
 * (which materials they consume per part); the cycle executor attempts to
 * consume from the pool before starting a cycle. If any required material
 * is short, the consume call returns false and the executor transitions the
 * station to Starved with reason "starved-material".
 *
 * Phase 0 scope:
 *   - Quantities are scalars (no batch awareness — a bottle is a bottle).
 *   - Consume is atomic across all required items in one call — all-or-nothing.
 *   - Replenishment is external — callers schedule replenish() calls via the
 *     scheduler, or invoke pool.replenish() directly when an event fires.
 *
 * Material runway (predicted-time-to-depletion) is exposed as a pure function
 * over the current pool state + a consumption rate map.
 */

import type { MaterialId } from "./ids";

export interface MaterialRequirement {
  readonly materialId: MaterialId;
  readonly qtyPerPart: number;
}

export class MaterialPool {
  private quantities = new Map<MaterialId, number>();

  constructor(initial: Iterable<readonly [MaterialId, number]> = []) {
    for (const [id, qty] of initial) {
      if (qty < 0) {
        throw new Error(
          `MaterialPool initial quantity for ${String(id)} cannot be negative, got ${String(qty)}`,
        );
      }
      this.quantities.set(id, qty);
    }
  }

  /** Current quantity available of a given material id. Zero if never set. */
  quantity(id: MaterialId): number {
    return this.quantities.get(id) ?? 0;
  }

  /**
   * Atomic consume — checks all requirements first, then deducts. If ANY
   * required material is insufficient, deducts NOTHING and returns false.
   * The caller should transition the station to Starved on a false return.
   */
  consume(requirements: ReadonlyArray<MaterialRequirement>): boolean {
    for (const r of requirements) {
      if (this.quantity(r.materialId) < r.qtyPerPart) return false;
    }
    for (const r of requirements) {
      this.quantities.set(r.materialId, this.quantity(r.materialId) - r.qtyPerPart);
    }
    return true;
  }

  /** Add to a material's quantity. */
  replenish(id: MaterialId, amount: number): void {
    if (amount < 0) {
      throw new Error(`MaterialPool.replenish requires non-negative amount, got ${String(amount)}`);
    }
    this.quantities.set(id, this.quantity(id) + amount);
  }

  /**
   * Determine which material would deplete first, given current quantities
   * and a per-material consumption rate (units per ms). Returns the first-to-
   * deplete entry: { materialId, runwayMs }. Returns null if no material has
   * a positive rate.
   */
  firstToDeplete(
    consumptionRatePerMs: ReadonlyMap<MaterialId, number>,
  ): { materialId: MaterialId; runwayMs: number } | null {
    let best: { materialId: MaterialId; runwayMs: number } | null = null;
    for (const [id, rate] of consumptionRatePerMs) {
      if (rate <= 0) continue;
      const runway = this.quantity(id) / rate;
      if (best === null || runway < best.runwayMs) {
        best = { materialId: id, runwayMs: runway };
      }
    }
    return best;
  }
}
