import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    restoreMocks: true,
    exclude: ["tests/integration/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/model/**/*.ts", "src/modules/health/**/*.ts", "src/modules/days/**/*.ts", "src/modules/profile/**/*.ts", "src/modules/work-intervals/**/*.ts", "src/modules/model-episodes/**/*.ts", "src/app/api/**/*.ts", "src/lib/env.ts"],
      exclude: ["src/modules/health/health.types.ts"],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 85,
        statements: 85,
      },
    },
  },
});
