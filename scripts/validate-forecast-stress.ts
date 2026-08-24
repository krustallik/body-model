import { canonicalForecasts, runForecastStressValidation } from "./lib/forecast-validation";

const canonical = Object.fromEntries(Object.entries(canonicalForecasts()).map(([name, result]) => {
  const final = result.dates.at(-1)!;
  return [name, {
    status: result.status,
    initialStateQuality: result.initialStateQuality,
    horizonDays: result.horizonDays,
    final: {
      weight: final.physiologicalBodyWeightKg,
      fatMass: final.fatMassKg,
      glycogen: final.glycogenKg,
      rmr: final.dynamicRmrKcalPerDay,
      tdee: final.tdeeKcalPerDay,
    },
  }];
}));
console.log(JSON.stringify({ stress: runForecastStressValidation(), canonical }, null, 2));
