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
import type { ScheduledEvent } from "./scheduler";
import type { MaterialId, StationId } from "./ids";
import { newStationId } from "./ids";
import { MaintenanceManager, type MaintenanceWindow } from "./maintenance";
import { MaterialPool, type MaterialRequirement } from "./material-pool";
import { MultiInputBuffer, MultiOutputBuffer } from "./multi-buffer";
import { computeOee, type OeeMetrics } from "./oee";
import type { Prng } from "./prng";
import { sample } from "./sampling";
import { Scheduler } from "./scheduler";
import { StationStateMachine } from "./state-machine";
import { StateTimeTracker } from "./state-time-tracker";
import type { ResourceId } from "./ids";
import { effectiveAvailableMs, WorkerPool, type PoolWorker } from "./worker-pool";

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
  /** Optional product identifier (VROL-594). Undefined for single-product runs. */
  readonly productId?: string;
  /**
   * VROL-886 — batch / lot identifier propagated with the part through the
   * whole chain. Pharma + food teams need lot traceability for regulatory
   * narrative. Minted at source-emit time; undefined for legacy runs without
   * batch config. Lot is the wider container; batch is one production run
   * within a lot — keeping both lets the spec map onto whichever convention
   * the user prefers.
   */
  readonly batchId?: string;
  readonly lotId?: string;
  /**
   * Number of times this part has been re-routed via rework (VROL-626).
   * Mutable: the rework router increments it before pushing into the target
   * buffer. Compared against MAX_REWORK_PASSES to bound infinite loops.
   */
  reworkCount?: number;
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

/**
 * Periodic snapshot of run state (VROL-612). Emitted when ChainOptions.sampler
 * is configured. tMs is the in-simulation time of the snapshot; lineCompleted
 * is the cumulative count of parts that have EXITED the system at or before
 * tMs (filtered against warmupMs); perStationCompleted is each station's own
 * completed counter at that instant.
 *
 * Samples enable time-axis visualisations in the editor (throughput chart,
 * per-station sparklines) without re-instrumenting every executor.
 */
export interface TimeseriesSample {
  readonly tMs: number;
  readonly lineCompleted: number;
  readonly perStationCompleted: readonly number[];
  /**
   * Per-edge buffer occupancy at the sample instant (VROL-615). Aligned with
   * topology.edges (or perEdgeFlowed) by index. Empty array when the topology
   * has no inter-station buffers — sampler-on runs always populate, sampler-off
   * runs never sample so this is never read.
   */
  readonly perEdgeBufferFill: readonly number[];
  /**
   * Cumulative ms-in-state per station at the sample instant (VROL-619).
   * Aligned with perStationCompleted by index. Each entry is a frozen
   * Record<state, ms> — consumers compute within-interval fractions by
   * diffing consecutive samples. Empty array when no sampler.
   */
  readonly perStationStateMs: readonly Readonly<Record<string, number>>[];
  /**
   * Cumulative count of parts a station has REWORKED (routed back to a
   * rework target) at the sample instant (VROL-639). Aligned with
   * perStationCompleted by index. Last sample equals
   * ChainResult.perStationReworked. Empty array when no sampler.
   */
  readonly perStationRework: readonly number[];
}

/**
 * Sampler configuration (VROL-612). Setting intervalMs > 0 turns sampling on;
 * leaving it undefined / 0 leaves ChainResult.samples empty and adds no
 * per-tick overhead.
 */
export interface ChainSamplerConfig {
  readonly intervalMs: number;
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
  /**
   * Per-station human labels, aligned by index with perStationOee /
   * perStationCompleted (i.e., topology order). Undefined entries when the
   * caller didn't supply a label for that station. Distinct from
   * bottlenecks[i].label — `bottlenecks` is sorted by runningPct DESC, so
   * indexing it positionally against perStationOee would mis-pair labels
   * (VROL-897). Consumers that render per-station OEE in topology order
   * MUST use this array, not bottlenecks[i].label.
   */
  readonly perStationLabels?: ReadonlyArray<string | undefined>;
  /**
   * Per-station share of the measurement window spent in Running (0–1),
   * aligned by index with perStationOee (topology order). VROL-897 — the
   * OEE breakdown UI shows a per-row "Utilization" chip alongside the A/P/Q
   * bars; previously it indexed `bottlenecks[i].runningPct`, which is
   * sorted-by-runningPct order, so the chip on row i described a different
   * station than the bars on row i. Consumers MUST use this array, not
   * bottlenecks[i].runningPct.
   */
  readonly perStationRunningPct: readonly number[];
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
  /**
   * Total source-arrival event count fired during the run (VROL-648).
   * Undefined when ChainOptions.source was omitted (back-compat).
   */
  readonly sourceArrivalsFired?: number;
  /**
   * Per-station parallel-cycle capacity (VROL-652). Aligned with
   * perStationCompleted by index. 1 for stations using the default
   * (sequential) cycle. Surfaces capacity for downstream consumers like
   * narrate-run that need to suggest "raise capacity" vs "raise rate".
   */
  readonly perStationCapacity: readonly number[];
  /** Per-station OEE metrics (Availability × Performance × Quality). */
  readonly perStationOee: readonly OeeMetrics[];
  /**
   * Line-level OEE = actual throughput / theoretical-max throughput, clamped
   * to [0, 1] (VROL-610 closes VROL-140). Theoretical-max throughput is
   * 1 / bottleneck-ideal-cycle, where the bottleneck is the station with the
   * largest mean cycle time. Captures Availability × Performance × Quality
   * at the chain level for both serial and DAG topologies.
   */
  readonly lineOee: number;
  /** Index of the rate-limiting station (largest meanOf(cycleTimeMs)). */
  readonly bottleneckStationIdx: number;
  /** Aggregate time-weighted WIP across inter-station buffers, taken from TrackedBuffer integrals. */
  readonly aggregateBufferWipL: number;
  /** Per-station breakdown count fired during the run. Undefined when no breakdowns config given. */
  readonly perStationBreakdowns?: readonly number[];
  /** Per-station total ms spent in Maintenance. Undefined when no maintenance config given. */
  readonly perStationMaintenanceMs?: readonly number[];
  /** Per-station scrap count (defective parts). Always present. */
  readonly perStationScrapped: readonly number[];
  /** Line scrap rate: total scrapped / (total completed + total scrapped). */
  readonly lineScrapRate: number;
  /**
   * Per-station rework count (VROL-626) — count of defective parts that
   * were re-routed to a rework target instead of being scrapped. Always
   * present (zeros for runs with no rework configured).
   */
  readonly perStationReworked: readonly number[];
  /**
   * Line rework rate: total rework events / (total completed + total
   * scrapped + total rework events). Captures how much rework the line is
   * doing relative to total throughput attempts.
   */
  readonly lineReworkRate: number;
  /**
   * VROL-868 — theoretical yield = good parts / (good parts + scrapped).
   * The mass-balance KPI pharma + chemistry use. Always present (1.0 when
   * the line had zero scrap).
   */
  readonly theoreticalYield: number;
  /**
   * VROL-885 — sustainability totals across the whole run, summed across
   * stations. Each total is (sum over stations of perStationCompleted ×
   * per-cycle input). All three default to 0 — the KPI tiles only render
   * when at least one is non-zero.
   */
  readonly totalEnergyJ: number;
  readonly totalWaterL: number;
  readonly totalCO2eG: number;
  /**
   * VROL-882 — per-station completion counts split by quality grade.
   * Index aligned with perStationCompleted. Sum of values per station
   * equals perStationCompleted[i] (modulo rounding).
   */
  readonly perStationGradeCounts: ReadonlyArray<Readonly<Record<string, number>>>;
  /** VROL-882 — line totals per grade (sum across stations of grade counts). */
  readonly lineGradeCounts: Readonly<Record<string, number>>;
  /**
   * VROL-886 — per-batch + per-lot completion counts when batch tagging is
   * configured on the source. Undefined when no batch tagging — legacy
   * scenarios remain unchanged.
   */
  readonly perBatchCompleted?: ReadonlyMap<string, number>;
  readonly perBatchScrapped?: ReadonlyMap<string, number>;
  readonly perLotCompleted?: ReadonlyMap<string, number>;
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
  /**
   * Per-product completion counts at the sink (VROL-594). Undefined when no
   * products config was provided.
   */
  readonly perProductCompleted?: ReadonlyMap<string, number>;
  /**
   * Timeseries snapshots taken at the sampler's intervalMs (VROL-612). Empty
   * array when no sampler was configured. Always present so callers can read
   * `.length === 0` without an undefined check.
   */
  readonly samples: readonly TimeseriesSample[];
}

