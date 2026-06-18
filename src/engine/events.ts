/**
 * Engine event union — payloads carried by the Scheduler.
 *
 * The scheduler is generic over payload type. The engine wraps it with this
 * specific union so all callers see one source of truth for "what kinds of
 * scheduled events can fire."
 *
 * New event kinds: add to the union below, handle in whichever processor
 * owns them (CycleExecutor, MaintenanceManager, ScheduleExpander, etc.).
 * The discriminator is `kind`; exhaustiveness checks via switch keep the
 * dispatch table honest.
 */

import type { StationId } from "./ids";

export type EngineEvent =
  /** A station's in-progress cycle has reached its sampled completion time. */
  { readonly kind: "cycle-complete"; readonly stationId: StationId; readonly partIndex: number };

// Future event kinds (added in their own stories):
//   - "breakdown-start" / "repair-complete"        (VROL-123, MTBF/MTTR)
//   - "setup-complete"                              (VROL-127)
//   - "maintenance-start" / "maintenance-end"       (VROL-130)
//   - "shift-start" / "shift-end"                   (VROL-133)
//   - "material-replenishment"                      (VROL-153)
//   - "worker-arrived"                              (VROL-174, agent overlay)
