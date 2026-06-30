/**
 * VROL-397 / VROL-1120-1122 — NL → Scenario JSON flow.
 *
 * Wires the Zod schema (scenario-schema.ts) and the system prompt
 * (scenario-prompt.ts) into a single function the host calls to
 * convert a user's NL description into a validated scenario. Loops
 * up to `maxRetries` times: on each Zod failure, the validation
 * error is reformatted as feedback and sent back to the model as a
 * follow-up turn.
 *
 * Designed to work with ANY ChatAdapter — pass the MockChatAdapter
 * for tests, plug in the live OpenAI/Gemini adapter (VROL-382/386)
 * when keys arrive.
 */

import { z } from "zod";

import type { ChatAdapter, ChatMessage, ChatTool, ChatToolCall } from "./types";
import { scenarioGenerationSchema, type GeneratedScenario } from "./scenario-schema";
import { scenarioGenerationSystemPrompt } from "./scenario-prompt";

export const SCENARIO_TOOL_NAME = "emit_scenario";

/**
 * Tool definition the LLM sees. Schema mirrors scenarioGenerationSchema
 * but expressed as JSON Schema (what the OpenAI tool-call API
 * expects). We could synthesize this from the Zod schema via a
 * runtime converter, but writing it out keeps the prompt + tool
 * definition stable + reviewable.
 */
export function createScenarioTool(): ChatTool {
  return {
    name: SCENARIO_TOOL_NAME,
    description:
      "Emit a Vrolen scenario derived from the user's natural-language description. Always call this tool — never reply in prose. The host validates the output via Zod and reports any errors back for a retry.",
    parameters: {
      type: "object",
      required: ["stations", "edges", "settings"],
      properties: {
        stations: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            required: ["id", "label", "cycleMs"],
            properties: {
              id: { type: "string", description: "kebab-case slug, unique" },
              label: { type: "string", description: "human-readable name" },
              cycleMs: {
                type: "integer",
                minimum: 1,
                maximum: 86_400_000,
                description: "per-part processing time in ms",
              },
              capacity: { type: "integer", minimum: 1, maximum: 100 },
              defectRate: { type: "number", minimum: 0, maximum: 1 },
              energyPerCycleJ: { type: "number", minimum: 0 },
            },
          },
        },
        edges: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["source", "target"],
            properties: {
              source: { type: "string" },
              target: { type: "string" },
              bufferCapacity: { type: "integer", minimum: 1, maximum: 10_000 },
            },
          },
        },
        products: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "name", "weight"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              weight: { type: "number", minimum: 0 },
            },
          },
        },
        settings: {
          type: "object",
          required: ["horizonMs", "warmupMs", "replications", "interStationBufferCapacity"],
          properties: {
            horizonMs: { type: "integer", minimum: 1_000, maximum: 604_800_000 },
            warmupMs: { type: "integer", minimum: 0 },
            replications: { type: "integer", minimum: 1, maximum: 50 },
            interStationBufferCapacity: { type: "integer", minimum: 1, maximum: 10_000 },
          },
        },
      },
    },
  };
}

/**
 * VROL-1122 — format a Zod ZodError into a structured feedback
 * message the LLM can act on. Lists `path: message` per issue so the
 * model can fix the SPECIFIC field, not just retry blindly.
 */
export function formatZodErrorForLlm(error: z.ZodError): string {
  const lines: string[] = [
    "Your previous emit_scenario call failed validation. Fix the following issues and call emit_scenario again:",
    "",
  ];
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    lines.push(`- ${path}: ${issue.message}`);
  }
  return lines.join("\n");
}

/**
 * Discriminated-union return so the host can handle success +
 * failure modes without try/catch.
 */
export type ScenarioGenerationResult =
  | { readonly ok: true; readonly scenario: GeneratedScenario; readonly attempts: number }
  | {
      readonly ok: false;
      readonly kind: "max-retries" | "no-tool-call" | "invalid-json";
      readonly attempts: number;
      readonly lastError: string;
    };

interface GenerateOptions {
  readonly maxRetries?: number;
  readonly model?: string;
  readonly temperature?: number;
}

/**
 * VROL-1121 — main entry point. Calls adapter.chat() up to maxRetries
 * times; on each Zod failure, feeds the error back as a follow-up
 * user turn. Returns ok=true on success or a structured failure.
 */
export async function generateScenarioFromNl(
  adapter: ChatAdapter,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<ScenarioGenerationResult> {
  const maxRetries = Math.max(1, Math.floor(opts.maxRetries ?? 3));
  const model = opts.model ?? "gemini-flash";
  const tool = createScenarioTool();
  const conversation: ChatMessage[] = [{ role: "user", content: prompt }];
  let lastError = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await adapter.chat(conversation, {
      model,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      tools: [tool],
      toolChoice: { name: SCENARIO_TOOL_NAME },
      systemPrompt: scenarioGenerationSystemPrompt(),
    });
    const toolCall = response.toolCalls.find((tc) => tc.name === SCENARIO_TOOL_NAME);
    if (!toolCall) {
      // Model didn't call the tool; record + return immediately.
      return {
        ok: false,
        kind: "no-tool-call",
        attempts: attempt,
        lastError: "The model replied in prose instead of calling emit_scenario.",
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(toolCall.arguments);
    } catch (e) {
      // Invalid JSON in the tool-call arguments — log + retry with feedback.
      const message = e instanceof Error ? e.message : String(e);
      lastError = `Tool-call arguments were not valid JSON: ${message}.`;
      if (attempt === maxRetries) {
        return { ok: false, kind: "invalid-json", attempts: attempt, lastError };
      }
      appendRetryTurn(conversation, response.toolCalls, toolCall, lastError);
      continue;
    }
    const result = scenarioGenerationSchema.safeParse(parsed);
    if (result.success) {
      return { ok: true, scenario: result.data, attempts: attempt };
    }
    lastError = formatZodErrorForLlm(result.error);
    if (attempt === maxRetries) {
      return { ok: false, kind: "max-retries", attempts: attempt, lastError };
    }
    appendRetryTurn(conversation, response.toolCalls, toolCall, lastError);
  }
  // Loop exit shouldn't be reachable (each branch returns); satisfy
  // the type checker.
  return {
    ok: false,
    kind: "max-retries",
    attempts: maxRetries,
    lastError: lastError || "unknown",
  };
}

function appendRetryTurn(
  conversation: ChatMessage[],
  allToolCalls: readonly ChatToolCall[],
  failedToolCall: ChatToolCall,
  feedback: string,
): void {
  // Preserve the assistant's tool-call turn + a tool-role response
  // with the error feedback, mirroring how OpenAI's chat loop wants
  // tool responses paired to their calls.
  conversation.push({ role: "assistant", content: "", toolCalls: allToolCalls });
  conversation.push({
    role: "tool",
    content: feedback,
    toolCallId: failedToolCall.id,
  });
}