export interface ChainProductsConfig {
  /** Weighted product mix. Weights are normalized; relative sizes are what matter. */
  readonly products: ReadonlyArray<{ readonly id: string; readonly weight: number }>;
  /**
   * VROL-158 — optional production plan. When set, the source emits parts
   * in this exact order: `quantity` of `productId`, then move to the next
   * entry. When the plan is exhausted, no more parts are pushed (chain
   * drains naturally). Overrides the weighted mix above.
   */
  readonly productionPlan?: ReadonlyArray<{
    readonly productId: string;
    readonly quantity: number;
  }>;
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

export interface ChainMaintenanceConfig {
  /**
   * Per-station maintenance windows. Key is the topology node index (matches
   * stationCycleTimes ordering in linear mode, or topology.nodes ordering in
   * DAG mode). Empty / missing entry = no maintenance for that station.
   */
  readonly perStationWindows: ReadonlyMap<number, readonly MaintenanceWindow[]>;
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
  /**
   * Recurring / finite-rate replenishments (VROL-642). Each entry is expanded
   * at init into a stream of "material-replenishment" events at startMs,
   * startMs + intervalMs, startMs + 2·intervalMs, ... up to (and including)
   * horizonMs. After expansion, recurring events are indistinguishable from
   * one-shot events in the scheduler — they just carry an optional
   * maxInventory cap that the handler honors.
   *
   * intervalMs must be > 0; amount must be >= 0; startMs >= 0 (default 0).
   * maxInventory, when set, clamps each replenishment so the pool never
   * exceeds the cap — a replenishment fired when the pool is already at the
   * cap is a no-op (still counted in replenishmentsFired for observability).
   */
  readonly recurringReplenishments?: ReadonlyArray<{
    readonly materialId: MaterialId;
    readonly amount: number;
    readonly intervalMs: number;
    readonly startMs?: number;
    readonly maxInventory?: number;
  }>;
}

export interface ChainTopologyNode {
  /** Stable identifier. Used in `topology.edges` and in error messages. */
  readonly id: string;
  /** Optional display label. */
  readonly label?: string;
  /** Cycle-time sampling distribution. Used as the default when no per-product override applies. */
  readonly cycleTimeMs: Distribution;
  /**
   * Optional per-product cycle-distribution overrides (VROL-595). When a part
   * with a productId arrives, the harness looks up cycleByProduct[productId]
   * and uses it instead of cycleTimeMs. Missing entries fall back to cycleTimeMs.
   */
  readonly cycleByProduct?: Record<string, Distribution>;
  /**
   * Optional per-cycle setup / changeover time. When set, the station goes
   * Idle → Setup → Running for each cycle. Defaults to no setup.
   */
  readonly setupTimeMs?: Distribution;
  /**
   * Optional changeover matrix (VROL-597). Keyed by previous product id, then
   * next product id. When a transition matches a cell, that distribution is
   * used for the setup time of the upcoming cycle instead of setupTimeMs.
   * Same-product transitions (A→A) typically have a zero-or-missing entry to
   * model "no changeover needed".
   */
  readonly changeoverMatrix?: Record<string, Record<string, Distribution>>;
  /**
   * Optional per-station defect rate in [0, 1] (VROL-626 prerequisite). When
   * a part completes a cycle, the engine samples uniformly and treats the
   * part as defective if the roll is below this value. Defaults to 0 (no
   * defects). Without this, rework targeting (below) has nothing to route.
   */
  readonly defectRate?: number;
  /**
   * Optional rework destination (VROL-626). When set, a defect at THIS
   * station is routed back to the named target station's input buffer
   * instead of being scrapped. Bounded by reworkPassLimit (default 3)
   * so a pathological loop can't form; if the cap is exhausted OR the
   * target buffer is full, the part falls through to the scrap path.
   * Rework targets are validated at run init — unknown ids throw.
   */
  readonly reworkTargetId?: string;
  /**
   * Optional max rework passes for parts routed from THIS station
   * (VROL-638). When unset, falls back to DEFAULT_REWORK_PASS_LIMIT (3).
   * Must be >= 1; build-time validation throws on 0 or negative values.
   * Only meaningful alongside reworkTargetId.
   */
  readonly reworkPassLimit?: number;
  /**
   * Optional parallel-cycle count (VROL-646). When > 1, the station can
   * have multiple parts in flight simultaneously — e.g. capacity = 3
   * models three identical fillers running side-by-side. The CycleExecutor
   * already supports this; this field exposes it to scenario authors.
   * Default 1 (sequential). Must be a positive integer 1..10 at build
   * time so a typo can't spawn thousands of parallel cycles.
   */
  readonly capacity?: number;
  /**
   * Optional OEM-rated design max cycle time, ms (VROL-899). When set,
   * Performance is computed against THIS instead of the operating cycle
   * mean — so a station deliberately throttled below its nominal (e.g. a
   * filler paced to a slower downstream labeler) reports Performance < 1.0
   * and surfaces a subordination chip on the canvas. Must be > 0 and
   * < operating cycle mean (otherwise the engine ignores it and falls
   * back to the operating mean). Default undefined → legacy behaviour
   * (Performance ≈ 1.0 for a deterministic station).
   */
  readonly nominalCycleTimeMs?: number;
  /**
   * Optional units produced per completed cycle (VROL-870). Default 1.
   * When > 1, the station's completed counter advances by N per cycle —
   * models PCB depanelizers, multi-cavity moulds, sheet-metal cutters,
   * any "one cycle, N usable parts" station. Pushed as ONE downstream
   * batch handle; the engine accounts for N units across all KPIs.
   * Validated as a positive integer 1..1000 at build time.
   */
  readonly unitsPerCycle?: number;
  /**
   * VROL-885 — sustainability accounting. Energy joules / water litres /
   * CO2-equivalent grams consumed per completed cycle. Multiplied by
   * unitsPerCycle when emitting line totals. All optional; line KPIs only
   * surface when at least one station declares non-zero values.
   */
  readonly energyPerCycleJ?: number;
  readonly waterPerCycleL?: number;
  readonly co2ePerCycleG?: number;
  /**
   * VROL-882 — per-station quality-grade weights. When set, completed
   * (non-defective) parts are sampled against this distribution and
   * counted per grade. Use {grade, pct} entries with pct summing to 1.0.
   * Unknown entries default the station to {A: 1.0}.
   */
  readonly qualityGrades?: ReadonlyArray<{ readonly grade: string; readonly pct: number }>;
}

/**
 * Default cap on how many times a part can be reworked before scrapping.
 * Per-station overrides via ChainTopologyNode.reworkPassLimit.
 */
export const DEFAULT_REWORK_PASS_LIMIT = 3;

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
  /** Optional planned-maintenance windows per station. */
  readonly maintenance?: ChainMaintenanceConfig;
  /** Optional worker pool — stations request workers before each cycle starts. */
  readonly workers?: ChainWorkerConfig;
  /** Optional product mix at source (VROL-594). When set, every part gets a productId. */
  readonly products?: ChainProductsConfig;
  /**
   * Optional timeseries sampler (VROL-612). When set, the harness emits one
   * TimeseriesSample per intervalMs interval; warmup-period samples are
   * dropped so chart series line up with the published end-of-run KPIs.
   */
  readonly sampler?: ChainSamplerConfig;
  /**
   * Optional finite-rate source generation (VROL-648). When set, the source
   * station's input buffer is filled by scheduled "source-arrival" events
   * instead of on-demand. interArrivalMs samples from a Distribution
   * (constant, exponential, etc); batchSize defaults to 1 (one part per
   * arrival). When omitted, the source produces on-demand as before
   * (back-compat).
   */
  readonly source?: ChainSourceConfig;
}

