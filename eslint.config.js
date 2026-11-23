import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: [".wrangler/", ".claude/", ".agents/", ".codex/"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ["public/js/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["public/sw.js"],
    languageOptions: { globals: { ...globals.worker, ...globals.serviceworker } },
  },
  {
    files: ["test/**/*.js", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      // Handlers share one (env, request, ctx) signature, so unused parameters
      // are expected; storage writes are allowed to fail silently on purpose.
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
