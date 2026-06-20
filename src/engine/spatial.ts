/**
 * VROL-163 / 166 / 170 / 174 / 178 / 182 — Agent Overlay Layer (E05).
 *
 * This module owns the spatial reasoning that sits ON TOP of the
 * discrete-event engine. The DES core doesn't know about positions —
 * it deals in events at instants. The agent overlay adds:
 *
 *   - Worker positions, velocities, and movement modes.
 *   - Straight-line interpolation between (current, target) positions.
 *     Per the design lock (no pathfinding tar-pit), every worker moves
 *     in a straight line; the visualizer can fade them through walls,
 *     that's fine for a portfolio sim.
 *   - Travel-time computation between any two points + a worker's
 *     position now.
 *   - Travel-time-aware ranking for "which idle worker should pick up
 *     this task next?" — the closer worker wins, ties broken by
 *     skill-match score.
 *   - Break / shift spatial transitions — workers move to a designated
 *     break point on break entry and to a shift-start point when their
 *     shift begins.
 *   - Spatial KPIs — walking distance per cycle and per-mode time
 *     breakdown for the worker utilization stack.
 *
 * The visualization layer (E06) consumes this module's snapshots to
 * render the canvas. The DES core treats these as black-box delays —
 * `travelTimeMs(from, to, speed)` returns ms, and the scheduler adds
 * it to the worker-arrival event.
 */

/** 2D point in world coordinates (mm). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Worker movement mode. Drives sprite + KPI bucket. */
export type WorkerMode = "idle" | "walking" | "working" | "break" | "off-shift" | "transition";

export interface WorkerSpatialState {
  readonly id: string;
  readonly position: Point;
  /** Target point the worker is moving toward; null when stationary. */
  readonly target: Point | null;
  /** Magnitude only; direction comes from (position, target). mm/ms. */
  readonly speed: number;
  readonly mode: WorkerMode;
  /** Last DES-tick time the state was advanced. */
  readonly lastUpdateMs: number;
}

/** Euclidean distance between two points (mm). */
export function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

/** Time (ms) to travel a straight line at the given speed. Speed in mm/ms. */
export function travelTimeMs(from: Point, to: Point, speedMmPerMs: number): number {
  if (speedMmPerMs <= 0) return Infinity;
  return distance(from, to) / speedMmPerMs;
}

/**
 * Advance a worker's position by `dtMs`. Straight-line lerp toward
 * `target`; clamps to target on arrival and flips mode to idle if the
 * caller doesn't override it. Pure — returns a new state.
 */
export function advanceWorker(
  state: WorkerSpatialState,
  dtMs: number,
  nowMs: number,
): WorkerSpatialState {
  if (state.target === null || state.speed <= 0 || dtMs <= 0) {
    return { ...state, lastUpdateMs: nowMs };
  }
  const total = distance(state.position, state.target);
  if (total === 0) {
    return { ...state, mode: state.mode === "walking" ? "idle" : state.mode, lastUpdateMs: nowMs };
  }
  const traveled = state.speed * dtMs;
  if (traveled >= total) {
    return {
      ...state,
      position: state.target,
      target: null,
      mode: state.mode === "walking" ? "idle" : state.mode,
      lastUpdateMs: nowMs,
    };
  }
  const frac = traveled / total;
  return {
    ...state,
    position: {
      x: state.position.x + (state.target.x - state.position.x) * frac,
      y: state.position.y + (state.target.y - state.position.y) * frac,
    },
    lastUpdateMs: nowMs,
  };
}

/**
 * VROL-170 — pick the best worker for a task at `taskPosition`.
 * Returns the worker id, ranked by (travel time ascending, then
 * skill-match score descending). `skillMatch` returns a non-negative
 * score for each (workerId, requirement) pair (higher = better fit;
 * 0 means missing a required skill).
 */
