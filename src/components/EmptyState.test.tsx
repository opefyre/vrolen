import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Inbox } from "lucide-react";

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title only when other slots are not provided", () => {
    render(<EmptyState title="No scenarios yet" />);
    expect(screen.getByRole("heading", { name: /no scenarios yet/i })).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    const { container } = render(<EmptyState icon={Inbox} title="Empty" />);
    // Lucide renders as inline SVG
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders body when provided", () => {
    render(<EmptyState title="Empty" body="Try creating one." />);
    expect(screen.getByText(/try creating one/i)).toBeInTheDocument();
  });

  it("renders action when provided", () => {
    render(<EmptyState title="Empty" action={<button>Create</button>} />);
    expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
  });
});
