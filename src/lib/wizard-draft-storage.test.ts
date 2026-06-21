/**
 * VROL-820 — round-trip the saved Wizard draft through localStorage.
 *
 * happy-dom's `localStorage` shim doesn't expose `setItem` / `getItem`
 * reliably in this project's test config, so we install a minimal
 * in-memory storage stand-in on `window.localStorage` for the duration
 * of these specs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultDraft } from "@/components/wizard/wizard-types";

import {
  WIZARD_DRAFT_KEY,
  clearWizardDraft,
  hasWizardDraft,
  loadWizardDraft,
  loadWizardDraftOrDefault,
  saveWizardDraft,
} from "./wizard-draft-storage";

interface MemoryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function makeMemoryStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? (store.get(key) ?? null) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

let storage: MemoryStorage = makeMemoryStorage();

beforeEach(() => {
  storage = makeMemoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wizard-draft-storage (VROL-820)", () => {
  it("returns null when nothing is saved", () => {
    expect(loadWizardDraft()).toBeNull();
    expect(hasWizardDraft()).toBe(false);
  });

  it("falls back to defaultDraft when nothing is saved", () => {
    expect(loadWizardDraftOrDefault()).toEqual(defaultDraft());
  });

  it("round-trips a saved draft", () => {
    const draft = { ...defaultDraft(), arrivalsPerMin: 42, presetId: "assembly-cell" };
    expect(saveWizardDraft(draft)).toBe(true);
    expect(hasWizardDraft()).toBe(true);
    expect(loadWizardDraft()).toEqual(draft);
  });

  it("clearWizardDraft removes the entry", () => {
    saveWizardDraft(defaultDraft());
    expect(hasWizardDraft()).toBe(true);
    clearWizardDraft();
    expect(hasWizardDraft()).toBe(false);
  });

  it("returns null for malformed JSON", () => {
    storage.setItem(WIZARD_DRAFT_KEY, "{not-json");
    expect(loadWizardDraft()).toBeNull();
  });

  it("returns null for unsupported schema version", () => {
    storage.setItem(WIZARD_DRAFT_KEY, JSON.stringify({ v: 99, savedAt: 0, draft: defaultDraft() }));
    expect(loadWizardDraft()).toBeNull();
  });

  it("returns null when the stored draft fails shape validation", () => {
    storage.setItem(WIZARD_DRAFT_KEY, JSON.stringify({ v: 1, savedAt: 0, draft: { presetId: 5 } }));
    expect(loadWizardDraft()).toBeNull();
  });
});
