/**
 * VROL-86 — scenario validation pipeline.
 *
 * Six categories of checks run before a scenario is saved or run. Errors
 * block the action (and surface in the editor); warnings are advisory and
 * don't block. Many of these checks are also enforced at runtime by
 * graph-to-chain + the engine's init validation — this layer hoists them
 * forward in time so the user gets feedback before clicking Run.
 *
 * Returns a flat ValidationResult; UI consumers group + sort by category.
 */

import type { Edge, Node } from "@xyflow/react";

import type { RunSettings } from "@/routes/editor-run-settings";

export type ValidationSeverity = "error" | "warning";
export type ValidationCategory =
  | "schema"
  | "reference"
  | "topology"
  | "resource"
  | "schedule"
  | "recipe";

/**
 * VROL-658 — discriminated union for one-click fix actions. When a
 * ValidationIssue carries a fixAction, ValidationPanel renders a "Fix it"
 * button that dispatches into EditorPage's onFixAction handler.
 */
export type FixAction =
  | { readonly kind: "delete-node"; readonly nodeId: string }
  | { readonly kind: "delete-edge"; readonly edgeId: string }
  | { readonly kind: "clear-rework-target"; readonly nodeId: string };

export interface ValidationIssue {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly category: ValidationCategory;
  readonly message: string;
  /** Pointer into the scenario (e.g., "nodes[3]", "edges[1].source"). */
  readonly path?: string;
  /** Human-readable suggested fix. */
  readonly fix?: string;
  /**
   * VROL-304 — when set, the issue is associated with a specific canvas
   * node so the validation panel can click-to-focus the camera + the node
   * renderer can paint a red/yellow indicator on it.
   */
  readonly nodeId?: string;
  /** VROL-658 — programmatic fix; the UI surfaces a "Fix it" button. */
  readonly fixAction?: FixAction;
}

