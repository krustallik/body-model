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
      include: [
        "src/model/**/*.ts",
        "src/modules/health/**/*.ts",
        "src/modules/days/**/*.ts",
        "src/modules/profile/**/*.ts",
        "src/modules/work-intervals/**/*.ts",
        "src/modules/model-episodes/**/*.ts",
        "src/modules/model-recovery/**/*.ts",
        "src/modules/model-forecast/**/*.ts",
        "src/modules/model-target-solver/**/*.ts",
        "src/modules/model-goal-planning/**/*.ts",
        "src/modules/model-diagnostics/**/*.ts",
        "src/app/api/**/*.ts",
        "src/lib/env.ts",
        "src/app/forecast/forecast-client.tsx",
        "src/app/forecast/forecast-chart.tsx",
        "src/app/goal/goal-client.tsx",
        "src/app/history/history-charts.tsx",
        "src/app/history/workout-details-dialog.tsx",
        "src/app/history/history-client.tsx",
        "src/components/help-tip.tsx",
      ],
      exclude: ["src/modules/health/health.types.ts"],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 85,
        statements: 85,
      },
    },
  },
});
