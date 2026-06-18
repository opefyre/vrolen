/**
 * Zod schemas mirroring every type in `./types.ts` and `./distribution.ts`.
 *
 * The schemas are the runtime authority — they validate at every external
 * boundary: scenario load from cloud, LLM tool-call output, scenario file
 * import. Inside engine + editor code, we work with already-validated
 * TypeScript types and don't re-parse.
 *
 * Discriminated union pattern: `StationSchema` is a `z.discriminatedUnion` on
 * the `type` field. Adding a new station subtype is a three-line change:
 *   1. Add to `StationType` in types.ts
 *   2. Add a new sub-schema here
 *   3. Add it to the array in `StationSchema`
 *
 * Branded ID schemas: parse to `string` at runtime, but produce the branded
 * id type at compile time via `.transform(asXxxId)`. So `z.infer<typeof SiteSchema>['id']`
 * is `SiteId`, not just `string`. This makes scenario JSON round-trippable.
 */

import { z } from "zod";

import {
  asEdgeId,
  asLineId,
  asMaterialId,
  asResourceId,
  asScenarioId,
  asScheduleId,
  asSiteId,
  asStationId,
  asWorkspaceId,
} from "./ids";

// ============ ID schemas (branded) ============

export const SiteIdSchema = z.string().min(1).transform(asSiteId);
export const LineIdSchema = z.string().min(1).transform(asLineId);
export const StationIdSchema = z.string().min(1).transform(asStationId);
export const EdgeIdSchema = z.string().min(1).transform(asEdgeId);
export const ResourceIdSchema = z.string().min(1).transform(asResourceId);
export const MaterialIdSchema = z.string().min(1).transform(asMaterialId);
export const ScheduleIdSchema = z.string().min(1).transform(asScheduleId);
export const ScenarioIdSchema = z.string().min(1).transform(asScenarioId);
export const WorkspaceIdSchema = z.string().min(1).transform(asWorkspaceId);

// ============ Customization primitives ============

export const CustomParamValueSchema = z.union([z.number(), z.string(), z.boolean()]);
export const CustomParamsSchema = z.record(z.string(), CustomParamValueSchema);

// ============ Distribution ============

export const DistributionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().finite() }),
  z
    .object({
      kind: z.literal("uniform"),
      min: z.number().finite(),
      max: z.number().finite(),
    })
    .refine((d) => d.max >= d.min, { message: "max must be >= min" }),
  z.object({
    kind: z.literal("normal"),
    mean: z.number().finite(),
    stddev: z.number().positive(),
  }),
  z
    .object({
      kind: z.literal("triangular"),
      min: z.number().finite(),
      mode: z.number().finite(),
      max: z.number().finite(),
    })
    .refine((d) => d.min <= d.mode && d.mode <= d.max, {
      message: "must satisfy min <= mode <= max",
    }),
  z.object({
    kind: z.literal("exponential"),
    rate: z.number().positive(),
  }),
]);

// ============ Material ============

export const MaterialReplenishmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("initial-only"), initialQuantity: z.number().nonnegative() }),
  z.object({
    kind: z.literal("periodic"),
    initialQuantity: z.number().nonnegative(),
    batchSize: z.number().positive(),
    intervalMs: z.number().positive(),
  }),
]);

export const MaterialSchema = z.object({
  id: MaterialIdSchema,
  name: z.string().min(1, { message: "name is required" }),
  unit: z.string().min(1, { message: "unit is required" }),
  replenishment: MaterialReplenishmentSchema,
  customParams: CustomParamsSchema,
});

// ============ Resource ============

export const ResourceSchema = z.object({
  id: ResourceIdSchema,
  name: z.string().min(1),
  skills: z.array(z.string().min(1)),
  speedMetersPerSec: z.number().positive(),
  customParams: CustomParamsSchema,
});

// ============ Edge ============

