/**
 * Discrete-event simulation scheduler.
 *
 * The foundational primitive of the entire engine. Maintains a priority queue
 * of (timeMs, seq, payload) tuples; advances simulated time by popping the
 * minimum-time event. Every other engine feature schedules events through
 * this — state-machine transitions, breakdowns, schedule windows, material
 * deliveries, KPI samples — and consumes them by popping in order.
 *
 * Properties relied on by the rest of the engine:
 *  - Deterministic: same input sequence + same seed PRNG = bit-identical run.
 *    Achieved via a monotonic `seq` counter that ties-breaks events scheduled
 *    at the same time, in insertion order.
 *  - O(log n) insert and pop via a binary min-heap.
 *  - Time is monotonic — scheduling an event in the past throws. The engine
 *    NEVER walks time backwards. Catches bugs early.
 *
 * The payload is generic — the scheduler doesn't know or care what an event
 * means. The DES core wraps it with a specific Event union next story.
 */

export interface ScheduledEvent<P> {
  /** Simulated time of the event, in milliseconds. */
  readonly timeMs: number;
  /** Monotonic insertion order — ties-breaks events scheduled at the same time. */
  readonly seq: number;
  /** Opaque payload — interpreted by the caller. */
  readonly payload: P;
}

/** Thrown when an event is scheduled at a time before the scheduler's currentTime. */
export class EventInPastError extends Error {
  constructor(
    /** The time at which the event was attempted to be scheduled. */
    public readonly scheduledTimeMs: number,
    /** The scheduler's current time at the moment of the failed schedule call. */
    public readonly currentTimeMs: number,
  ) {
    super(
      `Cannot schedule event at t=${String(scheduledTimeMs)}ms when current time is t=${String(currentTimeMs)}ms — DES events must move forward in time.`,
    );
    this.name = "EventInPastError";
  }
}

/** Thrown by popMin() when the scheduler has no events. */
export class SchedulerEmptyError extends Error {
  constructor() {
    super("Cannot popMin() from an empty scheduler — check size or peek() first.");
    this.name = "SchedulerEmptyError";
  }
}

/**
 * Binary min-heap. Internal — wrapped by Scheduler below.
 * Generic compare lets the scheduler order by (timeMs, seq).
 */
class MinHeap<T> {
  private items: T[] = [];
  constructor(private readonly compare: (a: T, b: T) => number) {}

  size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const n = this.items.length;
    if (n === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop();
    if (last !== undefined && n > 1) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  clear(): void {
    this.items = [];
  }

  private siftUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      const cur = this.items[idx];
      const par = this.items[parent];
      if (cur === undefined || par === undefined) return;
      if (this.compare(cur, par) < 0) {
        this.items[idx] = par;
        this.items[parent] = cur;
        idx = parent;
      } else {
        return;
      }
    }
  }

  private siftDown(idx: number): void {
    const n = this.items.length;
    while (true) {
      const left = idx * 2 + 1;
      const right = idx * 2 + 2;
      let smallest = idx;
      const sm = this.items[smallest];
      if (sm === undefined) return;
      const lf = this.items[left];
      if (left < n && lf !== undefined && this.compare(lf, sm) < 0) smallest = left;
      const sm2 = this.items[smallest];
      const rt = this.items[right];
      if (right < n && rt !== undefined && sm2 !== undefined && this.compare(rt, sm2) < 0) {
        smallest = right;
      }
      if (smallest === idx) return;
      const a = this.items[idx];
      const b = this.items[smallest];
      if (a === undefined || b === undefined) return;
      this.items[idx] = b;
      this.items[smallest] = a;
      idx = smallest;
    }
  }
}

function compareEvents<P>(a: ScheduledEvent<P>, b: ScheduledEvent<P>): number {
  if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
  return a.seq - b.seq;
}

export class Scheduler<P> {
  private heap = new MinHeap<ScheduledEvent<P>>(compareEvents);
  private nextSeq = 0;
  private currentTimeMs_ = 0;

  /** Current simulated time in milliseconds. Advances only when popMin() returns an event. */
  get currentTime(): number {
    return this.currentTimeMs_;
  }

  /** Number of pending events. */
  get size(): number {
    return this.heap.size();
  }

  /**
   * Schedule an event for a future (or equal-to-current) simulated time.
   * Throws EventInPastError if `timeMs` is strictly less than currentTime.
   */
  schedule(timeMs: number, payload: P): void {
    if (timeMs < this.currentTimeMs_) {
      throw new EventInPastError(timeMs, this.currentTimeMs_);
    }
    this.heap.push({ timeMs, seq: this.nextSeq, payload });
    this.nextSeq += 1;
  }

  /**
   * Return the next event without removing it. Returns null if empty.
   * Does NOT advance time.
   */
  peek(): ScheduledEvent<P> | null {
    return this.heap.peek() ?? null;
  }

  /**
   * Remove and return the minimum-time event, advancing currentTime to its
   * timestamp. Throws SchedulerEmptyError if the scheduler is empty.
   */
  popMin(): ScheduledEvent<P> {
    const event = this.heap.pop();
    if (event === undefined) {
      throw new SchedulerEmptyError();
    }
    this.currentTimeMs_ = event.timeMs;
    return event;
  }

  /**
   * Drop all pending events and reset currentTime to 0. The sequence counter
   * also resets so a cleared scheduler behaves like a fresh one.
   */
  clear(): void {
    this.heap.clear();
    this.nextSeq = 0;
    this.currentTimeMs_ = 0;
  }
}
