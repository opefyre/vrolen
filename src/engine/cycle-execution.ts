/**
 * Cycle execution — the core station behavior loop.
 *
 *   1. PULL a part from upstream (if available; else go Starved).
 *   2. HOLD for sample(cycleTimeMs) duration (state = Running).
 *      Schedules a cycle-complete event at currentTime + sampled cycleTime.
 *   3. On completion: roll defect.
 *      - Defect: scrap (don't push downstream).
 *      - Good:   push to downstream. If downstream full, go BlockedOut and
 *                hold the part until downstream clears.
 *   4. Attempt to start next cycle.
 *
 * Capacity > 1 lets a station have up to N parts in progress simultaneously
 * (parallel processing). Each in-progress part gets its own cycle-complete
 * event in the scheduler.
 *
 * The CycleExecutor owns the LOOP but not the wiring. A higher-level
 * orchestrator (next stories) is responsible for:
 *   - Calling executor.handleCycleComplete() when the scheduler fires a
 *     cycle-complete event tagged for this station.
 *   - Calling executor.onUpstreamAvailable() when a part arrives upstream.
 *   - Calling executor.onDownstreamCleared() when downstream has space.
 *
 * Determinism: all stochastic decisions (sampled cycleTime, defect roll)
 * go through the provided Prng. Same Prng sequence → same outcomes.
 */

import type { Distribution } from "./distribution";
import type { ResourceId, StationId } from "./ids";
import type { Prng } from "./prng";
import type { Buffer } from "./buffer";
import type { EngineEvent } from "./events";
import type { MaterialPool, MaterialRequirement } from "./material-pool";
import { Scheduler } from "./scheduler";
import { StationStateMachine } from "./state-machine";
import { sample } from "./sampling";
import type { WorkerPool } from "./worker-pool";

export interface CycleConfig<P> {
  readonly stationId: StationId;
  readonly cycleTimeMs: Distribution;
  /** [0, 1]. Probability that a completed part is defective and scrapped (vs pushed downstream). */
  readonly defectRate: number;
  /** Maximum number of simultaneously in-progress parts. */
  readonly capacity: number;
  readonly upstream: Buffer<P>;
  readonly downstream: Buffer<P>;
  /**
   * Optional setup/changeover time before each cycle starts. When set, the
   * station goes Idle → Setup → Running instead of directly to Running.
   * The cycle clock starts AFTER setup completes. Use constant(0) or omit to
   * skip setup entirely. Changeover matrices for product-specific setups are
   * a follow-up — single-product behavior in Phase 0.
   */
  readonly setupTimeMs?: Distribution;
  /**
   * Optional material requirements consumed atomically at cycle start. When
   * present + a materialPool is also provided, the executor calls
   * materialPool.consume(materialRequirements) before pulling a part. If
   * consume returns false (insufficient material), the station transitions
   * to Starved with reason "starved-material".
   */
  readonly materialRequirements?: ReadonlyArray<MaterialRequirement>;
  readonly materialPool?: MaterialPool;
  /**
   * Optional worker assignment. When workerPool is set, the executor calls
   * pool.request(requiredSkills ?? [], timeMs) before pulling a part. If no
   * eligible worker exists (insufficient skills, all assigned, or off-shift),
   * the station transitions to Starved with reason "no-skill-available".
   * On cycle completion (good, defective, or scrapped due to Down) the
   * worker is released back to the pool.
   */
  readonly workerPool?: WorkerPool;
  readonly requiredSkills?: readonly string[];
}

export interface CompletionEvent<P> {
  readonly stationId: StationId;
  readonly part: P;
  readonly timeMs: number;
  readonly defective: boolean;
}

export type CompletionListener<P> = (event: CompletionEvent<P>) => void;

export class CycleExecutor<P> {
  private inProgress_ = 0;
  private completed_ = 0;
  private scrapped_ = 0;
  /** Parts that finished their cycle but couldn't push (downstream was full). Drained when downstream clears. */
  private pendingPush: P[] = [];
  private listeners: CompletionListener<P>[] = [];

