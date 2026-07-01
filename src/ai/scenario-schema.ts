/**
 * VROL-397 / VROL-1118 — Zod schema for AI-generated scenarios.
 *
 * The LLM is asked to emit a scenario in this shape via the
 * `emit_scenario` tool call (see scenario-tool.ts). The schema is
 * tight enough to reject hallucinations (impossible cycles, missing
 * fields) but loose enough not to over-constrain the model's
 * authoring freedom.
 *
 * Intentionally a subset of the full Vrolen scenario format — covers
 * the 90 % case (linear and branching chains, products, basic
 * sustainability). Advanced features (per-station rework targets,
 * BOM feeders, tool pools, breakdowns) are deferred to future
 * iterations of this schema.
 */

import { z } from "zod";

/** Bounded so a malformed model output can't lock up the build step. */
const CYCLE_MS_MIN = 1;
const CYCLE_MS_MAX = 24 * 60 * 60 * 1000; // 24h
const CAPACITY_MIN = 1;
const CAPACITY_MAX = 100;
const BUFFER_MIN = 1;
const BUFFER_MAX = 10_000;
const HORIZON_MIN = 1_000;
const HORIZON_MAX = 7 * 24 * 60 * 60 * 1000; // 7 days

const stationSchema = z.object({
  id: z.string().min(1, "Station id must be non-empty."),
  label: z.string().min(1, "Station label must be non-empty."),
  cycleMs: z
    .number()
    .int("cycleMs must be an integer (milliseconds).")
    .min(CYCLE_MS_MIN, `cycleMs must be ≥ ${String(CYCLE_MS_MIN)} ms.`)
    .max(CYCLE_MS_MAX, `cycleMs must be ≤ ${String(CYCLE_MS_MAX)} ms (24 h).`),
  /** Parallel server count (1 = single-server). */
  capacity: z
    .number()
    .int("capacity must be an integer.")
    .min(CAPACITY_MIN)
    .max(CAPACITY_MAX)
    .optional(),
  /** Fraction of cycles producing a defective part, 0..1. */
  defectRate: z.number().min(0).max(1).optional(),
  /** Per-cycle energy in joules. Drives sustainability cards. */
  energyPerCycleJ: z.number().min(0).optional(),
});

const edgeSchema = z.object({
  source: z.string().min(1, "Edge source must reference a station id."),
  target: z.string().min(1, "Edge target must reference a station id."),
  /** Per-edge buffer override; engine clamps + validates further. */
  bufferCapacity: z.number().int().min(BUFFER_MIN).max(BUFFER_MAX).optional(),
});

const productSchema = z.object({
  id: z.string().min(1, "Product id must be non-empty."),
  name: z.string().min(1, "Product name must be non-empty."),
  /** Production mix weight; weights are relative across the product list. */
  weight: z.number().min(0, "Product weight must be ≥ 0."),
});

const settingsSchema = z.object({
  horizonMs: z.number().int().min(HORIZON_MIN).max(HORIZON_MAX),
  warmupMs: z.number().int().min(0),
  replications: z.number().int().min(1).max(50),
  interStationBufferCapacity: z.number().int().min(BUFFER_MIN).max(BUFFER_MAX),
});

/**
 * The full output the AI emits. References between edges + stations
 * are validated cross-field — both ends of every edge must point at a
 * declared station id.
 */
