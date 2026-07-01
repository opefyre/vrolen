import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The IsoCanvas + Pixi worker chain doesn't run in happy-dom. Stub
// IsoCanvas to a plain wrapper so the shell + surrounding behavior
// remain testable.
vi.mock("@/render/iso-canvas", () => ({
  IsoCanvas: () => <div data-testid="iso-canvas-stub" />,
}));

import type { Edge, Node } from "@xyflow/react";

import { IsoPlaybackView } from "./IsoPlaybackView";

const NODES: Node[] = [
  { id: "a", type: "station", position: { x: 0, y: 0 }, data: { label: "A" } },
  { id: "b", type: "station", position: { x: 200, y: 0 }, data: { label: "B" } },
];
const EDGES: Edge[] = [{ id: "e", source: "a", target: "b" }];

describe("IsoPlaybackView (VROL-854)", () => {
  it("renders the wrapper + read-only badge", () => {
    render(<IsoPlaybackView nodes={NODES} edges={EDGES} result={null} />);
    expect(screen.getByTestId("iso-playback-view")).toBeInTheDocument();
    expect(screen.getByTestId("iso-canvas-stub")).toBeInTheDocument();
    expect(screen.getByText(/Playback/i)).toBeInTheDocument();
  });
});
