/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * VROL — dev-only OpenAI proxy. Reads the shared key from
 * ../openai.txt (workspace root, outside the git repo) at Vite
 * startup and lets the dev server proxy /api/openai/* requests to
 * api.openai.com with the Authorization header injected server-side.
 *
 * The browser code hits /api/openai/... with no key of its own; the
 * key lives ONLY in Node during `pnpm dev`. Production builds don't
 * carry the key — production needs a real edge-function proxy (future
 * infra work). If the file is missing we no-op the proxy so the app
 * still builds + tests still pass.
 */
function loadSharedOpenAiKey(): string | null {
  try {
    const raw = readFileSync(resolve(import.meta.dirname, "../openai.txt"), "utf-8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}
const SHARED_OPENAI_KEY = loadSharedOpenAiKey();

export default defineConfig({
  // VROL-491 — vite-plugin-wasm + top-level-await let the Rust
  // engine's async WASM init (`await init()`) run at module top level.
  // Order matters: wasm() must sit before topLevelAwait() so the
  // transform sees the wasm imports first.
  plugins: [wasm(), topLevelAwait(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "@engine-rs": resolve(import.meta.dirname, "./engine-rs/pkg"),
    },
  },
  // VROL-657 — manual chunks for the heavy + reusable deps. Splitting
  // these out lets the browser parallelize their download + cache them
  // across visits independently of app code that changes often.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client"],
          xyflow: ["@xyflow/react"],
          lucide: ["lucide-react"],
        },
      },
    },
  },
  // VROL-187 — the render worker imports pixi.js, which produces a
  // code-split worker bundle. Rollup rejects IIFE / UMD formats for
  // multi-chunk workers; ES is the only format that survives. Modern
  // browsers (Chrome 80+, Firefox 114+, Safari 15+) all support module
  // workers, which covers the same baseline as the rest of the app.
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: SHARED_OPENAI_KEY
      ? {
          "/api/openai": {
            target: "https://api.openai.com",
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/openai/, ""),
            configure: (proxy) => {
              proxy.on("proxyReq", (proxyReq) => {
                // Inject the bearer AFTER any client-set Authorization
                // so nothing the browser sends can leak through.
                proxyReq.setHeader("Authorization", `Bearer ${SHARED_OPENAI_KEY}`);
              });
            },
          },
        }
      : undefined,
  },
  // Surface at build/dev time whether the shared key is available so
  // the app can offer "Use Vrolen's key" vs. BYO based on reality.
  define: {
    __VROL_SHARED_OPENAI_AVAILABLE__: JSON.stringify(SHARED_OPENAI_KEY !== null),
  },
  test: {
    environment: "happy-dom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
        "**/*.config.{js,ts}",
        "src/test-setup.ts",
        "src/**/*.test.{ts,tsx}",
        "src/main.tsx",
      ],
    },
  },
});
