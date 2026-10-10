import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"],
  },
  {
    rules: {
      // Privacy rule (CLAUDE.md): no ad-hoc console output in app code.
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // Components are client-facing: they must never reach server-only modules or secrets.
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/env",
                "@/lib/llm/**",
                "@/lib/guards/**",
                "@/lib/ctgov/**",
                "**/lib/env",
                "**/lib/llm/**",
                "**/lib/guards/**",
                "**/lib/ctgov/**",
              ],
              message: "Components must not import server-only modules (env, llm, guards, ctgov).",
            },
          ],
        },
      ],
    },
  },
  {
    // Local scripts print counts/timings/IDs only.
    files: ["eval/**/*.ts"],
    rules: { "no-console": "off" },
  },
];

export default config;
