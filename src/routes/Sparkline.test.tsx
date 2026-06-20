import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders nothing for empty / single-sample series", () => {
    const a = render(<Sparkline series={[]} />);
    expect(a.container.querySelector("svg")).toBeNull();
    a.unmount();
    const b = render(<Sparkline series={[3]} />);
    expect(b.container.querySelector("svg")).toBeNull();
  });

  it("renders nothing when the peak is zero", () => {
    const { container } = render(<Sparkline series={[0, 0, 0, 0]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders an area + line path with (N-1) line segments", () => {
    const { container } = render(<Sparkline series={[1, 2, 3, 4, 5]} />);
    const paths = container.querySelectorAll("path");
    // First path is the area polygon, second is the line.
    expect(paths.length).toBe(2);
    const linePath = paths[1]?.getAttribute("d") ?? "";
    expect((linePath.match(/M /g) ?? []).length).toBe(1);
    expect((linePath.match(/L /g) ?? []).length).toBe(4);
  });

  it("scales so the peak sample lands near the top of the inner plot", () => {
    const { container } = render(<Sparkline series={[0, 0, 0, 10]} />);
    const linePath = container.querySelectorAll("path")[1]?.getAttribute("d") ?? "";
    // Parse the final "L x y" command — y should be the top inner pad (1.5).
    const tokens = linePath.trim().split(/\s+/);
    const lastY = Number(tokens[tokens.length - 1]);
    expect(lastY).toBeCloseTo(1.5, 1);
  });

  it("renders at least one marker circle", () => {
    const { container } = render(<Sparkline series={[1, 2, 3, 4, 5]} />);
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(1);
  });
});
