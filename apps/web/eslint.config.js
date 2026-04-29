import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      ".output/**",
      ".tanstack/**",
      ".vite-hooks/**",
      "dist/**",
      "node_modules/**",
      "src/routeTree.gen.ts",
      "eslint.config.js",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: [
      "src/components/app/**/*.tsx",
      "src/components/session/**/*.tsx",
      "src/routes/**/*.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/\\[[^\\]]+\\]/]",
          message:
            "Do not use arbitrary Tailwind values in product UI. Add a named token in globals.css instead.",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)(text|bg|border)-(neutral|zinc|slate|gray|stone|red|white|black)(-|\\s|$)/]",
          message:
            "Do not use raw palette classes in product UI. Use semantic design tokens like foreground, muted-foreground, stage, overlay, toolbar, or destructive.",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)(max-w|w|h)-\\d/]",
          message:
            "Do not use raw sizing scale classes for product layout. Use named spacing tokens from globals.css.",
        },
      ],
    },
  },
];
