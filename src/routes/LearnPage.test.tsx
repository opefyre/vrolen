/**
 * VROL-834 — /learn route + tab sync tests.
 *
 * Covers the route redirect (/help → /learn), the tab-strip render, and the
 * search-yields-zero EmptyState that aligns with VROL-804.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import App from "@/App";

describe("LearnPage + /help redirect (VROL-834)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("redirects /help to /learn?section=glossary on mount", () => {
    window.history.replaceState(null, "", "/help");
    render(<App />);
    // useEffect runs after first paint — under act, RTL flushes both.
    expect(window.location.pathname).toBe("/learn");
    expect(window.location.search).toBe("?section=glossary");
  });

  it("renders the Learn heading and three tabs on /learn", () => {
    window.history.replaceState(null, "", "/learn?section=glossary");
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: /^Learn$/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Glossary/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Concepts/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Examples/i })).toBeInTheDocument();
  });

  it("deep-links to ?section=concepts and shows the Concepts EmptyState", () => {
    window.history.replaceState(null, "", "/learn?section=concepts");
    render(<App />);
    expect(screen.getByText(/Concepts coming soon/i)).toBeInTheDocument();
  });

  it("syncs the URL when the user changes tabs", () => {
    window.history.replaceState(null, "", "/learn?section=glossary");
    render(<App />);
    const examplesTab = screen.getByRole("tab", { name: /Examples/i });
    act(() => {
      examplesTab.click();
    });
    expect(window.location.search).toBe("?section=examples");
  });
});
