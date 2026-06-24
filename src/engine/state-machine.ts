/**
 * Station state machine.
 *
 * Every station in the engine lives in exactly one StationState at a time.
 * The cycle-execution loop (VROL-110), the breakdown scheduler, the schedule
 * expander, and the agent overlay all drive transitions through this state
 * machine. Subscribers (the renderer, KPI accumulator, AI auto-narrator)
 * listen on StationStateChange events.
 *
 * INVARIANT: only transitions in `ALLOWED_TRANSITIONS` are accepted. Any
 * other attempt throws InvalidTransitionError immediately — catches engine
 * bugs early. The table below IS the canonical state-transition diagram;
 * keep it readable.
 *
 * State semantics:
 *   - Idle: no part being worked, no scheduled event pending
 *   - Setup: changeover between products (or first-run setup)
 *   - Running: actively working a part
 *   - BlockedOut: finished a part but downstream buffer is full
 *   - Starved: ready to start a part but upstream/material is empty
 *   - Down: stochastic breakdown — until repair completes
 *   - Maintenance: scheduled downtime window
 *
 * The classification matters for KPIs: only Down counts as unplanned
 * downtime in OEE Availability; Maintenance + Setup count as planned.
 */

import type { StationId } from "./ids";

export type StationState =
  | "Idle"
  | "Setup"
  | "Running"
  | "BlockedOut"
  | "Starved"
  | "Down"
  | "Maintenance";

/** Reasons attached to every transition — surfaced in KPIs, narration, and the renderer. */
export type TransitionReason =
  | "start-cycle"
  | "cycle-complete"
  | "setup-start"
  | "setup-complete"
  | "blocked-downstream"
  | "downstream-cleared"
  | "starved-upstream"
  | "starved-material"
  | "starved-bom"
  | "starved-tool"
  | "upstream-available"
  | "no-skill-available"
  | "skill-available"
  | "breakdown"
  | "repair-complete"
  | "maintenance-start"
  | "maintenance-end"
  | "shift-end"
  | "shift-start";

export interface StationStateChange {
  readonly stationId: StationId;
  readonly fromState: StationState;
  readonly toState: StationState;
  readonly reason: TransitionReason;
  readonly timeMs: number;
}

/**
 * Canonical transition table. Each key is a from-state; the set is the
 * legal to-states from that from-state. Same-state transitions are NOT
 * allowed (catch infinite-loop bugs).
 */
const ALLOWED_TRANSITIONS: Readonly<Record<StationState, ReadonlySet<StationState>>> = {
  Idle: new Set<StationState>(["Setup", "Running", "Starved", "Down", "Maintenance"]),
  Setup: new Set<StationState>(["Running", "Down", "Maintenance", "Idle"]),
  Running: new Set<StationState>(["Idle", "Setup", "BlockedOut", "Starved", "Down", "Maintenance"]),
  BlockedOut: new Set<StationState>(["Running", "Idle", "Down", "Maintenance"]),
  Starved: new Set<StationState>(["Running", "Idle", "Down", "Maintenance"]),
  Down: new Set<StationState>(["Idle", "Running"]),
  Maintenance: new Set<StationState>(["Idle", "Running"]),
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly fromState: StationState,
    public readonly toState: StationState,
  ) {
    super(
      `Invalid station transition: ${fromState} → ${toState}. ` +
        `Allowed targets from ${fromState}: ${[...(ALLOWED_TRANSITIONS[fromState] ?? new Set())].join(", ")}.`,
    );
    this.name = "InvalidTransitionError";
  }
}

export type StateChangeListener = (event: StationStateChange) => void;

export class StationStateMachine {
  private state_: StationState = "Idle";
  private listeners: StateChangeListener[] = [];

  constructor(public readonly stationId: StationId) {}

  /** Current state. Read-only. */
  get state(): StationState {
    return this.state_;
  }

  /**
   * Apply a transition. Throws InvalidTransitionError if the (from → to)
   * pair is not in the allowed table. Notifies all subscribers with the
   * full StationStateChange event.
   */
  transition(to: StationState, reason: TransitionReason, timeMs: number): void {
    const from = this.state_;
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed.has(to)) {
      throw new InvalidTransitionError(from, to);
    }
    this.state_ = to;
    const event: StationStateChange = {
      stationId: this.stationId,
      fromState: from,
      toState: to,
      reason,
      timeMs,
    };
    // Copy listeners before iterating — guards against subscribers that
    // unsubscribe during their own callback.
    for (const fn of [...this.listeners]) {
      fn(event);
    }
  }

  /**
   * Subscribe to state-change events. Returns an unsubscribe function.
   * Multiple listeners are supported; all receive every event.
   */
  onStateChange(fn: StateChangeListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }
}

/** Convenience predicate: is the station currently doing productive work? */
export function isProductive(state: StationState): boolean {
  return state === "Running";
}

/** Convenience predicate: is the station unavailable for any work right now? */
export function isUnavailable(state: StationState): boolean {
  return state === "Down" || state === "Maintenance";
}

/** OEE Availability classification — unplanned downtime vs everything else. */
export function isUnplannedDowntime(state: StationState): boolean {
  return state === "Down";
}
