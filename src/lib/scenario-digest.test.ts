import { describe, expect, it } from "vitest";

import { digest } from "./scenario-digest";

describe("digest", () => {
  it("is deterministic", () => {
    const a = { x: 1, y: [1, 2, 3] };
    expect(digest(a)).toBe(digest(a));
  });

  it("ignores object key order", () => {
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
  });

  it("respects array order", () => {
    expect(digest([1, 2])).not.toBe(digest([2, 1]));
  });

  it("changes when values differ", () => {
    expect(digest({ x: 1 })).not.toBe(digest({ x: 2 }));
  });

  it("returns an 8-char hex string", () => {
    const h = digest({ x: 1 });
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });
});
