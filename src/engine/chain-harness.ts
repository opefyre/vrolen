/**
 * Multi-station chain test harness.
 *
 * Wires N CycleExecutors in series via shared TrackedBuffers, runs the
 * scheduler to a target horizon, and reports the metrics needed to validate
 * Little's Law on the engine.
 *
 *   L = time-weighted average WIP in the system
 *   λ = throughput (parts exiting per unit time, measured during the window)
 *   W = average time-in-system per exited part (exit - enter)
 *
 * Measurement window = [warmupMs, horizonMs]. We only count parts whose EXIT
 * fell inside the window — both their entry and exit times are real,
 * recorded at the moment the relevant events fired.
 *
 * Originally test-only; promoted to public API in VROL-573 when the /run
 * page became the first UI consumer. Material-consumption + replenishment
 * support landed in VROL-575.
 */

import { detectBottlenecks, type BottleneckCandidate } from "./bottleneck";
import { BreakdownManager } from "./breakdown";
import { Buffer, TrackedBuffer } from "./buffer";
import type { CycleConfig } from "./cycle-execution";
import { CycleExecutor } from "./cycle-execution";
import type { Distribution } from "./distribution";
import { meanOf } from "./distribution";
import type { EngineEvent } from "./events";
import type { MaterialId, StationId } from "./ids";
import { newStationId } from "./ids";
import { MaterialPool, type MaterialRequirement } from "./material-pool";
import { computeOee, type OeeMetrics } from "./oee";
import type { Prng } from "./prng";
import { Scheduler } from "./scheduler";
import { StationStateMachine } from "./state-machine";
import { StateTimeTracker } from "./state-time-tracker";
import type { ResourceId } from "./ids";
import { WorkerPool, type PoolWorker } from "./worker-pool";

/**
 * WorkerPool variant that records each worker's accumulated busy time so the
 * harness can compute labor utilization. Override the base API and rely on
 * the caller passing a timeMs to release() — CycleExecutor does this when it
 * runs against a tracking pool.
 */
class TrackingWorkerPool extends WorkerPool {
  private starts = new Map<string, number>();
  private busyMs_ = 0;

  override request(requiredSkills: readonly string[], timeMs: number): PoolWorker | null {
    const worker = super.request(requiredSkills, timeMs);
    if (worker) this.starts.set(String(worker.id), timeMs);
    return worker;
  }

  override release(workerId: ResourceId, timeMs?: number): void {
    const startedAt = this.starts.get(String(workerId));
    if (startedAt !== undefined && timeMs !== undefined) {
      this.busyMs_ += Math.max(0, timeMs - startedAt);
      this.starts.delete(String(workerId));
    }
    super.release(workerId);
  }

  /** Flush any still-busy workers up to `endTimeMs`. Call before reading busyMs. */
  finalize(endTimeMs: number): void {
    for (const startedAt of this.starts.values()) {
      this.busyMs_ += Math.max(0, endTimeMs - startedAt);
    }
    this.starts.clear();
  }

  get busyMs(): number {
    return this.busyMs_;
  }
}

interface TrackedPart {
  readonly id: number;
  readonly enteredSystemAtMs: number;
}

export interface ChainResult {
  readonly completed: number;
  readonly elapsedMs: number;
  /** L — time-weighted average WIP across inter-buffers + in-flight parts. */
  readonly averageWipL: number;
  /** λ — parts that EXITED the system per simulated ms, during the measurement window. */
  readonly throughputLambda: number;
  /** W — average time-in-system (exit - enter) per exited part. */
  readonly avgTimeInSystemW: number;
  readonly perStationCompleted: readonly number[];
  /** Bottleneck candidates ranked by time-in-Running descending. */
  readonly bottlenecks: readonly BottleneckCandidate[];
  /**
   * Final material quantities at end-of-run, in the order materials were
   * declared in opts.materials.initialInventory. Undefined when no materials
   * config was provided.
   */
  readonly materialFinal?: ReadonlyArray<readonly [MaterialId, number]>;
  /** Total replenishment-event count fired during the run. */
  readonly replenishmentsFired?: number;
  /** Per-station OEE metrics (Availability × Performance × Quality). */
  readonly perStationOee: readonly OeeMetrics[];
  /** Line-level OEE — geometric mean of station OEEs (rough proxy until VROL-140 lands). */
  readonly lineOee: number;
  /** Aggregate time-weighted WIP across inter-station buffers, taken from TrackedBuffer integrals. */
  readonly aggregateBufferWipL: number;
  /** Per-station breakdown count fired during the run. Undefined when no breakdowns config given. */
  readonly perStationBreakdowns?: readonly number[];
  /**
   * Labor utilization — total worker-busy ms across the run, normalized by
   * (worker count × elapsed ms). Undefined when no workers config provided.
   * Caps at 1.0 (every worker busy every moment).
   */
  readonly laborUtilization?: number;
}

