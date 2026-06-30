/**
 * VROL-397 / VROL-1123-1124 — NL → Scenario flow tests.
 * Drives the mock adapter through happy + retry paths.
 */
import { describe, expect, it } from "vitest";

import { always, createMockChatAdapter } from "./mock-adapter";
import { scenarioGenerationSchema, type GeneratedScenario } from "./scenario-schema";
import { SCENARIO_TOOL_NAME, formatZodErrorForLlm, generateScenarioFromNl } from "./scenario-tool";
import type { ChatToolCall } from "./types";

/** Convenience: build a tool-call carrying a JSON-encoded scenario. */
function toolCallFor(scenario: unknown, id = "tc1"): ChatToolCall {
  return { id, name: SCENARIO_TOOL_NAME, arguments: JSON.stringify(scenario) };
}

const VALID_LINEAR: GeneratedScenario = {
  stations: [
    { id: "feeder", label: "Feeder", cycleMs: 100 },
    { id: "press", label: "Press", cycleMs: 250 },
    { id: "pack", label: "Pack", cycleMs: 80 },
  ],
  edges: [
    { source: "feeder", target: "press" },
    { source: "press", target: "pack" },
  ],
  settings: {
    horizonMs: 60_000,
    warmupMs: 5_000,
    replications: 1,
    interStationBufferCapacity: 10,
  },
};

describe("generateScenarioFromNl — happy path (VROL-1123)", () => {
  it("returns ok=true on the first attempt with a valid linear scenario", async () => {
    const adapter = createMockChatAdapter([
      { when: always(), toolCalls: [toolCallFor(VALID_LINEAR)] },
    ]);
    const result = await generateScenarioFromNl(adapter, "Build a 3-station line.");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(1);
      expect(result.scenario.stations).toHaveLength(3);
      expect(result.scenario.edges).toHaveLength(2);
    }
  });

  it("accepts a branching topology (diamond)", async () => {
    const branching: GeneratedScenario = {
      stations: [
        { id: "src", label: "Src", cycleMs: 50 },
        { id: "a", label: "A", cycleMs: 100 },
        { id: "b", label: "B", cycleMs: 100 },
        { id: "sink", label: "Sink", cycleMs: 50 },
      ],
      edges: [
        { source: "src", target: "a" },
        { source: "src", target: "b" },
        { source: "a", target: "sink" },
        { source: "b", target: "sink" },
      ],
      settings: {
        horizonMs: 60_000,
        warmupMs: 0,
        replications: 1,
        interStationBufferCapacity: 10,
      },
    };
    const adapter = createMockChatAdapter([
      { when: always(), toolCalls: [toolCallFor(branching)] },
    ]);
    const result = await generateScenarioFromNl(adapter, "Two parallel branches.");
    expect(result.ok).toBe(true);
  });

  it("accepts a scenario with products + per-edge buffer overrides", async () => {
    const richScenario: GeneratedScenario = {
      stations: [
        { id: "feeder", label: "Feeder", cycleMs: 100, capacity: 2 },
        {
          id: "filler",
          label: "Filler",
          cycleMs: 250,
          defectRate: 0.02,
          energyPerCycleJ: 500,
        },
        { id: "pack", label: "Pack", cycleMs: 80 },
      ],
      edges: [
        { source: "feeder", target: "filler" },
        { source: "filler", target: "pack", bufferCapacity: 5 },
      ],
      products: [
        { id: "a", name: "Product A", weight: 60 },
        { id: "b", name: "Product B", weight: 40 },
      ],
      settings: {
        horizonMs: 60_000,
        warmupMs: 5_000,
        replications: 3,
        interStationBufferCapacity: 10,
      },
    };
    const adapter = createMockChatAdapter([
      { when: always(), toolCalls: [toolCallFor(richScenario)] },
    ]);
    const result = await generateScenarioFromNl(adapter, "Two-product line.");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.products).toHaveLength(2);
      expect(result.scenario.edges[1]?.bufferCapacity).toBe(5);
    }
  });

  it("propagates the model + temperature options to the adapter", async () => {
    const adapter = createMockChatAdapter([
      { when: always(), toolCalls: [toolCallFor(VALID_LINEAR)] },
    ]);
    await generateScenarioFromNl(adapter, "Anything.", {
      model: "gpt-4o-mini",
      temperature: 0.2,
    });
    expect(adapter.calls[0]?.options.model).toBe("gpt-4o-mini");
    expect(adapter.calls[0]?.options.temperature).toBe(0.2);
  });

  it("forces the emit_scenario tool choice", async () => {
    const adapter = createMockChatAdapter([
      { when: always(), toolCalls: [toolCallFor(VALID_LINEAR)] },
    ]);
    await generateScenarioFromNl(adapter, "Anything.");
    const choice = adapter.calls[0]?.options.toolChoice;
    expect(choice).toEqual({ name: SCENARIO_TOOL_NAME });
  });
});

