/**
 * VROL-389 / VROL-1139-1140 — BYO-key storage + provider catalogue.
 *
 * The user can paste API keys for the providers they want to use
 * (OpenAI, Anthropic, OpenRouter, Gemini, etc). Keys are persisted to
 * localStorage and survive page reloads. The provider catalogue lists
 * what we support + their default models + their auth header
 * convention so the future live adapter (VROL-386) routes correctly.
 *
 * Security note: localStorage is NOT encrypted. We surface this in the
 * settings UI and recommend a per-user proxy (VROL-393) for the
 * default-tier Gemini key — the BYO path is for power users who
 * understand the trade-off.
 *
 * Storage layout mirrors the UsageStore pattern from VROL-414.
 */

/** Providers we know how to talk to (or will know once VROL-386 lands). */
export type ProviderId = "openai" | "anthropic" | "openrouter" | "gemini" | "cloudflare";

export interface ProviderInfo {
  readonly id: ProviderId;
  /** Human-readable name for the settings dropdown. */
  readonly label: string;
  /** Model id used by default when the user picks this provider. */
  readonly defaultModel: string;
  /** All known model ids on this provider — drives the model picker. */
  readonly models: readonly string[];
  /**
   * How the adapter passes the key to the API. "bearer" → header
   * "Authorization: Bearer <key>"; "x-api-key" → header
   * "x-api-key: <key>" (Anthropic); "query" → ?key= (Gemini).
   */
  readonly authStyle: "bearer" | "x-api-key" | "query";
  /** Default base URL — overridable per stored key (proxies, self-hosted). */
  readonly defaultBaseUrl: string;
}

/**
 * VROL-1140 — known providers. Adding one is a 5-line entry here;
 * the adapter (VROL-386) consumes this map via PROVIDER_CATALOGUE.
 */
export const PROVIDER_CATALOGUE: Readonly<Record<ProviderId, ProviderInfo>> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
    authStyle: "bearer",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (OpenAI-compatible endpoint)",
    defaultModel: "claude-3-5-sonnet-latest",
    models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
    authStyle: "x-api-key",
    defaultBaseUrl: "https://api.anthropic.com/v1",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: "anthropic/claude-3.5-sonnet",
    models: [
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o-mini",
      "google/gemini-flash-1.5",
      "meta-llama/llama-3.1-70b-instruct",
    ],
    authStyle: "bearer",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-flash",
    models: ["gemini-flash", "gemini-pro"],
    authStyle: "query",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    defaultModel: "@cf/meta/llama-3.1-8b-instruct",
    models: ["@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3.1-70b-instruct"],
    authStyle: "bearer",
    defaultBaseUrl: "https://api.cloudflare.com/client/v4",
  },
};

export function listProviders(): readonly ProviderInfo[] {
  return Object.values(PROVIDER_CATALOGUE);
}

export function lookupProvider(id: string): ProviderInfo | undefined {
  return (PROVIDER_CATALOGUE as Record<string, ProviderInfo>)[id];
}

/** One stored credential. */
export interface ProviderKey {
  readonly providerId: ProviderId;
  /** Raw API key the adapter passes through. NEVER log this. */
  readonly apiKey: string;
  /** Optional override of the catalogue's defaultBaseUrl. */
  readonly baseUrl?: string;
  /** Optional human label so the user can tell two keys apart. */
  readonly label?: string;
  /** When the key was stored (ms since epoch). */
  readonly addedAt: number;
}

export interface ProviderKeyStore {
  readonly upsert: (key: ProviderKey) => void;
  readonly get: (providerId: ProviderId) => ProviderKey | undefined;
  readonly remove: (providerId: ProviderId) => void;
  readonly list: () => readonly ProviderKey[];
  readonly clear: () => void;
}

/** VROL-1139 — in-memory implementation for tests. */
export function createInMemoryProviderKeyStore(): ProviderKeyStore {
  const byId = new Map<ProviderId, ProviderKey>();
  return {
    upsert: (key) => {
      byId.set(key.providerId, key);
    },
    get: (id) => byId.get(id),
    remove: (id) => {
      byId.delete(id);
    },
    list: () => Array.from(byId.values()),
    clear: () => {
      byId.clear();
    },
  };
}

function isValidProviderId(s: unknown): s is ProviderId {
  return typeof s === "string" && s in PROVIDER_CATALOGUE;
}

function isProviderKey(v: unknown): v is ProviderKey {
  if (!v || typeof v !== "object") return false;
  const k = v as Record<string, unknown>;
  return (
    isValidProviderId(k["providerId"]) &&
    typeof k["apiKey"] === "string" &&
    k["apiKey"].length > 0 &&
    typeof k["addedAt"] === "number"
  );
}

/**
 * VROL-1139 — localStorage-backed implementation. Persists per-version
 * key so a schema change can land a new key without losing the old.
 * Tolerates malformed payloads (private mode, quota-exceeded, garbage
 * data) without breaking the adapter call path.
 */
export function createLocalStorageProviderKeyStore(
  namespace = "vrolen.provider-keys",
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = globalThis.localStorage,
): ProviderKeyStore {
  const KEY = `${namespace}.v1`;
  function read(): ProviderKey[] {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isProviderKey);
    } catch {
      return [];
    }
  }
  function write(entries: readonly ProviderKey[]): void {
    try {
      storage.setItem(KEY, JSON.stringify(entries));
    } catch {
      // Quota / private mode → silent skip.
    }
  }
  return {
    upsert: (key) => {
      const entries = read().filter((e) => e.providerId !== key.providerId);
      entries.push(key);
      write(entries);
    },
    get: (id) => read().find((e) => e.providerId === id),
    remove: (id) => {
      write(read().filter((e) => e.providerId !== id));
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
