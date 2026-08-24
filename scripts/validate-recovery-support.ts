import { runRecoverySupportValidation } from "./lib/recovery-support-validation";

const result = runRecoverySupportValidation();
console.table(Object.entries(result.coverage).map(([quantity, coverage]) => ({
  quantity,
  central50: Number(coverage.central50.toFixed(4)),
  high90: Number(coverage.high90.toFixed(4)),
})));
console.log(JSON.stringify({
  scenarioCount: result.scenarioCount,
  statusCounts: result.statusCounts,
  supportCases: result.supportCases,
  high90FailureCount: result.failures.length,
  byGap: result.byGap,
  failures: result.failures,
}, null, 2));
