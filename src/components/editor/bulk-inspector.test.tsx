import { fireEvent, render, screen } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";

import { BulkInspector } from "./bulk-inspector";

const stationNode = (id: string, data: Record<string, unknown> = {}): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: { label: id, ...data },
});

describe("BulkInspector (VROL-663)", () => {
  it("shows the selection count", () => {
    render(
      <BulkInspector
        selectedNodes={[stationNode("a"), stationNode("b"), stationNode("c")]}
        onPatch={() => {}}
      />,
    );
    expect(screen.getByText(/3 stations/i)).toBeInTheDocument();
  });

  it("calling capacity onChange dispatches a patch with the clamped int", () => {
    const onPatch = vi.fn();
    render(
      <BulkInspector selectedNodes={[stationNode("a"), stationNode("b")]} onPatch={onPatch} />,
    );
    const input = screen.getByLabelText("Parallel cycles") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(onPatch).toHaveBeenCalledWith({ capacity: 5 });
  });

  it("shows the shared value when all selected nodes match", () => {
    render(
      <BulkInspector
        selectedNodes={[stationNode("a", { capacity: 3 }), stationNode("b", { capacity: 3 })]}
        onPatch={() => {}}
      />,
    );
    const input = screen.getByLabelText("Parallel cycles") as HTMLInputElement;
    expect(input.value).toBe("3");
  });

  it("falls back when selected nodes disagree", () => {
    render(
      <BulkInspector
        selectedNodes={[stationNode("a", { capacity: 3 }), stationNode("b", { capacity: 5 })]}
        onPatch={() => {}}
      />,
    );
    const input = screen.getByLabelText("Parallel cycles") as HTMLInputElement;
    expect(input.value).toBe("1");
  });
});
