import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders with default label and role=status", () => {
    render(<Skeleton />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
  });

  it("accepts a custom label", () => {
    render(<Skeleton label="Loading scenarios" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading scenarios");
  });

  it("applies provided className alongside the defaults", () => {
    render(<Skeleton className="h-4 w-32" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("h-4");
    expect(el.className).toContain("w-32");
    expect(el.className).toContain("animate-pulse");
  });
});
