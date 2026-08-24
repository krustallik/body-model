import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { FORECAST_ALGORITHM_VERSION, type ForecastConfig, type ForecastScenario } from "./forecast.types";

export function forecastScenarioFingerprint(input: {
  scenario: ForecastScenario;
  seed: number;
  horizonDays: number;
  config: ForecastConfig;
}): string {
  return stableSha256({ forecastVersion: FORECAST_ALGORITHM_VERSION, ...input });
}

export function forecastSourceFingerprint(input: {
  modelVersion: string;
  recoveryVersion: string | null;
  recoverySourceFingerprint: string | null;
  currentStateSource: unknown;
  personalization: unknown;
  parameters: unknown;
}): string {
  return stableSha256({ forecastVersion: FORECAST_ALGORITHM_VERSION, ...input });
}