export interface ChainSourceConfig {
  readonly interArrivalMs: Distribution;
  /** Parts pushed per arrival event. Default 1. Must be a positive integer when set. */
  readonly batchSize?: number;
  /**
   * VROL-886 — batch + lot tagging. When set, each source-emit creates a new
   * batchId (prefix + monotonic counter). batchesPerLot, when also set,
   * groups N consecutive batches under the same lotId; otherwise lotId
   * defaults to the batchId. Undefined → no batch tagging, the legacy path.
   */
  readonly batchTagging?: {
    readonly enabled: boolean;
    readonly batchIdPrefix?: string;
    readonly lotIdPrefix?: string;
    readonly batchesPerLot?: number;
  };
}

/**
 * Normalized topology used throughout runChain — every input mode is
 * collapsed into this shape before wiring executors.
 */
interface NormalizedTopology {
  nodeIds: string[];
  cycleTimes: Distribution[];
  cyclesByProduct: (Record<string, Distribution> | undefined)[];
  setupTimes: (Distribution | undefined)[];
  changeoverMatrices: (Record<string, Record<string, Distribution>> | undefined)[];
  labels: (string | undefined)[];
  /** Per-station defect probabilities in [0, 1], default 0 (VROL-626). */
  defectRates: number[];
  /**
   * Per-station rework target node index (VROL-626). undefined when the
   * station has no rework configured. Validated at topology build time —
   * unknown ids throw before any executor is constructed.
   */
  reworkTargets: (number | undefined)[];
  /**
   * Per-station max rework pass count (VROL-638). undefined falls back to
   * DEFAULT_REWORK_PASS_LIMIT at the executor. Validated >= 1 at build.
   */
  reworkPassLimits: (number | undefined)[];
  /**
   * Per-station parallel-cycle count (VROL-646). Default 1 (sequential).
   * Validated as positive integer 1..10 at build.
   */
  capacities: number[];
  /**
   * Per-station OEM-rated nominal cycle time, ms (VROL-899). undefined when
   * the user hasn't set one — Performance falls back to ideal cycle (= mean
   * of operating distribution), matching legacy behaviour. When present,
   * computeOee uses this as the Performance reference so subordinated
   * stations report Performance < 1.0.
   */
  nominalCycleTimes: (number | undefined)[];
  /**
   * VROL-870 — per-station units produced per cycle (default 1). When > 1,
   * one cycle produces N units, all accounted through the same downstream
   * push (the part is the batch handle).
   */
  unitsPerCycle: number[];
  /** VROL-885 — sustainability inputs in per-cycle units, default 0. */
  energyPerCycleJ: number[];
  waterPerCycleL: number[];
  co2ePerCycleG: number[];
  /**
   * VROL-882 — per-station quality-grade weight vectors. Empty when not
   * configured; the harness defaults the station to {A: 1.0} so legacy lines
   * surface a single A-grade count.
   */
  qualityGrades: ReadonlyArray<{ readonly grade: string; readonly pct: number }>[];
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
    // Resolve rework targets (VROL-626) — validates each reworkTargetId
    // refers to an existing node before any executor is built. Self-targets
    // are rejected too; defects that would otherwise rework themselves are
    // a config bug, not a useful loop.
    const reworkTargets: (number | undefined)[] = nodes.map((node, i) => {
      if (!node.reworkTargetId) return undefined;
      const idx = idToIdx.get(node.reworkTargetId);
      if (idx === undefined) {
        throw new Error(
          `topology: station "${node.id}" reworkTargetId "${node.reworkTargetId}" is not a known node`,
        );
      }
      if (idx === i) {
        throw new Error(`topology: station "${node.id}" cannot rework to itself`);
      }
      return idx;
    });
    const reworkPassLimits: (number | undefined)[] = nodes.map((node) => {
      if (node.reworkPassLimit === undefined) return undefined;
      if (!Number.isInteger(node.reworkPassLimit) || node.reworkPassLimit < 1) {
        throw new Error(
          `topology: station "${node.id}" reworkPassLimit must be a positive integer (got ${String(node.reworkPassLimit)})`,
        );
      }
      return node.reworkPassLimit;
    });
    const capacities: number[] = nodes.map((node) => {
      const cap = node.capacity ?? 1;
      if (!Number.isInteger(cap) || cap < 1 || cap > 10) {
        throw new Error(
          `topology: station "${node.id}" capacity must be an integer between 1 and 10 (got ${String(cap)})`,
        );
      }
      return cap;
    });
    // VROL-870 — units-per-cycle. Default 1. Validated as positive integer
    // up to 1000 at build time so a typo can't make the throughput explode.
    const unitsPerCycle: number[] = nodes.map((node) => {
      const n = node.unitsPerCycle ?? 1;
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        throw new Error(
          `topology: station "${node.id}" unitsPerCycle must be an integer between 1 and 1000 (got ${String(n)})`,
        );
      }
      return n;
    });
    // VROL-885 — sustainability inputs. Default 0 (no-op) so existing
    // scenarios are unaffected. Negative values clamp to 0 — no apology for
    // refusing to model "negative water consumption."
    const sustainNum = (raw: unknown): number =>
      typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
    const energyPerCycleJ = nodes.map((node) => sustainNum(node.energyPerCycleJ));
    const waterPerCycleL = nodes.map((node) => sustainNum(node.waterPerCycleL));
    const co2ePerCycleG = nodes.map((node) => sustainNum(node.co2ePerCycleG));
    // VROL-882 — per-station grade weights. Normalize each vector to sum 1.0
    // so a user typo (0.4 + 0.3 + 0.4 = 1.1) doesn't break the sampler.
    // Empty / unset defaults to [{A: 1.0}].
    const qualityGrades: ReadonlyArray<{ readonly grade: string; readonly pct: number }>[] =
      nodes.map((node) => {
        const raw = node.qualityGrades;
        if (!raw || raw.length === 0) return [{ grade: "A", pct: 1 }];
        const sum = raw.reduce((s, g) => s + Math.max(0, g.pct), 0);
        if (sum <= 0) return [{ grade: "A", pct: 1 }];
        return raw.map((g) => ({ grade: g.grade, pct: Math.max(0, g.pct) / sum }));
      });
    // VROL-899 — nominal cycle is OPTIONAL. When set but >= operating cycle
    // mean, we silently drop it (a nominal slower than operating means the
    // operator over-rated the machine, not throttled it — clamping rather
    // than erroring keeps the engine forgiving in batch imports).
    const nominalCycleTimes: (number | undefined)[] = nodes.map((node, idx) => {
      const nominal = node.nominalCycleTimeMs;
      if (nominal === undefined) return undefined;
      if (!Number.isFinite(nominal) || nominal <= 0) {
        throw new Error(
          `topology: station "${node.id}" nominalCycleTimeMs must be > 0 (got ${String(nominal)})`,
        );
      }
      const operatingMean = meanOf(nodes[idx]!.cycleTimeMs);
      return nominal < operatingMean ? nominal : undefined;
    });
    return {
      nodeIds: nodes.map((n) => n.id),
      cycleTimes: nodes.map((n) => n.cycleTimeMs),
      cyclesByProduct: nodes.map((n) => n.cycleByProduct),
      setupTimes: nodes.map((n) => n.setupTimeMs),
      changeoverMatrices: nodes.map((n) => n.changeoverMatrix),
      labels: nodes.map((n) => n.label),
      defectRates: nodes.map((n) => n.defectRate ?? 0),
      reworkTargets,
      reworkPassLimits,
      capacities,
      nominalCycleTimes,
      unitsPerCycle,
      energyPerCycleJ,
      waterPerCycleL,
      co2ePerCycleG,
      qualityGrades,
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
    cyclesByProduct: Array.from({ length: n }, () => undefined),
    setupTimes: Array.from({ length: n }, () => undefined),
    changeoverMatrices: Array.from({ length: n }, () => undefined),
    labels: Array.from({ length: n }, (_, i) => opts.stationLabels?.[i]),
    // Linear mode has no per-station defect config — leave defects off and
    // rework targets empty. Callers wanting these features use DAG mode.
    defectRates: Array.from({ length: n }, () => 0),
    reworkTargets: Array.from({ length: n }, () => undefined),
    reworkPassLimits: Array.from({ length: n }, () => undefined),
    capacities: Array.from({ length: n }, () => 1),
    nominalCycleTimes: Array.from({ length: n }, () => undefined),
    unitsPerCycle: Array.from({ length: n }, () => 1),
    energyPerCycleJ: Array.from({ length: n }, () => 0),
    waterPerCycleL: Array.from({ length: n }, () => 0),
    co2ePerCycleG: Array.from({ length: n }, () => 0),
    qualityGrades: Array.from({ length: n }, () => [{ grade: "A", pct: 1 } as const]),
    edges,
    outgoing,
    incoming,
    sourceIdx: 0,
    sinkIdx: n - 1,
  };
}

