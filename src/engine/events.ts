/**
 * Engine event union — payloads carried by the Scheduler.
 *
 * The scheduler is generic over payload type. The engine wraps it with this
 * specific union so all callers see one source of truth for "what kinds of
 * scheduled events can fire."
 *
 * New event kinds: add to the union below, handle in whichever processor
 * owns them (CycleExecutor, BreakdownManager, MaintenanceManager,
 * ScheduleExpander, etc.). The discriminator is `kind`; exhaustiveness
 * checks via switch keep the dispatch table honest.
 */

import type { MaterialId, StationId } from "./ids";

export type EngineEvent =
  /** A station's in-progress cycle has reached its sampled completion time. */
  | { readonly kind: "cycle-complete"; readonly stationId: StationId; readonly partIndex: number }
  /** Station's MTBF clock has elapsed — fire a breakdown. */
  | { readonly kind: "breakdown-start"; readonly stationId: StationId }
  /** Station's MTTR clock has elapsed — repair is complete. */
  | { readonly kind: "repair-complete"; readonly stationId: StationId }
  /** Station's pre-cycle setup time has elapsed — ready to begin Running. */
  | { readonly kind: "setup-complete"; readonly stationId: StationId }
  /** A scheduled maintenance window for the station has begun. */
  | { readonly kind: "maintenance-start"; readonly stationId: StationId }
  /** A scheduled maintenance window for the station has ended. */
  | { readonly kind: "maintenance-end"; readonly stationId: StationId }
  /**
   * A scheduled material replenishment has arrived — add `amount` units of
   * `materialId` to the pool. The orchestrator handling this event is also
   * responsible for nudging any starved stations that consume this material
   * (executor.onUpstreamAvailable on their next tick).
   */
  | {
      readonly kind: "material-replenishment";
      readonly materialId: MaterialId;
      readonly amount: number;
      /**
       * Optional inventory ceiling (VROL-642). When set, the handler clamps
       * the effective added quantity to max(0, maxInventory - currentQty),
       * so a recurring replenishment that arrives when the pool is already
       * full is a no-op. One-shot events leave this undefined.
       */
      readonly maxInventory?: number;
    }
  /**
   * VROL-648 — a scheduled source arrival has landed. The orchestrator
   * pushes `batchSize` parts into the source station's input buffer +
   * samples + schedules the next arrival.
   */
  | {
      readonly kind: "source-arrival";
      readonly batchSize: number;
    }
  /**
   * A scheduled worker break has ended (VROL-618). The orchestrator handling
   * this event nudges every executor's attemptStart so stations that were
   * Starved because all workers were on break can resume now that the break
   * window has closed. Not tied to any single station/worker — workers
   * become re-available implicitly via WorkerPool.isOnBreak's time check.
   */
  | { readonly kind: "break-end" }
  // VROL-916 — CIP recurring fire. Dispatched per-station: transitions
  // state to Maintenance, schedules maintenance-end after cipDurationMs,
  // and re-schedules the NEXT cip-fire one cipEveryMs later.
  | { readonly kind: "cip-fire"; readonly stationId: StationId }
  // VROL-919 — random event fire. eventIdx selects which entry in the
  // station's randomEvents array fired; the dispatcher uses it to look up
  // the durationMs + next exponential gap. Station goes Down for that
  // duration; random-event-end re-arms the executor.
  | { readonly kind: "random-event-fire"; readonly stationId: StationId; readonly eventIdx: number }
  | { readonly kind: "random-event-end"; readonly stationId: StationId };

// Future event kinds (added in their own stories):
//   - "shift-start" / "shift-end"                   (VROL-133)
//   - "worker-arrived"                              (VROL-174, agent overlay)
