/**
 * VROL-379 — AI provider abstraction. Barrel export so callers
 * `import { ... } from "@/ai"` rather than reaching into individual
 * files. Keep this file thin — it should be the only file consumers
 * see when scanning for the public surface.
 */

export type {
  ChatRole,
  ChatMessage,
  ChatTool,
  ChatToolCall,
  ChatFinishReason,
  ChatOptions,
  ChatResponse,
  ChatAdapter,
} from "./types";

export { createMockChatAdapter, matchLastUser, matchModel, always } from "./mock-adapter";
export type {
  MockChatAdapter,
  MockChatPredicate,
  MockChatRule,
  MockChatCall,
} from "./mock-adapter";

export { openAiChatRequestBody, parseOpenAiChatResponse } from "./openai-shape";
