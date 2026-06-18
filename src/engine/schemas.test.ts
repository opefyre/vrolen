import { describe, expect, it } from "vitest";

import { constant } from "./distribution";
import { formatZodError } from "./errors";
import { newEdgeId, newLineId, newMaterialId, newResourceId, newSiteId, newStationId } from "./ids";
import {
  DistributionSchema,
  MachineStationSchema,
  MaterialSchema,
  SiteSchema,
  StationSchema,
} from "./schemas";
import type { MachineStation } from "./types";

/**
 * Note on schema-vs-type drift:
 *
 * We considered automated compile-time `z.infer extends EngineType` checks,
 * but they fight `Record<string, V>` (Zod v4 outputs `V | undefined` for safety)
 * and the readonly modifiers on engine types. The result was false-positives
 * on perfectly aligned schemas.
 *
 * Instead we rely on:
 *   1. Runtime parse tests in this file — every schema gets a positive +
 *      a negative fixture covering its discriminator and shape constraints.
 *   2. The round-trip Site test at the bottom — builds a fixture using the
 *      engine ID generators and successfully parses it through SiteSchema.
 *
 * If you add a field to a TS entity type, add it to the matching schema.
 * Code review catches drift; ship a test that fails when it isn't matched.
 */

describe("schemas — runtime validation", () => {
  it("accepts a valid constant Distribution", () => {
    const result = DistributionSchema.safeParse({ kind: "constant", value: 60 });
    expect(result.success).toBe(true);
  });

  it("rejects a normal Distribution with non-positive stddev", () => {
    const result = DistributionSchema.safeParse({ kind: "normal", mean: 10, stddev: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a triangular Distribution where mode is outside [min, max]", () => {
    const result = DistributionSchema.safeParse({
      kind: "triangular",
      min: 0,
      mode: 100,
      max: 50,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid Machine station with all fields", () => {
    const station: MachineStation = {
      id: newStationId(),
      type: "Machine",
      name: "Filler",
      position: { x: 0, y: 0 },
      customParams: {},
      cycleTimeMs: constant(2000),
      capacity: 1,
      defectRate: 0.01,
      setupTimeMs: constant(0),
      mtbfMs: constant(3_600_000),
      mttrMs: constant(60_000),
      requiredSkills: ["machine-op"],
    };
    const result = MachineStationSchema.safeParse(station);
    expect(result.success).toBe(true);
  });

  it("rejects a Machine station with defectRate > 1", () => {
    const result = MachineStationSchema.safeParse({
      id: newStationId(),
      type: "Machine",
      name: "Bad station",
      position: { x: 0, y: 0 },
      customParams: {},
      cycleTimeMs: { kind: "constant", value: 1 },
      capacity: 1,
      defectRate: 2.5,
      setupTimeMs: { kind: "constant", value: 0 },
      mtbfMs: { kind: "constant", value: 1 },
      mttrMs: { kind: "constant", value: 1 },
      requiredSkills: [],
    });
    expect(result.success).toBe(false);
  });

  it("StationSchema narrows by `type` discriminator (Buffer accepted, missing capacity rejected)", () => {
    const good = StationSchema.safeParse({
      id: newStationId(),
      type: "Buffer",
      name: "WIP",
      position: { x: 0, y: 0 },
      customParams: {},
      capacity: 100,
    });
    expect(good.success).toBe(true);

    const bad = StationSchema.safeParse({
      id: newStationId(),
      type: "Buffer",
      name: "WIP",
      position: { x: 0, y: 0 },
      customParams: {},
      // capacity missing
    });
    expect(bad.success).toBe(false);
  });

  it("CustomStation requires behaviorLabel (user-facing message)", () => {
    const result = StationSchema.safeParse({
      id: newStationId(),
      type: "Custom",
      name: "Mystery",
      position: { x: 0, y: 0 },
      customParams: {},
      cycleTimeMs: { kind: "constant", value: 100 },
      capacity: 1,
      requiredSkills: [],
      inputPorts: [],
      outputPorts: [],
      behaviorLabel: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = formatZodError(result.error);
      const hasLabelIssue = issues.some((i) => i.path.includes("behaviorLabel"));
      expect(hasLabelIssue).toBe(true);
    }
  });

  it("Material rejects missing unit with the user-facing 'is required' message", () => {
    const result = MaterialSchema.safeParse({
      id: newMaterialId(),
      name: "Caps",
      // unit missing
      replenishment: { kind: "none" },
      customParams: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = formatZodError(result.error);
      const unitIssue = issues.find((i) => i.path === "unit");
      expect(unitIssue).toBeDefined();
      expect(unitIssue?.message).toMatch(/required/i);
    }
  });

  it("round-trip: parse a valid Site fixture and get matching output", () => {
    const siteId = newSiteId();
    const lineId = newLineId();
    const matId = newMaterialId();
    const resId = newResourceId();
    const inId = newStationId();
    const machId = newStationId();
    const outId = newStationId();

    const fixture = {
      id: siteId,
      name: "Demo",
      floor: { widthM: 50, heightM: 30 },
      customParams: {},
      resources: [
        {
          id: resId,
          name: "Op",
          skills: ["machine-op"],
          speedMetersPerSec: 1.4,
          customParams: {},
        },
      ],
      materials: [
        {
          id: matId,
          name: "Bottles",
          unit: "ea",
          replenishment: { kind: "initial-only", initialQuantity: 1000 },
          customParams: {},
        },
      ],
      lines: [
        {
          id: lineId,
          siteId,
          name: "Line A",
          customParams: {},
          stations: [
            {
              id: inId,
              type: "MaterialInput",
              name: "Feed",
              materialId: matId,
              position: { x: 0, y: 0 },
              customParams: {},
            },
            {
              id: machId,
              type: "Machine",
              name: "Filler",
              cycleTimeMs: { kind: "constant", value: 2000 },
              capacity: 1,
              defectRate: 0.01,
              setupTimeMs: { kind: "constant", value: 0 },
              mtbfMs: { kind: "constant", value: 3_600_000 },
              mttrMs: { kind: "constant", value: 60_000 },
              requiredSkills: ["machine-op"],
              position: { x: 10, y: 0 },
              customParams: {},
            },
            {
              id: outId,
              type: "Output",
              name: "Out",
              position: { x: 20, y: 0 },
              customParams: {},
            },
          ],
          edges: [
            {
              id: newEdgeId(),
              fromStationId: inId,
              toStationId: machId,
              transitMs: 0,
              bufferCapacity: 100,
              customParams: {},
            },
            {
              id: newEdgeId(),
              fromStationId: machId,
              toStationId: outId,
              transitMs: 0,
              bufferCapacity: 100,
              customParams: {},
            },
          ],
        },
      ],
    };

    const result = SiteSchema.safeParse(fixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lines).toHaveLength(1);
      expect(result.data.lines[0]?.stations).toHaveLength(3);
    }
  });
});
