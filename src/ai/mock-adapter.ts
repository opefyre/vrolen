/**
 * VROL-379 / VROL-1115 — MockChatAdapter.
 *
 * Deterministic adapter for tests + dev environments without an API
 * key. The host primes it with (predicate, response) pairs; the first
 * predicate whose match fires picks the response. Records every
 * incoming message + options block so consumers can assert what the
 * AI was actually asked.
 *
 * Design intent: every AI-consuming feature in Vrolen tests against
 * this mock. When the real Gemini / OpenAI adapter lands, swap by
 * dependency injection — no test rewrite.
 */

import type {
  ChatAdapter,
  ChatFinishReason,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatToolCall,
} from "./types";

/**
 * Picks whether this response should fire for a given exchange.
 * Receives the FULL conversation + the request options so canned
 * responses can be context-sensitive (e.g. "if last user message
 * contains 'json', return tool call").
 */
export type MockChatPredicate = (messages: readonly ChatMessage[], options: ChatOptions) => boolean;

/**
 * A canned response paired with the predicate that selects it.
 * `finishReason` defaults to "stop"; "tool_call" is auto-set when
 * toolCalls is non-empty so callers don't need to keep them in sync.
 */
export interface MockChatRule {
  readonly when: MockChatPredicate;
  readonly text?: string;
  readonly toolCalls?: readonly ChatToolCall[];
  readonly finishReason?: ChatFinishReason;
}

/**
 * Recorded call to `chat()`. Stored in order; helpful for asserting
 * the ENTIRE conversation history the host built up across turns.
 */
export interface MockChatCall {
  readonly messages: readonly ChatMessage[];
  readonly options: ChatOptions;
}

/**
 * Test helper around ChatAdapter. Returns the live adapter plus
 * `calls` (the recorded log) and `reset()` so test setup can wipe
 * state between cases without re-constructing the adapter.
 */
export interface MockChatAdapter extends ChatAdapter {
  /** All chat() invocations in call order. */
  readonly calls: ReadonlyArray<MockChatCall>;
  /** Clear the call log (rules stay). */
  readonly reset: () => void;
}

const DEFAULT_FALLBACK: ChatResponse = {
  text: "",
  toolCalls: [],
  finishReason: "stop",
};

/**
 * Build a mock adapter primed with rules. Falls back to a no-op
 * "empty text" response when no rule matches — tests should always
 * register a catch-all or assert the specific predicate ran.
 *
 * `defaultResponse` overrides the fallback for tests that want
 * "always respond with X" semantics.
 */
export function createMockChatAdapter(
  rules: readonly MockChatRule[] = [],
  defaultResponse: ChatResponse = DEFAULT_FALLBACK,
): MockChatAdapter {
  const calls: MockChatCall[] = [];
  return {
    calls,
    reset: () => {
      calls.length = 0;
    },
    chat: (messages, options) => {
      calls.push({ messages, options });
      for (const rule of rules) {
        if (rule.when(messages, options)) {
          const toolCalls = rule.toolCalls ?? [];
          const finishReason: ChatFinishReason =
            rule.finishReason ?? (toolCalls.length > 0 ? "tool_call" : "stop");
          return Promise.resolve({
            text: rule.text ?? "",
            toolCalls,
            finishReason,
          });
        }
      }
      return Promise.resolve(defaultResponse);
    },
  };
}

/**
 * Common-case predicate factories. Keep these tiny — tests use them as
 * one-line preds (`when: matchLastUser(/save scenario/i)`).
 */
export function matchLastUser(pattern: RegExp): MockChatPredicate {
  return (messages) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === "user") return pattern.test(m.content);
    }
    return false;
  };
}

export function matchModel(name: string): MockChatPredicate {
  return (_messages, options) => options.model === name;
}

export function always(): MockChatPredicate {
  return () => true;
}
