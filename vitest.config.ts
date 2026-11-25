import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { readFileSync } from "node:fs";
import { UNIT_COVERAGE_INCLUDE, UNIT_COVERAGE_THRESHOLDS } from "./scripts/refactor/coverage-scopes.mjs";

const includeModuleCoverage = process.env.BODYCAST_INCLUDE_MODULE_COVERAGE === "1";
const moduleCoverageRoots = includeModuleCoverage
  ? JSON.parse(readFileSync(new URL("./tests/refactor-comparator/module-coverage-v1.json", import.meta.url), "utf8")).sourceRoots
  : [];

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    restoreMocks: true,
    exclude: ["tests/integration/**", "**/node_modules/**", "**/.next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: [
        ...UNIT_COVERAGE_INCLUDE,
        ...moduleCoverageRoots.map((root: string) => `${root}/**/*.{ts,tsx,js,jsx}`),
      ],
      exclude: ["src/modules/health/health.types.ts"],
      thresholds: UNIT_COVERAGE_THRESHOLDS,
    },
  },
});
