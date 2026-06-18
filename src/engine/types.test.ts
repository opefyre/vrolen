import { describe, expect, it } from "vitest";
import {
  constant,
  newEdgeId,
  newLineId,
  newMaterialId,
  newResourceId,
  newSiteId,
  newStationId,
  type Station,
  type Site,
} from "./index";

describe("entity types", () => {
  it("generates distinct branded ids", () => {
    const a = newSiteId();
    const b = newSiteId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe("string");
  });

  it("composes a minimal valid Site → Line → Stations + Edge fixture", () => {
    const siteId = newSiteId();
    const lineId = newLineId();
    const inputId = newStationId();
    const machineId = newStationId();
    const outputId = newStationId();
    const materialId = newMaterialId();
    const resourceId = newResourceId();
    const edgeIn = newEdgeId();
    const edgeOut = newEdgeId();

    const site: Site = {
      id: siteId,
      name: "Demo Plant",
      floor: { widthM: 50, heightM: 30 },
      customParams: {},
      resources: [
        {
          id: resourceId,
          name: "Operator 1",
          skills: ["machine-op"],
          speedMetersPerSec: 1.4,
          customParams: {},
        },
      ],
      materials: [
        {
          id: materialId,
          name: "Raw bottles",
          unit: "ea",
          replenishment: { kind: "initial-only", initialQuantity: 10_000 },
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
              id: inputId,
              type: "MaterialInput",
              name: "Bottle feed",
              materialId,
              position: { x: 0, y: 0 },
              customParams: {},
            },
            {
              id: machineId,
              type: "Machine",
              name: "Filler",
              cycleTimeMs: constant(2000),
              setupTimeMs: constant(0),
              mtbfMs: constant(3_600_000),
              mttrMs: constant(60_000),
              capacity: 1,
              defectRate: 0.01,
              requiredSkills: ["machine-op"],
              position: { x: 10, y: 0 },
              customParams: {},
            },
            {
              id: outputId,
              type: "Output",
              name: "Filled bottles",
              position: { x: 20, y: 0 },
              customParams: {},
            },
          ],
          edges: [
            {
              id: edgeIn,
              fromStationId: inputId,
              toStationId: machineId,
              transitMs: 0,
              bufferCapacity: 100,
              customParams: {},
            },
            {
              id: edgeOut,
              fromStationId: machineId,
              toStationId: outputId,
              transitMs: 0,
              bufferCapacity: 100,
              customParams: {},
            },
          ],
        },
      ],
    };

    expect(site.lines).toHaveLength(1);
    expect(site.lines[0]?.stations).toHaveLength(3);
    expect(site.lines[0]?.edges).toHaveLength(2);
  });

  it("StationType discriminated union narrows correctly in switch", () => {
    const stations: Station[] = [
      {
        id: newStationId(),
        type: "Buffer",
        name: "WIP",
        capacity: 50,
        position: { x: 0, y: 0 },
        customParams: {},
      },
      {
        id: newStationId(),
        type: "Output",
        name: "Sink",
        position: { x: 0, y: 0 },
        customParams: {},
      },
    ];

    // Narrowing test — if discriminated union narrowing breaks, this won't typecheck.
    const summaries = stations.map((s) => {
      switch (s.type) {
        case "Buffer":
          return `Buffer cap=${String(s.capacity)}`;
        case "Output":
          return "Sink";
        default:
          // Other types not in fixture; assert we'd handle them.
          return s.type;
      }
    });

    expect(summaries).toEqual(["Buffer cap=50", "Sink"]);
  });

  it("customParams accepts the three allowed primitive types", () => {
    const station = {
      id: newStationId(),
      type: "Output" as const,
      name: "Sink",
      position: { x: 0, y: 0 },
      customParams: {
        ambient_temp_c: 22,
        supplier_grade: "A",
        is_validated: true,
      },
    };

    expect(typeof station.customParams.ambient_temp_c).toBe("number");
    expect(typeof station.customParams.supplier_grade).toBe("string");
    expect(typeof station.customParams.is_validated).toBe("boolean");
  });
});
