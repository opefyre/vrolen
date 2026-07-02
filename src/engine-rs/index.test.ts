/**
 * VROL-491 — smoke test proving the JS ⇄ Rust WASM bridge is wired.
 *
 * We deliberately touch only the primitive surface exposed today
 * (`hello`, `add`, `version`). Later stories under E15 grow the tests
 * alongside the ported simulation logic; this file's job is just to
 * confirm the pipeline (wasm-pack build output + vite-plugin-wasm +
 * top-level-await) resolves and runs a Rust function from a vitest
 * environment.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it, beforeEach } from "vitest";

import { _resetLoaderForTests, loadRustEngine } from "./index";

// Vitest runs on happy-dom without an HTTP server, so wasm-pack's
// default fetch(engine_rs_bg.wasm) can't resolve. Read the bytes from
// disk and hand them to the loader instead — exercises the same
// `module_or_path` API real Node/edge runtimes would use.
const wasmPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../engine-rs/pkg/engine_rs_bg.wasm",
);
const wasmBytes = readFileSync(wasmPath);

describe("Rust engine bridge (VROL-491)", () => {
  beforeEach(() => {
    _resetLoaderForTests();
  });

  it("loads the wasm-pack module and reports its version", async () => {
    const engine = await loadRustEngine({ wasmInput: wasmBytes });
    expect(engine.version).toMatch(/^engine_rs v\d+\.\d+\.\d+$/);
    expect(engine.hello()).toBe(engine.version);
  });

  it("passes primitive numbers across the JS ⇄ Rust boundary", async () => {
    const engine = await loadRustEngine({ wasmInput: wasmBytes });
    expect(engine.add(2, 3)).toBe(5);
    expect(engine.add(-4, 1)).toBe(-3);
    expect(engine.add(0, 0)).toBe(0);
  });

  it("memoises the loader so the WASM module is only instantiated once", async () => {
    const a = loadRustEngine({ wasmInput: wasmBytes });
    const b = loadRustEngine({ wasmInput: wasmBytes });
    expect(a).toBe(b);
    await Promise.all([a, b]);
  });
});
