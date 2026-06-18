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
