//! VROL-491 — Vrolen Rust engine, Phase 4 scaffolding.
//!
//! This crate compiles to WebAssembly via `wasm-pack` and is loaded by
//! the Vite dev server + prod build via the `vite-plugin-wasm` plugin.
//! It ships three functions today, sized to validate that the JS ⇄ Rust
//! bridge is wired end-to-end BEFORE any real simulation logic is ported:
//!
//! - `hello()` returns the crate name + version so the loader can prove
//!   the module resolved and the JS shims are exported correctly.
//! - `add(a, b)` — a boring integer add, used by the vitest smoke test
//!   to prove that primitive values cross the boundary in both
//!   directions.
//! - `set_panic_hook()` forwards Rust panics to `console.error` so
//!   future porting mistakes are visible during dev instead of dying
//!   silently in the WASM module.
//!
//! Real simulation surface (event scheduler, state machine, KPI
//! accumulators) lands in the follow-up stories under E15:
//! VROL-495 → VROL-505.

use wasm_bindgen::prelude::*;

/// Set the console_error panic hook. Idempotent — safe to call multiple
/// times from JS. Called automatically once by [`init`] below; exposed
/// so tests can call it explicitly too.
#[wasm_bindgen(js_name = setPanicHook)]
pub fn set_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// One-shot initialiser JS calls after `await init()`. Installs the
/// panic hook and hands back a version string so callers can
/// double-check the loaded module matches what they expect.
#[wasm_bindgen]
pub fn init() -> String {
    set_panic_hook();
    hello()
}

/// Returns a human-readable identifier for this crate build. Used by
/// the smoke test to prove the module resolved. Format is deliberately
/// stable so string comparisons in tests don't churn on every version
/// bump (assertions match on `name` only via `starts_with`).
#[wasm_bindgen]
pub fn hello() -> String {
    format!(
        "{} v{}",
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION")
    )
}

/// Trivial primitive round-trip used by the smoke test. Adds two 32-bit
/// signed integers. If this returns the wrong value, the JS ⇄ Rust
/// number marshalling is broken and everything downstream will be too.
#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    // Rust-side smoke test — runs via `cargo test` inside the crate.
    // Complements the JS-side test that goes through the WASM bridge.
    #[test]
    fn add_boundary_cases() {
        assert_eq!(add(2, 3), 5);
        assert_eq!(add(-1, 1), 0);
        assert_eq!(add(i32::MAX, 0), i32::MAX);
    }

    #[test]
    fn hello_reports_crate_name() {
        let h = hello();
        assert!(h.starts_with("engine_rs"), "unexpected hello string: {h}");
    }
}