export interface WorkerCandidate {
  readonly id: string;
  readonly position: Point;
  readonly speedMmPerMs: number;
  readonly mode: WorkerMode;
}

export interface RankOptions {
  readonly skillMatch?: (workerId: string) => number;
  /** Skip workers in these modes — defaults to filtering out "off-shift" + "break". */
  readonly excludeModes?: readonly WorkerMode[];
}

export function rankWorkers(
  candidates: readonly WorkerCandidate[],
  taskPosition: Point,
  options: RankOptions = {},
): readonly string[] {
  const excluded = new Set<WorkerMode>(options.excludeModes ?? ["off-shift", "break"]);
  const eligible = candidates.filter((c) => !excluded.has(c.mode));
  const scored = eligible.map((c) => ({
    id: c.id,
    travelMs: travelTimeMs(c.position, taskPosition, c.speedMmPerMs),
    fit: options.skillMatch ? options.skillMatch(c.id) : 1,
  }));
  scored.sort((a, b) => {
    if (a.travelMs !== b.travelMs) return a.travelMs - b.travelMs;
    return b.fit - a.fit;
  });
  return scored.map((s) => s.id);
}

/**
 * VROL-178 — break + shift transitions.
 *
 * Returns the next state the worker should move toward given the current
 * scheduling signal. Caller still emits the DES event (engine doesn't
 * know about positions); this just decides target + mode.
 */
export interface ShiftSignal {
  readonly kind: "start-shift" | "end-shift" | "start-break" | "end-break";
  readonly shiftStartPos?: Point;
  readonly breakPos?: Point;
  readonly stationPos?: Point;
}

export function applyShiftSignal(
  state: WorkerSpatialState,
  signal: ShiftSignal,
  nowMs: number,
): WorkerSpatialState {
  switch (signal.kind) {
    case "start-shift":
      return signal.shiftStartPos
        ? {
            ...state,
            target: signal.shiftStartPos,
            mode: "transition",
            lastUpdateMs: nowMs,
          }
        : { ...state, mode: "idle", lastUpdateMs: nowMs };
    case "end-shift":
      return { ...state, target: null, mode: "off-shift", lastUpdateMs: nowMs };
    case "start-break":
      return signal.breakPos
        ? { ...state, target: signal.breakPos, mode: "transition", lastUpdateMs: nowMs }
        : { ...state, mode: "break", lastUpdateMs: nowMs };
    case "end-break":
      return signal.stationPos
        ? { ...state, target: signal.stationPos, mode: "transition", lastUpdateMs: nowMs }
        : { ...state, mode: "idle", lastUpdateMs: nowMs };
  }
}

/**
 * VROL-182 — spatial KPI accumulator. Tracks (a) total walking
 * distance per worker and (b) ms spent in each WorkerMode. Caller feeds
 * advanceWorker() output via `record()`; `snapshot()` returns the
 * aggregates for the run summary.
 */
export class SpatialKpi {
  private walkingMm = new Map<string, number>();
  private modeMs = new Map<string, Map<WorkerMode, number>>();

  record(prev: WorkerSpatialState, next: WorkerSpatialState): void {
    const dtMs = Math.max(0, next.lastUpdateMs - prev.lastUpdateMs);
    if (dtMs <= 0) return;
    const id = prev.id;
    const moved = distance(prev.position, next.position);
    if (moved > 0) {
      this.walkingMm.set(id, (this.walkingMm.get(id) ?? 0) + moved);
    }
    const bucket = this.modeMs.get(id) ?? new Map<WorkerMode, number>();
    bucket.set(prev.mode, (bucket.get(prev.mode) ?? 0) + dtMs);
    this.modeMs.set(id, bucket);
  }

  snapshot(): {
    readonly walkingMm: ReadonlyMap<string, number>;
    readonly modeMs: ReadonlyMap<string, ReadonlyMap<WorkerMode, number>>;
  } {
    return { walkingMm: this.walkingMm, modeMs: this.modeMs };
  }
}
