/**
 * VROL-835 — Theme picker dropdown + system echo tests.
 *
 * Covers the persistence contract: the user's *pick* (not the resolved
 * theme) lands in localStorage under `vrolen:theme-pref`, and the picker
 * trigger icon reflects the effective theme.
 *
 * happy-dom's localStorage shim isn't fully featured, so we install a
 * minimal stand-in for the duration of these specs (same pattern as
 * `src/components/wizard/wizard-shell.test.tsx`).
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "./ThemeToggle";
import { setThemePreference } from "@/lib/theme";

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

describe("ThemeToggle (VROL-835)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeMemoryStorage());
    setThemePreference("system");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setThemePreference("system");
  });

  it("persists the user's pick under vrolen:theme-pref", () => {
    render(<ThemeToggle />);
    act(() => {
      setThemePreference("dark");
    });
    expect(window.localStorage.getItem("vrolen:theme-pref")).toBe("dark");

    act(() => {
      setThemePreference("system");
    });
    // System persists as "system" — not as the resolved value.
    expect(window.localStorage.getItem("vrolen:theme-pref")).toBe("system");
  });

  it("renders an aria-live announcer region", () => {
    render(<ThemeToggle />);
    const announcer = screen.getByTestId("theme-announcer");
    expect(announcer).toHaveAttribute("aria-live", "polite");
  });

  it("trigger button is labeled with the current pick", () => {
    render(<ThemeToggle />);
    const trigger = screen.getByTestId("theme-toggle");
    expect(trigger).toHaveAttribute("aria-label", expect.stringMatching(/system/i));
    act(() => {
      setThemePreference("light");
    });
    expect(trigger).toHaveAttribute("aria-label", expect.stringMatching(/light/i));
  });
});