describe("generateScenarioFromNl — retry path (VROL-1124)", () => {
  it("retries when JSON parse fails on the first attempt, then succeeds", async () => {
    // First call returns invalid JSON in the tool-call arguments;
    // second call returns valid scenario JSON.
    const adapter = createMockChatAdapter([
      {
        when: (msgs) => msgs.length === 1,
        toolCalls: [{ id: "c1", name: SCENARIO_TOOL_NAME, arguments: "{ not valid json" }],
      },
      { when: always(), toolCalls: [toolCallFor(VALID_LINEAR, "c2")] },
    ]);
    const result = await generateScenarioFromNl(adapter, "build a line", { maxRetries: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(2);
    }
  });

  it("retries when Zod validation fails, then succeeds", async () => {
    const invalidScenario = {
      stations: [{ id: "a", label: "A", cycleMs: 100 }], // only 1 station — schema requires ≥ 2
      edges: [{ source: "a", target: "a" }],
      settings: {
        horizonMs: 60_000,
        warmupMs: 0,
        replications: 1,
        interStationBufferCapacity: 10,
      },
    };
    const adapter = createMockChatAdapter([
      {
        when: (msgs) => msgs.length === 1,
        toolCalls: [toolCallFor(invalidScenario, "c1")],
      },
      {
        when: always(),
        toolCalls: [toolCallFor(VALID_LINEAR, "c2")],
      },
    ]);
    const result = await generateScenarioFromNl(adapter, "two stations", { maxRetries: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(2);
    }
    // The retry turn includes the formatted error as a tool-role
    // message. Confirm the SECOND adapter call has the feedback in
    // its conversation.
    const secondCallMessages = adapter.calls[1]?.messages ?? [];
    const feedback = secondCallMessages.find((m) => m.role === "tool");
    expect(feedback).toBeDefined();
    expect(feedback?.content).toContain("stations");
  });

  it("retries when an edge references an unknown station, then succeeds", async () => {
    const badEdge: GeneratedScenario = {
      ...VALID_LINEAR,
      edges: [
        { source: "feeder", target: "press" },
        { source: "press", target: "ghost" }, // unknown
      ],
    } as GeneratedScenario;
    const adapter = createMockChatAdapter([
      {
        when: (msgs) => msgs.length === 1,
        toolCalls: [toolCallFor(badEdge, "c1")],
      },
      { when: always(), toolCalls: [toolCallFor(VALID_LINEAR, "c2")] },
    ]);
    const result = await generateScenarioFromNl(adapter, "linear", { maxRetries: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(2);
    }
  });

  it("returns ok=false / kind=max-retries when every attempt fails Zod", async () => {
    const adapter = createMockChatAdapter([
      {
        when: always(),
        toolCalls: [
          toolCallFor({
            stations: [{ id: "a", label: "A", cycleMs: 0 }], // cycleMs = 0 fails minimum
            edges: [],
            settings: {
              horizonMs: 60_000,
              warmupMs: 0,
              replications: 1,
              interStationBufferCapacity: 10,
            },
          }),
        ],
      },
    ]);
    const result = await generateScenarioFromNl(adapter, "broken", { maxRetries: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("max-retries");
      expect(result.attempts).toBe(2);
      expect(result.lastError).toContain("emit_scenario");
    }
  });

  it("returns ok=false / kind=no-tool-call when the model replies in prose", async () => {
    // Default mock returns empty tool_calls. The flow detects this
    // and stops immediately rather than retrying.
    const adapter = createMockChatAdapter();
    const result = await generateScenarioFromNl(adapter, "broken", { maxRetries: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("no-tool-call");
      expect(result.attempts).toBe(1);
    }
  });
});

describe("formatZodErrorForLlm", () => {
  it("includes the path + message of each issue + the emit_scenario hint", () => {
    // Empty object trips every "required" issue.
    const parse = scenarioGenerationSchema.safeParse({});
    expect(parse.success).toBe(false);
    if (!parse.success) {
      const formatted = formatZodErrorForLlm(parse.error);
      expect(formatted).toContain("emit_scenario");
      expect(formatted).toMatch(/stations|edges|settings/);
    }
  });
});
