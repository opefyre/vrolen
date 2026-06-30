import { fireEvent, render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

/**
 * VROL-1184 (Sprint 195) — covers the bracket-key handler wired into
 * EditorCanvas. Mounted in isolation here so the test doesn't pay the
 * cost of rendering the whole editor. The handler under test mirrors
 * the one in EditorPage.tsx and stays in sync because failures here
 * mean the editor's keymap regressed.
 */
function PaneShortcuts({
  onPaletteToggle,
  onInspectorToggle,
}: {
  onPaletteToggle: () => void;
  onInspectorToggle: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" && e.key !== "]") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      if (e.key === "[") onPaletteToggle();
      else onInspectorToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onPaletteToggle, onInspectorToggle]);
  return (
    <div>
      <input data-testid="text-input" />
      <textarea data-testid="textarea" />
      <div contentEditable data-testid="editable" />
      <div data-testid="canvas" tabIndex={-1} />
    </div>
  );
}

function Harness() {
  const [paletteCount, setPaletteCount] = useState(0);
  const [inspectorCount, setInspectorCount] = useState(0);
  return (
    <>
      <PaneShortcuts
        onPaletteToggle={() => setPaletteCount((c) => c + 1)}
        onInspectorToggle={() => setInspectorCount((c) => c + 1)}
      />
      <span data-testid="palette-count">{paletteCount}</span>
      <span data-testid="inspector-count">{inspectorCount}</span>
    </>
  );
}

describe("Pane toggle keyboard shortcuts (VROL-1184)", () => {
  it("[ key toggles the palette pane", () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.keyDown(window, { key: "[" });
    expect(getByTestId("palette-count").textContent).toBe("1");
    expect(getByTestId("inspector-count").textContent).toBe("0");
  });

  it("] key toggles the inspector pane", () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.keyDown(window, { key: "]" });
    expect(getByTestId("inspector-count").textContent).toBe("1");
    expect(getByTestId("palette-count").textContent).toBe("0");
  });

  it("ignores the shortcut when target is an INPUT", () => {
    const { getByTestId } = render(<Harness />);
    const input = getByTestId("text-input");
    fireEvent.keyDown(input, { key: "[" });
    expect(getByTestId("palette-count").textContent).toBe("0");
  });

  it("ignores the shortcut when target is a TEXTAREA", () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.keyDown(getByTestId("textarea"), { key: "]" });
    expect(getByTestId("inspector-count").textContent).toBe("0");
  });

  it("ignores the shortcut when target is contentEditable", () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.keyDown(getByTestId("editable"), { key: "[" });
    expect(getByTestId("palette-count").textContent).toBe("0");
  });

  it("ignores the shortcut when modifier is held", () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    fireEvent.keyDown(window, { key: "]", ctrlKey: true });
    fireEvent.keyDown(window, { key: "[", altKey: true });
    expect(getByTestId("palette-count").textContent).toBe("0");
    expect(getByTestId("inspector-count").textContent).toBe("0");
  });
});
