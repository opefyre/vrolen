/**
 * VROL-1211 — clarification-tool flow tests. Drives the mock adapter
 * through: initial question emission, resume after user answers,
 * resume after user skips.
 */
import { describe, expect, it } from "vitest";

import { createMockChatAdapter } from "./mock-adapter";
import type { ChatMessage, ChatToolCall } from "./types";
import { type GeneratedScenario } from "./scenario-schema";
import {
  CLARIFICATION_TOOL_NAME,
  SCENARIO_TOOL_NAME,
  generateScenarioFromNl,
} from "./scenario-tool";

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

function scenarioToolCall(scenario: unknown, id = "tc-sc"): ChatToolCall {
  return { id, name: SCENARIO_TOOL_NAME, arguments: JSON.stringify(scenario) };
}
function clarifyToolCall(questions: unknown, id = "tc-cl"): ChatToolCall {
  return {
    id,
    name: CLARIFICATION_TOOL_NAME,
    arguments: JSON.stringify({ questions }),
  };
}

const SAMPLE_QUESTIONS = [
  {
    id: "cycle-time",
    question: "How long does one full cycle take at the bottleneck?",
    hint: "e.g. 2s per bottle",
  },
  {
    id: "horizon",
    question: "How long should we simulate the line?",
    hint: "e.g. 60 minutes",
    suggestedAnswer: "1 minute",
  },
];

describe("generateScenarioFromNl — clarification (VROL-1211)", () => {
  it("returns questions when the LLM picks ask_clarification on round 1", async () => {
    const adapter = createMockChatAdapter([
      { when: () => true, toolCalls: [clarifyToolCall(SAMPLE_QUESTIONS)] },
    ]);
    const result = await generateScenarioFromNl(adapter, "3 stations, that's all I know");
    expect(result.ok).toBe(true);
    if (result.ok && "needsClarification" in result && result.needsClarification) {
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0]?.id).toBe("cycle-time");
      // Conversation preserved so the caller can resume.
      expect(result.conversation.length).toBeGreaterThan(0);
    } else {
      throw new Error("expected needsClarification");
    }
  });

  it("resumes with user answers and emits a scenario on round 2", async () => {
    const initialConversation: ChatMessage[] = [
      { role: "user", content: "3 stations" },
      { role: "assistant", content: "", toolCalls: [clarifyToolCall(SAMPLE_QUESTIONS)] },
      {
        role: "tool",
        content: "Questions delivered to the user.",
        toolCallId: "tc-cl",
      },
    ];
    const adapter = createMockChatAdapter([
      // On the resumption call, the LLM sees the answers and emits.
      { when: () => true, toolCalls: [scenarioToolCall(VALID_LINEAR)] },
    ]);
    const result = await generateScenarioFromNl(adapter, "3 stations", {
      priorContext: {
        conversation: initialConversation,
        questions: SAMPLE_QUESTIONS,
        answers: [
          { id: "cycle-time", answer: "1.5 seconds" },
          { id: "horizon", answer: "10 minutes" },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok && "scenario" in result) {
      expect(result.scenario.stations).toHaveLength(3);
      // Verify the mock saw a user turn recapping the answers.
      const lastUserTurn = adapter.calls[0]?.messages.at(-1);
      expect(lastUserTurn?.role).toBe("user");
      expect(lastUserTurn?.content).toMatch(/1\.5 seconds/);
      expect(lastUserTurn?.content).toMatch(/10 minutes/);
    } else {
      throw new Error("expected scenario");
    }
  });

  it("resumes with skip flag and emits a scenario using defaults", async () => {
    const adapter = createMockChatAdapter([
      { when: () => true, toolCalls: [scenarioToolCall(VALID_LINEAR)] },
    ]);
    const result = await generateScenarioFromNl(adapter, "3 stations", {
      priorContext: {
        conversation: [
          { role: "user", content: "3 stations" },
          { role: "assistant", content: "", toolCalls: [clarifyToolCall(SAMPLE_QUESTIONS)] },
        ],
        questions: SAMPLE_QUESTIONS,
      },
      skipClarification: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok && "scenario" in result) {
      const lastUserTurn = adapter.calls[0]?.messages.at(-1);
      expect(lastUserTurn?.content).toMatch(/rather not answer/i);
    } else {
      throw new Error("expected scenario");
    }
  });

  it("second-round tool set forces emit_scenario (ask_clarification unavailable)", async () => {
    const adapter = createMockChatAdapter([
      { when: () => true, toolCalls: [scenarioToolCall(VALID_LINEAR)] },
    ]);
    await generateScenarioFromNl(adapter, "3 stations", {
      priorContext: {
        conversation: [{ role: "user", content: "3 stations" }],
        questions: SAMPLE_QUESTIONS,
      },
      skipClarification: true,
    });
    const options = adapter.calls[0]?.options;
    const toolNames = (options?.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain(SCENARIO_TOOL_NAME);
    expect(toolNames).not.toContain(CLARIFICATION_TOOL_NAME);
    expect(options?.toolChoice).toEqual({ name: SCENARIO_TOOL_NAME });
  });

  it("first-round exposes BOTH tools with auto choice", async () => {
    const adapter = createMockChatAdapter([
      { when: () => true, toolCalls: [scenarioToolCall(VALID_LINEAR)] },
    ]);
    await generateScenarioFromNl(adapter, "detailed prompt with cycle times");
    const options = adapter.calls[0]?.options;
    const toolNames = (options?.tools ?? []).map((t) => t.name).sort();
    expect(toolNames).toEqual([CLARIFICATION_TOOL_NAME, SCENARIO_TOOL_NAME].sort());
    expect(options?.toolChoice).toBe("auto");
  });
});
