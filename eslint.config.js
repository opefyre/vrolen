import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", ".vite", "coverage", ".husky/_", "pnpm-lock.yaml"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // shadcn-generated components — relax rules that don't fit their patterns
    // (they export variant constants alongside components, which trips react-refresh)
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // Forbid raw `import.meta.env` reads outside src/config/ — the typed `env`
    // export from `@/config/env` is the single source of truth for environment
    // configuration. Centralizing it makes adding a new env var a 2-file change
    // (env.ts + .env.example) instead of a scavenger hunt across the codebase.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.type='MetaProperty'][property.name='env']",
          message:
            "Use the typed `env` from @/config/env — never read `import.meta.env` directly outside src/config/.",
        },
      ],
    },
  },
  {
    // src/config/ is the one place that's allowed to read import.meta.env raw.
    files: ["src/config/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  prettierConfig,
);