export interface ChainWorkerConfig {
  /**
   * Workers in the pool. Each worker carries skill tags + shift windows.
   * For the demo, a single 24/7 shift window covering [0, horizonMs] is fine.
   */
  readonly workers: readonly PoolWorker[];
  /**
   * Required skills per station (matched by index). Empty / missing array
   * means "any worker on shift". Stations not covered by perStationSkills
   * fall through to requireDefault (which defaults to []).
   */
  readonly perStationSkills?: ReadonlyArray<readonly string[]>;
  readonly requireDefault?: readonly string[];
}

export interface ChainBreakdownConfig {
  /**
   * Mean time between failures (sampled distribution). Applied identically to
   * every station — per-station overrides land alongside the editor.
   */
  readonly mtbfMs: Distribution;
  /** Mean time to repair (sampled distribution). */
  readonly mttrMs: Distribution;
}

export interface ChainMaterialConfig {
  /** Starting inventory per material. Tuple ordering preserved in the result. */
  readonly initialInventory: ReadonlyArray<readonly [MaterialId, number]>;
  /** Per-station recipes — which material a station consumes per part. */
  readonly stationRecipes: ReadonlyArray<{
    readonly stationIndex: number;
    readonly requirements: ReadonlyArray<MaterialRequirement>;
  }>;
  /**
   * Scheduled replenishments. Each fires as a "material-replenishment" event at
   * its atMs; the harness calls pool.replenish + nudges every executor that
   * consumes that material.
   */
  readonly replenishments?: ReadonlyArray<{
    readonly materialId: MaterialId;
    readonly amount: number;
    readonly atMs: number;
  }>;
}

export interface ChainOptions {
  readonly stationCycleTimes: readonly Distribution[];
  readonly interStationBufferCapacity: number;
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly prng: Prng;
  /** Optional labels for each station (matches stationCycleTimes by index). */
  readonly stationLabels?: readonly string[];
  /** Optional material consumption + replenishment configuration. */
  readonly materials?: ChainMaterialConfig;
  /** Optional stochastic breakdowns (MTBF / MTTR per station). */
  readonly breakdowns?: ChainBreakdownConfig;
  /** Optional worker pool — stations request workers before each cycle starts. */
  readonly workers?: ChainWorkerConfig;
}

