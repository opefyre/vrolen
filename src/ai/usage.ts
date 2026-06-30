/**
 * VROL-414 / VROL-1130-1132 — AI usage tracking.
 *
 * Provides:
 *   - `withUsageTracking(adapter, store)` — wraps any ChatAdapter to
 *     record per-call token estimates. Inner adapter unchanged.
 *   - `UsageStore` interface + `createInMemoryUsageStore()` +
 *     `createLocalStorageUsageStore(namespace)` implementations.
 *   - `summarizeByDay()` / `summarizeByProvider()` /
 *     `formatCostEstimate()` pure helpers the future dashboard UI
 *     uses.
 *
 * Token counts are estimated via a chars/4 heuristic until live
 * adapters surface exact provider counts. The heuristic is good
 * enough for the dashboard's "are we burning credits" question and
 * close enough for cost projections.
 */

import type { ChatAdapter, ChatMessage, ChatResponse } from "./types";

/** One recorded chat() call. */
export interface UsageEntry {
  /** Wall-clock timestamp (ms since epoch). Caller injects to keep this pure-functional under test. */
  readonly timestamp: number;
  readonly model: string;
  /** Estimated input tokens (system prompt + every message). */
  readonly inputTokens: number;
  /** Estimated output tokens (response text + serialized tool calls). */
  readonly outputTokens: number;
  /** Optional provider tag for filtering ("openai" / "gemini" / "mock"). */
  readonly provider?: string;
}

export interface UsageStore {
  readonly record: (entry: UsageEntry) => void;
  readonly list: () => readonly UsageEntry[];
  readonly clear: () => void;
}

/**
 * VROL-1130 — wrap any adapter so its chat() calls record token usage.
 * Inner adapter behavior is unchanged; on error the original error
 * propagates AFTER best-effort recording (we record what we sent
 * even if the response failed, so cost-tracking sees blocked calls).
 */
export function withUsageTracking(
  inner: ChatAdapter,
  store: UsageStore,
  opts: { readonly provider?: string; readonly now?: () => number } = {},
): ChatAdapter {
  const now = opts.now ?? (() => Date.now());
  return {
    chat: async (messages, options) => {
      const inputTokens = estimateTokensForMessages(messages, options.systemPrompt);
      let response: ChatResponse | null = null;
      let thrown: unknown = null;
      try {
        response = await inner.chat(messages, options);
      } catch (e) {
        thrown = e;
      }
      const outputTokens = response ? estimateTokensForResponse(response) : 0;
      store.record({
        timestamp: now(),
        model: options.model,
        inputTokens,
        outputTokens,
        ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
      });
      if (thrown) throw thrown;
      // response is non-null when we didn't throw.
      return response!;
    },
  };
}

/** chars / 4 ≈ tokens for most BPE tokenizers. Pure heuristic. */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function estimateTokensForMessages(
  messages: readonly ChatMessage[],
  systemPrompt?: string,
): number {
  let total = systemPrompt ? estimateTokens(systemPrompt) : 0;
  for (const m of messages) {
    total += estimateTokens(m.content);
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        total += estimateTokens(tc.name) + estimateTokens(tc.arguments);
      }
    }
  }
  return total;
}

function estimateTokensForResponse(response: ChatResponse): number {
  let total = estimateTokens(response.text);
  for (const tc of response.toolCalls) {
    total += estimateTokens(tc.name) + estimateTokens(tc.arguments);
  }
  return total;
}

/**
 * VROL-1131 — in-memory store for tests + ephemeral sessions.
 */
export function createInMemoryUsageStore(): UsageStore {
  let entries: UsageEntry[] = [];
  return {
    record: (entry) => {
      entries.push(entry);
    },
    list: () => entries,
    clear: () => {
      entries = [];
    },
  };
}

/**
 * VROL-1131 — localStorage-backed store. Persists per-versioned-key
 * so a schema change can land an empty new key without losing the
 * old one. namespace defaults to "vrolen.ai-usage".
 */
export function createLocalStorageUsageStore(
  namespace = "vrolen.ai-usage",
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = globalThis.localStorage,
): UsageStore {
  const KEY = `${namespace}.v1`;
  function read(): UsageEntry[] {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      // Tolerate missing optional fields; require the basics.
      return parsed.filter(
        (e): e is UsageEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as { timestamp?: unknown }).timestamp === "number" &&
          typeof (e as { model?: unknown }).model === "string",
      );
    } catch {
      return [];
    }
  }
  function write(entries: readonly UsageEntry[]): void {
    try {
      storage.setItem(KEY, JSON.stringify(entries));
    } catch {
      // Quota / private-mode failures shouldn't break the chat flow.
    }
  }
  return {
    record: (entry) => {
      const entries = read();
      entries.push(entry);
      write(entries);
    },
    list: () => read(),
    clear: () => {
      try {
        storage.removeItem(KEY);
      } catch {
        // ignore
      }
    },
  };
}

/** Aggregated rollup for the dashboard. */
export interface UsageSummary {
  readonly callCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface DayRollup extends UsageSummary {
  /** ISO date string YYYY-MM-DD in UTC. */
  readonly day: string;
}

export interface ProviderRollup extends UsageSummary {
  readonly provider: string;
}

/**
 * VROL-1132 — pure aggregation helpers. Each returns a sorted array
 * the UI can map straight to a chart.
 */
export function summarizeByDay(entries: readonly UsageEntry[]): readonly DayRollup[] {
  const byDay = new Map<string, { inputTokens: number; outputTokens: number; callCount: number }>();
  for (const e of entries) {
    const day = new Date(e.timestamp).toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? { inputTokens: 0, outputTokens: 0, callCount: 0 };
    bucket.inputTokens += e.inputTokens;
    bucket.outputTokens += e.outputTokens;
    bucket.callCount += 1;
    byDay.set(day, bucket);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, b]) => ({
      day,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      totalTokens: b.inputTokens + b.outputTokens,
      callCount: b.callCount,
    }));
}

export function summarizeByProvider(entries: readonly UsageEntry[]): readonly ProviderRollup[] {
  const byProvider = new Map<
    string,
    { inputTokens: number; outputTokens: number; callCount: number }
  >();
  for (const e of entries) {
    const provider = e.provider ?? "unknown";
    const bucket = byProvider.get(provider) ?? { inputTokens: 0, outputTokens: 0, callCount: 0 };
    bucket.inputTokens += e.inputTokens;
    bucket.outputTokens += e.outputTokens;
    bucket.callCount += 1;
    byProvider.set(provider, bucket);
  }
  return Array.from(byProvider.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, b]) => ({
      provider,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      totalTokens: b.inputTokens + b.outputTokens,
      callCount: b.callCount,
    }));
}

/**
 * Rough cost estimate in USD, for the dashboard chip. Prices are
 * provider-tier defaults — when live adapters land they'll override
 * via a per-model table.
 */
const DEFAULT_PRICE_PER_M_TOKENS_USD: Readonly<Record<string, { input: number; output: number }>> =
  {
    "gemini-flash": { input: 0.075, output: 0.3 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4o": { input: 5, output: 15 },
    "claude-3-5-sonnet": { input: 3, output: 15 },
  };

export function formatCostEstimate(
  summary: UsageSummary,
  model: string,
  prices = DEFAULT_PRICE_PER_M_TOKENS_USD,
): string {
  const tier = prices[model];
  if (!tier) return "—";
  const usd =
    (summary.inputTokens / 1_000_000) * tier.input +
    (summary.outputTokens / 1_000_000) * tier.output;
  if (usd < 0.01) return `< $0.01`;
  return `$${usd.toFixed(2)}`;
}
