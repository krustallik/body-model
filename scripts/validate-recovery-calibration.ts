import { runRecoveryGenerativeValidation } from "./lib/recovery-generative-validation";

const result = runRecoveryGenerativeValidation();
console.table(Object.entries(result.coverage).flatMap(([quantity, intervals]) => (
  Object.entries(intervals).map(([interval, value]) => ({
    quantity, interval,
    empirical: Number(value.empirical.toFixed(4)),
    binomial95: `${value.binomial95.lower.toFixed(4)}–${value.binomial95.upper.toFixed(4)}`,
  }))
)));
console.log(JSON.stringify({
  scenarioCount: result.scenarioCount,
  statusCounts: result.statusCounts,
  medianNormalizedEss: result.medianNormalizedEss,
  medianMaximumWeight: result.medianMaximumWeight,
  rankHistograms: result.rankHistograms,
  rankKolmogorovDistance: result.rankKolmogorovDistance,
  byGap: result.byGap,
}, null, 2));
