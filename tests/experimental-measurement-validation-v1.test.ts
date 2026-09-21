import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyExperimentalWaterObservationV1,
  evaluateExperimentalMeasurementMethodConsistencyV1,
  experimentalMeasurementValidationV1Fingerprint,
  rebuildExperimentalMeasurementValidationTrajectoryV1,
  type LongitudinalMeasurementObservationV1,
  type WaterObservationV1,
} from "@/model/physiology-v7/experimental-measurement-validation-v1";

function water(overrides: Partial<WaterObservationV1> = {}): WaterObservationV1 {
  return {
    kind: "hydration-status",
    source: "garmin",
    deviceId: "garmin-1",
    observedAt: "2026-09-20T08:00:00.000Z",
    timing: "unknown",
    ...overrides,
  };
}

function measurement(
  id: number,
  overrides: Partial<LongitudinalMeasurementObservationV1> = {},
): LongitudinalMeasurementObservationV1 {
  return {
    id: `measurement-${id}`,
    observedAt: `2026-09-${String(10 + id).padStart(2, "0")}T08:00:00.000Z`,
    endpoint: "bia-body-composition",
    source: "withings",
    deviceId: "withings-1",
    site: null,
    hydrationCondition: "standardized",
    acuteExerciseCondition: "standardized",
    ...overrides,
  };
}

describe("Experimental Measurement Validation V1 (shadow only)", () => {
  it("keeps hydration observations out of glycogen water without compatible glycogen evidence (C-I03)", () => {
    const result = classifyExperimentalWaterObservationV1({
      observation: water(),
      glycogenDeltaKg: 0.2,
    });

    expect(result.classification).toBe("unresolved");
    expect(result.glycogenWaterDeltaKg).toBeNull();
    expect(result.waterObservationAppliedToState).toBe(false);
    expect(result.residualAllocation).toBe("intentionally-rejected");
  });

  it("uses compatible glycogen-change evidence rather than a water observation as glycogen water", () => {
    const result = classifyExperimentalWaterObservationV1({
      observation: water({
        kind: "total-body-water",
        timing: "contemporaneous-with-glycogen-evidence",
      }),
      glycogenDeltaKg: 0.2,
    });

    expect(result.classification).toBe("compatible-glycogen-context");
    expect(result.glycogenWaterDeltaKg).toBeCloseTo(0.7);
    expect(result.waterObservationAppliedToState).toBe(false);
  });

  it("leaves ambiguous ECF or missing water evidence unresolved rather than zero", () => {
    const ambiguous = classifyExperimentalWaterObservationV1({
      observation: water({ kind: "ecf" }),
      glycogenDeltaKg: null,
    });
    const missing = classifyExperimentalWaterObservationV1({
      observation: null,
      glycogenDeltaKg: null,
    });

    expect(ambiguous.classification).toBe("unresolved");
    expect(ambiguous.glycogenWaterDeltaKg).toBeNull();
    expect(missing.availability).toBe("unavailable");
    expect(missing.glycogenWaterDeltaKg).toBeNull();
  });

  it("narrows only repeated standardized observations from the same measurement method", () => {
    const result = evaluateExperimentalMeasurementMethodConsistencyV1({
      observations: [measurement(1), measurement(2), measurement(3)],
    });

    expect(result.status).toBe("compatible-same-method-series");
    expect(result.uncertaintyWidthMultiplier).toBe(0.85);
    expect(result.measurementRole).toBe("aggregate-lean-context");
    expect(result.latentStateApplication).toBe("intentionally-not-applied");
  });

  it("does not treat replayed copies as independent measurements", () => {
    const original = measurement(1);
    const result = evaluateExperimentalMeasurementMethodConsistencyV1({
      observations: [original, { ...original }, { ...original }],
    });
    expect(result.inputObservationCount).toBe(3);
    expect(result.duplicateObservationCount).toBe(2);
    expect(result.observationCount).toBe(1);
    expect(result.status).toBe("insufficient-compatible-series");
    expect(result.uncertaintyWidthMultiplier).toBe(1);
    expect(result.reasons).toContain("duplicate-import-rows-do-not-count-as-independent-measurements");
  });

  it("widens experimental uncertainty for mixed measurement methods and devices (C-MV05)", () => {
    const sameMethod = evaluateExperimentalMeasurementMethodConsistencyV1({
      observations: [measurement(1), measurement(2), measurement(3)],
    });
    const mixed = evaluateExperimentalMeasurementMethodConsistencyV1({
      observations: [measurement(1), measurement(2, { deviceId: "withings-2" }), measurement(3)],
    });

    expect(mixed.status).toBe("mixed-or-nonstandard-series");
    expect(mixed.uncertaintyWidthMultiplier).toBeGreaterThan(sameMethod.uncertaintyWidthMultiplier!);
    expect(mixed.measurementRole).toBeNull();
    expect(mixed.universalTruthMethod).toBe("intentionally-not-defined");
  });

  it("does not manufacture uncertainty from missing measurement evidence", () => {
    const result = evaluateExperimentalMeasurementMethodConsistencyV1({ observations: [] });

    expect(result.availability).toBe("unavailable");
    expect(result.status).toBe("missing-evidence");
    expect(result.uncertaintyWidthMultiplier).toBeNull();
    expect(result.observationCount).toBe(0);
  });

  it("keeps BIA/DXA and local measurements in their own roles without residual allocation", () => {
    const bia = evaluateExperimentalMeasurementMethodConsistencyV1({
      observations: [measurement(1), measurement(2), measurement(3)],
    });
    const local = evaluateExperimentalMeasurementMethodConsistencyV1({
      observations: [
        measurement(1, { endpoint: "local-muscle-measurement", site: "right-biceps" }),
        measurement(2, { endpoint: "local-muscle-measurement", site: "right-biceps" }),
        measurement(3, { endpoint: "local-muscle-measurement", site: "right-biceps" }),
      ],
    });

    expect(bia.measurementRole).toBe("aggregate-lean-context");
    expect(local.measurementRole).toBe("local-hypertrophy-proxy");
    expect(local.rejectedConversions).toContain("bia-or-dxa-to-skeletal-muscle-kg");
    expect(local.rejectedConversions).toContain("scale-residual-allocation");
  });

  it("rebuilds deterministically in chronological order without touching production forecasting", () => {
    const days = [
      { date: "2026-09-21", waterObservation: water(), glycogenDeltaKg: null, measurements: [measurement(3)] },
      { date: "2026-09-20", waterObservation: null, glycogenDeltaKg: null, measurements: [measurement(1), measurement(2)] },
    ] as const;
    const first = rebuildExperimentalMeasurementValidationTrajectoryV1({ days });
    const second = rebuildExperimentalMeasurementValidationTrajectoryV1({ days: [...days].reverse() });
    const productionSources = [
      "src/model/dynamic-daily-expenditure.ts",
      "src/modules/model-forecast/forecast-engine.ts",
    ].map((path) => readFileSync(path, "utf8")).join("\n");

    expect(first).toEqual(second);
    expect(experimentalMeasurementValidationV1Fingerprint(first))
      .toBe(experimentalMeasurementValidationV1Fingerprint(second));
    expect(productionSources).not.toContain("experimental-measurement-validation-v1");
  });
});
