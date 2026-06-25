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
    body: "Per-station label that describes what 'one part' counts as in this line (parts, kg, L, doses…). The sink's unit drives the throughput display so a dairy line reads in kg / hour, a pharmaceutical line in doses / hour. v1 is display-only; the engine still counts integer parts.",
  },
  stability: {
    title: "Stability (replication CV)",
    body: "Coefficient of variation = stddev / mean of throughput across replications. CV < 5 % is Stable (the model is decisive). 5–10 % is some variance (more reps would tighten the answer). ≥ 10 % means a single run could mislead — run more replications.",
  },
};

export function lookupGlossary(key: string): GlossaryEntry | undefined {
  return GLOSSARY[key];
}
