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
import { MultiInputBuffer, MultiOutputBuffer } from "./multi-buffer";
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

/**
 * TrackedBuffer variant that counts every successful push. Used by the chain
 * harness to surface per-edge flow counts so the editor can label each edge
 * with throughput.
 */
class CountingTrackedBuffer<T> extends TrackedBuffer<T> {
  public flowed = 0;
  override push(item: T): boolean {
    const ok = super.push(item);
    if (ok) this.flowed += 1;
    return ok;
  }
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
  /**
   * Per-edge parts flowed. Matches topology.edges by index (or, in linear
   * mode, the implicit i → i+1 edges in stationCycleTimes order).
   */
  readonly perEdgeFlowed: readonly number[];
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

export interface ChainTopologyNode {
  /** Stable identifier. Used in `topology.edges` and in error messages. */
  readonly id: string;
  /** Optional display label. */
  readonly label?: string;
  /** Cycle-time sampling distribution. */
  readonly cycleTimeMs: Distribution;
  /**
   * Optional per-cycle setup / changeover time. When set, the station goes
   * Idle → Setup → Running for each cycle. Defaults to no setup.
   */
  readonly setupTimeMs?: Distribution;
}

export interface ChainTopologyEdge {
  readonly source: string;
  readonly target: string;
}

export interface ChainTopology {
  readonly nodes: readonly ChainTopologyNode[];
  readonly edges: readonly ChainTopologyEdge[];
}

export interface ChainOptions {
  /**
   * Linear mode: list of station cycle times. The harness builds an implicit
   * N-1-edge chain. Ignored when `topology` is provided.
   */
  readonly stationCycleTimes?: readonly Distribution[];
  /**
   * DAG mode (VROL-582): explicit node + edge list. Single source + single
   * sink + no cycles enforced; multi-input / multi-output handled via
   * MultiInputBuffer + MultiOutputBuffer.
   */
  readonly topology?: ChainTopology;
  readonly interStationBufferCapacity: number;
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly prng: Prng;
  /** Optional labels for each station (matches stationCycleTimes by index). Ignored in DAG mode. */
  readonly stationLabels?: readonly string[];
  /** Optional material consumption + replenishment configuration. */
  readonly materials?: ChainMaterialConfig;
  /** Optional stochastic breakdowns (MTBF / MTTR per station). */
  readonly breakdowns?: ChainBreakdownConfig;
  /** Optional worker pool — stations request workers before each cycle starts. */
  readonly workers?: ChainWorkerConfig;
}

/**
 * Normalized topology used throughout runChain — every input mode is
 * collapsed into this shape before wiring executors.
 */
interface NormalizedTopology {
  nodeIds: string[];
  cycleTimes: Distribution[];
  setupTimes: (Distribution | undefined)[];
  labels: (string | undefined)[];
  /** Edges in input order; each carries source + target as node-array indices. */
  edges: { sourceIdx: number; targetIdx: number }[];
  /** For each node index: the indices of nodes it sends parts to. */
  outgoing: number[][];
  /** For each node index: the indices of nodes that send parts to it. */
  incoming: number[][];
  /** Index of the single source (in-degree 0) node. */
  sourceIdx: number;
  /** Index of the single sink (out-degree 0) node. */
  sinkIdx: number;
}

function buildTopology(opts: ChainOptions): NormalizedTopology {
  if (opts.topology) {
    const { nodes, edges } = opts.topology;
    if (nodes.length === 0) throw new Error("topology must contain at least one node");
    const idToIdx = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as ChainTopologyNode;
      if (idToIdx.has(node.id)) throw new Error(`topology: duplicate node id ${node.id}`);
      idToIdx.set(node.id, i);
    }
    const outgoing: number[][] = nodes.map(() => []);
    const incoming: number[][] = nodes.map(() => []);
    const normalizedEdges: { sourceIdx: number; targetIdx: number }[] = [];
    for (const e of edges) {
      const s = idToIdx.get(e.source);
      const t = idToIdx.get(e.target);
      if (s === undefined) throw new Error(`topology: edge source "${e.source}" not in nodes`);
      if (t === undefined) throw new Error(`topology: edge target "${e.target}" not in nodes`);
      if (s === t) continue; // ignore self-loops
      outgoing[s]!.push(t);
      incoming[t]!.push(s);
      normalizedEdges.push({ sourceIdx: s, targetIdx: t });
    }
    // Cycle detection via Kahn's algorithm.
    const remaining = incoming.map((arr) => arr.length);
    const queue: number[] = [];
    for (let i = 0; i < remaining.length; i++) if (remaining[i] === 0) queue.push(i);
    let visited = 0;
    while (queue.length > 0) {
      const v = queue.shift()!;
      visited += 1;
      for (const t of outgoing[v]!) {
        remaining[t] = (remaining[t] ?? 0) - 1;
        if (remaining[t] === 0) queue.push(t);
      }
    }
    if (visited < nodes.length) throw new Error("topology contains a cycle");
    // Source + sink validation.
    const sources: number[] = [];
    const sinks: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      if (incoming[i]!.length === 0) sources.push(i);
      if (outgoing[i]!.length === 0) sinks.push(i);
    }
    if (sources.length !== 1) {
      throw new Error(
        `topology requires exactly one source (in-degree 0), found ${String(sources.length)}`,
      );
    }
    if (sinks.length !== 1) {
      throw new Error(
        `topology requires exactly one sink (out-degree 0), found ${String(sinks.length)}`,
      );
    }
    return {
      nodeIds: nodes.map((n) => n.id),
      cycleTimes: nodes.map((n) => n.cycleTimeMs),
      setupTimes: nodes.map((n) => n.setupTimeMs),
      labels: nodes.map((n) => n.label),
      edges: normalizedEdges,
      outgoing,
      incoming,
      sourceIdx: sources[0]!,
      sinkIdx: sinks[0]!,
    };
  }
  // Linear mode.
  const times = opts.stationCycleTimes ?? [];
  if (times.length < 1)
    throw new Error("chain requires at least 1 station (provide stationCycleTimes or topology)");
  const n = times.length;
  const outgoing: number[][] = Array.from({ length: n }, () => []);
  const incoming: number[][] = Array.from({ length: n }, () => []);
  const edges: { sourceIdx: number; targetIdx: number }[] = [];
  for (let i = 0; i < n - 1; i++) {
    outgoing[i]!.push(i + 1);
    incoming[i + 1]!.push(i);
    edges.push({ sourceIdx: i, targetIdx: i + 1 });
  }
  return {
    nodeIds: Array.from({ length: n }, (_, i) => `s${String(i)}`),
    cycleTimes: [...times],
    setupTimes: Array.from({ length: n }, () => undefined),
    labels: Array.from({ length: n }, (_, i) => opts.stationLabels?.[i]),
    edges,
    outgoing,
    incoming,
    sourceIdx: 0,
    sinkIdx: n - 1,
  };
}

