/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
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
