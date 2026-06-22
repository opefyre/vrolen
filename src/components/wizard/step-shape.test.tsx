/**
 * VROL-821 — no silent preselect + sessionStorage resume.
 *
 * Covers:
 *   - The picker mounts with no selected card when the draft has
 *     `shapeKind: null`.
 *   - Clicking a card writes the pick to `vrolen:wizard-shape-resume`
 *     in sessionStorage AND drives `update({ shapeKind, stations,
 *     connections })`.
 *   - A fresh mount with a null draft restores from sessionStorage.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHAPE_RESUME_KEY, StepShape } from "./step-shape";
import { defaultDraft, type WizardDraft } from "./wizard-types";

interface MemoryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
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
    clear: () => {
      store.clear();
    },
  };
}

describe("StepShape (VROL-821) no silent preselect + sessionStorage resume", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", makeMemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing as selected when shapeKind is null", () => {
    const draft: WizardDraft = { ...defaultDraft(), shapeKind: null };
    render(<StepShape draft={draft} update={() => {}} />);
    // No card should report aria-checked=true.
    const cards = screen.getAllByRole("radio");
    expect(cards).toHaveLength(4);
    cards.forEach((c) => {
      expect(c.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("clicking a card calls update with the pick AND writes resume key", () => {
    const draft: WizardDraft = { ...defaultDraft(), shapeKind: null };
    const update = vi.fn();
    render(<StepShape draft={draft} update={update} />);
    fireEvent.click(screen.getByTestId("shape-card-branching"));
    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0]![0] as Partial<WizardDraft>;
    expect(patch.shapeKind).toBe("branching");
    expect(Array.isArray(patch.stations)).toBe(true);
    expect(Array.isArray(patch.connections)).toBe(true);
    expect(window.sessionStorage.getItem(SHAPE_RESUME_KEY)).toBe("branching");
  });

  it("on mount, rehydrates from sessionStorage when the draft has no pick", () => {
    window.sessionStorage.setItem(SHAPE_RESUME_KEY, "two-lines");
    const draft: WizardDraft = { ...defaultDraft(), shapeKind: null };
    const update = vi.fn();
    render(<StepShape draft={draft} update={update} />);
    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0]![0] as Partial<WizardDraft>;
    expect(patch.shapeKind).toBe("two-lines");
  });

  it("does NOT clobber an already-picked shape on mount", () => {
    window.sessionStorage.setItem(SHAPE_RESUME_KEY, "two-lines");
    const draft: WizardDraft = { ...defaultDraft(), shapeKind: "single-line" };
    const update = vi.fn();
    render(<StepShape draft={draft} update={update} />);
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores a malformed sessionStorage value", () => {
    window.sessionStorage.setItem(SHAPE_RESUME_KEY, "diamond-formation");
    const draft: WizardDraft = { ...defaultDraft(), shapeKind: null };
    const update = vi.fn();
    render(<StepShape draft={draft} update={update} />);
    expect(update).not.toHaveBeenCalled();
  });
});
