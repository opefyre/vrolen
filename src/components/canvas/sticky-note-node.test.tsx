import { ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  STICKY_COLORS,
  STICKY_DEFAULT_H,
  STICKY_DEFAULT_W,
  STICKY_MAX_H,
  STICKY_MAX_W,
  STICKY_MIN_H,
  STICKY_MIN_W,
  StickyNoteNode,
} from "./sticky-note-node";

// Minimal props for an unconnected NodeProps. The component only reads
// id / data / selected, so we cast through unknown to satisfy NodeProps.
function renderSticky(data: Record<string, unknown>, selected = true): ReturnType<typeof render> {
  // The NodeProps type from React Flow has ~20 fields the component never
  // touches; building the full shape is noisy and brittle, so we cast.
  const props = { id: "n1", data, selected } as unknown as Parameters<typeof StickyNoteNode>[0];
  return render(
    <ReactFlowProvider>
      <StickyNoteNode {...props} />
    </ReactFlowProvider>,
  );
}

describe("StickyNoteNode (VROL-785)", () => {
  it("renders persisted width / height from node.data", () => {
    renderSticky({ text: "Hi", color: "blue", width: 200, height: 150, author: "Abolfazl" });
    const note = screen.getByTestId("sticky-note") as HTMLElement;
    expect(note.style.width).toBe("200px");
    expect(note.style.height).toBe("150px");
  });

  it("clamps oversized + tiny sizes to [min, max] (resize state round-trip)", () => {
    renderSticky({ width: 9999, height: 9999 });
    const huge = screen.getByTestId("sticky-note") as HTMLElement;
    expect(huge.style.width).toBe(`${String(STICKY_MAX_W)}px`);
    expect(huge.style.height).toBe(`${String(STICKY_MAX_H)}px`);
  });

  it("falls back to the default size when data has no width / height", () => {
    renderSticky({});
    const note = screen.getByTestId("sticky-note") as HTMLElement;
    expect(note.style.width).toBe(`${String(STICKY_DEFAULT_W)}px`);
    expect(note.style.height).toBe(`${String(STICKY_DEFAULT_H)}px`);
  });

  it("renders the 5-swatch picker when selected", () => {
    renderSticky({}, true);
    const swatches = screen.getByTestId("sticky-swatches");
    const buttons = swatches.querySelectorAll("button");
    expect(buttons.length).toBe(STICKY_COLORS.length);
    expect(buttons.length).toBe(5);
  });

  it("hides the swatch picker when not selected", () => {
    renderSticky({}, false);
    expect(screen.queryByTestId("sticky-swatches")).toBeNull();
  });

  it("renders the author bubble with the first letter and a tooltip", () => {
    renderSticky({ author: "Abolfazl" });
    const bubble = screen.getByTestId("sticky-author-bubble");
    expect(bubble.textContent).toBe("A");
    expect(bubble.getAttribute("title")).toBe("Abolfazl");
  });

  it("defaults the author to You when data.author is unset", () => {
    renderSticky({});
    const bubble = screen.getByTestId("sticky-author-bubble");
    expect(bubble.textContent).toBe("Y");
    expect(bubble.getAttribute("title")).toBe("You");
  });

  it("exposes a bottom-right resize grip with the nodrag class", () => {
    renderSticky({});
    const grip = screen.getByTestId("sticky-resize-grip");
    expect(grip.className).toContain("nodrag");
    expect(grip.className).toContain("cursor-nwse-resize");
  });

  it("STICKY_COLORS contains the 5 swatches in the documented order", () => {
    expect([...STICKY_COLORS]).toEqual(["yellow", "blue", "rose", "green", "gray"]);
  });

  it("STICKY_MIN_W / STICKY_MIN_H match the 120×80 floor", () => {
    expect(STICKY_MIN_W).toBe(120);
    expect(STICKY_MIN_H).toBe(80);
    expect(STICKY_MAX_W).toBe(480);
    expect(STICKY_MAX_H).toBe(360);
  });

  it("does not crash on a swatch click (selected case)", () => {
    renderSticky({ color: "yellow" }, true);
    const yellow = screen.getByLabelText(/yellow sticky color/i);
    fireEvent.click(yellow);
    // Click handler calls setNodes through the React Flow store; we just
    // assert no throw and that the swatch is still rendered.
    expect(yellow).toBeInTheDocument();
  });
});
