/**
 * VROL-79 — Schedule type module.
 *
 * Re-exports + zod schemas for the user-facing schedule shape: shifts,
 * breaks, planned maintenance windows, and changeovers. The engine has
 * its own internal representation (`engine/schedule.ts`, etc.); this
 * module is the boundary-level shape used by validation, persistence,
 * and import/export.
 */

import { z } from "zod";

export const ShiftSchema = z
  .object({
    label: z.string().min(1),
    /** Start time of day in ms since 00:00. */
    startMs: z.number().int().min(0).max(86_400_000),
    /** Duration in ms (e.g. 8h = 28_800_000). */
    durationMs: z.number().int().positive(),
  })
  .strict();

export type Shift = z.infer<typeof ShiftSchema>;

export const BreakSchema = z
  .object({
    label: z.string().min(1),
    /** Offset within the parent shift, ms. */
    offsetMs: z.number().int().min(0),
    durationMs: z.number().int().positive(),
  })
  .strict();

export type Break = z.infer<typeof BreakSchema>;

export const MaintenanceWindowSchema = z
  .object({
    label: z.string().min(1),
    /** Absolute simulator time (ms) when maintenance begins. */
    atMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
  })
  .strict();

export type MaintenanceWindow = z.infer<typeof MaintenanceWindowSchema>;

export const ChangeoverSchema = z
  .object({
    fromProductId: z.string().min(1),
    toProductId: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type Changeover = z.infer<typeof ChangeoverSchema>;

export const ScheduleSchema = z
  .object({
    shifts: z.array(ShiftSchema).default([]),
    breaks: z.array(BreakSchema).default([]),
    maintenance: z.array(MaintenanceWindowSchema).default([]),
    changeovers: z.array(ChangeoverSchema).default([]),
  })
  .strict();

export type Schedule = z.infer<typeof ScheduleSchema>;
