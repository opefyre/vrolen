import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// With `globals: false` in vitest config, RTL's auto-cleanup doesn't run
// (it relies on a global `afterEach`). Wire it up explicitly so each test
// starts with a fresh DOM and queries don't return stale elements.
afterEach(() => {
  cleanup();
});
