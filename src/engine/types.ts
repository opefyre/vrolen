/**
 * Core entity types for the Vrolen simulation engine.
 *
 * This file is the structural backbone:
 *   - A `Site` contains `Line`s, plus shared `Resource` (worker) pools and
 *     `Material` inputs that any line can consume.
 *   - A `Line` is a graph of `Station`s connected by `Edge`s.
 *   - `Station` is a discriminated union over `StationType`; each subtype
 *     has its own parameter shape (a Buffer doesn't have a cycle time, an
 *     Output doesn't have downstream).
 *
 * Universal conventions on every entity:
 *   - `id`: branded ULID-shaped string, generated via crypto.randomUUID()
 *     (see ids.ts). Branding catches mix-ups at compile time.
 *   - `name`: human-readable, freely renamable by the user. The user-facing
 *     vocabulary lives here, not in the type identifier.
 *   - `customParams`: a `Record<string, primitive>` where users can attach
 *     arbitrary annotations the engine ignores but the UI + AI can ingest.
 *
 * Everything is `readonly`-friendly. Mutations happen at the editor layer;
 * the engine consumes immutable snapshots.
 */

import type { EdgeId, LineId, MaterialId, ResourceId, SiteId, StationId } from "./ids";
import type { Distribution } from "./distribution";

// ============ Customization primitives ============

/** Values allowed in customParams. Keep narrow — no nested objects (use a top-level field if you need structure). */
export type CustomParamValue = number | string | boolean;

export type CustomParams = Readonly<Record<string, CustomParamValue>>;

// ============ Materials ============

/** Replenishment placeholder — formal schema lands in VROL-79 (E03-S5, Schedule). */
export type MaterialReplenishment =
  | { readonly kind: "none" }
  | { readonly kind: "initial-only"; readonly initialQuantity: number }
  | {
      readonly kind: "periodic";
      readonly initialQuantity: number;
      readonly batchSize: number;
      readonly intervalMs: number;
    };

export interface Material {
  readonly id: MaterialId;
  readonly name: string;
  /** Unit of measure — bottles, kg, liters, "ea", whatever the user types. Free-form. */
  readonly unit: string;
  readonly replenishment: MaterialReplenishment;
  readonly customParams: CustomParams;
}

// ============ Resources (workers, tools) ============

export interface Resource {
  readonly id: ResourceId;
  readonly name: string;
  /** Free-form skill tags. Stations declare required skills; engine matches by exact tag string. */
  readonly skills: readonly string[];
  /** Walking speed in meters per second; only used when spatial layer is active (VROL-163+). */
  readonly speedMetersPerSec: number;
  readonly customParams: CustomParams;
}

// ============ Edges ============

export interface Edge {
  readonly id: EdgeId;
  readonly fromStationId: StationId;
  /** Optional output port label — used by stations with multiple outputs (Disassembly, QC pass/fail). */
  readonly fromPort?: string;
  readonly toStationId: StationId;
  /** Optional input port label — used by Assembly stations that combine inputs. */
  readonly toPort?: string;
  /** In-transit time on this edge, in simulated milliseconds. Zero for instantaneous links. */
  readonly transitMs: number;
  /** Capacity of the in-transit buffer on this edge. */
  readonly bufferCapacity: number;
  readonly customParams: CustomParams;
}

// ============ Stations — discriminated union ============

export type StationType =
  | "Machine"
  | "ManualWorkstation"
  | "Buffer"
  | "QC"
  | "Packing"
  | "Assembly"
  | "Disassembly"
  | "Transport"
  | "MaterialInput"
  | "Output"
  | "Custom";

interface StationBase {
  readonly id: StationId;
  readonly name: string;
  readonly customParams: CustomParams;
  /** Worldspace position in meters; used by renderer + agent overlay. */
  readonly position: { readonly x: number; readonly y: number };
}

