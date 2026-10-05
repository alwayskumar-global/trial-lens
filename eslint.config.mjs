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
    // Local scripts print counts/timings/IDs only.
    files: ["eval/**/*.ts"],
    rules: { "no-console": "off" },
  },
];

export default config;
