/**
 * Public engine surface.
 *
 * Everything the editor, UI, and tests consume from the engine flows through
 * this barrel. Keep the export list intentional — anything not exported from
 * here is an internal detail.
 */

export type {
  CustomParamValue,
  CustomParams,
  Material,
  MaterialReplenishment,
  Resource,
  Edge,
  StationType,
  Station,
  MachineStation,
  ManualWorkstation,
  BufferStation,
  QCStation,
  PackingStation,
  AssemblyStation,
  DisassemblyStation,
  TransportStation,
  MaterialInputStation,
  OutputStation,
  CustomStation,
  Line,
  Site,
} from "./types";

export type {
  SiteId,
  LineId,
  StationId,
  EdgeId,
  ResourceId,
  MaterialId,
  RecipeId,
  ScheduleId,
  ScenarioId,
  RunId,
  WorkspaceId,
} from "./ids";

export {
  newSiteId,
  newLineId,
  newStationId,
  newEdgeId,
  newResourceId,
  newMaterialId,
  newRecipeId,
  newScheduleId,
  newScenarioId,
  newRunId,
  newWorkspaceId,
  asSiteId,
  asLineId,
  asStationId,
  asEdgeId,
  asResourceId,
  asMaterialId,
  asRecipeId,
  asScheduleId,
  asScenarioId,
  asRunId,
  asWorkspaceId,
} from "./ids";

export type { Distribution } from "./distribution";
export { constant } from "./distribution";

// Zod schemas — runtime validation at every external boundary (cloud, LLM tool calls, scenario imports).
export {
  SiteIdSchema,
  LineIdSchema,
  StationIdSchema,
  EdgeIdSchema,
  ResourceIdSchema,
  MaterialIdSchema,
  ScheduleIdSchema,
  ScenarioIdSchema,
  WorkspaceIdSchema,
  CustomParamValueSchema,
  CustomParamsSchema,
  DistributionSchema,
  MaterialReplenishmentSchema,
  MaterialSchema,
  ResourceSchema,
  EdgeSchema,
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
  StationSchema,
  LineSchema,
  SiteSchema,
} from "./schemas";

// User-facing error formatting for Zod issues.
export type { FormattedIssue } from "./errors";
export { formatZodError, formatZodErrorString } from "./errors";
