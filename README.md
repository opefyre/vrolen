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

- **Stations + buffers**: cycle-time distributions (constant, uniform, normal, triangular, exponential, lognormal, weibull, gamma, empirical), parallel capacity, defect roll, setup times, product-changeover matrices, rework targets with pass limits. Per-edge `bufferCapacity` overrides the global default so asymmetric queue space ("this stage holds 50, that one only 3") is first-class — tank capacity, kanban cap, and per-edge override compose in a documented precedence.
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

- **Coach**: 18 contextual tips covering empty-canvas, no-edges, no-run, bottleneck-tuning, BOM-imbalance, tool-pool-contention, per-SKU-routed-info, capacity-high-leverage, save-as-scenario, budget-infeasible, high-WIP, low-line-OEE, high-scrap, warmup-too-short, stochastic-needs-replications, per-edge-buffer-saturated, idle-source. Each tip is a pure predicate over a small editor-state snapshot so adding one is data, not glue. Coach tips dedupe against the action card — if the action card already speaks for a root signal (WIP / OEE / scrap / upstream-limited / buffer / bottleneck), the matching coach tip suppresses itself.
- **Action card**: every run ranks the single highest-leverage change across 18 rules — sampling bias, reliability work, partial-batch starvation, capacity bump for saturated single-server bottlenecks, subordination / speed-up, BOM imbalance, tool-pool contention, downstream blocking, buffer pressure, energy hotspot, dominant six-loss bucket, slim OEE factor. Each rule emits an Apply payload (cycle:halve, capacity:set, buffer:grow, tool-pool:grow, energy:scale, etc.) so one click mutates the scenario and re-runs.
- **OEE narration**: plain-language summary above the per-station breakdown — "Performance is the slim factor at Filler (62 %). Filler is binding 91 % of the window."
- **Constraint history**: horizontal lane chart showing which station was the binding constraint over the run.
- **Goal mode**: enter a target throughput; binary-search returns the cheapest uniform cycle-scale that meets it. Multi-lever variant searches over (cycle × buffer × tool-pool × capacity delta) for the cheapest combo and accepts an optional energy-per-part budget so the picker honours a sustainability ceiling.
- **Optimization search**: 3D grid sweeps buffer × cycle-multiplier × tool-pool delta; ranks candidates by 6 objectives (throughput, time-in-system, OEE, good-parts/h, WIP, energy / part) with a heatmap + Pareto-frontier scatter that swaps its X axis to match the active objective. Three feasibility constraints — max time-in-system, max average WIP, max energy / part — strike through cells that violate them and exclude infeasible candidates from the winner pick. Each candidate carries a 95 % CI on every objective (throughput, TIS, OEE, good-parts/h, WIP, energy/part — Bessel-corrected sample stddev × z=1.96 / √n). The picker is CI-aware in both directions: for max-direction objectives it prefers the higher LOWER bound on overlap (robust floor); for min-direction it prefers the lower UPPER bound (robust ceiling). The cell tooltip + best-summary surface the active objective's CI so you see how wide the answer is, not just the mean.
- **Sensitivity tornado**: 4 dimensions — per-station cycle ±20 %, BOM qty ±50 %, tool-pool capacity ±50 %, and station parallel-capacity ±1. Optional K replications per swing produce a 95 % CI on each swing magnitude; rows whose CI crosses zero are flagged as noise rather than ranked alongside real findings.
- **Replications + CIs**: line-level KPI 95 % CIs + per-station OEE half-widths when N > 1.
- **A/B compare**: two scenarios side-by-side with per-station Δ highlighted plus output-side KPI deltas (throughput, OEE, scrap, TIS, WIP, energy/part) and a one-sentence summary of the biggest mover (VROL-369).
- **Scenario ops**: name validation + `duplicateScenario(source, newName)` (VROL-355); duplicates carry notes forward.
- **Run-history helpers**: `filterRunHistory(entries, query, order)` for search + sort (recent / throughput-desc / oee-desc), `consecutiveRunDeltas(entries)` for adjacent-pair comparison chips (VROL-366).
- **Run history**: last 10 runs persisted; click any cell to compare against the current canvas.
- **Drilldowns**: station-level Sheet with state mix, throughput, buffer pressure, constraint counters, recommendation.

### Canvas

- React-flow graph with custom edges for primary flow, BOM feeders (dashed amber), and per-SKU routing (dashed purple).
- Tool-pool dashboard overlay; corner badges on stations declaring requiredToolPool.
- Live playback with state-tinted nodes, edge fill width, and a **Binding** pulse badge that follows the empirical bottleneck moment-to-moment.

