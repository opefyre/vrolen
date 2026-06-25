# Vrolen

Browser-based discrete-event simulator for industrial production lines. Sketch your line as a graph, hit Run, and Vrolen surfaces the bottleneck, the binding constraint, and the single most impactful thing to change next. Everything runs in your browser — no install, no cloud account required.

> _Model your line. Press play. Watch the bottleneck. Apply the fix. See the lift._

## Who it's for

- Manufacturing and operations engineers comparing capacity changes before committing to them on the real line
- Continuous-improvement practitioners running Theory-of-Constraints / OEE-loss analyses
- Consultants who want a tool that explains its math instead of treating it as a black box
- Q-commerce / dark-store operators modeling fulfilment lines with shared resources, BOM-style picking, and SKU-aware routing

## What it does

### Discrete-event engine

- **Stations + buffers**: cycle-time distributions (constant, uniform, normal, triangular, exponential, lognormal, weibull, gamma, empirical), parallel capacity, defect roll, setup times, product-changeover matrices, rework targets with pass limits.
- **Reliability**: stochastic breakdowns (MTBF/MTTR), planned maintenance windows, cycle-count-driven PM, recurring CIP cleaning, random-event library.
- **Workers + materials**: per-shift workforce with skills, worker breaks, shift handovers; material recipes with replenishment + per-station overrides.
- **Multi-SKU**: per-product cycle distributions, changeover matrices, weighted production plans, per-batch tagging, quality grades, per-SKU routing overrides (route or skip).
- **Assembly**: BOM feeders — an assembly station pulls _qtyPerCycle_ from each feeder edge with atomic consume + reservation for the primary upstream.
- **Shared resources**: tool pools with capacity. Stations holding the same pool serialise; wait time accrues to perStationToolBlockedMs.
- **Temperature / spec**: parts carry a temperatureC field; stations apply per-step deltas; out-of-spec parts at downstream stations are scrapped and counted.
- **Sustainability**: per-cycle energy (J), water (L), CO₂e (g) on each station. Result panel surfaces line totals, per-station breakdown bars, per-tick sparklines, intensity figures (J/kg, L/dose…), action-card hotspot rule when one station dominates the line energy, A/B comparison rows, CSV export with cumulative time series, and run-history capture so environmental cost is visible across iterations.
- **Conveyors / residence-time edges**: stations of type Transport carry _lengthM_ + _speedMps_; the inter-station buffer becomes a delay-line that holds parts for `lengthM / speedMps` seconds before the downstream station can pull. Multiple parts ride simultaneously, capped by the buffer capacity. See the **Conveyor between stations** preset.
- **Batch-fire stations**: a station with _batchSize > 1_ waits for N parts in its upstream, runs one cycle, and emits N at completion. Models 3D-print build plates, autoclave loads, oven batches. Defects scrap the whole load. See the **3D-print batch** preset.
- **Unit of measure (display)**: each station carries an optional `unit` label ("kg", "doses", "L"…) plus a `unitsPerPart` ratio. The sink's pair drives the result-panel throughput display so a dairy line at 1000 parts/h with 0.5 kg/part reads as 500 kg/h. All four major result-panel cards (Hero, Sensitivity, Two-way, Goal mode) read in the declared unit. See the **Dairy line (kg)** preset.

### Insight surfaces

- **Action card**: every run ranks the single highest-leverage change — reliability work, speed-up, BOM imbalance, tool-pool contention, downstream blocking, batch-fire starvation, energy hotspot, dominant six-loss bucket, slim OEE factor. One-click Apply mutates the scenario and re-runs.
- **OEE narration**: plain-language summary above the per-station breakdown — "Performance is the slim factor at Filler (62 %). Filler is binding 91 % of the window."
- **Constraint history**: horizontal lane chart showing which station was the binding constraint over the run.
- **Goal mode**: enter a target throughput; binary-search returns the cheapest uniform cycle-scale that meets it.
- **Sensitivity tornado**: per-station cycle ±20 % + BOM qty + tool-pool capacity dimensions.
- **Replications + CIs**: line-level KPI 95 % CIs + per-station OEE half-widths when N > 1.
- **A/B compare**: two scenarios side-by-side with per-station Δ highlighted.
- **Run history**: last 10 runs persisted; click any cell to compare against the current canvas.
- **Drilldowns**: station-level Sheet with state mix, throughput, buffer pressure, constraint counters, recommendation.

### Canvas

- React-flow graph with custom edges for primary flow, BOM feeders (dashed amber), and per-SKU routing (dashed purple).
- Tool-pool dashboard overlay; corner badges on stations declaring requiredToolPool.
- Live playback with state-tinted nodes, edge fill width, and a **Binding** pulse badge that follows the empirical bottleneck moment-to-moment.

### Pedagogy

- **In-app glossary** with sourced definitions (Goldratt, ISA-95 / Nakajima, Little 1961, Welch 1983).
- **Wizard advisor** flags physics-implausible inputs without blocking the user.
- **Validation panel** groups BOM / tool-pool / per-SKU misconfig as their own Constraints section.
- **Onboarding tour** ends at the sustainability card.

## Stack

- **Frontend** — React 19 · Vite · TypeScript (strict) · Tailwind v4 · shadcn/ui · Zustand · Zod
- **Visualization** — PixiJS in a Web Worker (OffscreenCanvas) · Kenney.nl isometric sprites · react-flow (xyflow) for the editor
- **Engine** — TypeScript (Phases 0–3) → Rust→WASM (Phase 4+)
- **Backend** — Supabase (Auth · Postgres + RLS · Storage · Edge Functions)
- **Hosting** — Cloudflare Pages
- **AI** — Provider-agnostic with Gemini Flash default; BYO-key path supported (deferred)

## How it compares

| Capability            | Vrolen                                                       | AnyLogic PLE            | Simul8 / FlexSim |
| --------------------- | ------------------------------------------------------------ | ----------------------- | ---------------- |
| Install               | None (browser)                                               | Java client             | Windows client   |
| Cost (intro tier)     | Free                                                         | Free (limited)          | Paid licenses    |
| Determinism           | Seeded PRNG; identical seed → identical output               | Yes                     | Yes              |
| Replications + CIs    | Built-in (paired-t / Welch)                                  | Yes                     | Yes              |
| Theory of Constraints | First-class (binding score, subordination chip, action card) | Manual                  | Manual           |
| OEE narration         | Plain-language, derived                                      | —                       | —                |
| Goal seek             | Target throughput → cycle scale                              | Optimization experiment | OptQuest         |
| Shareable scenarios   | URL / JSON                                                   | `.alp` files            | `.sim` files     |
| Source viewable       | Yes (engine in TS / Rust)                                    | No                      | No               |

## Local development

```bash
pnpm install      # in vrolen/
pnpm dev          # vite dev server
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint --max-warnings 0
```

Engine + UI subset: 1065 tests covering distribution sampling, scheduler, state machine, cycle execution, bottleneck detection, OEE, Little's Law, multi-product changeover, materials, workers, maintenance, breakdowns, BOM atomic pull, tool-pool queueing, per-SKU dispatch, sampler counters, constraint-history derivation, conveyor / residence-time, batch-fire (single + multi-plate), UoM v2 ratios, sustainability totals + time series, and result-panel components.

## Working agreements

All work flows through Jira. See [`vrolen-rules`](../.claude/skills/vrolen-rules/SKILL.md) for the source-of-truth on sprint discipline, the locked stack, credentials, and skill delegation.

## License

TBD.