export function runChain(opts: ChainOptions): ChainResult {
  const topology = buildTopology(opts);
  const n = topology.nodeIds.length;

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
  // One CountingTrackedBuffer per topology edge.
  const edgeBuffers: CountingTrackedBuffer<TrackedPart>[] = topology.edges.map(
    () => new CountingTrackedBuffer<TrackedPart>(opts.interStationBufferCapacity),
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

  // Build per-node upstream/downstream buffer arrays from the topology.
  // For each node i:
  //   - incomingEdgeIdx[i] = indices into edgeBuffers that target node i
  //   - outgoingEdgeIdx[i] = indices into edgeBuffers that source from node i
  const incomingEdgeIdx: number[][] = Array.from({ length: n }, () => []);
  const outgoingEdgeIdx: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < topology.edges.length; e++) {
    const edge = topology.edges[e]!;
    outgoingEdgeIdx[edge.sourceIdx]!.push(e);
    incomingEdgeIdx[edge.targetIdx]!.push(e);
  }

  // Helper: build the upstream / downstream buffer (single or multi-aggregating)
  // for a given node. Source uses inputBuffer; sink uses sinkBuffer. Interior
  // nodes use their edge buffers (wrapped when there's more than one).
  function upstreamFor(nodeIdx: number): Buffer<TrackedPart> {
    if (nodeIdx === topology.sourceIdx) return inputBuffer;
    const ins = incomingEdgeIdx[nodeIdx]!;
    if (ins.length === 1) return edgeBuffers[ins[0]!] as CountingTrackedBuffer<TrackedPart>;
    return new MultiInputBuffer<TrackedPart>(
      ins.map((idx) => edgeBuffers[idx] as CountingTrackedBuffer<TrackedPart>),
    );
  }
  function downstreamFor(nodeIdx: number): Buffer<TrackedPart> {
    if (nodeIdx === topology.sinkIdx) return sinkBuffer;
    const outs = outgoingEdgeIdx[nodeIdx]!;
    if (outs.length === 1) return edgeBuffers[outs[0]!] as CountingTrackedBuffer<TrackedPart>;
    return new MultiOutputBuffer<TrackedPart>(
      outs.map((idx) => edgeBuffers[idx] as CountingTrackedBuffer<TrackedPart>),
    );
  }

  const executors: CycleExecutor<TrackedPart>[] = [];
  for (let i = 0; i < n; i++) {
    const recipe = recipeByStation.get(i);
    const requiredSkills =
      opts.workers?.perStationSkills?.[i] ?? opts.workers?.requireDefault ?? undefined;
    const setupTimeMs = topology.setupTimes[i];
    const cfg: CycleConfig<TrackedPart> = {
      stationId: stationIds[i] as StationId,
      cycleTimeMs: topology.cycleTimes[i] as Distribution,
      defectRate: 0,
      capacity: 1,
      upstream: upstreamFor(i),
      downstream: downstreamFor(i),
      ...(setupTimeMs ? { setupTimeMs } : {}),
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
    if (recipe?.length) {
      for (const req of recipe) {
        const list = executorsByMaterial.get(req.materialId) ?? [];
        list.push(ex);
        executorsByMaterial.set(req.materialId, list);
      }
    }
  }

  for (const buf of edgeBuffers) buf.resetTracking(0);

  // Track exits at the sink station with real timestamps.
  const exits: { part: TrackedPart; exitTimeMs: number }[] = [];
  const sinkExecutor = executors[topology.sinkIdx];
  if (!sinkExecutor) throw new Error("chain harness invariant: no sink executor");
  sinkExecutor.onCompletion((event) => {
    exits.push({ part: event.part, exitTimeMs: event.timeMs });
  });

  // Refill the input on-demand, ONE part at a time, stamped with the time
  // the source will pull it. This keeps W (time-in-system) at exit honest —
  // a pre-loaded queue would give misleading W values for parts deep in it.
  let nextPartId = 0;
  const refillOne = (timeMs: number): void => {
    if (inputBuffer.size === 0) {
      inputBuffer.push({ id: nextPartId++, enteredSystemAtMs: timeMs });
    }
  };
  refillOne(0);

  // Cross-station notifications via the topology adjacency.
  for (let i = 0; i < n; i++) {
    const ex = executors[i];
    if (!ex) continue;
    const downstreamNodes = topology.outgoing[i] ?? [];
    if (downstreamNodes.length === 0) continue;
    ex.onCompletion((event) => {
      for (const downIdx of downstreamNodes) {
        executors[downIdx]?.onUpstreamAvailable(event.timeMs);
      }
    });
  }

  // After the source station finishes a cycle, refill the input BEFORE its
  // attemptStart tries to pull. (notifyCompletion runs before attemptStart
  // inside handleCycleComplete, so this slots in correctly.)
  executors[topology.sourceIdx]?.onCompletion((event) => {
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
      const executor = executors[idx];
      if (manager) {
        manager.handleBreakdown(ev.timeMs);
        // VROL-125 — pause in-flight parts so the resume on repair can pick up
        // where they left off, instead of losing them on the Down-state scrap path.
        if (executor) executor.handleBreakdown(ev.timeMs);
        if (breakdownCounts) breakdownCounts[idx] = (breakdownCounts[idx] ?? 0) + 1;
      }
      continue;
    }
    if (ev.payload.kind === "repair-complete") {
      const idx = stationIds.indexOf(ev.payload.stationId);
      const manager = breakdownManagers?.[idx];
      const executor = executors[idx];
      if (manager) manager.handleRepair(ev.timeMs);
      if (executor) {
        executor.handleRepair(ev.timeMs);
        executor.attemptStart(ev.timeMs);
      }
      continue;
    }
    if (ev.payload.kind !== "cycle-complete") continue;
    const idx = stationIds.indexOf(ev.payload.stationId);
    if (idx === -1) continue;
    const executor = executors[idx];
    if (!executor) continue;

    executor.handleCycleComplete(ev.timeMs, ev.payload.partIndex);

    // After this station pulled from each of its upstream buffers (inside
    // attemptStart), each of those upstream stations' downstream just gained
    // space — notify each.
    for (const upIdx of topology.incoming[idx] ?? []) {
      executors[upIdx]?.onDownstreamCleared(ev.timeMs);
    }

    if (idx === topology.sourceIdx) refillOne(ev.timeMs);

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
  // Buffer contribution: TrackedBuffer's analytical time-weighted average across
  // every edge.
  // In-flight contribution: assume each station's capacity is fully utilized
  // in steady state on the measurement window. This is exact for a balanced
  // chain where every station stays Running (the canonical Little's Law
  // fixture); for chains with starvation/blocking this overestimates.
  let bufferWipL = 0;
  for (const buf of edgeBuffers) {
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
      const label = topology.labels[i];
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
      idealCycleTimeMs: meanOf(topology.cycleTimes[i] as Distribution),
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
  const aggregateBufferWipL = edgeBuffers.reduce((s, b) => s + b.averageWIP(endTimeMs), 0);

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
    perEdgeFlowed: edgeBuffers.map((b) => b.flowed),
    ...(materialFinal ? { materialFinal, replenishmentsFired } : {}),
    ...(breakdownCounts ? { perStationBreakdowns: breakdownCounts } : {}),
    ...(laborUtilization !== undefined ? { laborUtilization } : {}),
  };
}
