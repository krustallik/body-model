import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ENGINEERING_CESSATION_GRACE_DAYS_V1,
} from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import {
  EXPERIMENTAL_RETRAINING_IDENTIFICATION_V1_PRIORS,
  experimentalRetrainingIdentificationV1Fingerprint,
  rebuildExperimentalRetrainingIdentificationTrajectoryV1,
} from "@/model/physiology-v7/experimental-retraining-identification-v1";
import type { ExperimentalTrainingExposureKindV1 } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";

function day(
  index: number,
  exposureKind: ExperimentalTrainingExposureKindV1,
  trainingSkeletalMuscleDeltaKg?: number,
) {
  return {
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    exposureKind,
    trainingSkeletalMuscleDeltaKg,
  };
}

function qualifyingCessationThenResume(trainingDelta = 0.012) {
  return [
    day(0, "qualified-mapped-training", 0.01),
    ...Array.from(
      { length: ENGINEERING_CESSATION_GRACE_DAYS_V1 + 2 },
      (_, index) => day(index + 1, "verified-no-exposure"),
    ),
    day(ENGINEERING_CESSATION_GRACE_DAYS_V1 + 3, "qualified-mapped-training", trainingDelta),
  ];
}

describe("Experimental Retraining Identification V1 (shadow only)", () => {
  it("labels qualified training after verified cessation as experimental retraining (C-B05)", () => {
    const rows = rebuildExperimentalRetrainingIdentificationTrajectoryV1({
      days: qualifyingCessationThenResume(),
    });
    const resumed = rows.at(-1)!;

    expect(rows.at(-2)!.cessation.state.phase).toBe("detraining");
    expect(resumed.cessation.state.phase).toBe("not-in-cessation");
    expect(resumed.retraining.retrainingStatus).toBe("experimental-identified");
    expect(resumed.retraining.qualifyingCessationDays)
      .toBeGreaterThan(ENGINEERING_CESSATION_GRACE_DAYS_V1);
  });

  it("does not call ordinary rest or a short verified gap retraining", () => {
    const rows = rebuildExperimentalRetrainingIdentificationTrajectoryV1({
      days: [
        day(0, "qualified-mapped-training", 0.01),
        ...Array.from({ length: 3 }, (_, index) => day(index + 1, "verified-no-exposure")),
        day(4, "qualified-mapped-training", 0.012),
      ],
    });
    const resumed = rows.at(-1)!;

    expect(resumed.retraining.retrainingStatus).toBe("not-identified");
    expect(resumed.retraining.retrainingLabelApplied).toBe(false);
    expect(resumed.retraining.reasons).toContain("ordinary-rest-or-short-verified-gap-is-not-retraining");
  });

  it("does not establish retraining after missing workout-feed coverage", () => {
    const rows = rebuildExperimentalRetrainingIdentificationTrajectoryV1({
      days: [
        day(0, "qualified-mapped-training", 0.01),
        ...Array.from(
          { length: ENGINEERING_CESSATION_GRACE_DAYS_V1 + 3 },
          (_, index) => day(index + 1, "unresolved-missing-training"),
        ),
        day(ENGINEERING_CESSATION_GRACE_DAYS_V1 + 4, "qualified-mapped-training", 0.012),
      ],
    });
    const resumed = rows.at(-1)!;

    expect(resumed.retraining.availability).toBe("unavailable");
    expect(resumed.retraining.retrainingStatus).toBe("insufficient-evidence");
    expect(resumed.retraining.retrainingLabelApplied).toBe(false);
  });

  it("keeps the cessation transition's ordinary resumption delta unchanged", () => {
    const trainingDelta = 0.012;
    const rows = rebuildExperimentalRetrainingIdentificationTrajectoryV1({
      days: qualifyingCessationThenResume(trainingDelta),
    });
    const resumed = rows.at(-1)!;

    expect(resumed.cessation.estimatedSkeletalMuscleDeltaKg).toBe(trainingDelta);
    expect(resumed.retraining.skeletalMuscleDeltaKgUnchanged).toBe(trainingDelta);
    expect(resumed.retraining.skeletalMuscleDeltaModificationKg).toBe(0);
    expect(resumed.retraining.trainingStatusMathChanged).toBe(false);
    expect(resumed.retraining.proteinEnergyMathChanged).toBe(false);
  });

  it("has no numeric memory bonus or accelerated-growth coefficient", () => {
    const resumed = rebuildExperimentalRetrainingIdentificationTrajectoryV1({
      days: qualifyingCessationThenResume(),
    }).at(-1)!;

    expect(resumed.retraining.quantitativeMemoryBonus).toBeNull();
    expect(resumed.retraining.acceleratedGrowthCoefficient).toBeNull();
    expect(EXPERIMENTAL_RETRAINING_IDENTIFICATION_V1_PRIORS.noQuantitativeMemoryBonus).toBe(true);
    expect(EXPERIMENTAL_RETRAINING_IDENTIFICATION_V1_PRIORS.classification)
      .toBe("engineering-reused-cessation-identification-threshold-not-universal");
  });

  it("rebuilds deterministically and remains outside production forecast and TDEE", () => {
    const days = qualifyingCessationThenResume();
    const first = rebuildExperimentalRetrainingIdentificationTrajectoryV1({ days });
    const second = rebuildExperimentalRetrainingIdentificationTrajectoryV1({ days });
    const productionSources = [
      "src/model/physiology-v7/daily-runtime-v7.ts",
      "src/modules/model-forecast/forecast-engine.ts",
      "src/model/base-tdee.ts",
    ].map((path) => readFileSync(path, "utf8")).join("\n");

    expect(first).toEqual(second);
    expect(experimentalRetrainingIdentificationV1Fingerprint(first.at(-1)!.retraining))
      .toBe(experimentalRetrainingIdentificationV1Fingerprint(second.at(-1)!.retraining));
    expect(productionSources).not.toContain("experimental-retraining-identification");
  });
});
