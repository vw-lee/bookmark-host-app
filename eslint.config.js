import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

export default [
  { ignores: ["dist/", "node_modules/", ".svelte-kit/"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs["flat/recommended"],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      /**
       * Task 0h / README §5.4. The single most important rule in this file.
       *
       * Every string the app renders — titles, descriptions, imported bookmarks, metadata
       * scraped by the Phase 6 Action — is attacker-influenceable. Svelte escapes by default,
       * so the only way to reintroduce XSS is one well-meaning {@html}. This makes that a
       * build failure rather than a code-review question.
       */
      "svelte/no-at-html-tags": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    files: ["**/*.test.ts", "scripts/**"],
    rules: { "no-console": "off" },
  },
];
