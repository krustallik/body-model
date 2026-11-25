export const UNIT_COVERAGE_INCLUDE = Object.freeze([
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
]);

export const UNIT_COVERAGE_THRESHOLDS = Object.freeze({
  lines: 85,
  branches: 80,
  functions: 85,
  statements: 85,
});
