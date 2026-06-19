import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Accordion, AccordionStatus } from "./accordion";

describe("Accordion (VROL-635)", () => {
  it("renders title + chevron; body hidden when not expanded", () => {
    render(
      <Accordion title="Materials" expanded={false} onToggle={() => undefined}>
        <div>body content</div>
      </Accordion>,
    );
    expect(screen.getByText("Materials")).toBeInTheDocument();
    expect(screen.queryByText("body content")).toBeNull();
  });

  it("mounts body when expanded=true", () => {
    render(
      <Accordion title="Materials" expanded={true} onToggle={() => undefined}>
        <div>body content</div>
      </Accordion>,
    );
    expect(screen.getByText("body content")).toBeInTheDocument();
  });

  it("clicking the header calls onToggle", () => {
    const onToggle = vi.fn();
    render(
      <Accordion title="Materials" expanded={false} onToggle={onToggle}>
        body
      </Accordion>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Materials/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders the status chip via AccordionStatus", () => {
    render(
      <Accordion
        title="Workers"
        status={<AccordionStatus tone="on">On · 2 workers</AccordionStatus>}
        expanded={false}
        onToggle={() => undefined}
      >
        body
      </Accordion>,
    );
    expect(screen.getByText("On · 2 workers")).toBeInTheDocument();
  });

  it("aria-expanded reflects the expanded prop", () => {
    const { rerender } = render(
      <Accordion title="X" expanded={false} onToggle={() => undefined}>
        body
      </Accordion>,
    );
    expect(screen.getByRole("button", { name: /X/i }).getAttribute("aria-expanded")).toBe("false");
    rerender(
      <Accordion title="X" expanded={true} onToggle={() => undefined}>
        body
      </Accordion>,
    );
    expect(screen.getByRole("button", { name: /X/i }).getAttribute("aria-expanded")).toBe("true");
  });
});
