import { describe, expect, it } from "vitest";
import {
  forecastScenarioFingerprint,
  forecastSourceFingerprint,
} from "@/modules/model-forecast/forecast-fingerprint";
import { DEFAULT_FORECAST_CONFIG } from "@/modules/model-forecast/forecast.types";

const scenario = {
  mode: "recent-behavior" as const,
  blockLengthDays: 3,
  donorLookbackDays: 30,
};

describe("forecast fingerprints", () => {
  it("is stable for the same scenario and changes for seed, horizon, config, or scenario", () => {
    const base = { scenario, seed: 7, horizonDays: 30, config: DEFAULT_FORECAST_CONFIG };
    const fingerprint = forecastScenarioFingerprint(base);
    expect(forecastScenarioFingerprint(base)).toBe(fingerprint);
    expect(forecastScenarioFingerprint({ ...base, seed: 8 })).not.toBe(fingerprint);
    expect(forecastScenarioFingerprint({ ...base, horizonDays: 31 })).not.toBe(fingerprint);
    expect(forecastScenarioFingerprint({
      ...base, config: { ...DEFAULT_FORECAST_CONFIG, pathCount: 513 },
    })).not.toBe(fingerprint);
    expect(forecastScenarioFingerprint({
      ...base, scenario: { ...scenario, blockLengthDays: 4 },
    })).not.toBe(fingerprint);
  });

  it("changes with model, recovery, current-state, personalization, and parameter provenance", () => {
    const base = {
      modelVersion: "model-v1",
      recoveryVersion: "recovery-v1",
      recoverySourceFingerprint: "recovery-source-a",
      currentStateSource: { recoveryId: 1 },
      personalization: { activityCalibration: 1 },
      parameters: { sex: "male" },
    };
    const fingerprint = forecastSourceFingerprint(base);
    expect(forecastSourceFingerprint(base)).toBe(fingerprint);
    for (const changed of [
      { ...base, modelVersion: "model-v2" },
      { ...base, recoveryVersion: "recovery-v2" },
      { ...base, recoverySourceFingerprint: "recovery-source-b" },
      { ...base, currentStateSource: { recoveryId: 2 } },
      { ...base, personalization: { activityCalibration: 0.9 } },
      { ...base, parameters: { sex: "female" } },
    ]) expect(forecastSourceFingerprint(changed)).not.toBe(fingerprint);
  });
});
