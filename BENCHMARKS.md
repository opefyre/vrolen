# Vrolen Benchmarks

Performance numbers recorded as the engine grows. Each entry includes
hardware so future-you can interpret. Re-run with `pnpm bench:<name>`.

---

## `Scheduler` — DES event scheduler (VROL-94)

**Workload:** 1,000,000 events with pseudo-random times across a 30-day
simulated horizon, inserted in a tight loop, then drained in min-time
order until empty. Insert and drain phases timed separately. Best of
5 runs reported to discount JIT warm-up and GC noise.

| Phase              |  Best time |       Throughput |
| ------------------ | ---------: | ---------------: |
| Insert (1M events) |      44 ms |    22.7M ops/sec |
| Drain (1M events)  |     470 ms |     2.1M ops/sec |
| **End-to-end**     | **514 ms** | **3.9M ops/sec** |

**Hardware:** macOS, Apple Silicon, Node.js v25.9.0, single-threaded.
Other observed runs in the same session: 633 / 730 / 515 / 548 / 514 ms total (GC-driven variance).

**Implication:** A 30-day single-line sim emitting ~10k events/sim-second
is well under 1 second of wall-clock for the scheduler alone. Headroom
for the upcoming state machine, distributions, KPI accumulation, and
rendering before we worry about engine performance.

**How to reproduce:**

```bash
pnpm bench:scheduler
```

Source: [`scripts/bench-scheduler.ts`](./scripts/bench-scheduler.ts).