export const EdgeSchema = z.object({
  id: EdgeIdSchema,
  fromStationId: StationIdSchema,
  fromPort: z.string().min(1).optional(),
  toStationId: StationIdSchema,
  toPort: z.string().min(1).optional(),
  transitMs: z.number().nonnegative(),
  bufferCapacity: z.number().int().nonnegative(),
  customParams: CustomParamsSchema,
});

// ============ Station — discriminated union ============

const PositionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const stationBaseFields = {
  id: StationIdSchema,
  name: z.string().min(1),
  customParams: CustomParamsSchema,
  position: PositionSchema,
};

const Probability = z.number().min(0).max(1);
const PositiveInt = z.number().int().positive();
const NonNegativeInt = z.number().int().nonnegative();

export const MachineStationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("Machine"),
  cycleTimeMs: DistributionSchema,
  capacity: PositiveInt,
  defectRate: Probability,
  setupTimeMs: DistributionSchema,
  mtbfMs: DistributionSchema,
  mttrMs: DistributionSchema,
  requiredSkills: z.array(z.string()),
});

export const ManualWorkstationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("ManualWorkstation"),
  cycleTimeMs: DistributionSchema,
  capacity: PositiveInt,
  defectRate: Probability,
  requiredSkills: z.array(z.string()),
});

export const BufferStationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("Buffer"),
  capacity: NonNegativeInt,
});

export const QCStationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("QC"),
  cycleTimeMs: DistributionSchema,
  capacity: PositiveInt,
  passRate: Probability,
  failPort: z.string().min(1).optional(),
  requiredSkills: z.array(z.string()),
});

export const PackingStationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("Packing"),
  cycleTimeMs: DistributionSchema,
  capacity: PositiveInt,
  defectRate: Probability,
  requiredSkills: z.array(z.string()),
});

export const AssemblyStationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("Assembly"),
  cycleTimeMs: DistributionSchema,
  capacity: PositiveInt,
  defectRate: Probability,
  inputPorts: z.array(z.string().min(1)).min(1),
  requiredSkills: z.array(z.string()),
});

export const DisassemblyStationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("Disassembly"),
  cycleTimeMs: DistributionSchema,
  capacity: PositiveInt,
  outputPorts: z.array(z.string().min(1)).min(1),
  requiredSkills: z.array(z.string()),
});

export const TransportStationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("Transport"),
  lengthM: z.number().positive(),
  speedMps: z.number().positive(),
  capacity: PositiveInt,
});

export const MaterialInputStationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("MaterialInput"),
  materialId: MaterialIdSchema,
});

export const OutputStationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("Output"),
});

export const CustomStationSchema = z.object({
  ...stationBaseFields,
  type: z.literal("Custom"),
  behaviorLabel: z.string().min(1, {
    message: "behaviorLabel is required for Custom stations — describe what this station does",
  }),
  cycleTimeMs: DistributionSchema,
  capacity: PositiveInt,
  requiredSkills: z.array(z.string()),
  inputPorts: z.array(z.string()),
  outputPorts: z.array(z.string()),
});

export const StationSchema = z.discriminatedUnion("type", [
  MachineStationSchema,
  ManualWorkstationSchema,
  BufferStationSchema,
  QCStationSchema,
  PackingStationSchema,
  AssemblyStationSchema,
  DisassemblyStationSchema,
  TransportStationSchema,
  MaterialInputStationSchema,
  OutputStationSchema,
  CustomStationSchema,
]);

// ============ Line and Site ============

export const LineSchema = z.object({
  id: LineIdSchema,
  siteId: SiteIdSchema,
  name: z.string().min(1),
  stations: z.array(StationSchema),
  edges: z.array(EdgeSchema),
  customParams: CustomParamsSchema,
});

export const SiteSchema = z.object({
  id: SiteIdSchema,
  name: z.string().min(1),
  lines: z.array(LineSchema),
  resources: z.array(ResourceSchema),
  materials: z.array(MaterialSchema),
  floor: z.object({ widthM: z.number().positive(), heightM: z.number().positive() }),
  customParams: CustomParamsSchema,
});
