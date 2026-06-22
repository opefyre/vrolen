/**
 * VROL-871 — connections step renders an edge editor and a DAG preview.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StepConnections } from "./step-connections";
import { defaultDraft } from "./wizard-types";

describe("StepConnections (VROL-871)", () => {
  it("renders one row per existing edge", () => {
    const draft = defaultDraft();
    render(<StepConnections draft={draft} update={() => {}} />);
    // Each edge has a source select and a target select.
    const sources = screen.getAllByLabelText(/From/i);
    expect(sources).toHaveLength(draft.connections.length);
  });

  it("Add connection appends a new edge between the first two stations", () => {
    const draft = defaultDraft();
    const update = vi.fn();
    render(<StepConnections draft={draft} update={update} />);
    fireEvent.click(screen.getByRole("button", { name: /Add connection/i }));
    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0]?.[0] as { connections?: unknown[] };
    expect(patch.connections).toBeDefined();
    expect((patch.connections ?? []).length).toBe(draft.connections.length + 1);
  });

  it("surfaces single-source / single-sink errors when both fail", () => {
    const draft = defaultDraft();
    render(
      <StepConnections
        draft={{ ...draft, connections: [] }}
        update={() => {}}
        errors={{
          sources: "Only one starting station is allowed (single source).",
          sinks: "Only one ending station is allowed (single sink).",
        }}
      />,
    );
    // Use getAllByText since the FieldError + summary copy can match.
    expect(screen.getAllByText(/single source/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/single sink/i).length).toBeGreaterThan(0);
  });
});
