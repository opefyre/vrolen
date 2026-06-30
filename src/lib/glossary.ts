/**
 * VROL-964 — engine concept dictionary. Single source of truth for the
 * hover-tooltip glossary surfaced from various UI surfaces (OEE
 * breakdown, action card, drilldown counters, CSV headers).
 *
 * Each entry includes a short body + an optional source citation. Keep
 * the body to ~2 sentences — long definitions belong in proper docs.
 */

export interface GlossaryEntry {
  readonly title: string;
  readonly body: string;
  readonly source?: string;
}

export const GLOSSARY: Readonly<Record<string, GlossaryEntry>> = {
  oee: {
    title: "Overall Equipment Effectiveness (OEE)",
    body: "Availability × Performance × Quality. Measures losses while a station is allowed to run — does NOT include starvation or blocking (those are surfaced by the Util percentage alongside).",
    source: "ISA-95 / Nakajima 1988",
  },
  teep: {
    title: "Total Effective Equipment Performance (TEEP)",
    body: "OEE × Loading. Includes planned downtime (Setup + Maintenance + CIP) in the denominator, so a line that's only run 16h/24h with 95% OEE reads ~63% TEEP. The honest 'how much of calendar time produced parts' number for capacity planning.",
    source: "Vorne / Productivity Press",
  },
  availability: {
    title: "Availability",
    body: "Fraction of operating time the station was not Down due to unplanned breakdowns. Per SEMI E10 / Nakajima, planned downtime (Setup + Maintenance + CIP) is excluded from the Availability denominator — those losses surface elsewhere (Setup ↘ Performance, Maintenance ↘ TEEP). A station with frequent CIP can still read 100 % Availability; check Util or TEEP for an inclusive view.",
    source: "SEMI E10 / Nakajima 1988",
  },
  performance: {
    title: "Performance",
    body: "Actual run rate ÷ design rate while running. Sub-1 indicates micro-stops, slow cycles, or a station throttled below its OEM-rated nominal max.",
  },
  quality: {
    title: "Quality",
    body: "Good parts ÷ total parts produced. Defect roll + rework + scrap all reduce this factor.",
  },
  bottleneck: {
    title: "Bottleneck",
    body: "The station that caps how much the whole line can produce. Improving any non-bottleneck station does NOT lift line throughput until the bottleneck moves.",
    source: "Goldratt — Theory of Constraints",
  },
  binding: {
    title: "Binding constraint",
    body: "A station whose current performance directly limits line throughput. Empirically the station running the largest share of the window, weighted by its OEM-nominal-speed ratio.",
    source: "Goldratt — Theory of Constraints",
  },
  subordination: {
    title: "Subordination",
    body: "Deliberately running a non-bottleneck station BELOW its rated speed to match the bottleneck's pace — avoids piling WIP in front of the constraint. A nominalSpeedRatio < 1.0 on a non-bottleneck station is the engine's tell.",
    source: "Goldratt — Theory of Constraints (Step 3)",
  },
  wip: {
    title: "Work in Process (WIP)",
    body: "Parts currently in any buffer or in-progress at any station. Little's Law relates WIP (L), throughput (λ), and time-in-system (W): L = λ · W.",
    source: "Little 1961",
  },
  throughput: {
    title: "Throughput (λ)",
    body: "Parts completed per unit time, measured at the sink. Cap is set by the bottleneck's effective cycle (mean cycle ÷ capacity ÷ availability).",
  },
  warmup: {
    title: "Warmup period",
    body: "Initial transient where buffers fill from empty and KPIs haven't stabilised. The engine reports KPIs only over the post-warmup window so reported throughput reflects steady-state behaviour.",
    source: "Welch 1983 — Initial transient detection",
  },
  starved: {
    title: "Starved",
    body: "Station is ready to work but its upstream buffer (or BOM feeder, or tool pool) has no parts available. Reducing upstream variability or growing the upstream buffer fixes it.",
  },
  blocked: {
    title: "Blocked",
    body: "Station finished a cycle but downstream can't accept the part (next buffer is full). The downstream station's cycle time or the buffer between is the lever.",
  },
  "binding-score": {
    title: "Binding score",
    body: "runningPct × nominalSpeedRatio. Higher score = station whose work is most directly limiting line throughput. Used to rank empirical bottlenecks across the run.",
  },
  "bom-feeders": {
    title: "BOM feeders",
    body: "Per-cycle quantity of side-input parts an assembly station needs from each feeder. If any feeder is short, the cycle starves with reason 'starved-bom'.",
  },
  "tool-pool": {
    title: "Shared tool pool",
    body: "Limited resource shared across stations (e.g. a single autoclave shared by mix + cap). Stations holding the same pool serialise through its capacity; wait time accrues to perStationToolBlockedMs.",
  },
  "per-sku-routing": {
    title: "Per-SKU routing",
    body: "Override the downstream destination on a per-product basis. 'skip' routes the part to the sink; otherwise the named station receives the part directly.",
  },
  // VROL-1008 — entries for Sprints 112-118 features.
  conveyor: {
    title: "Conveyor (Transport station)",
    body: "A station-shaped edge segment with physical length and travel speed. Parts entering take residenceTimeMs = lengthM / speedMps × 1000 before becoming available downstream. Multiple parts can be in transit at once, capped by the inter-station buffer capacity.",
  },
  "residence-time": {
    title: "Residence time",
    body: "How long a part takes to traverse a conveyor or hold tank, measured from entry to availability at the downstream station. Adds latency to time-in-system but does not reduce steady-state throughput (bandwidth is set by the slowest cycle, not the conveyor).",
  },
  "unit-of-measure": {
    title: "Unit of measure (UoM)",
    body: "Two per-station fields drive the throughput display. unit is the label (parts, kg, L, doses…). unitsPerPart is the ratio — how many of the declared unit does one part represent. The sink's values multiply throughput so a dairy line at 1000 parts/h × 0.5 kg/part reads as 500 kg/h. Engine still counts integer parts; v1+v2 are both display-only.",
  },
  stability: {
    title: "Stability (replication CV)",
    body: "Coefficient of variation = stddev / mean of throughput across replications. CV < 5 % is Stable (the model is decisive). 5–10 % is some variance (more reps would tighten the answer). ≥ 10 % means a single run could mislead — run more replications.",
  },
  "sustainability-intensity": {
    title: "Sustainability intensity (per-unit)",
    body: "Total resource consumed (energy / water / CO₂e) divided by total units produced. The honest 'how efficient is this line' number — a line might consume more total energy AND have lower J/kg than a smaller one. Falls back to per-part when the scenario hasn't declared a unit.",
  },
  "batch-fire": {
    title: "Batch-fire station",
    body: "Station waits for batchSize parts in its upstream before starting a cycle; consumes all N at start; emits all N at completion. Models 3D-print build plates, autoclave loads, oven batches, kilns. Pair with capacity > 1 for multi-plate scheduling (e.g. capacity=3 + batchSize=10 = 3 printers each running 10-part plates in parallel). A defective or down-during-cycle batch scraps the whole load.",
  },
  // VROL-1024 — terms surfaced by the new action-card rules (S121,
  // S130, S137).
  "energy-hotspot": {
    title: "Energy hotspot",
    body: "One station that dominates the line's energy budget (> 60 % of total). The action card surfaces it because it's the cheapest sustainability lever — drop energyPerCycleJ on that station (more efficient equipment, lower set-point) or cut its cycle count (less rework / scrap upstream so it fires less). Improving any other station's energy footprint won't move the line total much.",
  },
  "partial-batch": {
    title: "Partial-batch starvation",
    body: "A batch-fire station can't start its cycle until batchSize parts arrive — so it sits idle when upstream is slow. The action card fires this rule when the bottleneck has batchSize > 1 AND spent > 30 % of horizon Starved. Two levers: feed it faster (upstream cycle / parallelism), or shrink batchSize so it can fire sooner with smaller loads (at the cost of more cycles per output).",
  },
  "multi-plate": {
    title: "Multi-plate batch (capacity × batchSize)",
    body: "A batch-fire station with capacity > 1 runs N batches in parallel — e.g. capacity=3 + batchSize=10 = three 10-part plates printing concurrently. Throughput scales linearly with capacity until the upstream feed catches up to N × batchSize parts/cycle. Used to model parallel 3D-printer arrays, multi-cavity autoclave racks, or two-deck ovens.",
  },
  // VROL-1046 — TOC vocabulary surfaced by the capacity arc + Pareto
  // optimization (Sprints 153-161).
  "station-capacity": {
    title: "Station capacity (parallel servers)",
    body: "Number of parts a station can process simultaneously. Capacity 1 = a single server (a part in cycle blocks the next from starting); capacity 2 = two parallel servers (two parts in cycle at once). When a station is the bottleneck AND saturated at capacity 1, doubling capacity roughly doubles its throughput — the canonical TOC 'add a second server' move. Engine accepts integers 1-10; the sensitivity tornado shows the swing of ±1 capacity for every station that declared one.",
  },
  "pareto-frontier": {
    title: "Pareto frontier (multi-objective optimization)",
    body: "When optimizing two objectives at once (e.g. throughput vs energy/part), the Pareto frontier is the set of candidates where you can't improve one objective without making the other worse. Dominated candidates are strictly beaten by some frontier point on both axes. Vrolen's optimization scatter highlights frontier points in the primary colour; dominated cells are muted — pick the frontier candidate whose tradeoff matches your priority.",
  },
  // VROL-1087 → VROL-1093 — Sprint 183 statistical / DES vocabulary.
  // The CI arc (S176-S179) introduced terms the UI tooltips +
  // result-panel copy now use without definition.
  replication: {
    title: "Replication",
    body: "One re-run of the same scenario with a different RNG seed. Each replication produces one realisation of the stochastic system; averaging across replications gives a mean + 95 % confidence interval that the single-run output can't show. Vrolen runs N reps when settings.replications > 1.",
    source: "Law & Kelton — Simulation Modeling and Analysis",
  },
  "confidence-interval": {
    title: "95 % confidence interval",
    body: "The range that contains the true mean with 95 % probability under repeated sampling. Reported as mean ± half-width or [low, high]. Vrolen surfaces 95 % CIs on optimization candidates (S176) and sensitivity swings (S179); a wide CI means the figure is noisy and another rep would change it materially.",
  },
  "half-width": {
    title: "Half-width (95 % CI)",
    body: "The ± part of a confidence interval. mean ± halfWidth gives [low, high]. Vrolen computes halfWidth = 1.96 × σ/√n (normal-approximation Z), where σ is the Bessel-corrected sample standard deviation across replications. Shrinks with 1/√n — to halve the half-width, run 4× the replications.",
  },
  crn: {
    title: "Common random numbers (CRN)",
    body: "Variance-reduction trick: paired scenarios share the same RNG seed so the sampling noise cancels in the difference between them. Vrolen uses CRN in the sensitivity sweep (low + high cycle perturbations of the same station are paired on the seed) and in the optimization replications. The signal — the parameter change — survives; the noise mostly cancels.",
    source: "Law & Kelton — Simulation Modeling and Analysis",
  },
  "bessel-correction": {
    title: "Bessel-corrected sample stddev",
    body: "Divide the squared-deviations sum by (n − 1) instead of n when computing variance from a SAMPLE rather than a full population. Corrects the small-sample bias that would systematically under-estimate the true variance. Vrolen's computeStats() helper applies Bessel for every objective's CI math.",
  },
  "sensitivity-sweep": {
    title: "Sensitivity sweep (tornado)",
    body: "Per-input throughput swing when that input is perturbed ±X % while everything else stays fixed. Sorted descending by swing magnitude so the widest bar is the highest-leverage lever. Vrolen sweeps four dimensions: per-station cycle ±20 %, BOM qty ±50 %, tool-pool capacity ±50 %, station parallel-capacity ±1.",
  },
  "robust-pick": {
    title: "Robust pick / CI-aware tiebreak",
    body: "When two optimization candidates' 95 % CIs overlap on the active objective, picking by mean alone is a statistical coin flip. Vrolen's picker prefers the candidate whose CI gives the STRONGER guarantee in the objective's direction — higher LOWER bound for max-direction, lower UPPER bound for min-direction. Falls back to mean ordering only when the CIs are statistically clear of each other.",
  },
};

export function lookupGlossary(key: string): GlossaryEntry | undefined {
  return GLOSSARY[key];
}
