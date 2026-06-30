import { describe, expect, it } from "vitest";

import { aiScenarioToGraph } from "./scenario-from-ai";
import type { GeneratedScenario } from "@/ai/scenario-schema";

const baseSettings: GeneratedScenario["settings"] = {
  horizonMs: 60_000,
  warmupMs: 5_000,
  replications: 3,
  interStationBufferCapacity: 10,
};

describe("aiScenarioToGraph (VROL-402)", () => {
  it("converts a linear chain into station nodes + edges", () => {
    const scenario: GeneratedScenario = {
      stations: [
        { id: "s1", label: "Mixer", cycleMs: 90_000 },
        { id: "s2", label: "Filler", cycleMs: 100, capacity: 2 },
        { id: "s3", label: "Packer", cycleMs: 60 },
      ],
      edges: [
        { source: "s1", target: "s2" },
        { source: "s2", target: "s3" },
      ],
      settings: baseSettings,
    };
    const out = aiScenarioToGraph(scenario);
    expect(out.nodes).toHaveLength(3);
    expect(out.edges).toHaveLength(2);
    expect(out.nodes[0]).toMatchObject({ id: "s1", type: "station" });
    const firstData = out.nodes[0]?.data as { label: string; stationType: string };
    expect(firstData.label).toBe("Mixer");
    expect(firstData.stationType).toBe("input");
    const fillerData = out.nodes[1]?.data as { capacity?: number };
    expect(fillerData.capacity).toBe(2);
    const lastData = out.nodes[2]?.data as { stationType: string };
    expect(lastData.stationType).toBe("output");
  });

  it("propagates settings from the AI scenario to the run settings", () => {
    const out = aiScenarioToGraph({
      stations: [
        { id: "s1", label: "A", cycleMs: 100 },
        { id: "s2", label: "B", cycleMs: 100 },
      ],
      edges: [{ source: "s1", target: "s2" }],
      settings: {
        horizonMs: 30_000,
        warmupMs: 2_000,
        replications: 5,
        interStationBufferCapacity: 4,
      },
    });
    expect(out.settings.horizonMs).toBe(30_000);
    expect(out.settings.warmupMs).toBe(2_000);
    expect(out.settings.replications).toBe(5);
    expect(out.settings.interStationBufferCapacity).toBe(4);
  });

  it("rows-out parallel branches so they don't visually overlap", () => {
    const out = aiScenarioToGraph({
      stations: [
        { id: "s1", label: "Source", cycleMs: 30 },
        { id: "s2", label: "Branch A", cycleMs: 100 },
        { id: "s3", label: "Branch B", cycleMs: 100 },
        { id: "s4", label: "Merge", cycleMs: 60 },
      ],
      edges: [
        { source: "s1", target: "s2" },
        { source: "s1", target: "s3" },
        { source: "s2", target: "s4" },
        { source: "s3", target: "s4" },
      ],
      settings: baseSettings,
    });
    const a = out.nodes.find((n) => n.id === "s2");
    const b = out.nodes.find((n) => n.id === "s3");
    expect(a?.position.y).not.toBe(b?.position.y);
  });

  it("carries per-edge buffer overrides onto edge.data", () => {
    const out = aiScenarioToGraph({
      stations: [
        { id: "s1", label: "A", cycleMs: 100 },
        { id: "s2", label: "B", cycleMs: 100 },
      ],
      edges: [{ source: "s1", target: "s2", bufferCapacity: 25 }],
      settings: baseSettings,
    });
    const edge = out.edges[0];
    expect((edge?.data as { bufferCapacity?: number }).bufferCapacity).toBe(25);
  });

  it("forwards defectRate + energyPerCycleJ onto station data", () => {
    const out = aiScenarioToGraph({
      stations: [
        { id: "s1", label: "A", cycleMs: 100 },
        { id: "s2", label: "Tester", cycleMs: 80, defectRate: 0.1, energyPerCycleJ: 2500 },
      ],
      edges: [{ source: "s1", target: "s2" }],
      settings: baseSettings,
    });
    const data = out.nodes[1]?.data as { defectRate: number; energyPerCycleJ: number };
    expect(data.defectRate).toBe(0.1);
    expect(data.energyPerCycleJ).toBe(2500);
  });
});
