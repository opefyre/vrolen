/**
 * VROL-829 — SPA navigation helper tests.
 *
 * `navigate` is verified directly against `window.history` (happy-dom ships
 * a working History API). `usePathname` is exercised through React's
 * `act(...)` so the `useSyncExternalStore` subscription flushes.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigate, usePathname } from "./spa-nav";

describe("spa-nav (VROL-829)", () => {
  beforeEach(() => {
    // Anchor every test at "/" so order doesn't matter.
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  describe("navigate", () => {
    it("pushes a new history entry by default", () => {
      const before = window.history.length;
      navigate("/editor");
      expect(window.location.pathname).toBe("/editor");
      expect(window.history.length).toBe(before + 1);
    });

    it("replaces the current entry when opts.replace = true", () => {
      navigate("/editor");
      const lenAfterPush = window.history.length;
      navigate("/help", { replace: true });
      expect(window.location.pathname).toBe("/help");
      // replaceState must not grow the stack.
      expect(window.history.length).toBe(lenAfterPush);
    });

    it("dispatches a popstate event so subscribers react", () => {
      const onPop = vi.fn();
      window.addEventListener("popstate", onPop);
      navigate("/templates");
      window.removeEventListener("popstate", onPop);
      expect(onPop).toHaveBeenCalledTimes(1);
    });
  });

  describe("usePathname", () => {
    it("returns the current pathname on mount", () => {
      window.history.replaceState(null, "", "/help");
      const { result } = renderHook(() => usePathname());
      expect(result.current).toBe("/help");
    });

    it("re-renders when navigate fires popstate", () => {
      const { result } = renderHook(() => usePathname());
      expect(result.current).toBe("/");
      act(() => {
        navigate("/editor");
      });
      expect(result.current).toBe("/editor");
      act(() => {
        navigate("/help", { replace: true });
      });
      expect(result.current).toBe("/help");
    });
  });
});