/**
 * VROL-148 — incremental simulation handle.
 *
 * createSimulation(opts) returns a stateful runner that callers can drive
 * one event (step) or up to a sim-time (advanceUntil) at a time. The
 * generator-based implementation shares ALL setup + main-loop code with
 * runChain — runChain is now a thin "drain to completion" wrapper.
 */
export interface SimulationHandle {
  readonly currentTimeMs: number;
  readonly done: boolean;
  /** Advance exactly one event. Returns the event processed, or null if done. */
  step(): ScheduledEvent<EngineEvent> | null;
  /**
   * Advance until either the scheduler reaches simMs / horizon / empty.
   * Returns the count of events processed.
   */
  advanceUntil(simMs: number): number;
  /** Drain to the end (full-speed) and return the final ChainResult. */
  finalize(): ChainResult;
}

export function createSimulation(opts: ChainOptions): SimulationHandle {
  const gen = simulationStream(opts);
  let currentTimeMs = 0;
  let isDone = false;
  let finalResult: ChainResult | null = null;
  const advanceOne = (): ScheduledEvent<EngineEvent> | null => {
    if (isDone) return null;
    const r = gen.next();
    if (r.done) {
      isDone = true;
      finalResult = r.value;
      return null;
    }
    currentTimeMs = r.value.timeMs;
    return r.value;
  };
  return {
    get currentTimeMs() {
      return currentTimeMs;
    },
    get done() {
      return isDone;
    },
    step: () => advanceOne(),
    advanceUntil: (simMs: number): number => {
      let n = 0;
      while (!isDone) {
        const ev = advanceOne();
        if (ev === null) break;
        n += 1;
        if (ev.timeMs >= simMs) break;
      }
      return n;
    },
    finalize: (): ChainResult => {
      while (!isDone) advanceOne();
      if (finalResult === null) {
        throw new Error("simulation drained but no final result was produced");
      }
      return finalResult;
    },
  };
}

export function runChain(opts: ChainOptions): ChainResult {
  // VROL-148 — runChain is now a thin "drain to completion" wrapper around
  // the same generator that powers createSimulation. Full-speed mode = drain
  // immediately; live/step modes drive the generator from outside.
  return createSimulation(opts).finalize();
}

