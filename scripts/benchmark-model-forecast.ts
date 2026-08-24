import { performance } from "node:perf_hooks";
import { runForecast } from "@/modules/model-forecast/forecast-engine";
import { validationForecastInput } from "./lib/forecast-validation";

const horizons = [7, 30, 90, 180, 365];
const pathCounts = [128, 512, 2048];
const results = [];
for (const pathCount of pathCounts) {
  for (const horizonDays of horizons) {
    const started = performance.now();
    const result = runForecast(validationForecastInput({ seed: 90_000 + pathCount + horizonDays, horizonDays, pathCount }));
    const runtimeMs = performance.now() - started;
    const final = result.dates.at(-1)!;
    results.push({
      pathCount,
      horizonDays,
      runtimeMs,
      transitions: pathCount * horizonDays,
      validPathCount: result.diagnostics.validPathCount,
      approximatePathMetricMemoryBytes: pathCount * horizonDays * 12 * 8,
      numericalQuality: result.diagnostics.numericalQuality.classification,
      weightMedianKg: final.physiologicalBodyWeightKg.median,
      weightP05Kg: final.physiologicalBodyWeightKg.p05,
      weightP95Kg: final.physiologicalBodyWeightKg.p95,
      fatMassMedianKg: final.fatMassKg.median,
      glycogenMedianKg: final.glycogenKg.median,
    });
  }
}
console.log(JSON.stringify(results, null, 2));
