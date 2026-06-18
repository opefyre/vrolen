/**
 * Bounded FIFO buffer used between stations and on edges.
 *
 * Two flavors:
 *   - Buffer<T>:        plain queue with capacity. Minimal overhead. Use when
 *                       no time-series instrumentation is needed.
 *   - TrackedBuffer<T>: Buffer plus time-weighted WIP tracking. Records the
 *                       integral of size over simulated time so the KPI layer
 *                       can compute average WIP without sampling.
 *
 * push() returns true on success, false if full — the cycle executor uses
 * this to transition the station to BlockedOut on a failed push.
 */

export class Buffer<T> {
  private items: T[] = [];

  constructor(public readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new Error(`Buffer capacity must be a non-negative integer, got ${String(capacity)}`);
    }
  }

  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  get isFull(): boolean {
    return this.items.length >= this.capacity;
  }

  push(item: T): boolean {
    if (this.isFull) return false;
    this.items.push(item);
    return true;
  }

  pull(): T | undefined {
    return this.items.shift();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  clear(): void {
    this.items = [];
  }
}

/**
 * Buffer that tracks time-weighted WIP.
 *
 * The KPI math we care about is the time-weighted average:
 *   avgWIP(t0, t1) = (∫ size(t) dt from t0 to t1) / (t1 - t0)
 *
 * Sampling at scheduler events is wasteful and noisy. Instead we accumulate
 * the integral analytically: every time `size` changes, we add
 *   (currentSize) × (timeMs - lastChangeTimeMs)
 * to an integral accumulator. Average is then integral / elapsed.
 *
 * The user must call `tick(timeMs)` immediately before each push/pull AND
 * `finalize(timeMs)` at end of run so the integral covers the final flat
 * segment. The cycle executor does this automatically when consumers use
 * TrackedBuffer instead of plain Buffer.
 */
export class TrackedBuffer<T> extends Buffer<T> {
  private integral_ = 0;
  private lastChangeTimeMs_ = 0;
  private startTimeMs_ = 0;

  /** Reset tracking, anchoring t0 at the given simulated time. */
  resetTracking(timeMs: number): void {
    this.integral_ = 0;
    this.lastChangeTimeMs_ = timeMs;
    this.startTimeMs_ = timeMs;
  }

  /** Advance the integral up to `timeMs` using the CURRENT size — call before mutating. */
  tick(timeMs: number): void {
    const delta = timeMs - this.lastChangeTimeMs_;
    if (delta < 0) {
      throw new Error(
        `TrackedBuffer.tick called with timeMs=${String(timeMs)} < lastChangeTimeMs=${String(this.lastChangeTimeMs_)}`,
      );
    }
    this.integral_ += this.size * delta;
    this.lastChangeTimeMs_ = timeMs;
  }

  pushAt(item: T, timeMs: number): boolean {
    this.tick(timeMs);
    return super.push(item);
  }

  pullAt(timeMs: number): T | undefined {
    this.tick(timeMs);
    return super.pull();
  }

  /** Time-integral of size over [startTime, currentTime]. */
  get integral(): number {
    return this.integral_;
  }

  /** Time-weighted average WIP over the tracked window. Returns 0 if no time has elapsed. */
  averageWIP(endTimeMs: number): number {
    this.tick(endTimeMs);
    const elapsed = endTimeMs - this.startTimeMs_;
    if (elapsed <= 0) return 0;
    return this.integral_ / elapsed;
  }
}