function* simulationStream(
  opts: ChainOptions,
): Generator<ScheduledEvent<EngineEvent>, ChainResult, void> {
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

  // Maintenance — one manager per station that has at least one window.
  const maintenanceManagers: (MaintenanceManager | undefined)[] = stationIds.map((id, i) => {
    const windows = opts.maintenance?.perStationWindows.get(i);
    if (!windows || windows.length === 0) return undefined;
    return new MaintenanceManager(id, windows, stateMachines[i] as StationStateMachine, scheduler);
  });

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

  // Schedule planned maintenance events upfront. Managers don't repeat — windows
  // are deterministic and fire exactly once each per the input config.
  for (const mgr of maintenanceManagers) {
    if (mgr) mgr.schedule(0);
  }

  // VROL-469 — inputBuffer is time-tracked so its WIP contributes to L.
  // Previously a plain Buffer, which made L undercount whenever the source
  // queued a part before the source station pulled it (~1 part per cycle
  // in a balanced chain, causing a measurable L vs λW drift).
  const inputBuffer = new TrackedBuffer<TrackedPart>(10_000_000);
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
  /**
   * VROL-626 — push a part directly into the target station's input. Unlike
   * upstreamFor() — which returns a MultiInputBuffer wrapper whose push()
   * throws by design — this helper picks a concrete edge buffer (or the
   * source's input buffer) and writes there. Returns false when no
   * constituent buffer has capacity, which the caller treats as scrap.
   */
  function pushReworkTo(targetIdx: number, part: TrackedPart): boolean {
    if (targetIdx === topology.sourceIdx) return inputBuffer.push(part);
    const ins = incomingEdgeIdx[targetIdx]!;
    if (ins.length === 0) return false;
    if (ins.length === 1) {
      return (edgeBuffers[ins[0]!] as CountingTrackedBuffer<TrackedPart>).push(part);
    }
    // Multi-input: try edge buffers in topology order; first one with space wins.
    // Same priority as MultiInputBuffer's pull() so the part lands in a buffer
    // the consumer will see on its next attempt.
    for (const idx of ins) {
      const buf = edgeBuffers[idx] as CountingTrackedBuffer<TrackedPart>;
      if (buf.push(part)) return true;
    }
    return false;
  }

  // VROL-626 — bounded rework loops. Defective parts at a station with a
  // reworkTargetId are routed back into the target's input buffer with an
  // incremented reworkCount; parts whose count hits the per-station limit
  // (VROL-638: topology.reworkPassLimits[i] ?? DEFAULT_REWORK_PASS_LIMIT)
  // fall through to scrap so a pathological chain can't recurse forever.
  const executors: CycleExecutor<TrackedPart>[] = [];
  for (let i = 0; i < n; i++) {
    const recipe = recipeByStation.get(i);
    const requiredSkills =
      opts.workers?.perStationSkills?.[i] ?? opts.workers?.requireDefault ?? undefined;
    const setupTimeMs = topology.setupTimes[i];
    const cycleByProduct = topology.cyclesByProduct[i];
    const changeoverMatrix = topology.changeoverMatrices[i];
    const cycleTimeFor: ((part: TrackedPart) => Distribution | undefined) | undefined =
      cycleByProduct
        ? (part) => (part.productId !== undefined ? cycleByProduct[part.productId] : undefined)
        : undefined;
    const setupTimeFor:
      | ((prevId: string | undefined, nextPart: TrackedPart) => Distribution | undefined)
      | undefined = changeoverMatrix
      ? (prevId, nextPart) => {
          if (prevId === undefined || nextPart.productId === undefined) return undefined;
          return changeoverMatrix[prevId]?.[nextPart.productId];
        }
      : undefined;
    // Build a router closure when this station has a rework target. The
    // target's input buffer is resolved AFTER executors are constructed, but
    // we capture the index now and look up the executor at call time so the
    // routing works in DAG mode regardless of station ordering.
    const reworkTargetIdx = topology.reworkTargets[i];
    const reworkPassLimit = topology.reworkPassLimits[i] ?? DEFAULT_REWORK_PASS_LIMIT;
    const reworkRouter: ((part: TrackedPart) => boolean) | undefined =
      reworkTargetIdx !== undefined
        ? (part) => {
            const count = (part.reworkCount ?? 0) + 1;
            if (count > reworkPassLimit) return false;
            part.reworkCount = count;
            return pushReworkTo(reworkTargetIdx, part);
          }
        : undefined;
    const cfg: CycleConfig<TrackedPart> = {
      stationId: stationIds[i] as StationId,
      cycleTimeMs: topology.cycleTimes[i] as Distribution,
      defectRate: topology.defectRates[i] ?? 0,
      capacity: topology.capacities[i] ?? 1,
      // VROL-870 — multi-output station. unitsPerCycle defaults to 1 in
      // normaliseTopology, so legacy lines are unaffected.
      unitsPerCycle: topology.unitsPerCycle[i] ?? 1,
      upstream: upstreamFor(i),
      downstream: downstreamFor(i),
      ...(cycleTimeFor ? { cycleTimeFor } : {}),
      ...(setupTimeMs ? { setupTimeMs } : {}),
      ...(setupTimeFor ? { setupTimeFor } : {}),
      ...(materialPool && recipe?.length ? { materialPool, materialRequirements: recipe } : {}),
      ...(workerPool ? { workerPool, ...(requiredSkills ? { requiredSkills } : {}) } : {}),
      ...(reworkRouter ? { reworkRouter } : {}),
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
  const perProductCompleted = opts.products ? new Map<string, number>() : undefined;
  const sinkExecutor = executors[topology.sinkIdx];
  if (!sinkExecutor) throw new Error("chain harness invariant: no sink executor");
  sinkExecutor.onCompletion((event) => {
    // VROL-AUDIT — sink completion fires for EVERY cycle (good, defective,
    // Down/Maintenance scrap). Without this filter, result.completed and
    // result.throughputLambda overcount by the sink's scrap rate. Skipping
    // defectives here aligns result.completed with perStationCompleted[sinkIdx]
    // (the engine's correctly-filtered station-level good-count).
    // VROL-886 — also tally per-batch good/scrap so the result panel can
    // surface per-batch yield. Scrap goes to perBatchScrapped; only goods
    // hit perBatchCompleted (which feeds throughput).
    if (event.defective) {
      if (perBatchScrapped && event.part.batchId) {
        perBatchScrapped.set(
          event.part.batchId,
          (perBatchScrapped.get(event.part.batchId) ?? 0) + 1,
        );
      }
      return;
    }
    exits.push({ part: event.part, exitTimeMs: event.timeMs });
    if (perProductCompleted && event.part.productId !== undefined) {
      perProductCompleted.set(
        event.part.productId,
        (perProductCompleted.get(event.part.productId) ?? 0) + 1,
      );
    }
    if (perBatchCompleted && event.part.batchId) {
      perBatchCompleted.set(
        event.part.batchId,
        (perBatchCompleted.get(event.part.batchId) ?? 0) + 1,
      );
    }
    if (perLotCompleted && event.part.lotId) {
      perLotCompleted.set(event.part.lotId, (perLotCompleted.get(event.part.lotId) ?? 0) + 1);
    }
  });

  // Products — when configured, every part is stamped with a productId from a
  // weighted mix. Cumulative weights for inverse-transform sampling.
  const productCumulative: { id: string; cum: number }[] = [];
  if (opts.products && opts.products.products.length > 0) {
    const totalWeight = opts.products.products.reduce((s, p) => s + Math.max(0, p.weight), 0);
    let acc = 0;
    for (const p of opts.products.products) {
      acc += Math.max(0, p.weight) / Math.max(totalWeight, 1e-12);
      productCumulative.push({ id: p.id, cum: acc });
    }
  }
  // VROL-158 — production plan state. When set, pickProduct walks the plan
  // FIFO; pushPart returns false once the plan is exhausted so refillOne
  // stops emitting parts.
  const plan = opts.products?.productionPlan;
  let planIdx = 0;
  let planUnitsRemaining = plan && plan.length > 0 ? plan[0]!.quantity : 0;
  const pickProduct = (): string | undefined => {
    if (plan && plan.length > 0) {
      // Skip exhausted entries.
      while (planIdx < plan.length && planUnitsRemaining <= 0) {
        planIdx += 1;
        if (planIdx < plan.length) planUnitsRemaining = plan[planIdx]!.quantity;
      }
      if (planIdx >= plan.length) return undefined; // plan exhausted
      const entry = plan[planIdx]!;
      planUnitsRemaining -= 1;
      return entry.productId;
    }
    if (productCumulative.length === 0) return undefined;
    const r = opts.prng.nextFloat();
    for (const entry of productCumulative) {
      if (r <= entry.cum) return entry.id;
    }
    return productCumulative[productCumulative.length - 1]!.id;
  };
  // True when the plan exists AND has no more units to emit.
  const planExhausted = (): boolean =>
    plan !== undefined && plan.length > 0 && planIdx >= plan.length;

  // Refill the input on-demand, ONE part at a time, stamped with the time
  // the source will pull it. This keeps W (time-in-system) at exit honest —
  // a pre-loaded queue would give misleading W values for parts deep in it.
  // When ChainOptions.source is set (VROL-648), parts are pushed by
  // scheduled "source-arrival" events instead — refillOne is unused in that
  // mode and the on-completion-refill below is skipped.
  let nextPartId = 0;
  // VROL-886 — batch + lot counter. Both increment lazily — batchSize parts
  // belong to the same batch, batchesPerLot batches belong to the same lot.
  // When no batch tagging is configured these stay 0 and the IDs aren't
  // emitted, so legacy runs are unaffected.
  const batchTagging =
    opts.source?.batchTagging?.enabled === true ? opts.source.batchTagging : null;
  const batchPrefix = batchTagging?.batchIdPrefix ?? "BATCH";
  const lotPrefix = batchTagging?.lotIdPrefix ?? "LOT";
  const batchSizePerBatch = Math.max(1, opts.source?.batchSize ?? 1);
  const batchesPerLot = Math.max(1, batchTagging?.batchesPerLot ?? 1);
  let batchCounter = 0;
  let lotCounter = 0;
  let partsInCurrentBatch = 0;
  // Track per-batch + per-lot counts on the result.
  const perBatchCompleted = batchTagging ? new Map<string, number>() : undefined;
  const perBatchScrapped = batchTagging ? new Map<string, number>() : undefined;
  const perLotCompleted = batchTagging ? new Map<string, number>() : undefined;
  const nextBatchIds = (): { batchId: string; lotId: string } => {
    // Advance counters when the batch fills up. lotCounter advances when
    // `batchesPerLot` batches have been minted.
    if (partsInCurrentBatch >= batchSizePerBatch) {
      batchCounter += 1;
      partsInCurrentBatch = 0;
      if (batchCounter % batchesPerLot === 0) lotCounter += 1;
    }
    partsInCurrentBatch += 1;
    return {
      batchId: `${batchPrefix}-${String(batchCounter).padStart(4, "0")}`,
      lotId: `${lotPrefix}-${String(lotCounter).padStart(4, "0")}`,
    };
  };
  const pushPart = (timeMs: number): void => {
    // VROL-158 — once the production plan is exhausted, stop pushing parts.
    // Source station will starve naturally; chain drains via remaining WIP.
    if (planExhausted()) return;
    const productId = pickProduct();
    if (plan && plan.length > 0 && productId === undefined) return;
    const tagging = batchTagging ? nextBatchIds() : null;
    inputBuffer.push({
      id: nextPartId++,
      enteredSystemAtMs: timeMs,
      ...(productId !== undefined ? { productId } : {}),
      ...(tagging ? { batchId: tagging.batchId, lotId: tagging.lotId } : {}),
    });
  };
  const refillOne = (timeMs: number): void => {
    if (inputBuffer.size === 0) pushPart(timeMs);
  };
  const sourceMode = opts.source !== undefined;
  // VROL-655 — single dispatcher for the "source station just consumed
  // (or is about to consume) — does anyone need to refill?" decision.
  // sourceMode means arrivals are the only injection path; this is a no-op.
  // Otherwise we ensure the input buffer always has the next part queued.
  const onSourceTickMaybeRefill = (timeMs: number): void => {
    if (sourceMode) return;
    refillOne(timeMs);
  };
  onSourceTickMaybeRefill(0);

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
  // inside handleCycleComplete, so this slots in correctly.) VROL-655 —
  // dispatched via the single helper so sourceMode skips it.
  executors[topology.sourceIdx]?.onCompletion((event) => {
    onSourceTickMaybeRefill(event.timeMs);
  });

  // VROL-648 — finite-rate source generation. Validate config, schedule the
  // first arrival at t=0, and let the scheduler handler chain the rest.
  let sourceArrivalsFired = 0;
  let sourceBatchSize = 1;
  let sourceInterArrival: Distribution | undefined;
  if (sourceMode) {
    const cfg = opts.source!;
    if (cfg.batchSize !== undefined) {
      if (!Number.isInteger(cfg.batchSize) || cfg.batchSize < 1) {
        throw new Error(
          `source.batchSize must be a positive integer (got ${String(cfg.batchSize)})`,
        );
      }
      sourceBatchSize = cfg.batchSize;
    }
    sourceInterArrival = cfg.interArrivalMs;
    scheduler.schedule(0, { kind: "source-arrival", batchSize: sourceBatchSize });
  }

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
  // VROL-642 — expand recurring entries into the same scheduler stream so
  // the handler sees no difference between one-shot + recurring events
  // beyond the optional maxInventory cap.
  if (opts.materials?.recurringReplenishments) {
    for (const rep of opts.materials.recurringReplenishments) {
      if (!(rep.intervalMs > 0)) {
        throw new Error(
          `materials.recurringReplenishments: intervalMs must be > 0 (got ${String(rep.intervalMs)})`,
        );
      }
      if (rep.amount < 0) {
        throw new Error(
          `materials.recurringReplenishments: amount must be >= 0 (got ${String(rep.amount)})`,
        );
      }
      const startMs = rep.startMs ?? 0;
      if (startMs < 0) {
        throw new Error(
          `materials.recurringReplenishments: startMs must be >= 0 (got ${String(startMs)})`,
        );
      }
      for (let t = startMs; t <= opts.horizonMs; t += rep.intervalMs) {
        scheduler.schedule(t, {
          kind: "material-replenishment",
          materialId: rep.materialId,
          amount: rep.amount,
          ...(rep.maxInventory !== undefined ? { maxInventory: rep.maxInventory } : {}),
        });
      }
    }
  }

  // VROL-618 — schedule a break-end event for every worker break. Without this,
  // a station that Starved because all workers were on break stays Starved
  // forever after the break window closes (the engine has no other nudge).
  // Mirrors how maintenance-end events wake stations after planned downtime.
  if (opts.workers) {
    for (const w of opts.workers.workers) {
      if (!w.breaks) continue;
      for (const brk of w.breaks) {
        if (brk.endMs > 0 && brk.endMs <= opts.horizonMs) {
          scheduler.schedule(brk.endMs, { kind: "break-end" });
        }
      }
    }
  }

  // Kick off — every station attempts to start so Starved transitions fire correctly.
  for (const ex of executors) ex.attemptStart(0);

  // VROL-612 — pre-compute sampler timestamps when the sampler is configured.
  // Samples land at intervalMs, 2*intervalMs, ... up to horizonMs (inclusive).
  // tMs values before warmupMs are recorded but flagged so they get dropped
  // from the published samples array.
  const samplerIntervalMs = opts.sampler?.intervalMs ?? 0;
  const sampleTimes: number[] = [];
  if (samplerIntervalMs > 0) {
    for (let t = samplerIntervalMs; t <= opts.horizonMs; t += samplerIntervalMs) {
      sampleTimes.push(t);
    }
    // Guarantee a final flush at horizonMs so the last sample's totals match
    // ChainResult.completed / perStationCompleted exactly.
    if (sampleTimes.length === 0 || sampleTimes[sampleTimes.length - 1] !== opts.horizonMs) {
      sampleTimes.push(opts.horizonMs);
    }
  }
  let nextSampleIdx = 0;
  let exitCursor = 0;
  let exitsInWindowSoFar = 0;
  const samples: TimeseriesSample[] = [];
  const drainSamplesUpTo = (uptoMs: number): void => {
    while (nextSampleIdx < sampleTimes.length) {
      const tMs = sampleTimes[nextSampleIdx];
      if (tMs === undefined || tMs > uptoMs) break;
      // Advance the running cursor through any exits we've now passed. exits
      // are pushed in temporal order so this is a single linear sweep total.
      while (exitCursor < exits.length) {
        const exit = exits[exitCursor];
        if (!exit || exit.exitTimeMs > tMs) break;
        if (exit.exitTimeMs >= opts.warmupMs) exitsInWindowSoFar += 1;
        exitCursor += 1;
      }
      if (tMs >= opts.warmupMs) {
        samples.push({
          tMs,
          lineCompleted: exitsInWindowSoFar,
          perStationCompleted: executors.map((e) => e.completed),
          perEdgeBufferFill: edgeBuffers.map((b) => b.size),
          // VROL-619 — cumulative ms-in-state per station; consumer derives
          // fractions per interval by diffing consecutive samples.
          perStationStateMs: stateTimeTrackers.map((t) => t.snapshotInto(tMs)),
          // VROL-639 — cumulative rework count per station; last sample
          // matches result.perStationReworked.
          perStationRework: executors.map((e) => e.reworked),
        });
      } else {
        // Pre-warmup: still advance trackers so the snapshot deltas stay
        // consistent with the end-of-run finalize, but don't keep the sample.
        for (const t of stateTimeTrackers) t.snapshotInto(tMs);
      }
      nextSampleIdx += 1;
    }
  };

  while (scheduler.size > 0) {
    const peeked = scheduler.peek();
    if (!peeked || peeked.timeMs > opts.horizonMs) break;
    // Drain any sampler ticks whose tMs falls before the next event — those
    // snapshots see executor.completed as of the previous event's outcome,
    // matching the engine's "discrete event clock" semantics.
    if (samplerIntervalMs > 0) drainSamplesUpTo(peeked.timeMs - 1);
    const ev = scheduler.popMin();
    // VROL-148 — `dispatch:` labels the per-event handler. Replaces the old
    // `continue` short-circuits with `break dispatch` so the generator
    // can `yield ev` at the bottom of every iteration (step mode requires
    // a pause point after every event, not just cycle-complete).
    dispatch: {
      if (ev.payload.kind === "material-replenishment") {
        if (!materialPool) break dispatch;
        let addAmount = ev.payload.amount;
        if (ev.payload.maxInventory !== undefined) {
          const headroom = ev.payload.maxInventory - materialPool.quantity(ev.payload.materialId);
          addAmount = Math.max(0, Math.min(addAmount, headroom));
        }
        if (addAmount > 0) materialPool.replenish(ev.payload.materialId, addAmount);
        replenishmentsFired += 1;
        const affected = executorsByMaterial.get(ev.payload.materialId);
        if (affected) {
          for (const ex of affected) ex.onUpstreamAvailable(ev.timeMs);
        }
        break dispatch;
      }
      if (ev.payload.kind === "source-arrival") {
        // VROL-648 — push `batchSize` parts, nudge the source station, then
        // sample + schedule the next arrival if there's still horizon left.
        for (let b = 0; b < ev.payload.batchSize; b++) pushPart(ev.timeMs);
        sourceArrivalsFired += 1;
        executors[topology.sourceIdx]?.onUpstreamAvailable(ev.timeMs);
        if (sourceInterArrival) {
          const dtMs = sample(sourceInterArrival, opts.prng, { min: 0 });
          const nextT = ev.timeMs + dtMs;
          if (nextT <= opts.horizonMs) {
            scheduler.schedule(nextT, { kind: "source-arrival", batchSize: sourceBatchSize });
          }
        }
        break dispatch;
      }
      if (ev.payload.kind === "breakdown-start") {
        const bidx = stationIds.indexOf(ev.payload.stationId);
        const manager = breakdownManagers?.[bidx];
        const executor = executors[bidx];
        if (manager) {
          manager.handleBreakdown(ev.timeMs);
          // VROL-125 — pause in-flight parts so the resume on repair can pick up
          // where they left off, instead of losing them on the Down-state scrap path.
          if (executor) executor.handleBreakdown(ev.timeMs);
          if (breakdownCounts) breakdownCounts[bidx] = (breakdownCounts[bidx] ?? 0) + 1;
        }
        break dispatch;
      }
      if (ev.payload.kind === "repair-complete") {
        const ridx = stationIds.indexOf(ev.payload.stationId);
        const manager = breakdownManagers?.[ridx];
        const executor = executors[ridx];
        if (manager) manager.handleRepair(ev.timeMs);
        if (executor) {
          executor.handleRepair(ev.timeMs);
          executor.attemptStart(ev.timeMs);
        }
        break dispatch;
      }
      if (ev.payload.kind === "maintenance-start") {
        const midx = stationIds.indexOf(ev.payload.stationId);
        const mgr = maintenanceManagers[midx];
        const executor = executors[midx];
        if (mgr) mgr.handleMaintenanceStart(ev.timeMs);
        // Reuse the part-resume primitive — Maintenance and Down both want to
        // pause in-flight parts so they can resume after the window ends.
        if (executor) executor.handleBreakdown(ev.timeMs);
        break dispatch;
      }
      if (ev.payload.kind === "break-end") {
        // VROL-618 — wake every executor; whichever ones were Starved on
        // "no-skill-available" will retry the worker pool, which now sees the
        // break window has closed.
        for (const ex of executors) ex.attemptStart(ev.timeMs);
        break dispatch;
      }
      if (ev.payload.kind === "maintenance-end") {
        const eidx = stationIds.indexOf(ev.payload.stationId);
        const mgr = maintenanceManagers[eidx];
        const executor = executors[eidx];
        if (mgr) mgr.handleMaintenanceEnd(ev.timeMs);
        if (executor) {
          executor.handleRepair(ev.timeMs);
          executor.attemptStart(ev.timeMs);
        }
        break dispatch;
      }
      if (ev.payload.kind === "setup-complete") {
        // VROL-AUDIT — without this branch, stations with setupTimeMs > 0 sit
        // in Setup forever (per-station OEE shows availability=0, runTimeMs=0,
        // Setup % = 100), even though cycle-complete still fires and throughput
        // math survives. handleSetupComplete is a no-op when the SM isn't in
        // Setup, so this is safe with capacity > 1 stations.
        const sidx = stationIds.indexOf(ev.payload.stationId);
        executors[sidx]?.handleSetupComplete(ev.timeMs);
        break dispatch;
      }
      if (ev.payload.kind !== "cycle-complete") break dispatch;
      const idx = stationIds.indexOf(ev.payload.stationId);
      if (idx === -1) break dispatch;
      const executor = executors[idx];
      if (!executor) break dispatch;

      executor.handleCycleComplete(ev.timeMs, ev.payload.partIndex);

      // After this station pulled from each of its upstream buffers (inside
      // attemptStart), each of those upstream stations' downstream just gained
      // space — notify each.
      for (const upIdx of topology.incoming[idx] ?? []) {
        executors[upIdx]?.onDownstreamCleared(ev.timeMs);
      }

      // VROL-655 — single dispatcher; sourceMode skips refill internally.
      if (idx === topology.sourceIdx) onSourceTickMaybeRefill(ev.timeMs);

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
    // VROL-148 — pause point for step / live consumers. runChain consumer
    // ignores the yielded value and drives to completion.
    yield ev;
  }

  const endTimeMs = opts.horizonMs;
  const measureWindowMs = endTimeMs - opts.warmupMs;

  // Final sampler flush — any tMs ≤ horizonMs that wasn't drained mid-loop
  // (because no event followed it) gets the end-of-run executor state. This
  // is the sample whose perStationCompleted equals ChainResult.perStationCompleted.
  if (samplerIntervalMs > 0) drainSamplesUpTo(endTimeMs);

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
  // VROL-469 — count the source-side inputBuffer too. Without this the
  // chain undercounted L by ~1 part-equivalent per cycle in steady state.
  bufferWipL += inputBuffer.averageWIP(endTimeMs);
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
      // VROL-900 — per-station nominal/operating ratio, derived from the
      // same nominalCycleTimes the topology validated against the operating
      // mean. 1.0 means at nominal max (or no nominal set). < 1.0 means
      // throttled. detectBottlenecks uses this for the composite bindingScore
      // so balanced lines surface the at-nominal-max station as bottleneck.
      const nominal = topology.nominalCycleTimes[i];
      const operatingMean = meanOf(topology.cycleTimes[i] as Distribution);
      const nominalSpeedRatio =
        nominal && operatingMean > 0 ? Math.min(1, Math.max(0, nominal / operatingMean)) : 1;
      const base =
        label !== undefined
          ? { stationId: id, label, tracker, nominalSpeedRatio }
          : { stationId: id, tracker, nominalSpeedRatio };
      return base;
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
    // VROL-616 — denominator is sum across workers of "effectively available
    // ms in the measurement window" = shift ∩ [warmup, horizon], minus break ∩
    // shift ∩ [warmup, horizon]. A 50%-break worker no longer drags util to
    // 50%; we just don't count their break time as available capacity.
    // Pre-VROL-616 workers (no breaks) fall through to shift-only math.
    let denom = 0;
    for (const w of opts.workers.workers) {
      denom += effectiveAvailableMs(w, opts.warmupMs, endTimeMs);
    }
    if (denom > 0) {
      laborUtilization = Math.min(1, trackingPool.busyMs / denom);
    }
  }

  // Per-station OEE — A × P × Q against the station's own time-in-state breakdown.
  // Phase 0 chain has defectRate=0, so totalParts = goodParts = perStationCompleted.
  // VROL-899 — nominalCycleTimeMs threaded through so Performance can be
  // measured against the OEM-rated design max instead of the operating mean.
  // When undefined for a station, computeOee falls back to ideal cycle.
  const perStationOee: OeeMetrics[] = executors.map((ex, i) =>
    computeOee({
      stateTimeTracker: stateTimeTrackers[i] as StateTimeTracker,
      idealCycleTimeMs: meanOf(topology.cycleTimes[i] as Distribution),
      nominalCycleTimeMs: topology.nominalCycleTimes[i],
      goodParts: ex.completed,
      totalParts: ex.completed + ex.scrapped,
    }),
  );
  // Proper line OEE (VROL-610) — actual throughput / theoretical-max
  // throughput, where the max is set by the bottleneck (largest ideal cycle).
  // Clamped to [0, 1] so heavy warm-up / short-horizon corner cases (where
  // a few parts may exit faster than the "ideal" rate due to startup queue)
  // don't report >100% OEE.
  let bottleneckIdealCycleMs = 0;
  let bottleneckStationIdx = 0;
  topology.cycleTimes.forEach((dist, i) => {
    const mean = meanOf(dist as Distribution);
    if (mean > bottleneckIdealCycleMs) {
      bottleneckIdealCycleMs = mean;
      bottleneckStationIdx = i;
    }
  });
  const lineOee =
    bottleneckIdealCycleMs > 0
      ? Math.min(1, Math.max(0, throughputLambda * bottleneckIdealCycleMs))
      : 0;
  const aggregateBufferWipL = edgeBuffers.reduce((s, b) => s + b.averageWIP(endTimeMs), 0);

  return {
    completed: exitsInWindow.length,
    elapsedMs: measureWindowMs,
    averageWipL,
    throughputLambda,
    avgTimeInSystemW,
    perStationCompleted: executors.map((e) => e.completed),
    perStationLabels: topology.labels,
    perStationRunningPct: stateTimeTrackers.map((t) => {
      const total = t.totalTime();
      return total > 0 ? t.timeInState("Running") / total : 0;
    }),
    perStationCapacity: topology.capacities,
    bottlenecks,
    perStationOee,
    lineOee,
    bottleneckStationIdx,
    aggregateBufferWipL,
    perEdgeFlowed: edgeBuffers.map((b) => b.flowed),
    perStationScrapped: executors.map((e) => e.scrapped),
    lineScrapRate: (() => {
      const totalCompleted = executors.reduce((s, e) => s + e.completed, 0);
      const totalScrapped = executors.reduce((s, e) => s + e.scrapped, 0);
      const denom = totalCompleted + totalScrapped;
      return denom > 0 ? totalScrapped / denom : 0;
    })(),
    perStationReworked: executors.map((e) => e.reworked),
    lineReworkRate: (() => {
      const totalCompleted = executors.reduce((s, e) => s + e.completed, 0);
      const totalScrapped = executors.reduce((s, e) => s + e.scrapped, 0);
      const totalReworked = executors.reduce((s, e) => s + e.reworked, 0);
      const denom = totalCompleted + totalScrapped + totalReworked;
      return denom > 0 ? totalReworked / denom : 0;
    })(),
    // VROL-868 — theoretical yield. goodParts / (goodParts + scrapped).
    // Excludes reworked from the denominator (rework is a recovery path,
    // not a yield loss). Defaults to 1.0 when there's no scrap.
    theoreticalYield: (() => {
      const totalCompleted = executors.reduce((s, e) => s + e.completed, 0);
      const totalScrapped = executors.reduce((s, e) => s + e.scrapped, 0);
      const denom = totalCompleted + totalScrapped;
      return denom > 0 ? totalCompleted / denom : 1;
    })(),
    // VROL-885 — sustainability totals. Each station's per-cycle input ×
    // (completed / unitsPerCycle) since "completed" already accounts for
    // the multi-output multiplier. Cycles ran = completed / unitsPerCycle.
    totalEnergyJ: executors.reduce((s, e, i) => {
      const cycles = e.completed / (topology.unitsPerCycle[i] ?? 1);
      return s + cycles * (topology.energyPerCycleJ[i] ?? 0);
    }, 0),
    totalWaterL: executors.reduce((s, e, i) => {
      const cycles = e.completed / (topology.unitsPerCycle[i] ?? 1);
      return s + cycles * (topology.waterPerCycleL[i] ?? 0);
    }, 0),
    totalCO2eG: executors.reduce((s, e, i) => {
      const cycles = e.completed / (topology.unitsPerCycle[i] ?? 1);
      return s + cycles * (topology.co2ePerCycleG[i] ?? 0);
    }, 0),
    // VROL-882 — per-station grade counts. Multinomial expectation: each
    // station's completed × pct(grade). The engine doesn't sample per part
    // for grades — it bulk-attributes the count proportionally at finalize
    // time. Trades per-part variance for runtime perf (one walk over
    // stations × grades vs N×G sampler calls).
    perStationGradeCounts: executors.map((e, i) => {
      const grades = topology.qualityGrades[i] ?? [{ grade: "A", pct: 1 }];
      const out: Record<string, number> = {};
      for (const g of grades) out[g.grade] = Math.round(e.completed * g.pct);
      return out;
    }),
    lineGradeCounts: (() => {
      const out: Record<string, number> = {};
      executors.forEach((e, i) => {
        const grades = topology.qualityGrades[i] ?? [{ grade: "A", pct: 1 }];
        for (const g of grades) {
          const count = Math.round(e.completed * g.pct);
          out[g.grade] = (out[g.grade] ?? 0) + count;
        }
      });
      return out;
    })(),
    samples,
    ...(materialFinal ? { materialFinal, replenishmentsFired } : {}),
    ...(sourceMode ? { sourceArrivalsFired } : {}),
    ...(breakdownCounts ? { perStationBreakdowns: breakdownCounts } : {}),
    ...(opts.maintenance
      ? {
          perStationMaintenanceMs: stateTimeTrackers.map((t) => t.timeInState("Maintenance")),
        }
      : {}),
    ...(laborUtilization !== undefined ? { laborUtilization } : {}),
    ...(perProductCompleted ? { perProductCompleted } : {}),
    ...(perBatchCompleted ? { perBatchCompleted } : {}),
    ...(perBatchScrapped ? { perBatchScrapped } : {}),
    ...(perLotCompleted ? { perLotCompleted } : {}),
  };
}
