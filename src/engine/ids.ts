/**
 * Branded ID types and generators for the simulation engine.
 *
 * A branded string is just a string at runtime, but the type system treats
 * `SiteId` and `StationId` as distinct, so you can't accidentally pass a
 * station id where a site id is expected. This catches whole classes of bugs
 * at compile time without any runtime overhead.
 */

// Generic brand utility — never instantiated, only used in the type system.
type Brand<T, B extends string> = T & { readonly __brand: B };

export type SiteId = Brand<string, "SiteId">;
export type LineId = Brand<string, "LineId">;
export type StationId = Brand<string, "StationId">;
export type EdgeId = Brand<string, "EdgeId">;
export type ResourceId = Brand<string, "ResourceId">;
export type MaterialId = Brand<string, "MaterialId">;
export type RecipeId = Brand<string, "RecipeId">;
export type ScheduleId = Brand<string, "ScheduleId">;
export type ScenarioId = Brand<string, "ScenarioId">;
export type RunId = Brand<string, "RunId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;

/** Use crypto.randomUUID() — browser/Node 19+ have it; deterministic in tests via seeded PRNG (VROL-98). */
function generate(): string {
  return crypto.randomUUID();
}

export const newSiteId = (): SiteId => generate() as SiteId;
export const newLineId = (): LineId => generate() as LineId;
export const newStationId = (): StationId => generate() as StationId;
export const newEdgeId = (): EdgeId => generate() as EdgeId;
export const newResourceId = (): ResourceId => generate() as ResourceId;
export const newMaterialId = (): MaterialId => generate() as MaterialId;
export const newRecipeId = (): RecipeId => generate() as RecipeId;
export const newScheduleId = (): ScheduleId => generate() as ScheduleId;
export const newScenarioId = (): ScenarioId => generate() as ScenarioId;
export const newRunId = (): RunId => generate() as RunId;
export const newWorkspaceId = (): WorkspaceId => generate() as WorkspaceId;

/** Coerce a known-valid string to a branded id (use at deserialization boundaries). */
export const asSiteId = (s: string): SiteId => s as SiteId;
export const asLineId = (s: string): LineId => s as LineId;
export const asStationId = (s: string): StationId => s as StationId;
export const asEdgeId = (s: string): EdgeId => s as EdgeId;
export const asResourceId = (s: string): ResourceId => s as ResourceId;
export const asMaterialId = (s: string): MaterialId => s as MaterialId;
export const asRecipeId = (s: string): RecipeId => s as RecipeId;
export const asScheduleId = (s: string): ScheduleId => s as ScheduleId;
export const asScenarioId = (s: string): ScenarioId => s as ScenarioId;
export const asRunId = (s: string): RunId => s as RunId;
export const asWorkspaceId = (s: string): WorkspaceId => s as WorkspaceId;
