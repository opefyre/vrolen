/**
 * VROL-379 — AI provider abstraction: type vocabulary.
 *
 * Defines the shape of chat messages, tools, options, and responses
 * shared across every adapter (Mock for tests, OpenAI-compatible for
 * OpenAI / Anthropic / OpenRouter / Cloudflare Workers AI, Gemini Flash
 * via Edge Function proxy in production).
 *
 * Modelled after the OpenAI chat completions API because every
 * mainstream provider ships an adapter that speaks that shape — so
 * shipping the abstraction in OpenAI's idiom keeps each new adapter
 * thin.
 */

/** Sender role on a single chat turn. */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/**
 * A single chat turn.
 *
 * - `content` is the text payload. Empty string is allowed on
 *   assistant messages that ONLY emit tool calls.
 * - `toolCalls` is set on assistant messages that ask the host to
 *   run a tool. Multiple tool calls in one turn is supported (OpenAI
 *   parallel tool calls).
 * - `toolCallId` is set on tool-role messages — the id of the
 *   originating tool call so the assistant can correlate result back
 *   to request.
 */
export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  readonly toolCalls?: readonly ChatToolCall[];
  readonly toolCallId?: string;
}

/**
 * A function-style tool the assistant can invoke. The host owns the
 * implementation; the assistant sees only the schema.
 *
 * `parameters` is a JSON Schema object (draft-07 compatible) — every
 * adapter passes it through unchanged.
 */
export interface ChatTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/**
 * An assistant-issued tool call. `arguments` is the raw JSON-encoded
 * string from the model (OpenAI convention — kept as a string rather
 * than pre-parsed so adapters can surface parse failures cleanly).
 */
export interface ChatToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

/**
 * Why the model stopped emitting tokens.
 *
 * - `"stop"` — natural stop (end-of-message or stop sequence).
 * - `"tool_call"` — the assistant emitted one or more tool calls and
 *   is waiting for the host to run them.
 * - `"length"` — hit maxTokens cap before finishing.
 * - `"content_filter"` — provider's safety filter blocked the
 *   completion.
 */
export type ChatFinishReason = "stop" | "tool_call" | "length" | "content_filter";

/**
 * Request shape passed to an adapter. `model` is provider-specific
 * but kept as a string so adapters can resolve their own catalogues.
 */
export interface ChatOptions {
  readonly model: string;
  /** 0..2; lower = more deterministic. Adapters clamp to provider's actual range. */
  readonly temperature?: number;
  /** Soft cap on response tokens. Adapters surface "length" finish reason when hit. */
  readonly maxTokens?: number;
  /** Tools the assistant MAY call. Omit for chat-only flows. */
  readonly tools?: readonly ChatTool[];
  /**
   * Controls the assistant's tool-call discretion:
   *
   * - `"auto"` — model decides (default when tools provided).
   * - `"none"` — never call a tool.
   * - `"required"` — must call at least one tool.
   * - `{ name }` — must call this specific tool.
   */
  readonly toolChoice?: "auto" | "none" | "required" | { readonly name: string };
  /** Optional system prompt prepended to messages. Convenience alternative to a role:system entry. */
  readonly systemPrompt?: string;
}

/**
 * Response from an adapter. Adapters parse provider responses into
 * this shape so consumers don't care which provider answered.
 */
export interface ChatResponse {
  readonly text: string;
  readonly toolCalls: readonly ChatToolCall[];
  readonly finishReason: ChatFinishReason;
}

/**
 * Adapter interface every provider implementation satisfies. The
 * canonical method is `chat(messages, options)`; streaming is a
 * future addition (provider parity is uneven on streaming + tools
 * combined).
 */
export interface ChatAdapter {
  readonly chat: (messages: readonly ChatMessage[], options: ChatOptions) => Promise<ChatResponse>;
}
