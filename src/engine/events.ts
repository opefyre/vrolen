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
    }
  /**
   * A scheduled worker break has ended (VROL-618). The orchestrator handling
   * this event nudges every executor's attemptStart so stations that were
   * Starved because all workers were on break can resume now that the break
   * window has closed. Not tied to any single station/worker — workers
   * become re-available implicitly via WorkerPool.isOnBreak's time check.
   */
  | { readonly kind: "break-end" };

// Future event kinds (added in their own stories):
//   - "shift-start" / "shift-end"                   (VROL-133)
//   - "worker-arrived"                              (VROL-174, agent overlay)
