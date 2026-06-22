/**
 * VROL-820 — smoke test the validation gating + Save & exit flow.
 * VROL-783 — focus trap, auto-focus, focus restoration, Escape and
 * background `inert` smoke tests.
 *
 * happy-dom's localStorage shim isn't fully featured, so we install a
 * minimal stand-in for the duration of these specs (same pattern as
 * src/lib/wizard-draft-storage.test.ts).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadWizardDraft } from "@/lib/wizard-draft-storage";

import { WizardShell } from "./wizard-shell";

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

describe("WizardShell (VROL-820)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeMemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <WizardShell open={false} onClose={() => {}} onFinish={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("Next is disabled until the user picks a shape (VROL-821)", () => {
    render(<WizardShell open onClose={() => {}} onFinish={() => {}} />);
    const next = screen.getByRole("button", { name: /Next/i });
    expect(next).toBeDisabled();
    // Clicking any shape card unblocks Next.
    fireEvent.click(screen.getByTestId("shape-card-single-line"));
    expect(screen.getByRole("button", { name: /Next/i })).not.toBeDisabled();
  });

  it("Save & exit persists the draft and calls onClose", () => {
    const onClose = vi.fn();
    render(<WizardShell open onClose={onClose} onFinish={() => {}} />);
    const save = screen.getByRole("button", { name: /Save & exit/i });
    fireEvent.click(save);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(loadWizardDraft()).not.toBeNull();
  });
});

describe("WizardShell (VROL-783) a11y focus management", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeMemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses role=dialog with aria-modal and aria-labelledby wired to the step title", () => {
    render(<WizardShell open onClose={() => {}} onFinish={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const labelledById = dialog.getAttribute("aria-labelledby");
    expect(labelledById).toBeTruthy();
    const title = labelledById ? document.getElementById(labelledById) : null;
    expect(title?.textContent).toMatch(/Shape/i);
  });

  it("renders the rebuilt 8-step stepper (VROL-871)", () => {
    render(<WizardShell open onClose={() => {}} onFinish={() => {}} />);
    // Step 1 of 8 caption proves the new 8-step pipeline is wired.
    expect(screen.getByText(/Step 1 of 8/i)).toBeInTheDocument();
  });

  it("the last step exposes Create scenario (not Run simulation) — VROL-871", async () => {
    const { rerender } = render(<WizardShell open onClose={() => {}} onFinish={() => {}} />);
    // VROL-821 — step 1 starts with no shape selected; click one before
    // walking through the rest of the wizard.
    fireEvent.click(screen.getByTestId("shape-card-single-line"));
    const user = userEvent.setup();
    for (let i = 0; i < 7; i++) {
      const next = screen.getByRole("button", { name: /Next/i });
      await user.click(next);
    }
    expect(screen.getByRole("button", { name: /Create scenario/i })).toBeInTheDocument();
    rerender(<WizardShell open={false} onClose={() => {}} onFinish={() => {}} />);
  });

  it("Escape triggers the Save & exit path (persists draft + closes)", () => {
    const onClose = vi.fn();
    render(<WizardShell open onClose={onClose} onFinish={() => {}} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(loadWizardDraft()).not.toBeNull();
  });

  it("restores focus to the trigger element when the wizard unmounts", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open wizard";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    const { rerender } = render(<WizardShell open onClose={() => {}} onFinish={() => {}} />);
    // Flush the focus microtask that the WizardInner schedules on mount.
    await Promise.resolve();
    rerender(<WizardShell open={false} onClose={() => {}} onFinish={() => {}} />);
    // Focus restoration is deferred one microtask so the inert cleanup
    // (a sibling effect) has run; flush before asserting.
    await Promise.resolve();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it("marks background body siblings as inert while open and clears on close", () => {
    const sibling = document.createElement("div");
    sibling.setAttribute("data-testid", "bg-sibling");
    document.body.appendChild(sibling);
    expect(sibling.hasAttribute("inert")).toBe(false);
    const { rerender } = render(<WizardShell open onClose={() => {}} onFinish={() => {}} />);
    expect(sibling.hasAttribute("inert")).toBe(true);
    rerender(<WizardShell open={false} onClose={() => {}} onFinish={() => {}} />);
    expect(sibling.hasAttribute("inert")).toBe(false);
    document.body.removeChild(sibling);
  });

  it("Tab from the last focusable wraps inside the dialog (focus trap)", async () => {
    render(<WizardShell open onClose={() => {}} onFinish={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    expect(focusables.length).toBeGreaterThan(1);
    const last = focusables[focusables.length - 1];
    if (!last) throw new Error("no focusables");
    last.focus();
    expect(document.activeElement).toBe(last);
    const user = userEvent.setup();
    await user.tab();
    // Trap: focus must remain inside the dialog, not escape to <body>.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);
  });

  it("Shift+Tab from the first focusable wraps inside the dialog (focus trap)", async () => {
    render(<WizardShell open onClose={() => {}} onFinish={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    const first = focusables[0];
    if (!first) throw new Error("no focusables");
    first.focus();
    const user = userEvent.setup();
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(first);
  });
});

describe("WizardShell (VROL-827) in-modal progress sequence", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeMemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clicking Create scenario advances through the 4-step progress sequence and lands on success", async () => {
    const onFinish = vi.fn();
    const onClose = vi.fn();
    render(<WizardShell open onClose={onClose} onFinish={onFinish} progressPhaseMs={0} />);
    // Pick a shape and walk through the wizard.
    fireEvent.click(screen.getByTestId("shape-card-single-line"));
    const user = userEvent.setup();
    for (let i = 0; i < 7; i++) {
      const next = screen.getByRole("button", { name: /Next/i });
      await user.click(next);
    }
    // Trigger the progress sequence.
    const create = screen.getByRole("button", { name: /Create scenario/i });
    await user.click(create);
    // Modal must NOT close yet — we are showing the progress sequence.
    expect(onClose).not.toHaveBeenCalled();
    // The 4-step indicator is present.
    expect(await screen.findByTestId("wizard-progress-indicator")).toBeInTheDocument();
    // Eventually the success-screen CTA appears.
    const openBtn = await screen.findByTestId("wizard-open-scenario");
    expect(openBtn).toBeInTheDocument();
    // Clicking it hands off to the host and closes the modal.
    await user.click(openBtn);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0]![1]).toBe("run");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the progress indicator is not present while the user is authoring", () => {
    render(<WizardShell open onClose={() => {}} onFinish={() => {}} />);
    expect(screen.queryByTestId("wizard-progress-indicator")).not.toBeInTheDocument();
  });
});