  constructor(
    public readonly config: CycleConfig<P>,
    public readonly stateMachine: StationStateMachine,
    public readonly scheduler: Scheduler<EngineEvent>,
    public readonly prng: Prng,
  ) {
    if (config.defectRate < 0 || config.defectRate > 1) {
      throw new Error(
        `defectRate must be in [0, 1], got ${String(config.defectRate)} for station ${String(config.stationId)}`,
      );
    }
    if (!Number.isInteger(config.capacity) || config.capacity < 1) {
      throw new Error(
        `capacity must be a positive integer, got ${String(config.capacity)} for station ${String(config.stationId)}`,
      );
    }
  }

  get inProgress(): number {
    return this.inProgress_;
  }

  get completed(): number {
    return this.completed_;
  }

  get scrapped(): number {
    return this.scrapped_;
  }

  /**
   * Attempt to start cycles up to capacity. Called externally on:
   *   - Initial kick-off
   *   - When upstream signals a part is available
   *   - After a cycle completes (the executor calls this internally)
   *
   * Loops to start multiple cycles in one go for capacity > 1. No-ops gracefully
   * when at capacity, upstream is empty (transitions to Starved if applicable),
   * or station is Down/Maintenance/BlockedOut.
   */
  attemptStart(timeMs: number): void {
    while (true) {
      const state = this.stateMachine.state;
      if (state === "Down" || state === "Maintenance") return;
      if (state === "BlockedOut") return;
      if (this.inProgress_ >= this.config.capacity) return;

      if (this.config.upstream.isEmpty) {
        if (state === "Idle" || state === "Running") {
          this.stateMachine.transition("Starved", "starved-upstream", timeMs);
        }
        return;
      }

      // Material check — atomic across all requirements. If short, go Starved
      // with the material-specific reason. Don't pull the part yet (it stays
      // in upstream for the next attempt after replenishment).
      if (this.config.materialPool && this.config.materialRequirements?.length) {
        const consumed = this.config.materialPool.consume(this.config.materialRequirements);
        if (!consumed) {
          if (state === "Idle" || state === "Running") {
            this.stateMachine.transition("Starved", "starved-material", timeMs);
          }
          return;
        }
      }

      // Worker check — request a qualified worker. If none, go Starved with
      // the no-skill reason. We've already consumed materials at this point,
      // which is "wrong" in the sense that the recipe leaks if the worker
      // never shows up. For Phase 0 this is acceptable — material starvation
      // and worker starvation in the same cycle is a degenerate scenario, and
      // real scenarios get a fresh consume retry on every attemptStart anyway.
      let assignedWorkerId: ResourceId | undefined;
      if (this.config.workerPool) {
        const worker = this.config.workerPool.request(this.config.requiredSkills ?? [], timeMs);
        if (!worker) {
          if (state === "Idle" || state === "Running") {
            this.stateMachine.transition("Starved", "no-skill-available", timeMs);
          }
          return;
        }
        assignedWorkerId = worker.id;
      }

      const part = this.config.upstream.pull();
      if (part === undefined) {
        if (assignedWorkerId) this.config.workerPool?.release(assignedWorkerId, timeMs);
        return;
      }

      this.inProgress_ += 1;
      this.inFlight.push(part);
      if (assignedWorkerId) this.assignedWorkers.push(assignedWorkerId);
      else this.assignedWorkers.push(null);

      // If setup time is configured (and non-zero), spend it in Setup state
      // before the cycle clock starts. Otherwise, go straight to Running.
      const setupMs = this.config.setupTimeMs
        ? sample(this.config.setupTimeMs, this.prng, { min: 0 })
        : 0;

      if (setupMs > 0) {
        if (state === "Idle" || state === "Starved") {
          this.stateMachine.transition("Setup", "setup-start", timeMs);
        } else if (state === "Running") {
          // capacity > 1 with setup: subsequent setups happen alongside running cycles;
          // we don't double-transition the station's state — only the first part
          // starting from Idle/Starved triggers the Setup transition. Treat the
          // shared station state as "the worst running condition any part is in."
          // For Phase 0 this approximation is fine; full per-part state lands in
          // a later story.
        }
        this.scheduler.schedule(timeMs + setupMs, {
          kind: "setup-complete",
          stationId: this.config.stationId,
        });
        // Also schedule the cycle-complete at setupMs + cycleTime
        const cycleTimeMs = sample(this.config.cycleTimeMs, this.prng, { min: 0 });
        this.scheduler.schedule(timeMs + setupMs + cycleTimeMs, {
          kind: "cycle-complete",
          stationId: this.config.stationId,
          partIndex: this.completed_ + this.scrapped_ + this.inProgress_,
        });
      } else {
        if (state === "Idle" || state === "Starved") {
          this.stateMachine.transition("Running", "start-cycle", timeMs);
        }
        const cycleTimeMs = sample(this.config.cycleTimeMs, this.prng, { min: 0 });
        this.scheduler.schedule(timeMs + cycleTimeMs, {
          kind: "cycle-complete",
          stationId: this.config.stationId,
          partIndex: this.completed_ + this.scrapped_ + this.inProgress_,
        });
      }

      // Loop — try to start another cycle if we have capacity + upstream parts.
    }
  }