### Pedagogy

- **In-app glossary** with sourced definitions (Goldratt, ISA-95 / Nakajima, Little 1961, Welch 1983, Law & Kelton). 35 entries covering TOC vocabulary, OEE/TEEP, DES primitives, sustainability, and the statistical / replication terms surfaced by the CI arc (replication, 95 % confidence interval, half-width, common random numbers, Bessel correction, sensitivity sweep, robust pick).
- **Wizard advisor** flags physics-implausible + structurally-odd inputs without blocking the user. 15 non-blocking pre-flight checks: cycle-too-fast, cycle-too-slow, defect-too-high, capacity-suspect, MTTR>MTBF, MTBF<1min, warmup-too-large, horizon-too-short, buffer-cap-extreme, setup-dominates-cycle, replications-very-high, reps-one-with-stochastic, defect-no-rework, single-station-line, product-zero-weight.
- **Validation panel** groups BOM / tool-pool / per-SKU misconfig as their own Constraints section.
- **Onboarding tour** ends at the sustainability card. Steps that point at post-run anchors (bottleneck tile / action card / sustainability) are gated on a run completing so the tour never lands on a missing anchor; on an empty canvas the tour optionally auto-loads the bottling-line preset and runs it so the post-run steps materialize before the user reaches them.
- **Sensitivity tornado** rows ship a colour-independent direction glyph (↑/↓/•) alongside the divergent bar so colour-blind readers get the same verdict, with an `aria-label` for screen readers.

## Stack

- **Frontend** — React 19 · Vite · TypeScript (strict) · Tailwind v4 · shadcn/ui · Zustand · Zod
- **Visualization** — PixiJS in a Web Worker (OffscreenCanvas) · Kenney.nl isometric sprites · react-flow (xyflow) for the editor
- **Engine** — TypeScript (Phases 0–3) → Rust→WASM (Phase 4+)
- **Backend** — Supabase (Auth · Postgres + RLS · Storage · Edge Functions)
- **Hosting** — Cloudflare Pages
- **AI** — Provider-agnostic abstraction (VROL-379) at `src/ai/`. `ChatAdapter` interface, `MockChatAdapter` for tests, `openAiChatRequestBody()` + `parseOpenAiChatResponse()` shape helpers ready to plug into VROL-386. `generateScenarioFromNl()` (VROL-397) returns a Zod-validated scenario via a tool-call retry loop. `narrateRun()` (VROL-410) returns a 2-3 sentence plain-English summary of a sim run with a deterministic-template fallback. `withUsageTracking()` (VROL-414) wraps any adapter to record per-call token estimates into an in-memory or localStorage-backed `UsageStore`, with `summarizeByDay/Provider` + `formatCostEstimate` helpers for the dashboard. `queryRunResult()` (VROL-405) implements network-free RAG over a single run — extracts a keyword-indexed fact set, retrieves by TF-style scoring, prompts the LLM with a "use only these facts" contract, falls back to "I don't have that" when the LLM is unavailable. `createLocalStorageProviderKeyStore()` (VROL-389) persists BYO API keys with the 5-provider `PROVIDER_CATALOGUE` (OpenAI / Anthropic / OpenRouter / Gemini / Cloudflare Workers AI). Live adapters for all five providers ship (VROL-382/386): `createOpenAiAdapter`, `createAnthropicAdapter`, `createGeminiAdapter`, plus `createAdapterForProvider(key)` factory that dispatches by providerId. All adapters take an injectable `fetch` so tests run against mocks; activation needs only the API key.

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

Engine + UI subset: 1200+ tests covering distribution sampling, scheduler, state machine, cycle execution, bottleneck detection, OEE, Little's Law, multi-product changeover, materials, workers, maintenance, breakdowns, BOM atomic pull, tool-pool queueing, per-SKU dispatch, sampler counters, constraint-history derivation, conveyor / residence-time, batch-fire (single + multi-plate), UoM v2 ratios, sustainability totals + time series, sensitivity sweep with capacity dim + per-row CIs, optimization search with per-objective CIs, per-edge buffer overrides, and result-panel components. 27 scenario presets (20 base + 7 diagnostic/feature demos) cover starter lines, multi-product, reliability, parallel, branching, sustainability, conveyor, batch, per-edge buffer, WIP pile-up, upstream-limited, stochastic, changeover-heavy, and conveyor-TIS-dominated topologies.

## Working agreements

All work flows through Jira. See [`vrolen-rules`](../.claude/skills/vrolen-rules/SKILL.md) for the source-of-truth on sprint discipline, the locked stack, credentials, and skill delegation.

## License

TBD.
