import { beforeEach, describe, expect, it, vi } from "vitest";

import { dismissCoachTip, getCoachDismissed, resetCoachTipsForTests } from "./coach-state";

/**
 * VROL-819 — coach dismissal persistence.
 *
 * The in-memory cache is canonical; localStorage is best-effort. happy-dom's
 * localStorage shim is flaky, so persistence round-trip tests mock the
 * window.localStorage object explicitly to keep coverage honest.
 */
describe("coach-state (VROL-819)", () => {
  beforeEach(() => {
    resetCoachTipsForTests();
  });

  it("returns an empty set when nothing has been dismissed", () => {
    expect(getCoachDismissed().size).toBe(0);
  });

  it("dismissCoachTip adds the id and getCoachDismissed reads it back", () => {
    dismissCoachTip("run-it");
    expect(getCoachDismissed().has("run-it")).toBe(true);
  });

  it("dismissing the same id twice is a no-op", () => {
    dismissCoachTip("run-it");
    dismissCoachTip("run-it");
    expect(getCoachDismissed().size).toBe(1);
  });

  it("returned set is a copy — mutating it does not affect the cache", () => {
    dismissCoachTip("run-it");
    const set = getCoachDismissed();
    set.delete("run-it");
    expect(getCoachDismissed().has("run-it")).toBe(true);
  });

  it("round-trips multiple ids through localStorage", () => {
    const store = new Map<string, string>();
    const mockStorage: Storage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
      removeItem: (k) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: () => null,
      get length() {
        return store.size;
      },
    };
    vi.spyOn(window, "localStorage", "get").mockReturnValue(mockStorage);

    dismissCoachTip("try-the-wizard");
    dismissCoachTip("connect-the-graph");
    // Drop in-memory cache so the next read forces a localStorage reload.
    resetCoachTipsForTests();
    const set = getCoachDismissed();
    expect(set.has("try-the-wizard")).toBe(true);
    expect(set.has("connect-the-graph")).toBe(true);
    expect(set.size).toBe(2);

    vi.restoreAllMocks();
  });

  it("ignores malformed localStorage payloads gracefully", () => {
    const mockStorage: Storage = {
      getItem: () => "{not json",
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    };
    vi.spyOn(window, "localStorage", "get").mockReturnValue(mockStorage);
    resetCoachTipsForTests();
    expect(getCoachDismissed().size).toBe(0);
    vi.restoreAllMocks();
  });

  it("ignores non-array JSON payloads", () => {
    const mockStorage: Storage = {
      getItem: () => '{"a":1}',
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    };
    vi.spyOn(window, "localStorage", "get").mockReturnValue(mockStorage);
    resetCoachTipsForTests();
    expect(getCoachDismissed().size).toBe(0);
    vi.restoreAllMocks();
  });
});
