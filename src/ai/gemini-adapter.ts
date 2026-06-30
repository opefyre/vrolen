/**
 * VROL-382 / VROL-1144 — Gemini Flash live adapter.
 *
 * Gemini's native API differs from OpenAI's chat completions:
 *   - Messages use `contents` array with `parts` instead of
 *     `messages` with `content`.
 *   - Roles are `user` / `model` (not `assistant`); system prompts
 *     go on a separate `systemInstruction` field.
 *   - Tools use `functionDeclarations` with the same JSON-schema
 *     params we ship.
 *   - Auth via `?key=` query string, not a header.
 *
 * Hand-written request builder + response parser; same ChatAdapter
 * interface so consumers don't see the shape difference.
 *
 * fetch is injectable for tests.
 */

import type {
  ChatAdapter,
  ChatFinishReason,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatTool,
  ChatToolCall,
} from "./types";

export interface GeminiAdapterOptions {
  readonly apiKey: string;
  /** Defaults to `https://generativelanguage.googleapis.com/v1beta`. */
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function createGeminiAdapter(opts: GeminiAdapterOptions): ChatAdapter {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  return {
    chat: async (messages, chatOpts) => {
      const body = geminiRequestBody(messages, chatOpts);
      const url = `${baseUrl}/models/${encodeURIComponent(chatOpts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await safeText(res);
        throw new Error(
          `Gemini adapter: HTTP ${String(res.status)} ${res.statusText}${errBody ? `\n${errBody}` : ""}`,
        );
      }
      const parsed = (await res.json()) as unknown;
      return parseGeminiResponse(parsed);
    },
  };
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model" | "function";
  parts: GeminiPart[];
}

/** Build the Gemini request body from Vrolen's ChatMessage list. */
export function geminiRequestBody(
  messages: readonly ChatMessage[],
  options: ChatOptions,
): Record<string, unknown> {
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      // Gemini takes systemInstruction at the top level; skip here.
      continue;
    }
    if (m.role === "tool") {
      // Gemini's role for tool responses is `function`. The functionResponse
      // is keyed by name, which Vrolen tracks via toolCallId — adapters
      // upstream remember the call→name mapping; in this minimal v1 we
      // pass through under "function".
      contents.push({
        role: "function",
        parts: [{ text: m.content }],
      });
      continue;
    }
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
    const parts: GeminiPart[] = [];
    if (m.content) parts.push({ text: m.content });
    if (m.toolCalls && m.toolCalls.length > 0) {
      for (const tc of m.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.arguments) as Record<string, unknown>;
        } catch {
          // Fall through with empty args; Gemini expects a real object.
        }
        parts.push({ functionCall: { name: tc.name, args } });
      }
    }
    contents.push({ role, parts: parts.length > 0 ? parts : [{ text: "" }] });
  }
  const body: Record<string, unknown> = { contents };
  // systemInstruction goes alongside contents.
  const systemPromptParts: GeminiPart[] = [];
  if (options.systemPrompt) systemPromptParts.push({ text: options.systemPrompt });
  for (const m of messages) {
    if (m.role === "system") systemPromptParts.push({ text: m.content });
  }
  if (systemPromptParts.length > 0) {
    body["systemInstruction"] = { parts: systemPromptParts };
  }
  if (options.tools && options.tools.length > 0) {
    body["tools"] = [
      {
        functionDeclarations: options.tools.map((t: ChatTool) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }
  const genConfig: Record<string, unknown> = {};
  if (options.temperature !== undefined) genConfig["temperature"] = options.temperature;
  if (options.maxTokens !== undefined) genConfig["maxOutputTokens"] = options.maxTokens;
  if (Object.keys(genConfig).length > 0) body["generationConfig"] = genConfig;
  if (options.toolChoice !== undefined && typeof options.toolChoice === "object") {
    body["toolConfig"] = {
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: [options.toolChoice.name] },
    };
  } else if (options.toolChoice === "none") {
    body["toolConfig"] = { functionCallingConfig: { mode: "NONE" } };
  } else if (options.toolChoice === "required") {
    body["toolConfig"] = { functionCallingConfig: { mode: "ANY" } };
  }
  return body;
}

interface GeminiResponseBody {
  candidates?: ReadonlyArray<{
    content?: {
      role?: string;
      parts?: ReadonlyArray<GeminiPart>;
    };
    finishReason?: string;
  }>;
}

const GEMINI_FINISH_MAP: Readonly<Record<string, ChatFinishReason>> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
};

export function parseGeminiResponse(body: unknown): ChatResponse {
  const typed = (body && typeof body === "object" ? body : {}) as GeminiResponseBody;
  const candidate = typed.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  let text = "";
  const toolCalls: ChatToolCall[] = [];
  for (const p of parts) {
    if (p.text) text += p.text;
    if (p.functionCall?.name) {
      toolCalls.push({
        // Gemini doesn't return a tool-call id; synthesize one so the
        // host can correlate. Deterministic per-position.
        id: `gemini-tc-${String(toolCalls.length)}`,
        name: p.functionCall.name,
        arguments: JSON.stringify(p.functionCall.args ?? {}),
      });
    }
  }
  const rawFinish = candidate?.finishReason ?? "STOP";
  const mapped = GEMINI_FINISH_MAP[rawFinish];
  const finishReason: ChatFinishReason = toolCalls.length > 0 ? "tool_call" : (mapped ?? "stop");
  return { text, toolCalls, finishReason };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
