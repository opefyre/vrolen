import type { Edge, Node } from "@xyflow/react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TopologyPreview } from "./topology-preview";

const node = (id: string, x: number, y: number, stationType = "machine"): Node => ({
  id,
  position: { x, y },
  data: { label: id, stationType },
});

describe("TopologyPreview (VROL-666)", () => {
  it("renders one circle per node and one line per edge", () => {
    const nodes = [node("a", 0, 0), node("b", 100, 0), node("c", 200, 0)];
    const edges: Edge[] = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
    ];
    const { container } = render(<TopologyPreview nodes={nodes} edges={edges} />);
    expect(container.querySelectorAll("svg circle")).toHaveLength(3);
    expect(container.querySelectorAll("svg line")).toHaveLength(2);
  });

  it("renders nothing for an empty topology", () => {
    const { container } = render(<TopologyPreview nodes={[]} edges={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("skips edges that reference unknown nodes", () => {
    const nodes = [node("a", 0, 0), node("b", 100, 0)];
    const edges: Edge[] = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "a", target: "ghost" },
    ];
    const { container } = render(<TopologyPreview nodes={nodes} edges={edges} />);
    expect(container.querySelectorAll("svg line")).toHaveLength(1);
  });
});
