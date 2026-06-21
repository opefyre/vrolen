/**
 * VROL-820 — smoke test the validation gating + Save & exit flow.
 *
 * happy-dom's localStorage shim isn't fully featured, so we install a
 * minimal stand-in for the duration of these specs (same pattern as
 * src/lib/wizard-draft-storage.test.ts).
 */

import { fireEvent, render, screen } from "@testing-library/react";
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

  it("Next is enabled for the default draft because the preset is preselected", () => {
    render(<WizardShell open onClose={() => {}} onFinish={() => {}} />);
    const next = screen.getByRole("button", { name: /Next/i });
    expect(next).not.toBeDisabled();
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
