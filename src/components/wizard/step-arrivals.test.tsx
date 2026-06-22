/**
 * VROL-824 — arrivals advanced disclosure.
 *
 * Covers:
 *   - Above the fold: source toggle, inter-arrival distribution,
 *     materials toggle, initial bottles, bottles per part.
 *   - Below the fold: batch size, initial caps, caps per part,
 *     one-shot replenishment, recurring deliveries — only when the
 *     user pops the Advanced disclosure open.
 *   - Open-state persists across remounts via sessionStorage.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ARRIVALS_ADVANCED_KEY, StepArrivals } from "./step-arrivals";
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

function draftWithMaterials(): WizardDraft {
  const d = defaultDraft();
  return {
    ...d,
    shapeKind: "single-line",
    materials: { ...d.materials, enabled: true },
  };
}

describe("StepArrivals (VROL-824) advanced disclosure", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", makeMemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the Advanced disclosure default-closed", () => {
    render(<StepArrivals draft={draftWithMaterials()} update={() => {}} />);
    const details = screen.getByTestId("arrivals-advanced");
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it("keeps inter-arrival + initial bottles + bottlesPerPart above the fold", () => {
    render(<StepArrivals draft={draftWithMaterials()} update={() => {}} />);
    // Inter-arrival distribution control exists when arrivals.enabled.
    expect(screen.getByText(/Inter-arrival time/i)).toBeInTheDocument();
    // Initial bottles + bottles per part are above the fold.
    expect(screen.getByLabelText(/Initial bottles/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Bottles per part/i)).toBeInTheDocument();
  });

  it("hides batch size, initial caps, capsPerPart, recurring behind Advanced", () => {
    render(<StepArrivals draft={draftWithMaterials()} update={() => {}} />);
    // <details> closed → contents present in DOM but not interactive; we
    // assert the disclosure summary surfaces an Advanced label and the
    // sentinel batch-size input is inside the disclosure.
    const details = screen.getByTestId("arrivals-advanced");
    expect(details.textContent).toMatch(/Advanced/i);
    // The batch-size NumberField has id="wiz-batch"; it must live inside
    // the Advanced disclosure, not as a sibling above it.
    const batch = document.getElementById("wiz-batch");
    expect(batch).not.toBeNull();
    expect(details.contains(batch)).toBe(true);
    // Same for caps controls and the recurring section.
    expect(details.contains(document.getElementById("wiz-caps"))).toBe(true);
    expect(details.contains(document.getElementById("wiz-capsPerPart"))).toBe(true);
    expect(details.textContent).toMatch(/recurring/i);
  });

  it("toggling Advanced persists the open-state to sessionStorage", () => {
    const { rerender } = render(<StepArrivals draft={draftWithMaterials()} update={() => {}} />);
    const details = screen.getByTestId("arrivals-advanced") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(window.sessionStorage.getItem(ARRIVALS_ADVANCED_KEY)).toBe("1");
    // A fresh mount (simulating a step revisit) rehydrates the open
    // flag without the user re-clicking the disclosure.
    rerender(<StepArrivals draft={draftWithMaterials()} update={() => {}} />);
    const detailsAfter = screen.getByTestId("arrivals-advanced") as HTMLDetailsElement;
    expect(detailsAfter.open).toBe(true);
  });

  it("auto-opens Advanced when one of its fields has a validation error", async () => {
    render(
      <StepArrivals
        draft={draftWithMaterials()}
        update={() => {}}
        errors={{ batchSize: "Batch size must be at least 1." }}
      />,
    );
    // Auto-open is deferred via queueMicrotask so the React effect doesn't
    // dispatch a synchronous setState; flush microtasks inside act so the
    // resulting setState is committed before we read the DOM.
    await act(async () => {
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
    });
    const details = screen.getByTestId("arrivals-advanced") as HTMLDetailsElement;
    expect(details.open).toBe(true);
  });
});
