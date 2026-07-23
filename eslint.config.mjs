import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
  },
  globalIgnores([
    "**/.next/**",
    "**/coverage/**",
    "**/node_modules/**",
    "**/playwright-report/**",
    "**/test-results/**",
  ]),
]);