export interface ValidationResult {
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

/**
 * VROL-660 — find all issues bound to a specific node + field. Used by the
 * Inspector to paint a per-field red/yellow indicator next to controls
 * with active validation issues. Matches via:
 *   - issue.nodeId === nodeId
 *   - issue.path ends with `.${fieldKey}` (so `nodes[3].data.skills`
 *     matches fieldKey="skills")
 */
export function findIssuesForField(
  issues: readonly ValidationIssue[],
  nodeId: string,
  fieldKey: string,
): readonly ValidationIssue[] {
  const suffix = `.${fieldKey}`;
  return issues.filter(
    (i) => i.nodeId === nodeId && typeof i.path === "string" && i.path.endsWith(suffix),
  );
}

export function validateScenario(
  nodes: readonly Node[],
  edges: readonly Edge[],
  settings: RunSettings,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  checkSchema(nodes, edges, issues);
  checkReferenceIntegrity(nodes, edges, issues);
  checkTopology(nodes, edges, issues);
  checkResourceFeasibility(nodes, settings, issues);
  checkScheduleSanity(settings, issues);
  checkRecipeCoverage(settings, issues);
  checkConstraintsSanity(nodes, settings, issues);
  checkUomConsistency(nodes, edges, issues);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { errors, warnings };
}

// ─── 1. Schema (lightweight runtime guards) ─────────────────────────────────
function checkSchema(nodes: readonly Node[], edges: readonly Edge[], out: ValidationIssue[]): void {
  nodes.forEach((n, i) => {
    if (typeof n.id !== "string" || n.id.length === 0) {
      out.push({
        code: "SCHEMA_NODE_ID_MISSING",
        severity: "error",
        category: "schema",
        message: `Node at index ${String(i)} has no id`,
        path: `nodes[${String(i)}].id`,
      });
    }
    if (!n.data || typeof n.data !== "object") {
      out.push({
        code: "SCHEMA_NODE_DATA_MISSING",
        severity: "error",
        category: "schema",
        message: `Node "${String(n.id)}" has no data object`,
        path: `nodes[${String(i)}].data`,
      });
    }
  });
  edges.forEach((e, i) => {
    if (typeof e.source !== "string" || typeof e.target !== "string") {
      out.push({
        code: "SCHEMA_EDGE_ENDPOINTS_INVALID",
        severity: "error",
        category: "schema",
        message: `Edge at index ${String(i)} has non-string source/target`,
        path: `edges[${String(i)}]`,
      });
    }
  });
}

// ─── 2. Reference integrity ─────────────────────────────────────────────────
function checkReferenceIntegrity(
  nodes: readonly Node[],
  edges: readonly Edge[],
  out: ValidationIssue[],
): void {
  const ids = new Set(nodes.map((n) => n.id));
  edges.forEach((e, i) => {
    if (!ids.has(e.source)) {
      out.push({
        code: "REF_EDGE_SOURCE_UNKNOWN",
        severity: "error",
        category: "reference",
        message: `Edge ${String(e.id ?? i)} sources from unknown node "${e.source}"`,
        path: `edges[${String(i)}].source`,
        fix: `Delete this edge or add a node with id "${e.source}"`,
        // No nodeId — the offending node doesn't exist; the issue is on the edge.
        ...(typeof e.id === "string"
          ? { fixAction: { kind: "delete-edge", edgeId: e.id } as FixAction }
          : {}),
      });
    }
    if (!ids.has(e.target)) {
      out.push({
        code: "REF_EDGE_TARGET_UNKNOWN",
        severity: "error",
        category: "reference",
        message: `Edge ${String(e.id ?? i)} targets unknown node "${e.target}"`,
        path: `edges[${String(i)}].target`,
        fix: `Delete this edge or add a node with id "${e.target}"`,
        ...(typeof e.id === "string"
          ? { fixAction: { kind: "delete-edge", edgeId: e.id } as FixAction }
          : {}),
      });
    }
  });
  // VROL-AUDIT — pre-compute the set of nodes that belong to the "active
  // chain" that graph-to-chain will keep. We mirror graph-to-chain's logic:
  //   - exclude decorative sticky / frame nodes
  //   - find the in-degree-0 source(s); if exactly one, the chain is the set
  //     of nodes reachable from it. Otherwise, the chain is the union of the
  //     single longest path from each source (matches the linear fallback).
  // A rework target outside this set is silently dropped → warn the user.
  const stationNodes = nodes.filter((n) => n.type !== "sticky" && n.type !== "frame");
  const outgoingForRework = new Map<string, string[]>();
  const incomingForRework = new Map<string, string[]>();
  for (const n of stationNodes) {
    outgoingForRework.set(n.id, []);
    incomingForRework.set(n.id, []);
  }
  for (const e of edges) {
    if (!outgoingForRework.has(e.source) || !outgoingForRework.has(e.target)) continue;
    outgoingForRework.get(e.source)!.push(e.target);
    incomingForRework.get(e.target)!.push(e.source);
  }
  const sourceNodes = stationNodes.filter((n) => (incomingForRework.get(n.id) ?? []).length === 0);
  const sinkNodes = stationNodes.filter((n) => (outgoingForRework.get(n.id) ?? []).length === 0);
  // Single-source/single-sink: DAG branch — the chain is everything reachable
  // from the source (matching graph-to-chain's topoSet).
  // Otherwise: linear-fallback — chain is the longest linear sub-path from
  // the picked source (matches the bestChain compute in graph-to-chain).
  const activeChainSet = new Set<string>();
  if (sourceNodes.length === 1 && sinkNodes.length === 1) {
    const src = sourceNodes[0]!;
    const stack = [src.id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (activeChainSet.has(cur)) continue;
      activeChainSet.add(cur);
      for (const next of outgoingForRework.get(cur) ?? []) {
        if (!activeChainSet.has(next)) stack.push(next);
      }
    }
  } else {
    // Mirror graph-to-chain's bestChain: longest single-successor linear walk.
    let bestChain: string[] = [];
    for (const src of sourceNodes) {
      const chain: string[] = [src.id];
      let cur = src.id;
      while (true) {
        const outs = outgoingForRework.get(cur) ?? [];
        if (outs.length !== 1) break;
        const next = outs[0]!;
        if (chain.includes(next)) break;
        chain.push(next);
        cur = next;
      }
      if (chain.length > bestChain.length) bestChain = chain;
    }
    for (const id of bestChain) activeChainSet.add(id);
  }
  // Rework target references — node.data.reworkTargetNodeId must point at an existing node.
  nodes.forEach((n, i) => {
    const raw = (n.data as { reworkTargetNodeId?: unknown } | undefined)?.reworkTargetNodeId;
    if (typeof raw !== "string" || raw.length === 0) return;
    if (!ids.has(raw)) {
      out.push({
        code: "REF_REWORK_TARGET_UNKNOWN",
        severity: "error",
        category: "reference",
        message: `Station "${n.id}" reworks to unknown node "${raw}"`,
        path: `nodes[${String(i)}].data.reworkTargetNodeId`,
        fix: `Pick a different rework target or remove the setting`,
        nodeId: n.id,
        fixAction: { kind: "clear-rework-target", nodeId: n.id },
      });
      return;
    }
    // VROL-AUDIT — target exists but isn't on the active chain. graph-to-chain
    // silently drops it (line 307 of graph-to-chain.ts), so defects will be
    // scrapped instead of rerouted. Warn (not error) so the user keeps running.
    if (!activeChainSet.has(raw)) {
      out.push({
        code: "REF_REWORK_TARGET_OFFCHAIN",
        severity: "warning",
        category: "reference",
        message: `Station "${n.id}"'s rework target "${raw}" isn't on the active chain — defects will be scrapped instead of rerouted`,
        path: `nodes[${String(i)}].data.reworkTargetNodeId`,
        fix: `Connect "${raw}" to the chain or clear the rework target`,
        nodeId: n.id,
        fixAction: { kind: "clear-rework-target", nodeId: n.id },
      });
    }
  });
}

// ─── 3. Topology ────────────────────────────────────────────────────────────
function checkTopology(
  nodes: readonly Node[],
  edges: readonly Edge[],
  out: ValidationIssue[],
): void {
  // Sticky notes and section frames are visual-only — they don't
  // participate in the simulation graph. Topology checks must ignore them
  // or the user gets "orphan / multiple-source / multiple-sink" warnings
  // for every annotation they drop on the canvas.
  const stationNodes = nodes.filter((n) => n.type !== "sticky" && n.type !== "frame");
  if (stationNodes.length === 0) {
    out.push({
      code: "TOPO_EMPTY",
      severity: "error",
      category: "topology",
      message: "Scenario has no stations",
      fix: "Drop a station from the palette onto the canvas",
    });
    return;
  }
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of stationNodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!incoming.has(e.target) || !outgoing.has(e.source)) continue;
    incoming.get(e.target)!.push(e.source);
    outgoing.get(e.source)!.push(e.target);
  }
  // Orphan stations: no inputs AND no outputs (and not the lone station).
  if (stationNodes.length > 1) {
    stationNodes.forEach((n, i) => {
      const ins = incoming.get(n.id) ?? [];
      const outs = outgoing.get(n.id) ?? [];
      if (ins.length === 0 && outs.length === 0) {
        const labelData = (n.data ?? {}) as { label?: string };
        const label = typeof labelData.label === "string" ? labelData.label : n.id;
        out.push({
          code: "TOPO_ORPHAN_NODE",
          severity: "warning",
          category: "topology",
          message: `Station "${label}" has no connections — it won't run`,
          path: `nodes[${String(i)}]`,
          fix: `Connect it to the chain or delete it`,
          nodeId: n.id,
          fixAction: { kind: "delete-node", nodeId: n.id },
        });
      }
    });
  }
  // Cycle detection (Tarjan-lite via DFS). A cycle with no exit is a
  // deadlock; with an exit it's a rework loop (acceptable but flagged).
  const visited = new Set<string>();
  const stack = new Set<string>();
  const inCycle = new Set<string>();
  const dfs = (id: string): void => {
    if (stack.has(id)) {
      inCycle.add(id);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    stack.add(id);
    for (const next of outgoing.get(id) ?? []) {
      dfs(next);
      if (inCycle.has(next)) inCycle.add(id);
    }
    stack.delete(id);
  };
  for (const n of stationNodes) dfs(n.id);
  if (inCycle.size > 0) {
    out.push({
      code: "TOPO_CYCLE_DETECTED",
      severity: "warning",
      category: "topology",
      message: `Cycle detected through ${String(inCycle.size)} node${inCycle.size === 1 ? "" : "s"} — engine treats rework loops as cycles`,
      fix: `If unintentional, remove the back-edge`,
    });
  }
  // Source / sink uniqueness: many scenarios have a single source + sink.
  // We flag multiple of either as a warning (engine throws if topology mode
  // has > 1 source or sink).
  const sources = stationNodes.filter((n) => (incoming.get(n.id) ?? []).length === 0);
  const sinks = stationNodes.filter((n) => (outgoing.get(n.id) ?? []).length === 0);
  // VROL-AUDIT — multi-source / multi-sink graphs fall into the linear-fallback
  // branch of graph-to-chain that emits only stationCycleTimes + labels, silently
  // dropping capacity, defectRate, setupDistribution, changeoverMatrix,
  // cycleByProduct, reworkTargetId, reworkPassLimit, and skills. Block the run
  // with an explicit error so the user doesn't see silently-mis-computed KPIs.
  if (sources.length > 1) {
    out.push({
      code: "TOPO_MULTIPLE_SOURCES",
      severity: "error",
      category: "topology",
      message: `${String(sources.length)} stations have no input — the engine requires a single source so per-station settings (capacity, defect rate, setup, rework) aren't silently dropped`,
      fix: `Connect the extra sources downstream of a shared input station`,
    });
  }
  if (sinks.length > 1) {
    out.push({
      code: "TOPO_MULTIPLE_SINKS",
      severity: "error",
      category: "topology",
      message: `${String(sinks.length)} stations have no output — the engine requires a single sink so per-station settings (capacity, defect rate, setup, rework) aren't silently dropped`,
      fix: `Connect the extra sinks upstream of a shared output station`,
    });
  }
  // VROL-AUDIT — even with one source + one sink, the DAG branch is skipped when
  // the source can't reach the sink (disconnected subgraph). Catch that case too:
  // some non-skipped stations would fall into the linear fallback. We approximate
  // by checking that every station is on the source→sink reachable path.
  if (sources.length === 1 && sinks.length === 1 && stationNodes.length > 1) {
    const src = sources[0]!;
    const sinkId = sinks[0]!.id;
    const seen = new Set<string>([src.id]);
    const stack = [src.id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const next of outgoing.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    if (!seen.has(sinkId)) {
      out.push({
        code: "TOPO_SOURCE_SINK_DISCONNECTED",
        severity: "error",
        category: "topology",
        message: `Source "${src.id}" can't reach sink "${sinkId}" — connect them before running`,
        fix: `Add edges so every station sits on a path from source to sink`,
      });
    }
  }
}

// ─── 4. Resource feasibility ────────────────────────────────────────────────
function checkResourceFeasibility(
  nodes: readonly Node[],
  settings: RunSettings,
  out: ValidationIssue[],
): void {
  if (!settings.workers.enabled) return;
  const allSkills = new Set<string>();
  for (const w of settings.workers.list) {
    for (const s of w.skills) allSkills.add(s);
  }
  nodes.forEach((n, i) => {
    const skills = (n.data as { skills?: unknown } | undefined)?.skills;
    if (!Array.isArray(skills)) return;
    for (const required of skills) {
      if (typeof required !== "string" || required.length === 0) continue;
      // "any" is a special skill — every worker has it implicitly via the
      // engine's default match path, so don't flag.
      if (required === "any") continue;
      if (!allSkills.has(required)) {
        out.push({
          code: "RES_SKILL_UNCOVERED",
          severity: "error",
          category: "resource",
          message: `Station "${n.id}" requires skill "${required}" but no worker has it`,
          path: `nodes[${String(i)}].data.skills`,
          fix: `Add a worker with the "${required}" skill or remove the requirement`,
          nodeId: n.id,
        });
      }
    }
  });
}

// ─── 5. Schedule sanity ─────────────────────────────────────────────────────
function checkScheduleSanity(settings: RunSettings, out: ValidationIssue[]): void {
  if (!settings.workers.enabled) return;
  settings.workers.list.forEach((w, wi) => {
    const breaks = w.breaks ?? [];
    breaks.forEach((b, bi) => {
      if (b.endMs <= b.startMs) {
        out.push({
          code: "SCHED_BREAK_ZERO_DURATION",
          severity: "error",
          category: "schedule",
          message: `Worker "${w.name}" break #${String(bi + 1)} has zero or negative duration`,
          path: `workers.list[${String(wi)}].breaks[${String(bi)}]`,
          fix: `Set break end after break start`,
        });
      }
    });
    // Pairwise overlap detection.
    for (let i = 0; i < breaks.length; i++) {
      for (let j = i + 1; j < breaks.length; j++) {
        const a = breaks[i]!;
        const b = breaks[j]!;
        if (a.startMs < b.endMs && b.startMs < a.endMs) {
          out.push({
            code: "SCHED_BREAK_OVERLAP",
            severity: "error",
            category: "schedule",
            message: `Worker "${w.name}" breaks #${String(i + 1)} and #${String(j + 1)} overlap`,
            path: `workers.list[${String(wi)}].breaks`,
            fix: `Adjust break windows so they don't overlap`,
          });
        }
      }
    }
  });
}

// ─── 7. Sprint 90/91 constraint sanity (VROL-934) ───────────────────────────
function checkConstraintsSanity(
  nodes: readonly Node[],
  settings: RunSettings,
  out: ValidationIssue[],
): void {
  const productIds = new Set((settings.products?.list ?? []).map((p) => p.id));
  const stationNodeIds = new Set(
    nodes.filter((n) => n.type !== "sticky" && n.type !== "frame").map((n) => n.id),
  );
  const poolByName = new Map<string, number>(
    (settings.toolPools ?? []).map((p) => [p.name, p.capacity] as const),
  );
  // Per-pool consumer count for oversubscription check.
  const poolDemand = new Map<string, number>();

  nodes.forEach((n, i) => {
    const data = n.data as
      | {
          bomFeeders?: ReadonlyArray<{ feederStationId?: string; qtyPerCycle?: number }>;
          requiredToolPool?: string;
          perSkuRouting?: Record<string, string>;
          stationType?: string;
          lengthM?: number;
          speedMps?: number;
        }
      | undefined;
    if (!data) return;

    // VROL-889 — batch-fire sanity. Warn on (a) typo-sized batches
    // (> 100 is real but rare; flag > 200 as suspicious) and (b) the
    // semantics conflict between batchSize > 1 and capacity > 1
    // (which would mean "wait for N parts and process them in
    // parallel, N at a time" — well-defined but almost never what
    // the user means).
    {
      const dataAny = n.data as { batchSize?: unknown; capacity?: unknown };
      const batchSize = typeof dataAny.batchSize === "number" ? dataAny.batchSize : 1;
      const capacity = typeof dataAny.capacity === "number" ? dataAny.capacity : 1;
      if (typeof dataAny.batchSize === "number" && batchSize > 200) {
        out.push({
          code: "BATCH_SIZE_SUSPICIOUS",
          severity: "warning",
          category: "topology",
          message: `Station "${n.id}" batchSize=${String(batchSize)} is unusually large`,
          fix: "Real build plates / autoclave loads top out around 100-200 parts. Double-check the value before running.",
          nodeId: n.id,
          path: `nodes[${String(i)}].data.batchSize`,
        });
      }
      // VROL-1016 — BATCH_CAPACITY_CONFLICT (Sprint 121) used to flag
      // batchSize > 1 AND capacity > 1 as suspicious. Turns out that's
      // exactly how multi-plate batch-fire is modelled (e.g. 3 printers
      // each running a 10-part plate = capacity=3 + batchSize=10). The
      // engine handles it correctly, so this warning was over-eager and
      // is removed. BATCH_SIZE_SUSPICIOUS still catches the >200 typo
      // case; capacity itself is bounded 1..10 at build time.
      void capacity;
    }

    // VROL-1003 — Transport stations need both lengthM and speedMps
    // for the conveyor delay to apply. Surface a soft warning when
    // either is missing or zero so the user isn't surprised that
    // their conveyor behaves like a zero-delay edge.
    if (data.stationType === "transport") {
      const lenOk = typeof data.lengthM === "number" && data.lengthM > 0;
      const spOk = typeof data.speedMps === "number" && data.speedMps > 0;
      if (!lenOk || !spOk) {
        out.push({
          code: "TRANSPORT_GEOMETRY_MISSING",
          severity: "warning",
          category: "topology",
          message: `Transport "${n.id}" is missing ${!lenOk ? "length (m)" : ""}${!lenOk && !spOk ? " and " : ""}${!spOk ? "speed (m/s)" : ""}`,
          fix: "Open the inspector → Conveyor geometry and set both length and speed. Without them the conveyor adds 0 ms delay.",
          nodeId: n.id,
          path: `nodes[${String(i)}].data.${!lenOk ? "lengthM" : "speedMps"}`,
        });
      }
    }

    // BOM qty > 10 is a likely typo.
    if (Array.isArray(data.bomFeeders)) {
      data.bomFeeders.forEach((f, fi) => {
        if (typeof f.qtyPerCycle === "number" && f.qtyPerCycle > 10) {
          out.push({
            code: "BOM_QTY_SUSPICIOUS",
            severity: "warning",
            category: "topology",
            message: `Station "${n.id}" BOM feeder ${String(fi)} requires ${String(f.qtyPerCycle)} parts/cycle — unusually high`,
            fix: "Double-check the per-cycle quantity. Real assemblies rarely need > 10 components from one feeder per cycle.",
            nodeId: n.id,
            path: `nodes[${String(i)}].data.bomFeeders[${String(fi)}].qtyPerCycle`,
          });
        }
        if (typeof f.feederStationId === "string" && !stationNodeIds.has(f.feederStationId)) {
          out.push({
            code: "BOM_FEEDER_NOT_IN_GRAPH",
            severity: "warning",
            category: "topology",
            message: `Station "${n.id}" BOM feeder references "${f.feederStationId}" which is not in the graph`,
            fix: "Add the feeder station to the graph or remove the BOM entry.",
            nodeId: n.id,
            path: `nodes[${String(i)}].data.bomFeeders[${String(fi)}].feederStationId`,
          });
        }
      });
    }

    // Tool-pool oversubscription accounting + undeclared pool check.
    if (typeof data.requiredToolPool === "string" && data.requiredToolPool.length > 0) {
      const pool = data.requiredToolPool;
      poolDemand.set(pool, (poolDemand.get(pool) ?? 0) + 1);
      if (!poolByName.has(pool)) {
        out.push({
          code: "TOOL_POOL_UNDECLARED",
          severity: "warning",
          category: "topology",
          message: `Station "${n.id}" requires tool pool "${pool}" but no such pool is declared in run settings`,
          fix: `Declare the pool in run settings → Tool pools (or fix the station's requiredToolPool field).`,
          nodeId: n.id,
          path: `nodes[${String(i)}].data.requiredToolPool`,
        });
      }
    }

    // perSkuRouting destination + product sanity.
    if (data.perSkuRouting && typeof data.perSkuRouting === "object") {
      for (const [sku, dest] of Object.entries(data.perSkuRouting)) {
        if (productIds.size > 0 && !productIds.has(sku)) {
          out.push({
            code: "ROUTING_PRODUCT_NOT_IN_LIST",
            severity: "warning",
            category: "topology",
            message: `Station "${n.id}" routes SKU "${sku}" but it's not in settings.products.list`,
            fix: `Add the SKU to Products or remove the routing entry.`,
            nodeId: n.id,
            path: `nodes[${String(i)}].data.perSkuRouting`,
          });
        }
        if (dest !== "skip" && typeof dest === "string" && !stationNodeIds.has(dest)) {
          out.push({
            code: "ROUTING_DEST_NOT_IN_GRAPH",
            severity: "warning",
            category: "topology",
            message: `Station "${n.id}" routes "${sku}" to "${dest}" which is not in the graph`,
            fix: `Add the destination station to the graph, change the destination, or use "skip".`,
            nodeId: n.id,
            path: `nodes[${String(i)}].data.perSkuRouting`,
          });
        }
      }
    }
  });

  // Tool-pool oversubscription: demand >> capacity.
  for (const [pool, demand] of poolDemand) {
    const cap = poolByName.get(pool);
    if (typeof cap === "number" && demand > cap * 2) {
      out.push({
        code: "TOOL_POOL_OVERSUBSCRIBED",
        severity: "warning",
        category: "topology",
        message: `Tool pool "${pool}" has ${String(demand)} consumers but capacity ${String(cap)} — heavily oversubscribed`,
        fix: `Raise the pool capacity or reduce the number of stations that share it.`,
      });
    }
  }
}

// ─── 6. Recipe + material coverage ──────────────────────────────────────────
function checkRecipeCoverage(settings: RunSettings, out: ValidationIssue[]): void {
  if (!settings.materials.enabled) return;
  // Today the only recipe is "bottle + cap per part" applied to the
  // currently selected station. Check that the inventories aren't both
  // zero — otherwise no parts can ever complete.
  if (settings.materials.bottles <= 0 && settings.materials.caps <= 0) {
    out.push({
      code: "RECIPE_NO_INVENTORY",
      severity: "error",
      category: "recipe",
      message: "Materials are enabled but both bottle + cap inventories are zero",
      fix: "Set starting inventory above zero or disable materials",
    });
  }
  for (const r of settings.materials.recurring) {
    if (r.amount <= 0) {
      out.push({
        code: "RECIPE_RECURRING_ZERO_AMOUNT",
        severity: "warning",
        category: "recipe",
        message: `Recurring "${r.material}" delivery has amount=0 — no parts will arrive`,
        fix: `Set amount > 0 or remove the delivery`,
      });
    }
  }
}

// ─── 8. VROL-867 v1 — UoM consistency ────────────────────────────────────────
// Edges that connect two stations with declared-but-different units
// warn the user. v1 doesn't do unit conversion; downstream display
// reads the sink's unit. Empty = default = treated as "parts"; one
// side empty is silent.
function checkUomConsistency(
  nodes: readonly Node[],
  edges: readonly Edge[],
  out: ValidationIssue[],
): void {
  const unitByNodeId = new Map<string, string>();
  for (const n of nodes) {
    const d = n.data as { unit?: unknown } | undefined;
    const u = d && typeof d.unit === "string" ? d.unit.trim() : "";
    unitByNodeId.set(n.id, u);
  }
  // VROL-1012 — surface stations that declared a unit but not a ratio
  // (the throughput display will silently use 1 part = 1 unit, which
  // is often wrong for bulk lines). Also flag the inverse: a non-1
  // ratio without a unit reads as "X / hour" with no unit context.
  nodes.forEach((n, i) => {
    const d = n.data as { unit?: unknown; unitsPerPart?: unknown } | undefined;
    if (!d) return;
    const unit = typeof d.unit === "string" ? d.unit.trim() : "";
    const ratio =
      typeof d.unitsPerPart === "number" && Number.isFinite(d.unitsPerPart) && d.unitsPerPart > 0
        ? d.unitsPerPart
        : 1;
    if (unit.length > 0 && unit !== "parts" && ratio === 1) {
      out.push({
        code: "UOM_RATIO_MISSING",
        severity: "warning",
        category: "reference",
        message: `Station "${n.id}" declares unit "${unit}" but no unitsPerPart — display will use 1 part = 1 ${unit}`,
        fix: `Set unitsPerPart on this station if 1 part doesn't equal 1 ${unit}. Skip the warning by leaving unit unset.`,
        nodeId: n.id,
        path: `nodes[${String(i)}].data.unitsPerPart`,
      });
    } else if (unit.length === 0 && ratio !== 1) {
      out.push({
        code: "UOM_RATIO_WITHOUT_UNIT",
        severity: "warning",
        category: "reference",
        message: `Station "${n.id}" has unitsPerPart=${String(ratio)} but no declared unit`,
        fix: `Add a unit label (kg, L, doses…) on this station so the throughput display has context.`,
        nodeId: n.id,
        path: `nodes[${String(i)}].data.unit`,
      });
    }
  });
  edges.forEach((e, i) => {
    const a = unitByNodeId.get(e.source);
    const b = unitByNodeId.get(e.target);
    if (a === undefined || b === undefined) return;
    if (a.length === 0 || b.length === 0) return;
    if (a === b) return;
    out.push({
      code: "UOM_MISMATCH",
      severity: "warning",
      category: "reference",
      message: `Edge ${e.source} → ${e.target} crosses unit boundary "${a}" → "${b}"`,
      fix: "Either align the two stations' units, or accept that the throughput display will use the sink's unit. UoM conversion is a future feature.",
      path: `edges[${String(i)}]`,
    });
  });
  // VROL-1025 — sustainability inputs declared but no UoM. The
  // SustainabilityCard intensity figure would read "X / parts", which
  // is uninformative. Flag once line-level (not per-station) since the
  // fix is to declare a unit on the sink.
  const anySustainability = nodes.some((n) => {
    const d = n.data as
      | { energyPerCycleJ?: unknown; waterPerCycleL?: unknown; co2ePerCycleG?: unknown }
      | undefined;
    if (!d) return false;
    const e = typeof d.energyPerCycleJ === "number" ? d.energyPerCycleJ : 0;
    const w = typeof d.waterPerCycleL === "number" ? d.waterPerCycleL : 0;
    const c = typeof d.co2ePerCycleG === "number" ? d.co2ePerCycleG : 0;
    return e > 0 || w > 0 || c > 0;
  });
  const anyUnit = Array.from(unitByNodeId.values()).some((u) => u.length > 0);
  if (anySustainability && !anyUnit) {
    out.push({
      code: "SUSTAINABILITY_NO_UOM",
      severity: "warning",
      category: "reference",
      message:
        "Stations declare sustainability inputs (energy / water / CO₂e per cycle) but no station declares a unit",
      fix: "Declare a unit (kg, L, doses…) on the sink station so the intensity figure reads 'J / kg' instead of 'J / parts'.",
    });
  }
}
