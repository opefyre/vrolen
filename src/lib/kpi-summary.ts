/**
 * VROL-73 — Scenario / Run / KPI summary schemas.
 *
 * Lightweight zod schemas + TS types that the cloud-sync layer (E10) and
 * any external consumers can use to validate Vrolen data. Mirrors the
 * shapes used in localStorage / run-history today, factored out so the
 * shape isn't tied to those modules.
 */

import { z } from "zod";

export const KpiSummarySchema = z
  .object({
    completed: z.number().int().nonnegative(),
    throughputPerHour: z.number().nonnegative(),
    lineOee: z.number().min(0).max(1),
    averageWipL: z.number().nonnegative(),
    avgTimeInSystemMs: z.number().nonnegative(),
    lineScrapRate: z.number().min(0).max(1).optional(),
    lineReworkRate: z.number().min(0).max(1).optional(),
    bottleneckLabel: z.string().optional(),
  })
  .strict();

export type KpiSummary = z.infer<typeof KpiSummarySchema>;

export const RunSummarySchema = z
  .object({
    /** Unix ms when the run was executed. */
    runAtMs: z.number().int().nonnegative(),
    /** Scenario digest (FNV-1a hex) so equal scenarios reconcile across machines. */
    scenarioDigest: z.string().regex(/^[0-9a-f]{8}$/),
    /** Horizon used for this run (ms). */
    horizonMs: z.number().int().positive(),
    /** Warmup used for this run (ms). */
    warmupMs: z.number().int().nonnegative(),
    kpis: KpiSummarySchema,
  })
  .strict();

export type RunSummary = z.infer<typeof RunSummarySchema>;

export const ScenarioSummarySchema = z
  .object({
    name: z.string().min(1),
    savedAtMs: z.number().int().nonnegative(),
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    notes: z.string().optional(),
  })
  .strict();

export type ScenarioSummary = z.infer<typeof ScenarioSummarySchema>;
