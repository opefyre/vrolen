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
import {
  clarificationSchema,
  type Clarification,
  type ClarificationAnswer,
} from "./clarification-schema";

export const SCENARIO_TOOL_NAME = "emit_scenario";
export const CLARIFICATION_TOOL_NAME = "ask_clarification";

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
 * VROL-1211 — clarification tool. LLM picks this when critical info
 * for the scenario is missing from the user's prompt (cycle times,
 * capacity, defect rates, horizon). Host renders the questions as an
 * inline form; user answers or skips.
 */
export function createClarificationTool(): ChatTool {
  return {
    name: CLARIFICATION_TOOL_NAME,
    description:
      "Ask the user 1-5 concise clarifying questions when the description is missing information critical to modelling the line (per-station cycle times, capacity for parallel stations, defect rates, horizon). Prefer emit_scenario when you can make a defensible guess. NEVER ask more than one round of questions per prompt.",
    parameters: {
      type: "object",
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            required: ["id", "question"],
            properties: {
              id: { type: "string", description: "stable kebab-case slug" },
              question: { type: "string", description: "concise question" },
              hint: {
                type: "string",
                description: "optional example / hint, e.g. 'e.g. 2s per bottle'",
              },
              suggestedAnswer: {
                type: "string",
                description: "optional prefilled suggested answer",
              },
            },
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
 *
 * VROL-1211 — `needsClarification` is added: LLM decided the prompt
 * was under-specified and emitted questions instead of a scenario.
 * The host renders them; user can answer + re-call generateScenarioFromNl
 * with `priorContext` set, or click Continue anyway which flips the
 * `skipClarification` flag.
 */
export type ScenarioGenerationResult =
  | { readonly ok: true; readonly scenario: GeneratedScenario; readonly attempts: number }
  | {
      readonly ok: true;
      readonly needsClarification: true;
      readonly questions: Clarification["questions"];
      readonly attempts: number;
      /** Opaque; pass back verbatim via priorContext.conversation. */
      readonly conversation: readonly ChatMessage[];
    }
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
  /**
   * VROL-1211 — when the user answered a prior clarification round or
   * clicked Continue anyway, pass this so the LLM keeps the earlier
   * questions + answers in context. The host doesn't need to know
   * the internal turn shape; just forward what we return.
   */
  readonly priorContext?: PriorClarificationContext;
  /**
   * VROL-1211 — when true, the LLM is told the user declined to
   * answer clarifying questions; it must call emit_scenario with
   * best-effort defaults. Ignored when priorContext is absent.
   */
  readonly skipClarification?: boolean;
}

/**
 * VROL-1211 — opaque conversational context carried between rounds.
 * Contains the earlier assistant/tool turns so the LLM can see what
 * it asked and how the user answered.
 */
export interface PriorClarificationContext {
  readonly conversation: readonly ChatMessage[];
  readonly questions: Clarification["questions"];
  readonly answers?: readonly ClarificationAnswer[];
}

/**
 * VROL-1121 + VROL-1211 — main entry point.
 *
 * First round: LLM sees both `ask_clarification` and `emit_scenario`
 * tools and picks. If it emits questions, we return them and the host
 * shows a form. If it emits a scenario, we validate + return it.
 *
 * Second round (after user answers or skips): the LLM is forced to
 * call `emit_scenario` — the questions round is single-shot. This
 * prevents infinite question loops.
 *
 * Zod-failure retries stay in place inside each round.
 */
export async function generateScenarioFromNl(
  adapter: ChatAdapter,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<ScenarioGenerationResult> {
  const maxRetries = Math.max(1, Math.floor(opts.maxRetries ?? 3));
  const model = opts.model ?? "gemini-flash";
  const scenarioTool = createScenarioTool();
  const clarifyTool = createClarificationTool();

  // Build the starting conversation. When priorContext is present the
  // user has either answered or skipped a prior question round; we
  // preserve the earlier turns and append a new user turn describing
  // the outcome, then force emit_scenario.
  const conversation: ChatMessage[] = opts.priorContext
    ? [...opts.priorContext.conversation]
    : [{ role: "user", content: prompt }];
  const isSecondRound = opts.priorContext !== undefined;
  if (isSecondRound) {
    conversation.push({
      role: "user",
      content: opts.skipClarification
        ? "I'd rather not answer those questions — please emit_scenario now using best-effort defaults for anything unspecified."
        : formatAnswersForLlm(opts.priorContext!.questions, opts.priorContext!.answers ?? []),
    });
  }

  let lastError = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // First round exposes both tools; second round forces emit_scenario.
    const tools = isSecondRound ? [scenarioTool] : [scenarioTool, clarifyTool];
    const toolChoice = isSecondRound ? ({ name: SCENARIO_TOOL_NAME } as const) : ("auto" as const);
    const response = await adapter.chat(conversation, {
      model,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      tools,
      toolChoice,
      systemPrompt: scenarioGenerationSystemPrompt(),
    });

    const scenarioCall = response.toolCalls.find((tc) => tc.name === SCENARIO_TOOL_NAME);
    const clarifyCall = response.toolCalls.find((tc) => tc.name === CLARIFICATION_TOOL_NAME);
    const toolCall = scenarioCall ?? clarifyCall;
    if (!toolCall) {
      return {
        ok: false,
        kind: "no-tool-call",
        attempts: attempt,
        lastError:
          "The model replied in prose instead of calling emit_scenario or ask_clarification.",
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(toolCall.arguments);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      lastError = `Tool-call arguments were not valid JSON: ${message}.`;
      if (attempt === maxRetries) {
        return { ok: false, kind: "invalid-json", attempts: attempt, lastError };
      }
      appendRetryTurn(conversation, response.toolCalls, toolCall, lastError);
      continue;
    }

    if (toolCall === clarifyCall && !isSecondRound) {
      // First-round clarification path.
      const parsedClar = clarificationSchema.safeParse(parsed);
      if (parsedClar.success) {
        // Persist the assistant's tool-call turn + a tool-role
        // acknowledgement so the LLM can see its own questions when
        // we resume next round.
        conversation.push({ role: "assistant", content: "", toolCalls: response.toolCalls });
        conversation.push({
          role: "tool",
          content: "Questions delivered to the user.",
          toolCallId: toolCall.id,
        });
        return {
          ok: true,
          needsClarification: true,
          questions: parsedClar.data.questions,
          attempts: attempt,
          conversation: [...conversation],
        };
      }
      lastError = formatZodErrorForLlm(parsedClar.error);
      if (attempt === maxRetries) {
        return { ok: false, kind: "max-retries", attempts: attempt, lastError };
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
  return {
    ok: false,
    kind: "max-retries",
    attempts: maxRetries,
    lastError: lastError || "unknown",
  };
}

function formatAnswersForLlm(
  questions: Clarification["questions"],
  answers: readonly ClarificationAnswer[],
): string {
  const byId = new Map(answers.map((a) => [a.id, a.answer]));
  const lines = ["Here are my answers to your questions. Please call emit_scenario now.", ""];
  for (const q of questions) {
    const ans = byId.get(q.id)?.trim();
    lines.push(
      `- ${q.question} → ${ans && ans.length > 0 ? ans : "(no answer — pick a sensible default)"}`,
    );
  }
  return lines.join("\n");
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
