import {
  runForecastGenerativeValidation,
  runForecastHighPathReference,
  runForecastScenarioModeValidation,
  runForecastUncertaintyDecompositionValidation,
} from "./lib/forecast-validation";

console.log(JSON.stringify({
  main: runForecastGenerativeValidation(),
  decomposition: runForecastUncertaintyDecompositionValidation(),
  scenarioModes: runForecastScenarioModeValidation(),
  highPathReference: runForecastHighPathReference(),
}, null, 2));
