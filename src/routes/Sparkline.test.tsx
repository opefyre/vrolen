import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sparkline } from "./Sparkline";

describe("Sparkline (VROL-614)", () => {
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

  it("emits one M command + (N-1) L commands for N samples", () => {
    const { container } = render(<Sparkline series={[1, 2, 3, 4, 5]} />);
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    expect((d.match(/M /g) ?? []).length).toBe(1);
    expect((d.match(/ L /g) ?? []).length).toBe(4);
  });

  it("scales so the peak sample lands at y === 1 (top of inner plot)", () => {
    const { container } = render(<Sparkline series={[0, 0, 0, 10]} />);
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    // Last L command's y should equal 1.0 (rendered as "1.0").
    const parts = d.split(" ");
    const lastY = parts[parts.length - 1];
    expect(lastY).toBe("1.0");
  });
});
