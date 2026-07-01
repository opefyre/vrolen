/**
 * VROL-834 — /learn route + search tests.
 * VROL-1216 — second-pass polish removed the Concepts + Examples tabs
 * (v1.1 placeholders that undermined trust). Tests updated to assert the
 * single-glossary layout + legacy `?section=` deep-link normalisation.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import App from "@/App";

describe("LearnPage + /help redirect (VROL-834)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("redirects /help to /learn on mount", () => {
    window.history.replaceState(null, "", "/help");
    render(<App />);
    expect(window.location.pathname).toBe("/learn");
    // VROL-1216 — no ?section param anymore; the redirect drops it.
    expect(window.location.search).toBe("");
  });

  it("renders the Learn heading and glossary content on /learn", () => {
    window.history.replaceState(null, "", "/learn");
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: /^Learn$/ })).toBeInTheDocument();
    // Glossary content is inlined — no tab strip.
    expect(screen.queryByRole("tab", { name: /Glossary/i })).toBeNull();
    expect(screen.getByRole("searchbox", { name: /search glossary/i })).toBeInTheDocument();
  });

  it("normalises legacy ?section=concepts to /learn with no section param", () => {
    window.history.replaceState(null, "", "/learn?section=concepts");
    render(<App />);
    // VROL-1216 — old deep links to the removed tabs silently redirect.
    expect(window.location.pathname).toBe("/learn");
    expect(window.location.search).toBe("");
  });

  it("normalises legacy ?section=examples to /learn with no section param", () => {
    window.history.replaceState(null, "", "/learn?section=examples");
    render(<App />);
    expect(window.location.pathname).toBe("/learn");
    expect(window.location.search).toBe("");
  });
});
