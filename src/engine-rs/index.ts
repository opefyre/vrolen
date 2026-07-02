/**
 * VROL-491 — TypeScript bridge to the Rust engine (Phase 4 kickoff).
 *
 * The Rust crate lives at `engine-rs/` and is compiled to WebAssembly
 * via wasm-pack (target=web, --release). Vite's wasm + topLevelAwait
 * plugins handle the actual module resolution; this file wraps the
 * generated `pkg/engine_rs.js` in a thin async-load API so callers can
 * do:
 *
 *   const engine = await loadRustEngine();
 *   engine.add(2, 3); // → 5
 *   engine.hello();   // → "engine_rs v0.1.0"
 *
 * Follow-up stories (VROL-495 scheduler, VROL-498 state machine,
 * VROL-509 output-parity, VROL-516 UI wire-up) will grow this surface;
 * for now it's just the primitives needed to prove the bridge works.
 *
 * Loader is memoised so the WASM module is fetched + instantiated
 * exactly once per browser session even if multiple UI surfaces call
 * `loadRustEngine()`. Errors from the init call bubble up so a
 * missing / broken build surfaces to the caller with a real stack
 * instead of a silent noop.
 */

// The `?url` variant tells Vite to hand back the URL of the wasm-pack
// generated JS shim. We import it lazily inside loadRustEngine so
// pulling this module into a bundle doesn't force a WASM download at
// app boot — only routes that actually use the Rust engine pay for it.

export interface RustEngine {
  /** Human-readable identifier for the loaded WASM build. */
  readonly hello: () => string;
  /** Primitive round-trip; VROL-491 smoke-test surface only. */
  readonly add: (a: number, b: number) => number;
  /** Version string returned by the wasm-side init(); also captured
   *  at load time and exposed via `.version` for convenience. */
  readonly version: string;
}

let loader: Promise<RustEngine> | null = null;

/**
 * Optional init override. In the browser we let wasm-pack fetch its
 * .wasm sibling by URL; in vitest (happy-dom) there's no HTTP server
 * so we resolve the binary from disk via `readFileSync` before init
 * and hand the bytes in. Callers don't normally need to touch this.
 */
export interface LoaderOptions {
  readonly wasmInput?: BufferSource | Promise<BufferSource>;
}

export function loadRustEngine(options?: LoaderOptions): Promise<RustEngine> {
  if (loader) return loader;
  loader = (async () => {
    const mod = (await import("@engine-rs/engine_rs.js")) as {
      default: (input?: unknown) => Promise<unknown>;
      init: () => string;
      hello: () => string;
      add: (a: number, b: number) => number;
    };
    // The default export is the async initialiser wasm-pack emits.
    // Browser: called with no argument → fetches `engine_rs_bg.wasm`.
    // Node (vitest): pass raw bytes so no HTTP fetch is required.
    if (options?.wasmInput !== undefined) {
      await mod.default({ module_or_path: options.wasmInput } as unknown);
    } else {
      await mod.default();
    }
    const version = mod.init();
    return {
      hello: mod.hello,
      add: mod.add,
      version,
    };
  })();
  return loader;
}

/** Test-only escape hatch to reset the memoised loader between test
 *  cases. Not used in application code. */
export function _resetLoaderForTests(): void {
  loader = null;
}
