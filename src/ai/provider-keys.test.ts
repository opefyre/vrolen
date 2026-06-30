/**
 * VROL-389 / VROL-1141 — provider key store + catalogue tests.
 */
import { describe, expect, it } from "vitest";

import {
  PROVIDER_CATALOGUE,
  createInMemoryProviderKeyStore,
  createLocalStorageProviderKeyStore,
  listProviders,
  lookupProvider,
  type ProviderKey,
} from "./provider-keys";

describe("PROVIDER_CATALOGUE (VROL-1140)", () => {
  it("includes the five core providers we plan to ship adapters for", () => {
    const ids = Object.keys(PROVIDER_CATALOGUE).sort();
    expect(ids).toEqual(["anthropic", "cloudflare", "gemini", "openai", "openrouter"]);
  });

  it("every entry has at least one model + a default + a base URL", () => {
    for (const info of listProviders()) {
      expect(info.models.length).toBeGreaterThan(0);
      expect(info.models).toContain(info.defaultModel);
      expect(info.defaultBaseUrl).toMatch(/^https?:\/\//);
    }
  });

  it("lookupProvider returns the entry for a known id and undefined otherwise", () => {
    expect(lookupProvider("openai")?.label).toBe("OpenAI");
    expect(lookupProvider("ghost")).toBeUndefined();
  });
});

describe("createInMemoryProviderKeyStore (VROL-1139)", () => {
  it("upsert + get + list round-trip", () => {
    const store = createInMemoryProviderKeyStore();
    const key: ProviderKey = {
      providerId: "openai",
      apiKey: "sk-test-1",
      addedAt: 1,
    };
    store.upsert(key);
    expect(store.get("openai")?.apiKey).toBe("sk-test-1");
    expect(store.list()).toHaveLength(1);
  });

  it("upsert overwrites a previous key for the same provider (no duplicates)", () => {
    const store = createInMemoryProviderKeyStore();
    store.upsert({ providerId: "openai", apiKey: "sk-1", addedAt: 1 });
    store.upsert({ providerId: "openai", apiKey: "sk-2", addedAt: 2, label: "prod" });
    expect(store.list()).toHaveLength(1);
    expect(store.get("openai")?.apiKey).toBe("sk-2");
    expect(store.get("openai")?.label).toBe("prod");
  });

  it("remove deletes by providerId", () => {
    const store = createInMemoryProviderKeyStore();
    store.upsert({ providerId: "openai", apiKey: "sk", addedAt: 1 });
    store.upsert({ providerId: "anthropic", apiKey: "sk", addedAt: 2 });
    store.remove("openai");
    expect(store.list()).toHaveLength(1);
    expect(store.get("openai")).toBeUndefined();
  });

  it("clear empties the store", () => {
    const store = createInMemoryProviderKeyStore();
    store.upsert({ providerId: "openai", apiKey: "sk", addedAt: 1 });
    store.upsert({ providerId: "anthropic", apiKey: "sk", addedAt: 2 });
    store.clear();
    expect(store.list()).toHaveLength(0);
  });
});

describe("createLocalStorageProviderKeyStore (VROL-1139)", () => {
  function fakeStorage() {
    const inner: Record<string, string> = {};
    return {
      getItem: (k: string) => inner[k] ?? null,
      setItem: (k: string, v: string) => {
        inner[k] = v;
      },
      removeItem: (k: string) => {
        delete inner[k];
      },
      _peek: () => inner,
    };
  }

  it("persists across instances", () => {
    const fake = fakeStorage();
    const s1 = createLocalStorageProviderKeyStore("test", fake);
    s1.upsert({ providerId: "openai", apiKey: "sk-1", addedAt: 1 });
    const s2 = createLocalStorageProviderKeyStore("test", fake);
    expect(s2.get("openai")?.apiKey).toBe("sk-1");
  });

  it("tolerates malformed JSON", () => {
    const fake = fakeStorage();
    fake.setItem("test.v1", "not json");
    const store = createLocalStorageProviderKeyStore("test", fake);
    expect(store.list()).toEqual([]);
  });

  it("drops entries with invalid providerId on read", () => {
    const fake = fakeStorage();
    fake.setItem(
      "test.v1",
      JSON.stringify([
        { providerId: "ghost", apiKey: "x", addedAt: 1 },
        { providerId: "openai", apiKey: "sk-1", addedAt: 2 },
      ]),
    );
    const store = createLocalStorageProviderKeyStore("test", fake);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.providerId).toBe("openai");
  });

  it("clear() removes the persisted key", () => {
    const fake = fakeStorage();
    const store = createLocalStorageProviderKeyStore("test", fake);
    store.upsert({ providerId: "openai", apiKey: "sk", addedAt: 1 });
    store.clear();
    expect(store.list()).toHaveLength(0);
    expect(fake._peek()).not.toHaveProperty("test.v1");
  });

  it("uses 'vrolen.provider-keys' as the default namespace", () => {
    const fake = fakeStorage();
    const store = createLocalStorageProviderKeyStore(undefined, fake);
    store.upsert({ providerId: "openai", apiKey: "sk", addedAt: 1 });
    expect(fake._peek()).toHaveProperty("vrolen.provider-keys.v1");
  });
});
