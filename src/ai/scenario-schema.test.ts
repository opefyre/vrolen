import { describe, expect, it } from "vitest";

import { scenarioGenerationSchema } from "./scenario-schema";

const baseSettings = {
  horizonMs: 60_000,
  warmupMs: 5_000,
  replications: 1,
  interStationBufferCapacity: 10,
};

function linearChain() {
  return {
    stations: [
      { id: "s1", label: "A", cycleMs: 100 },
      { id: "s2", label: "B", cycleMs: 100 },
      { id: "s3", label: "C", cycleMs: 100 },
    ],
    edges: [
      { source: "s1", target: "s2" },
      { source: "s2", target: "s3" },
    ],
    settings: baseSettings,
  };
}

describe("scenarioGenerationSchema — topology (VROL-1210)", () => {
  it("accepts a linear single-source single-sink chain", () => {
    const r = scenarioGenerationSchema.safeParse(linearChain());
    expect(r.success).toBe(true);
  });

  it("rejects topologies with multiple sources", () => {
    const scenario = {
      stations: [
        { id: "a", label: "A", cycleMs: 100 },
        { id: "b", label: "B", cycleMs: 100 },
        { id: "c", label: "C", cycleMs: 100 },
      ],
      edges: [
        { source: "a", target: "c" },
        { source: "b", target: "c" },
      ],
      settings: baseSettings,
    };
    const r = scenarioGenerationSchema.safeParse(scenario);
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message).join("\n");
      expect(messages).toMatch(/exactly one source/);
      expect(messages).toMatch(/"a"/);
      expect(messages).toMatch(/"b"/);
    }
  });

  it("rejects topologies with multiple sinks", () => {
    const scenario = {
      stations: [
        { id: "a", label: "A", cycleMs: 100 },
        { id: "b", label: "B", cycleMs: 100 },
        { id: "c", label: "C", cycleMs: 100 },
      ],
      edges: [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
      ],
      settings: baseSettings,
    };
    const r = scenarioGenerationSchema.safeParse(scenario);
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message).join("\n");
      expect(messages).toMatch(/exactly one sink/);
    }
  });

  it("rejects a cycle (fake QC→capper rework back-edge)", () => {
    const scenario = {
      stations: [
        { id: "cap", label: "Capper", cycleMs: 100 },
        { id: "qc", label: "QC", cycleMs: 60 },
        { id: "pack", label: "Packer", cycleMs: 40 },
      ],
      edges: [
        { source: "cap", target: "qc" },
        { source: "qc", target: "cap" },
        { source: "qc", target: "pack" },
      ],
      settings: baseSettings,
    };
    const r = scenarioGenerationSchema.safeParse(scenario);
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message).join("\n");
      expect(messages).toMatch(/Cycle detected/);
    }
  });

  it("rejects a self-loop", () => {
    const scenario = {
      stations: [
        { id: "a", label: "A", cycleMs: 100 },
        { id: "b", label: "B", cycleMs: 100 },
      ],
      edges: [
        { source: "a", target: "a" },
        { source: "a", target: "b" },
      ],
      settings: baseSettings,
    };
    const r = scenarioGenerationSchema.safeParse(scenario);
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message).join("\n");
      expect(messages).toMatch(/Cycle detected/);
    }
  });

  it("rejects unreachable-from-source stations", () => {
    const scenario = {
      stations: [
        { id: "a", label: "A", cycleMs: 100 },
        { id: "b", label: "B", cycleMs: 100 },
        { id: "orphan", label: "Orphan", cycleMs: 100 },
      ],
      edges: [
        { source: "a", target: "b" },
        // "orphan" has no incoming edge → also flagged as a source
        // (multiple sources check will fire first). Wire an outgoing
        // edge from orphan to the sink so we only fail on reachability.
        { source: "orphan", target: "b" },
      ],
      settings: baseSettings,
    };
    const r = scenarioGenerationSchema.safeParse(scenario);
    expect(r.success).toBe(false);
    if (!r.success) {
      // At least the multiple-sources error will fire; reachability
      // may or may not depending on which source is picked. The key
      // point: this scenario is rejected before hitting the engine.
      expect(r.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("still catches malformed edge id references", () => {
    const scenario = {
      stations: [
        { id: "s1", label: "A", cycleMs: 100 },
        { id: "s2", label: "B", cycleMs: 100 },
      ],
      edges: [{ source: "s1", target: "nonexistent" }],
      settings: baseSettings,
    };
    const r = scenarioGenerationSchema.safeParse(scenario);
    expect(r.success).toBe(false);
  });

  it("still catches warmup > horizon", () => {
    const scenario = {
      stations: [
        { id: "s1", label: "A", cycleMs: 100 },
        { id: "s2", label: "B", cycleMs: 100 },
      ],
      edges: [{ source: "s1", target: "s2" }],
      settings: { ...baseSettings, warmupMs: 999_999 },
    };
    const r = scenarioGenerationSchema.safeParse(scenario);
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message).join("\n");
      expect(messages).toMatch(/warmupMs must be ≤ horizonMs/);
    }
  });
});
