/**
 * VROL-386 / VROL-1142-1143 — OpenAI-compatible live adapter.
 *
 * Wraps the pure shape helpers (openAiChatRequestBody +
 * parseOpenAiChatResponse) with a fetch call. Same wrapper works for
 * OpenAI, OpenRouter, and Cloudflare Workers AI — they all speak the
 * same wire format with bearer auth. Anthropic uses a tweak (see
 * createAnthropicAdapter).
 *
 * `fetch` is injectable so tests run against a mock without monkey-
 * patching globalThis.
 */

import { openAiChatRequestBody, parseOpenAiChatResponse } from "./openai-shape";
import type { ChatAdapter } from "./types";

export interface OpenAiAdapterOptions {
  readonly apiKey: string;
  /** Defaults to `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
  /**
   * Optional injected fetch — defaults to globalThis.fetch. Tests pass
   * vitest mock fetch here; prod paths rely on the platform default.
   */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Optional extra headers (per-provider quirks like
   * `OpenAI-Beta: assistants=v2`). Merged onto our defaults.
   */
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function createOpenAiAdapter(opts: OpenAiAdapterOptions): ChatAdapter {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    chat: async (messages, chatOpts) => {
      const body = openAiChatRequestBody(messages, chatOpts);
      const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
          ...(opts.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await safeText(res);
        throw new Error(
          `OpenAI-compatible adapter: HTTP ${String(res.status)} ${res.statusText}${errBody ? `\n${errBody}` : ""}`,
        );
      }
      const parsed = (await res.json()) as unknown;
      return parseOpenAiChatResponse(parsed);
    },
  };
}

/**
 * VROL-1143 — Anthropic via its OpenAI-compatible endpoint. Uses
 * `x-api-key` instead of bearer, and requires the `anthropic-version`
 * header. Same body + response shape otherwise.
 */
export interface AnthropicAdapterOptions {
  readonly apiKey: string;
  /** Defaults to `https://api.anthropic.com/v1`. */
  readonly baseUrl?: string;
  /** Anthropic API version, defaults to `2023-06-01`. */
  readonly anthropicVersion?: string;
  readonly fetch?: typeof globalThis.fetch;
}

const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com/v1";

export function createAnthropicAdapter(opts: AnthropicAdapterOptions): ChatAdapter {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const baseUrl = (opts.baseUrl ?? ANTHROPIC_DEFAULT_BASE).replace(/\/+$/, "");
  const version = opts.anthropicVersion ?? "2023-06-01";
  return {
    chat: async (messages, chatOpts) => {
      const body = openAiChatRequestBody(messages, chatOpts);
      const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": version,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await safeText(res);
        throw new Error(
          `Anthropic adapter: HTTP ${String(res.status)} ${res.statusText}${errBody ? `\n${errBody}` : ""}`,
        );
      }
      const parsed = (await res.json()) as unknown;
      return parseOpenAiChatResponse(parsed);
    },
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
