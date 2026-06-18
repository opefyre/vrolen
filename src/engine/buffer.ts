/**
 * Bounded FIFO buffer used between stations.
 *
 * Minimal implementation — time-weighted WIP tracking and richer
 * observability arrive in VROL-116. This version is just enough to wire
 * cycle execution against (VROL-110).
 *
 * Semantics:
 *   - push() returns true if there was space, false if the buffer was full.
 *     The cycle executor uses the boolean to transition the station to
 *     BlockedOut on a failed push.
 *   - pull() returns the front item or undefined if empty.
 *
 * Generic over part type so test harnesses can use simple primitives and
 * the real engine can use richer Part objects later.
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
