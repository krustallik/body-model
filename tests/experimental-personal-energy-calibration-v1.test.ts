import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  evaluateExperimentalPersonalEnergyCalibrationCoverageV1,
  experimentalPersonalEnergyCalibrationCoverageV1Fingerprint,
  EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_PROVENANCE,
} from "@/model/activity/experimental-personal-energy-calibration-v1";

const asOf = "2026-09-21T12:00:00.000Z";

function observation(index: number, overrides: Record<string, unknown> = {}) {
  return {
    sessionId: `session-${index}`,
    observedAt: `2026-09-${String(10 + index).padStart(2, "0")}T12:00:00.000Z`,
    modality: "resistance-diary" as const,
    source: "garmin",
    deviceId: "garmin-watch-a",
    timingQuality: "complete" as const,
    hrCoverage: "contextual" as const,
    garminReferenceKcal: 300 + index,
    ...overrides,
  };
}

/** EXPERIMENTAL harness — validation coverage, never calorimetry truth. */
describe("experimental personal active-energy calibration coverage v1", () => {
  it("narrows experimental uncertainty after repeated same-modality/device compatible observations (C-K03)", () => {
    const result = evaluateExperimentalPersonalEnergyCalibrationCoverageV1({
      asOf,
      observations: [observation(1), observation(2), observation(3)],
    });
    expect(result.status).toBe("repeated-compatible-observations");
    expect(result.uncertaintyWidthMultiplier).toBeLessThan(1);
    expect(result.modality).toBe("resistance-diary");
    expect(result.source).toBe("garmin");
    expect(result.deviceId).toBe("garmin-watch-a");
    expect(result.calibrationApplication).toBe("intentionally-not-applied");
    expect(result.provenance).toBe(EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_PROVENANCE);
  });

  it("does not narrow uncertainty for mixed modality or device observations", () => {
    const mixed = evaluateExperimentalPersonalEnergyCalibrationCoverageV1({
      asOf,
      observations: [
        observation(1),
        observation(2, { modality: "ms100-stepper" }),
        observation(3, { deviceId: "garmin-watch-b" }),
      ],
    });
    expect(mixed.status).toBe("mixed-modality-or-device");
    expect(mixed.uncertaintyWidthMultiplier).toBe(1);
    expect(mixed.reasons).toContain("mixed-modality-or-device-observations-do-not-narrow-uncertainty");
  });

  it("blocks calibration and widens uncertainty for poor HR or timing coverage", () => {
    const poorCoverage = evaluateExperimentalPersonalEnergyCalibrationCoverageV1({
      asOf,
      observations: [
        observation(1),
        observation(2, { hrCoverage: "sparse" }),
        observation(3, { timingQuality: "partial" }),
      ],
    });
    expect(poorCoverage.status).toBe("insufficient-timing-or-hr-coverage");
    expect(poorCoverage.uncertaintyWidthMultiplier).toBeGreaterThan(1);
    expect(poorCoverage.reasons).toContain("poor-timing-or-hr-coverage-blocks-calibration-and-widens-uncertainty");
  });

  it("keeps Garmin and HR out of any truth or kcal conversion", () => {
    const lowGarmin = evaluateExperimentalPersonalEnergyCalibrationCoverageV1({
      asOf,
      observations: [observation(1, { garminReferenceKcal: 1 }), observation(2, { garminReferenceKcal: 2 }), observation(3, { garminReferenceKcal: 3 })],
    });
    const highGarmin = evaluateExperimentalPersonalEnergyCalibrationCoverageV1({
      asOf,
      observations: [observation(1, { garminReferenceKcal: 900 }), observation(2, { garminReferenceKcal: 1_200 }), observation(3, { garminReferenceKcal: 1_500 })],
    });
    expect(highGarmin).toEqual(lowGarmin);
    expect(highGarmin.reasons).toContain("garmin-reference-diagnostic-only-not-calibration-target");
    expect(highGarmin.hrUncertainty.role).toBe("context-and-coverage-only-not-kcal-conversion");
  });

  it("labels resistance HR uncertainty as device/activity-specific without a universal cardio ranking (C-L04)", () => {
    const result = evaluateExperimentalPersonalEnergyCalibrationCoverageV1({
      asOf,
      observations: [observation(1), observation(2), observation(3)],
    });
    expect(result.hrUncertainty).toEqual({
      role: "context-and-coverage-only-not-kcal-conversion",
      classification: "activity-and-device-specific",
      universalResistanceVsCardioErrorRanking: "intentionally-not-defined",
    });
  });

  it("keeps missing calibration evidence unavailable rather than claiming zero uncertainty", () => {
    const missing = evaluateExperimentalPersonalEnergyCalibrationCoverageV1({ asOf, observations: [] });
    expect(missing.availability).toBe("unavailable");
    expect(missing.status).toBe("missing-evidence");
    expect(missing.uncertaintyWidthMultiplier).toBeNull();
    expect(missing.reasons).toContain("missing-calibration-evidence-is-not-zero-uncertainty");
  });

  it("is deterministic and remains outside production forecast/TDEE paths", () => {
    const input = { asOf, observations: [observation(3), observation(1), observation(2)] };
    const a = evaluateExperimentalPersonalEnergyCalibrationCoverageV1(input);
    const b = evaluateExperimentalPersonalEnergyCalibrationCoverageV1(input);
    expect(a).toEqual(b);
    expect(experimentalPersonalEnergyCalibrationCoverageV1Fingerprint(a))
      .toBe(experimentalPersonalEnergyCalibrationCoverageV1Fingerprint(b));
    expect(readFileSync("src/model/dynamic-daily-expenditure.ts", "utf8"))
      .not.toContain("evaluateExperimentalPersonalEnergyCalibrationCoverageV1");
    expect(readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8"))
      .not.toContain("evaluateExperimentalPersonalEnergyCalibrationCoverageV1");
  });
});
