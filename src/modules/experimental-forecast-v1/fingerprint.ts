import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  EXPERIMENTAL_FORECAST_V1_REVISION,
  type ExperimentalForecastConfig,
  type ExperimentalForecastScenario,
} from "./contracts";

export function experimentalForecastScenarioFingerprint(input: {
  initialStateFingerprint: string;
  scenario: ExperimentalForecastScenario;
  horizonDays: number;
  seed: number;
  config: ExperimentalForecastConfig;
}): string {
  return stableSha256({ forecastRevision: EXPERIMENTAL_FORECAST_V1_REVISION, ...input });
}
