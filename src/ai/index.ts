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

// VROL-397 — NL → Scenario JSON flow.
export {
  scenarioGenerationSchema,
  type GeneratedScenario,
  type GeneratedStation,
  type GeneratedEdge,
} from "./scenario-schema";
export { scenarioGenerationSystemPrompt, SCENARIO_PROMPT_VERSION } from "./scenario-prompt";
export {
  SCENARIO_TOOL_NAME,
  createScenarioTool,
  formatZodErrorForLlm,
  generateScenarioFromNl,
  type ScenarioGenerationResult,
} from "./scenario-tool";

// VROL-410 — auto-narration of a sim run.
export {
  deriveDeterministicNarration,
  narrationSystemPrompt,
  narrateRun,
  type NarrationBundle,
  type NarrationResult,
} from "./narration";

// VROL-414 — AI usage tracking.
export {
  withUsageTracking,
  createInMemoryUsageStore,
  createLocalStorageUsageStore,
  summarizeByDay,
  summarizeByProvider,
  formatCostEstimate,
  type UsageEntry,
  type UsageStore,
  type UsageSummary,
  type DayRollup,
  type ProviderRollup,
} from "./usage";
