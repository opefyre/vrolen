/**
 * VROL-379 / VROL-1116 — OpenAI-compatible request/response shape
 * helpers. Pure functions, no network — they convert between Vrolen's
 * ChatOptions / ChatResponse types and the wire format used by every
 * OpenAI-compatible API (OpenAI, Anthropic via OpenAI-compat
 * endpoint, OpenRouter, Cloudflare Workers AI, etc.).
 *
 * When VROL-386 lands the live adapter it'll be a 30-line wrapper:
 * fetch(url, { body: openAiChatRequestBody(...) }) →
 * parseOpenAiChatResponse(await res.json()). Keeping the conversion
 * pure means the live adapter has near-zero logic to test.
 */

import type {
  ChatFinishReason,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatToolCall,
} from "./types";

/**
 * Build the JSON body for an OpenAI-compatible chat completions
 * request. Drops Vrolen's `systemPrompt` convenience by prepending a
 * system message when set — adapter callers don't need to do that
 * themselves.
 */
export function openAiChatRequestBody(
  messages: readonly ChatMessage[],
  options: ChatOptions,
): Record<string, unknown> {
  const wireMessages: Record<string, unknown>[] = [];
  if (options.systemPrompt) {
    wireMessages.push({ role: "system", content: options.systemPrompt });
  }
  for (const m of messages) {
    const msg: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.toolCalls && m.toolCalls.length > 0) {
      msg["tool_calls"] = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    if (m.toolCallId !== undefined) {
      msg["tool_call_id"] = m.toolCallId;
    }
    wireMessages.push(msg);
  }
  const body: Record<string, unknown> = {
    model: options.model,
    messages: wireMessages,
  };
  if (options.temperature !== undefined) body["temperature"] = options.temperature;
  if (options.maxTokens !== undefined) body["max_tokens"] = options.maxTokens;
  if (options.tools && options.tools.length > 0) {
    body["tools"] = options.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
  if (options.toolChoice !== undefined) {
    body["tool_choice"] =
      typeof options.toolChoice === "string"
        ? options.toolChoice
        : { type: "function", function: { name: options.toolChoice.name } };
  }
  return body;
}

/**
 * Provider response body shape we read. Field-by-field tolerant of
 * missing keys — we only consume what we strictly need.
 */
interface OpenAiChatResponseBody {
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: ReadonlyArray<{
        readonly id?: string;
        readonly type?: string;
        readonly function?: {
          readonly name?: string;
          readonly arguments?: string;
        };
      }>;
    };
    readonly finish_reason?: string | null;
  }>;
}

const FINISH_REASON_MAP: Readonly<Record<string, ChatFinishReason>> = {
  stop: "stop",
  length: "length",
  tool_calls: "tool_call",
  function_call: "tool_call",
  content_filter: "content_filter",
};

/**
 * Parse an OpenAI-compatible response body into Vrolen's ChatResponse
 * shape. Returns an empty response on missing/empty bodies so callers
 * don't need to null-check.
 */
export function parseOpenAiChatResponse(body: unknown): ChatResponse {
  // Guard against null / non-object bodies so tests + adapters don't
  // need to null-check before calling.
  const typed = (body && typeof body === "object" ? body : {}) as OpenAiChatResponseBody;
  const choice = typed.choices?.[0];
  const message = choice?.message;
  const rawText = message?.content ?? "";
  const toolCalls: ChatToolCall[] = [];
  for (const tc of message?.tool_calls ?? []) {
    if (tc.function?.name && tc.id) {
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments ?? "",
      });
    }
  }
  const rawFinish = choice?.finish_reason ?? "stop";
  const mapped = FINISH_REASON_MAP[rawFinish];
  // Tool-call payloads always finish as "tool_call" regardless of
  // the provider's reported reason — some providers send "stop" even
  // when tool_calls is non-empty.
  const finishReason: ChatFinishReason = toolCalls.length > 0 ? "tool_call" : (mapped ?? "stop");
  return { text: rawText, toolCalls, finishReason };
}
