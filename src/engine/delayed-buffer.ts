/**
 * VROL-1001 — Delay-line buffer (conveyor primitive).
 *
 * A bounded FIFO where each pushed item carries a `readyAtMs` =
 * pushTimeMs + residenceTimeMs. peek/pull only return items whose
 * readyAtMs has elapsed. firstReadyAt() exposes when the front item
 * becomes available so the chain harness can wake a downstream
 * station via the scheduler instead of polling.
 *
 * Tracks the time-weighted WIP integral so KPI math still works.
 * Capacity counts BOTH ready and in-transit items — back-pressure
 * happens regardless of readiness, which is the real conveyor
 * behaviour (a conveyor can't accept new parts once it's full).
 *
 * Models real conveyors / tunnel ovens / dryers / hold tanks where
 * parts physically travel for residenceTimeMs before reaching the
 * next station.
 */

interface DelayedItem<T> {
  readonly item: T;
  readonly readyAtMs: number;
}

export class DelayedBuffer<T> {
  private items: DelayedItem<T>[] = [];
  private integral_ = 0;
  private lastChangeTimeMs_ = 0;
  private startTimeMs_ = 0;

  constructor(
    public readonly capacity: number,
    public readonly residenceTimeMs: number,
  ) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new Error(
        `DelayedBuffer capacity must be a non-negative integer, got ${String(capacity)}`,
      );
    }
    if (!Number.isFinite(residenceTimeMs) || residenceTimeMs < 0) {
      throw new Error(
        `DelayedBuffer residenceTimeMs must be a finite non-negative number, got ${String(residenceTimeMs)}`,
      );
    }
  }

  /** Total items in the buffer (ready + still in transit). */
  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Full means no more parts can enter, regardless of how many are ready. */
  get isFull(): boolean {
    return this.items.length >= this.capacity;
  }

  resetTracking(timeMs: number): void {
    this.integral_ = 0;
    this.lastChangeTimeMs_ = timeMs;
    this.startTimeMs_ = timeMs;
  }

  private tick(timeMs: number): void {
    const delta = timeMs - this.lastChangeTimeMs_;
    if (delta < 0) {
      throw new Error(
        `DelayedBuffer.tick called with timeMs=${String(timeMs)} < lastChangeTimeMs=${String(this.lastChangeTimeMs_)}`,
      );
    }
    this.integral_ += this.items.length * delta;
    this.lastChangeTimeMs_ = timeMs;
  }

  /**
   * Push an item that will become available at `timeMs + residenceTimeMs`.
   * Returns true on success, false when full.
   */
  pushAt(item: T, timeMs: number): boolean {
    this.tick(timeMs);
    if (this.isFull) return false;
    this.items.push({ item, readyAtMs: timeMs + this.residenceTimeMs });
    return true;
  }

  /**
   * Pull the front item if and only if it has become ready at `timeMs`.
   * Returns undefined when empty OR front is still in transit. Callers
   * that need to know when to retry should consult `firstReadyAt()`.
   */
  pullAt(timeMs: number): T | undefined {
    this.tick(timeMs);
    const front = this.items[0];
    if (!front || front.readyAtMs > timeMs) return undefined;
    this.items.shift();
    return front.item;
  }

  /** Front item iff ready at `timeMs`. Non-mutating. */
  peekReady(timeMs: number): T | undefined {
    const front = this.items[0];
    if (!front || front.readyAtMs > timeMs) return undefined;
    return front.item;
  }

  /** When the front item becomes available; undefined when empty. */
  firstReadyAt(): number | undefined {
    return this.items[0]?.readyAtMs;
  }

  /** Count of items whose readyAt has elapsed at `timeMs`. */
  readyCountAt(timeMs: number): number {
    let n = 0;
    for (const w of this.items) {
      if (w.readyAtMs <= timeMs) n++;
      else break;
    }
    return n;
  }

  /** Time-integral of size over [startTime, currentTime]. */
  get integral(): number {
    return this.integral_;
  }

  /** Time-weighted average WIP over the tracked window. 0 if no time elapsed. */
  averageWIP(endTimeMs: number): number {
    this.tick(endTimeMs);
    const elapsed = endTimeMs - this.startTimeMs_;
    if (elapsed <= 0) return 0;
    return this.integral_ / elapsed;
  }

  clear(): void {
    this.items = [];
  }
}
