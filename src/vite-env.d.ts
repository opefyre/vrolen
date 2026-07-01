/// <reference types="vite/client" />

/**
 * True when Vite dev server has an OpenAI key wired at the proxy so
 * the app can call /api/openai/* without shipping a key to the browser.
 * Defined via `define:` in vite.config.ts.
 */
declare const __VROL_SHARED_OPENAI_AVAILABLE__: boolean;