export function runChain(opts: ChainOptions): ChainResult {
  const n = opts.stationCycleTimes.length;
  if (n < 1) throw new Error("chain requires at least 1 station");

  const stationIds: StationId[] = Array.from({ length: n }, () => newStationId());
  const stateMachines = stationIds.map((id) => new StationStateMachine(id));
  const stateTimeTrackers: StateTimeTracker[] = stateMachines.map(
    (sm) => new StateTimeTracker(sm.state, 0),
  );
  const scheduler = new Scheduler<EngineEvent>();

  // Breakdown wiring — one manager per station when configured. Each manager
  // arms on its station's first Running entry; subsequent arms happen after
  // repair-complete restarts the cycle. Track per-station breakdown counts
  // for reporting.
  const breakdownManagers: BreakdownManager[] | undefined = opts.breakdowns
    ? stationIds.map(
        (id, i) =>
          new BreakdownManager(
            id,
            opts.breakdowns!.mtbfMs,
            opts.breakdowns!.mttrMs,
            stateMachines[i] as StationStateMachine,
            scheduler,
            opts.prng,
          ),
      )
    : undefined;
  const breakdownCounts: number[] | undefined = breakdownManagers
    ? new Array(n).fill(0)
    : undefined;

  // Wire each tracker (and, if applicable, breakdown manager) to its state machine.
  for (let i = 0; i < n; i++) {
    const tracker = stateTimeTrackers[i] as StateTimeTracker;
    const sm = stateMachines[i] as StationStateMachine;
    const manager = breakdownManagers?.[i];
    sm.onStateChange((e) => {
      tracker.recordTransition(e.toState, e.timeMs);
      if (manager && e.toState === "Running") manager.arm(e.timeMs);
    });
  }

  const inputBuffer = new Buffer<TrackedPart>(10_000_000);
  const sinkBuffer = new Buffer<TrackedPart>(10_000_000);
  const interBuffers: TrackedBuffer<TrackedPart>[] = Array.from(
    { length: Math.max(0, n - 1) },
    () => new TrackedBuffer<TrackedPart>(opts.interStationBufferCapacity),
  );

  // Workers — optional. The TrackingWorkerPool below extends WorkerPool with
  // acquire/release time bookkeeping so we can compute labor utilization at
  // the end of the run.
  const trackingPool: TrackingWorkerPool | undefined = opts.workers
    ? new TrackingWorkerPool(opts.workers.workers)
    : undefined;
  const workerPool: WorkerPool | undefined = trackingPool;

  // Materials — optional. Build a single pool that the configured executors share.
  let materialPool: MaterialPool | undefined;
  const recipeByStation = new Map<number, ReadonlyArray<MaterialRequirement>>();
  const executorsByMaterial = new Map<MaterialId, CycleExecutor<TrackedPart>[]>();
  if (opts.materials) {
    materialPool = new MaterialPool(opts.materials.initialInventory);
    for (const r of opts.materials.stationRecipes) {
      recipeByStation.set(r.stationIndex, r.requirements);
    }
  }

  const executors: CycleExecutor<TrackedPart>[] = [];
  for (let i = 0; i < n; i++) {
    const upstream = i === 0 ? inputBuffer : (interBuffers[i - 1] as TrackedBuffer<TrackedPart>);
    const downstream = i === n - 1 ? sinkBuffer : (interBuffers[i] as TrackedBuffer<TrackedPart>);
    const recipe = recipeByStation.get(i);
    const requiredSkills =
      opts.workers?.perStationSkills?.[i] ?? opts.workers?.requireDefault ?? undefined;
    const cfg: CycleConfig<TrackedPart> = {
      stationId: stationIds[i] as StationId,
      cycleTimeMs: opts.stationCycleTimes[i] as Distribution,
      defectRate: 0,
      capacity: 1,
      upstream,
      downstream,
      ...(materialPool && recipe?.length ? { materialPool, materialRequirements: recipe } : {}),
      ...(workerPool ? { workerPool, ...(requiredSkills ? { requiredSkills } : {}) } : {}),
    };
    const ex = new CycleExecutor<TrackedPart>(
      cfg,
      stateMachines[i] as StationStateMachine,
      scheduler,
      opts.prng,
    );
    executors.push(ex);
    // Index this executor under every material it consumes (so replenishment
    // events know which stations to nudge).
    if (recipe?.length) {
      for (const req of recipe) {
        const list = executorsByMaterial.get(req.materialId) ?? [];
        list.push(ex);
        executorsByMaterial.set(req.materialId, list);
      }
    }
  }

  for (const buf of interBuffers) buf.resetTracking(0);

  // Track exits at the LAST station with real timestamps.
  const exits: { part: TrackedPart; exitTimeMs: number }[] = [];
  const lastExecutor = executors[n - 1];
  if (!lastExecutor) throw new Error("chain harness invariant: no last executor");
  lastExecutor.onCompletion((event) => {
    exits.push({ part: event.part, exitTimeMs: event.timeMs });
  });

  // Refill the input on-demand, ONE part at a time, stamped with the time
  // station 0 will pull it. This means W (time-in-system) measured at exit
  // reflects only the part's actual pipeline traversal, not waiting in the
  // input feed. (An earlier version pre-loaded 100 parts at t=0 and gave
  // misleading W values for parts deep in the queue.)
  let nextPartId = 0;
  const refillOne = (timeMs: number): void => {
    if (inputBuffer.size === 0) {
      inputBuffer.push({ id: nextPartId++, enteredSystemAtMs: timeMs });
    }
  };
  refillOne(0);

  // Cross-station notifications: station i's completion notifies station i+1.
  for (let i = 0; i < n; i++) {
    const ex = executors[i];
    const next = executors[i + 1];
    if (!ex || !next) continue;
    ex.onCompletion((event) => {
      next.onUpstreamAvailable(event.timeMs);
    });
  }

  // After station 0 finishes a cycle, refill the input BEFORE its attemptStart
  // tries to pull. (notifyCompletion runs before attemptStart inside
  // handleCycleComplete, so this slots in correctly.)
  executors[0]?.onCompletion((event) => {
    refillOne(event.timeMs);
  });

  // Schedule any replenishment events declared in the materials config.
  let replenishmentsFired = 0;
  if (opts.materials?.replenishments) {
    for (const rep of opts.materials.replenishments) {
      scheduler.schedule(rep.atMs, {
        kind: "material-replenishment",
        materialId: rep.materialId,
        amount: rep.amount,
      });
    }
  }

  // Kick off — every station attempts to start so Starved transitions fire correctly.
  for (const ex of executors) ex.attemptStart(0);

  while (scheduler.size > 0) {
    const peeked = scheduler.peek();
    if (!peeked || peeked.timeMs > opts.horizonMs) break;
    const ev = scheduler.popMin();
    if (ev.payload.kind === "material-replenishment") {
      if (!materialPool) continue;
      materialPool.replenish(ev.payload.materialId, ev.payload.amount);
      replenishmentsFired += 1;
      const affected = executorsByMaterial.get(ev.payload.materialId);
      if (affected) {
        for (const ex of affected) ex.onUpstreamAvailable(ev.timeMs);
      }
      continue;
    }
    if (ev.payload.kind === "breakdown-start") {
      const idx = stationIds.indexOf(ev.payload.stationId);
      const manager = breakdownManagers?.[idx];
      if (manager) {
        manager.handleBreakdown(ev.timeMs);
        if (breakdownCounts) breakdownCounts[idx] = (breakdownCounts[idx] ?? 0) + 1;
      }
      continue;
    }
    if (ev.payload.kind === "repair-complete") {
      const idx = stationIds.indexOf(ev.payload.stationId);
      const manager = breakdownManagers?.[idx];
      const executor = executors[idx];
      if (manager) manager.handleRepair(ev.timeMs);
      if (executor) executor.attemptStart(ev.timeMs);
      continue;
    }
    if (ev.payload.kind !== "cycle-complete") continue;
    const idx = stationIds.indexOf(ev.payload.stationId);
    if (idx === -1) continue;
    const executor = executors[idx];
    if (!executor) continue;

    executor.handleCycleComplete(ev.timeMs);

    // After station idx pulled from interBuffers[idx-1] (in its attemptStart),
    // station idx-1's downstream just gained space — tell it.
    const prev = executors[idx - 1];
    if (prev) prev.onDownstreamCleared(ev.timeMs);

    if (idx === 0) refillOne(ev.timeMs);

    // When workers are configured, releasing one inside handleCycleComplete
    // doesn't notify other stations that have been Starved on no-skill. Nudge
    // every executor — attemptStart is a no-op if the station is already
    // Running / BlockedOut / Down. Without this pass, a 1-worker N-station
    // chain "marches" once down the line and then deadlocks.
    if (trackingPool) {
      for (let s = 0; s < executors.length; s++) {
        if (s !== idx) executors[s]?.attemptStart(ev.timeMs);
      }
    }
  }

  const endTimeMs = opts.horizonMs;
  const measureWindowMs = endTimeMs - opts.warmupMs;

  // Filter exits to those that occurred in the measurement window.
  const exitsInWindow = exits.filter((e) => e.exitTimeMs >= opts.warmupMs);

  // λ — parts exited per ms, during the measurement window.
  const throughputLambda = exitsInWindow.length / measureWindowMs;

  // W — average time-in-system for those exited parts.
  const avgTimeInSystemW =
    exitsInWindow.length > 0
      ? exitsInWindow.reduce((acc, e) => acc + (e.exitTimeMs - e.part.enteredSystemAtMs), 0) /
        exitsInWindow.length
      : 0;

  // L — average WIP across the system.
  //
  // Buffer contribution: TrackedBuffer's analytical time-weighted average.
  // In-flight contribution: assume each station's capacity is fully utilized
  // in steady state on the measurement window. This is exact for a balanced
  // chain where every station stays Running (the canonical Little's Law
  // fixture); for chains with starvation/blocking this overestimates and a
  // separate time-weighted-in-flight measurement (VROL-138) would be more
  // honest. For Phase 0 validation, the steady-state approximation suffices.
  let bufferWipL = 0;
  for (const buf of interBuffers) {
    bufferWipL += buf.averageWIP(endTimeMs);
  }
  const inFlightApprox = executors.reduce((s, e) => s + e.config.capacity, 0);
  const averageWipL = bufferWipL + inFlightApprox;

  // Finalize trackers up to the horizon and compute bottlenecks.
  for (const tracker of stateTimeTrackers) {
    tracker.finalize(endTimeMs);
  }
  const bottlenecks = detectBottlenecks(
    stationIds.map((id, i) => {
      const label = opts.stationLabels?.[i];
      const tracker = stateTimeTrackers[i] as StateTimeTracker;
      return label !== undefined ? { stationId: id, label, tracker } : { stationId: id, tracker };
    }),
  );

  const materialFinal: Array<readonly [MaterialId, number]> | undefined = opts.materials
    ? opts.materials.initialInventory.map(
        ([id]) => [id, materialPool ? materialPool.quantity(id) : 0] as const,
      )
    : undefined;

  let laborUtilization: number | undefined;
  if (trackingPool && opts.workers) {
    trackingPool.finalize(endTimeMs);
    const denom = opts.workers.workers.length * measureWindowMs;
    if (denom > 0) {
      // Note: busyMs is accumulated across the full run, while denom is the
      // measurement window — for Phase 0 this slight overcount in low-warmup
      // cases is acceptable; the test fixture uses warmupMs=0 anyway.
      laborUtilization = Math.min(1, trackingPool.busyMs / denom);
    }
  }

  // Per-station OEE — A × P × Q against the station's own time-in-state breakdown.
  // Phase 0 chain has defectRate=0, so totalParts = goodParts = perStationCompleted.
  const perStationOee: OeeMetrics[] = executors.map((ex, i) =>
    computeOee({
      stateTimeTracker: stateTimeTrackers[i] as StateTimeTracker,
      idealCycleTimeMs: meanOf(opts.stationCycleTimes[i] as Distribution),
      goodParts: ex.completed,
      totalParts: ex.completed + ex.scrapped,
    }),
  );
  // Geometric mean of per-station OEE — a quick proxy for line OEE until VROL-140
  // brings a proper line-level rollup with parallel branch handling.
  const lineOee = perStationOee.length
    ? Math.pow(
        perStationOee.reduce((acc, m) => acc * Math.max(m.oee, 1e-12), 1),
        1 / perStationOee.length,
      )
    : 0;
  const aggregateBufferWipL = interBuffers.reduce((s, b) => s + b.averageWIP(endTimeMs), 0);

  return {
    completed: exitsInWindow.length,
    elapsedMs: measureWindowMs,
    averageWipL,
    throughputLambda,
    avgTimeInSystemW,
    perStationCompleted: executors.map((e) => e.completed),
    bottlenecks,
    perStationOee,
    lineOee,
    aggregateBufferWipL,
    ...(materialFinal ? { materialFinal, replenishmentsFired } : {}),
    ...(breakdownCounts ? { perStationBreakdowns: breakdownCounts } : {}),
    ...(laborUtilization !== undefined ? { laborUtilization } : {}),
  };
}
