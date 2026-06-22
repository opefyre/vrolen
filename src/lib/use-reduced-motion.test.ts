/**
 * VROL-801 — useReducedMotion mocks window.matchMedia and asserts the hook
 * returns true when prefers-reduced-motion: reduce matches, false otherwise.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReducedMotion } from "./use-reduced-motion";

type ChangeHandler = (event: MediaQueryListEvent) => void;

interface MockMql {
  matches: boolean;
  media: string;
  onchange: null;
  addEventListener: (type: string, handler: ChangeHandler) => void;
  removeEventListener: (type: string, handler: ChangeHandler) => void;
  addListener: (handler: ChangeHandler) => void;
  removeListener: (handler: ChangeHandler) => void;
  dispatchEvent: () => boolean;
}

function installMatchMedia(matches: boolean): MockMql {
  const mql: MockMql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mql),
  });
  return mql;
}

describe("useReducedMotion (VROL-801)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when matchMedia reports the reduce preference matches", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("returns false when matchMedia reports no reduce preference", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("subscribes to change events on mount and cleans up on unmount", () => {
    const mql = installMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
