import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier/recommended";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  prettierPlugin,
  // Architecture rules from CLAUDE.md.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.{ts,tsx}", "app/api/test/**"],
    rules: {
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@phosphor-icons/react",
              message: 'Import from "@phosphor-icons/react/ssr" instead.',
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='revalidatePath']",
          message: "Use updateTag(groupTag(slug)), never revalidatePath.",
        },
        {
          selector:
            "CallExpression[callee.property.name='delete']:has(CallExpression[callee.property.name='from'][arguments.0.value='memberships'])",
          message:
            "Never delete memberships directly; use removeMembership (lib/membership).",
        },
      ],
    },
  },
  {
    files: ["lib/membership/**"],
    rules: { "no-restricted-syntax": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