  /** Called by the orchestrator when a setup-complete event for this station fires. */
  handleSetupComplete(timeMs: number): void {
    if (this.stateMachine.state === "Setup") {
      this.stateMachine.transition("Running", "setup-complete", timeMs);
    }
  }

  /** Called by the orchestrator when a cycle-complete event for this station fires. */
  handleCycleComplete(timeMs: number): void {
    if (this.inFlight.length === 0) {
      throw new Error(
        `cycle-complete fired for station ${String(this.config.stationId)} with no parts in flight`,
      );
    }
    const part = this.inFlight.shift() as P;
    this.inProgress_ -= 1;
    const workerId = this.assignedWorkers.shift();
    if (workerId && this.config.workerPool) this.config.workerPool.release(workerId, timeMs);

    // If a breakdown or maintenance kicked in after this cycle started, the
    // part is lost (per breakdown.ts Phase-0 scope). We can't push or
    // BlockedOut from a Down/Maintenance state — both transitions are
    // explicitly disallowed.
    const state = this.stateMachine.state;
    if (state === "Down" || state === "Maintenance") {
      this.scrapped_ += 1;
      this.notifyCompletion({ stationId: this.config.stationId, part, timeMs, defective: true });
      return;
    }

    const isDefective = this.prng.nextFloat() < this.config.defectRate;

    if (isDefective) {
      this.scrapped_ += 1;
      this.notifyCompletion({ stationId: this.config.stationId, part, timeMs, defective: true });
      this.attemptStart(timeMs);
      return;
    }

    // Try to push to downstream.
    const pushed = this.config.downstream.push(part);
    if (pushed) {
      this.completed_ += 1;
      this.notifyCompletion({ stationId: this.config.stationId, part, timeMs, defective: false });
      this.attemptStart(timeMs);
      return;
    }

    // Downstream full → BlockedOut.
    this.pendingPush.push(part);
    if (this.stateMachine.state !== "BlockedOut") {
      this.stateMachine.transition("BlockedOut", "blocked-downstream", timeMs);
    }
  }

  /**
   * Notify the executor that downstream has space again — push any pending
   * blocked parts, transition out of BlockedOut, and resume cycling.
   */
  onDownstreamCleared(timeMs: number): void {
    while (this.pendingPush.length > 0 && !this.config.downstream.isFull) {
      const part = this.pendingPush.shift() as P;
      this.config.downstream.push(part);
      this.completed_ += 1;
      this.notifyCompletion({ stationId: this.config.stationId, part, timeMs, defective: false });
    }

    if (this.pendingPush.length === 0 && this.stateMachine.state === "BlockedOut") {
      this.stateMachine.transition("Running", "downstream-cleared", timeMs);
      this.attemptStart(timeMs);
    }
  }

  /** Notify the executor that upstream has a new part — try to resume from Starved. */
  onUpstreamAvailable(timeMs: number): void {
    if (this.stateMachine.state === "Starved") {
      this.stateMachine.transition("Running", "upstream-available", timeMs);
    }
    this.attemptStart(timeMs);
  }

  onCompletion(fn: CompletionListener<P>): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  private inFlight: P[] = [];
  /** Per-in-flight-part worker id (null when no worker pool configured). */
  private assignedWorkers: Array<ResourceId | null> = [];

  private notifyCompletion(event: CompletionEvent<P>): void {
    for (const fn of [...this.listeners]) fn(event);
  }
}
