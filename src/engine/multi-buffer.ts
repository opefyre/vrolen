/**
 * Aggregating buffer wrappers for DAG-shaped chains.
 *
 * A linear chain (the original chain-harness target) had one upstream and one
 * downstream per CycleExecutor. Branching graphs (VROL-582) need a station to
 * "see" multiple upstream / downstream edges. Rather than refactor the
 * executor to accept arrays, we wrap N real buffers in a Buffer<T>-shaped
 * facade that the executor consumes unchanged.
 *
 *   MultiInputBuffer  — pulls from the first non-empty source (deterministic
 *                       priority = source order). isEmpty when ALL sources
 *                       are empty. push() throws.
 *   MultiOutputBuffer — pushes to the first non-full destination
 *                       (deterministic priority = destination order). isFull
 *                       when ALL destinations are full. pull() throws.
 *
 * Both expose `size` as the SUM across underlying buffers — used for L
 * accounting where it matters; cycle execution only cares about emptiness /
 * fullness flags, not size.
 */

import { Buffer } from "./buffer";

export class MultiInputBuffer<T> extends Buffer<T> {
  constructor(private readonly sources: readonly Buffer<T>[]) {
    // Capacity is effectively unbounded from the consumer's perspective — the
    // executor only ever pulls. Pass through the underlying sources' total
    // capacity for size sanity.
    super(sources.reduce((s, b) => s + b.capacity, 0));
  }

  override get size(): number {
    return this.sources.reduce((s, b) => s + b.size, 0);
  }

  override get isEmpty(): boolean {
    return this.sources.every((b) => b.isEmpty);
  }

  override get isFull(): boolean {
    // Inputs are never "full" from the consumer's perspective.
    return false;
  }

  override push(_item: T): boolean {
    void _item;
    throw new Error("MultiInputBuffer.push is not supported — push to a source buffer instead");
  }

  override pull(): T | undefined {
    for (const b of this.sources) {
      if (!b.isEmpty) return b.pull();
    }
    return undefined;
  }

  override peek(): T | undefined {
    for (const b of this.sources) {
      const p = b.peek();
      if (p !== undefined) return p;
    }
    return undefined;
  }

  override clear(): void {
    for (const b of this.sources) b.clear();
  }
}

export class MultiOutputBuffer<T> extends Buffer<T> {
  constructor(private readonly destinations: readonly Buffer<T>[]) {
    super(destinations.reduce((s, b) => s + b.capacity, 0));
  }

  override get size(): number {
    return this.destinations.reduce((s, b) => s + b.size, 0);
  }

  override get isEmpty(): boolean {
    // Outputs are never "empty" from the producer's perspective.
    return true;
  }

  override get isFull(): boolean {
    return this.destinations.every((b) => b.isFull);
  }

  override push(item: T): boolean {
    for (const b of this.destinations) {
      if (!b.isFull) return b.push(item);
    }
    return false;
  }

  override pull(): T | undefined {
    throw new Error("MultiOutputBuffer.pull is not supported — pull from a destination instead");
  }

  override peek(): T | undefined {
    return undefined;
  }

  override clear(): void {
    for (const b of this.destinations) b.clear();
  }
}