export const scenarioGenerationSchema = z
  .object({
    stations: z.array(stationSchema).min(2, "A scenario needs at least 2 stations."),
    edges: z.array(edgeSchema).min(1, "A scenario needs at least 1 edge."),
    products: z.array(productSchema).optional(),
    settings: settingsSchema,
  })
  .superRefine((s, ctx) => {
    // Every edge must reference a declared station id on both ends.
    const ids = new Set(s.stations.map((n) => n.id));
    s.edges.forEach((e, i) => {
      if (!ids.has(e.source)) {
        ctx.addIssue({
          code: "custom",
          message: `Edge ${String(i)}: source "${e.source}" is not a declared station id.`,
          path: ["edges", i, "source"],
        });
      }
      if (!ids.has(e.target)) {
        ctx.addIssue({
          code: "custom",
          message: `Edge ${String(i)}: target "${e.target}" is not a declared station id.`,
          path: ["edges", i, "target"],
        });
      }
    });
    // Settings sanity — warmup must not exceed horizon.
    if (s.settings.warmupMs > s.settings.horizonMs) {
      ctx.addIssue({
        code: "custom",
        message: "warmupMs must be ≤ horizonMs.",
        path: ["settings", "warmupMs"],
      });
    }

    // VROL-1210 — topology constraints the engine also enforces at
    // run time. Hoisting them into the schema so the LLM retry loop
    // can feed the specific violation back and get a fixed scenario.
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    for (const n of s.stations) {
      incoming.set(n.id, []);
      outgoing.set(n.id, []);
    }
    for (const e of s.edges) {
      // Skip malformed refs — already flagged above.
      if (!ids.has(e.source) || !ids.has(e.target)) continue;
      outgoing.get(e.source)?.push(e.target);
      incoming.get(e.target)?.push(e.source);
    }

    // Exactly one source (station with no incoming edge).
    const sources = s.stations.filter((n) => (incoming.get(n.id) ?? []).length === 0);
    if (sources.length !== 1) {
      const labels = sources
        .map((n) => `"${n.id}"`)
        .slice(0, 6)
        .join(", ");
      ctx.addIssue({
        code: "custom",
        message: `Topology must have exactly one source station (no incoming edges). Found ${String(sources.length)}${labels ? ` (${labels})` : ""}. Merge extra sources downstream of a single shared input station.`,
        path: ["stations"],
      });
    }
    // Exactly one sink (station with no outgoing edge).
    const sinks = s.stations.filter((n) => (outgoing.get(n.id) ?? []).length === 0);
    if (sinks.length !== 1) {
      const labels = sinks
        .map((n) => `"${n.id}"`)
        .slice(0, 6)
        .join(", ");
      ctx.addIssue({
        code: "custom",
        message: `Topology must have exactly one sink station (no outgoing edges). Found ${String(sinks.length)}${labels ? ` (${labels})` : ""}. Merge extra sinks upstream of a single shared output station.`,
        path: ["stations"],
      });
    }

    // No cycles — rework loops aren't modeled in the v1 schema, so any
    // cycle is either a modelling mistake or a hallucinated back-edge
    // trying to fake rework. Report the smallest cycle for grounding.
    const visited = new Set<string>();
    const stack = new Set<string>();
    const cycleNodes = new Set<string>();
    const dfs = (id: string): void => {
      if (stack.has(id)) {
        cycleNodes.add(id);
        return;
      }
      if (visited.has(id)) return;
      visited.add(id);
      stack.add(id);
      for (const next of outgoing.get(id) ?? []) {
        dfs(next);
        if (cycleNodes.has(next)) cycleNodes.add(id);
      }
      stack.delete(id);
    };
    for (const n of s.stations) dfs(n.id);
    if (cycleNodes.size > 0) {
      const preview = Array.from(cycleNodes)
        .slice(0, 6)
        .map((id) => `"${id}"`)
        .join(", ");
      ctx.addIssue({
        code: "custom",
        message: `Cycle detected involving ${String(cycleNodes.size)} station(s): ${preview}. This schema does not model rework loops; if the user described rework, keep the flow one-directional and set defectRate on the QC station instead of adding a back-edge.`,
        path: ["edges"],
      });
    }

    // Reachability — every station should be reachable from the source
    // and able to reach the sink. Isolated fragments silently drop
    // work at runtime.
    if (sources.length === 1) {
      const src = sources[0]!.id;
      const reachable = new Set<string>();
      const stack2 = [src];
      while (stack2.length > 0) {
        const cur = stack2.pop()!;
        if (reachable.has(cur)) continue;
        reachable.add(cur);
        for (const n of outgoing.get(cur) ?? []) stack2.push(n);
      }
      const unreachable = s.stations.filter((n) => !reachable.has(n.id));
      if (unreachable.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `${String(unreachable.length)} station(s) are unreachable from the source: ${unreachable
            .map((n) => `"${n.id}"`)
            .slice(0, 6)
            .join(", ")}. Wire them into the chain or drop them.`,
          path: ["stations"],
        });
      }
    }
  });

export type GeneratedScenario = z.infer<typeof scenarioGenerationSchema>;
export type GeneratedStation = z.infer<typeof stationSchema>;
export type GeneratedEdge = z.infer<typeof edgeSchema>;
