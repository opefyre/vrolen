import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ScenarioSummary } from "@/lib/scenario-store";

import { ScenariosList } from "./scenarios-list";

const make = (name: string, lastUsedAtMs: number): ScenarioSummary => ({
  name,
  nodeCount: 3,
  edgeCount: 2,
  savedAtMs: lastUsedAtMs,
  lastUsedAtMs,
});

describe("ScenariosList (VROL-789)", () => {
  it("renders empty state when there are no scenarios", () => {
    render(
      <ScenariosList
        scenarios={[]}
        activeScenarioName={null}
        onPrimaryLoad={() => {}}
        renderItem={() => <div />}
      />,
    );
    expect(screen.getByText(/No saved scenarios yet/i)).toBeInTheDocument();
  });

  it("shows the 2 most-recently-used as primary buttons and the rest collapsed", () => {
    const scenarios = [
      make("oldest", 100),
      make("middle-a", 500),
      make("recent-1", 1_000),
      make("recent-2", 900),
    ];
    render(
      <ScenariosList
        scenarios={scenarios}
        activeScenarioName={null}
        onPrimaryLoad={() => {}}
        renderItem={(s) => <div data-testid={`row-${s.name}`}>{s.name}</div>}
      />,
    );
    const primary = screen.getByTestId("scenarios-primary");
    // Top-2 by recency: recent-1 (1000), recent-2 (900).
    expect(primary).toHaveTextContent("recent-1");
    expect(primary).toHaveTextContent("recent-2");
    // The "More scenarios…" disclosure is closed by default.
    const more = screen.getByTestId("scenarios-more") as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(more).toHaveTextContent(/More scenarios… \(2\)/);
  });

  it("filters the FULL list — primaries hide when they don't match", () => {
    const scenarios = [make("alpha", 100), make("beta-recent", 1_000), make("gamma-recent", 900)];
    render(
      <ScenariosList
        scenarios={scenarios}
        activeScenarioName={null}
        onPrimaryLoad={() => {}}
        renderItem={(s) => <div data-testid={`row-${s.name}`}>{s.name}</div>}
      />,
    );
    const search = screen.getByTestId("scenario-search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "alpha" } });
    expect(screen.queryByTestId("scenarios-primary")).toBeNull();
    expect(screen.getByTestId("row-alpha")).toBeInTheDocument();
  });

  it("shows an empty state when the search yields nothing", () => {
    const scenarios = [make("alpha", 100), make("beta", 200)];
    render(
      <ScenariosList
        scenarios={scenarios}
        activeScenarioName={null}
        onPrimaryLoad={() => {}}
        renderItem={() => <div />}
      />,
    );
    const search = screen.getByTestId("scenario-search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText(/No matches/i)).toBeInTheDocument();
  });

  it("fires onPrimaryLoad when a primary button is clicked", () => {
    const spy = vi.fn();
    const scenarios = [make("first", 100), make("primary-pick", 1_000)];
    render(
      <ScenariosList
        scenarios={scenarios}
        activeScenarioName={null}
        onPrimaryLoad={spy}
        renderItem={() => <div />}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Load scenario primary-pick/i }));
    expect(spy).toHaveBeenCalledWith("primary-pick");
  });
});
