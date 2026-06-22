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
  // Rework target references — node.data.reworkTargetNodeId must point at an existing node.
  nodes.forEach((n, i) => {
    const raw = (n.data as { reworkTargetNodeId?: unknown } | undefined)?.reworkTargetNodeId;
    if (typeof raw === "string" && raw.length > 0 && !ids.has(raw)) {
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
  if (sources.length > 1) {
    out.push({
      code: "TOPO_MULTIPLE_SOURCES",
      severity: "warning",
      category: "topology",
      message: `${String(sources.length)} stations have no input — engine accepts a single source`,
      fix: `Connect the extra sources downstream of a shared input`,
    });
  }
  if (sinks.length > 1) {
    out.push({
      code: "TOPO_MULTIPLE_SINKS",
      severity: "warning",
      category: "topology",
      message: `${String(sinks.length)} stations have no output — engine accepts a single sink`,
      fix: `Connect the extra sinks upstream of a shared output`,
    });
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