export interface MachineStation extends StationBase {
  readonly type: "Machine";
  readonly cycleTimeMs: Distribution;
  readonly capacity: number;
  readonly defectRate: number;
  readonly setupTimeMs: Distribution;
  readonly mtbfMs: Distribution;
  readonly mttrMs: Distribution;
  readonly requiredSkills: readonly string[];
}

export interface ManualWorkstation extends StationBase {
  readonly type: "ManualWorkstation";
  readonly cycleTimeMs: Distribution;
  readonly capacity: number;
  readonly defectRate: number;
  readonly requiredSkills: readonly string[];
}

export interface BufferStation extends StationBase {
  readonly type: "Buffer";
  readonly capacity: number;
}

export interface QCStation extends StationBase {
  readonly type: "QC";
  readonly cycleTimeMs: Distribution;
  readonly capacity: number;
  /** Probability of passing. Failures route to `failPort` (e.g., "rework" or "scrap"). */
  readonly passRate: number;
  /** Port name used by edges to route failures (defaults to "fail" if undefined). */
  readonly failPort?: string;
  readonly requiredSkills: readonly string[];
}

export interface PackingStation extends StationBase {
  readonly type: "Packing";
  readonly cycleTimeMs: Distribution;
  readonly capacity: number;
  readonly defectRate: number;
  readonly requiredSkills: readonly string[];
}

export interface AssemblyStation extends StationBase {
  readonly type: "Assembly";
  readonly cycleTimeMs: Distribution;
  readonly capacity: number;
  readonly defectRate: number;
  /** Input port names that must each receive a part before assembly fires. */
  readonly inputPorts: readonly string[];
  readonly requiredSkills: readonly string[];
}

export interface DisassemblyStation extends StationBase {
  readonly type: "Disassembly";
  readonly cycleTimeMs: Distribution;
  readonly capacity: number;
  /** Output port names that each receive a piece per disassembly cycle. */
  readonly outputPorts: readonly string[];
  readonly requiredSkills: readonly string[];
}

export interface TransportStation extends StationBase {
  readonly type: "Transport";
  /** Length of the conveyor in meters. */
  readonly lengthM: number;
  /** Speed in meters per second. transitMs is computed as lengthM / speedMps * 1000. */
  readonly speedMps: number;
  readonly capacity: number;
}

export interface MaterialInputStation extends StationBase {
  readonly type: "MaterialInput";
  readonly materialId: MaterialId;
}

export interface OutputStation extends StationBase {
  readonly type: "Output";
}

export interface CustomStation extends StationBase {
  readonly type: "Custom";
  /** User-defined label describing the station's intent. AI gets this verbatim and is told it is user-defined. */
  readonly behaviorLabel: string;
  readonly cycleTimeMs: Distribution;
  readonly capacity: number;
  readonly requiredSkills: readonly string[];
  readonly inputPorts: readonly string[];
  readonly outputPorts: readonly string[];
}

export type Station =
  | MachineStation
  | ManualWorkstation
  | BufferStation
  | QCStation
  | PackingStation
  | AssemblyStation
  | DisassemblyStation
  | TransportStation
  | MaterialInputStation
  | OutputStation
  | CustomStation;

// ============ Line and Site ============

export interface Line {
  readonly id: LineId;
  readonly siteId: SiteId;
  readonly name: string;
  readonly stations: readonly Station[];
  readonly edges: readonly Edge[];
  readonly customParams: CustomParams;
}

export interface Site {
  readonly id: SiteId;
  readonly name: string;
  readonly lines: readonly Line[];
  /** Workers + tools shared across the site. Stations declare required skills; the engine resolves to specific resources at runtime. */
  readonly resources: readonly Resource[];
  /** Materials consumed by stations on any line. */
  readonly materials: readonly Material[];
  /** Floor extent in meters; used by the renderer. */
  readonly floor: { readonly widthM: number; readonly heightM: number };
  readonly customParams: CustomParams;
}
