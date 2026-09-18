import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENGINEERING_CESSATION_GRACE_DAYS_V1,
  EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1,
  EXPERIMENTAL_CESSATION_DETRAINING_V1_PROVENANCE,
  EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
  EXPERIMENTAL_CESSATION_PRIORS_V1,
  rebuildExperimentalCessationDetrainingTrajectoryV1,
  transitionExperimentalCessationDetrainingV1,
} from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import type { ExperimentalTrainingExposureKindV1 } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";

function isoDay(offset: number): string {
  const date = new Date(Date.UTC(2026, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}

function day(
  offset: number,
  exposureKind: ExperimentalTrainingExposureKindV1,
  trainingSkeletalMuscleDeltaKg?: number | null,
) {
  return { date: isoDay(offset), exposureKind, trainingSkeletalMuscleDeltaKg };
}

function trainingThenObservedRest(restDays: number, trainingDelta = 0.01) {
  return [
    day(0, "qualified-mapped-training", trainingDelta),
    ...Array.from({ length: restDays }, (_, index) => day(index + 1, "verified-no-exposure")),
  ];
}

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental cessation / detraining v1", () => {
  it("a normal rest day is not cessation", () => {
    const neverTrained = transitionExperimentalCessationDetrainingV1({
      exposureKind: "verified-no-exposure",
    });
    expect(neverTrained.state.phase).toBe("not-in-cessation");
    expect(neverTrained.estimatedSkeletalMuscleDeltaKg).toBe(0);
    expect(neverTrained.state.observedNoExposureStreakDays).toBe(0);
    expect(neverTrained.features.phase).not.toBe("detraining");
    expect(neverTrained.reasons).toContain(
      "rest-day-is-not-cessation-without-prior-qualified-training",
    );

    const afterTraining = rebuildExperimentalCessationDetrainingTrajectoryV1({
      days: trainingThenObservedRest(1),
    });
    const rest = afterTraining[1]!;
    expect(rest.state.phase).toBe("verified-rest-or-grace");
    expect(rest.estimatedSkeletalMuscleDeltaKg).toBe(0);
    expect(rest.lowerBoundKg).toBe(0);
    expect(rest.upperBoundKg).toBe(0);
    expect(rest.features.phase).not.toBe("detraining");
    expect(rest.reasons).toContain("ordinary-rest-or-grace-is-not-detraining");
  });

  it("missing workout feed is unknown and never cessation", () => {
    const missing = rebuildExperimentalCessationDetrainingTrajectoryV1({
      days: [
        day(0, "qualified-mapped-training", 0.01),
        ...Array.from({ length: 40 }, (_, index) => day(index + 1, "unresolved-missing-training")),
      ],
    });
    const last = missing[missing.length - 1]!;
    expect(last.state.phase).toBe("unknown-coverage-not-cessation");
    expect(last.state.observedNoExposureStreakDays).toBe(0);
    expect(last.estimatedSkeletalMuscleDeltaKg).toBe(0);
    expect(last.features.phase).not.toBe("detraining");
    expect(last.reasons).toContain("missing-workout-feed-is-not-cessation");
    expect(last.reasons).toContain("no-exposure-streak-does-not-increment-on-unknown-coverage");

    const paused = rebuildExperimentalCessationDetrainingTrajectoryV1({
      days: [
        day(0, "qualified-mapped-training", 0.01),
        ...Array.from({ length: 10 }, (_, index) => day(index + 1, "verified-no-exposure")),
        day(11, "unresolved-missing-training"),
        day(12, "verified-no-exposure"),
      ],
    });
    expect(paused[10]!.state.observedNoExposureStreakDays).toBe(10);
    expect(paused[11]!.state.observedNoExposureStreakDays).toBe(10);
    expect(paused[11]!.estimatedSkeletalMuscleDeltaKg).toBe(0);
    expect(paused[11]!.state.phase).toBe("unknown-coverage-not-cessation");
    expect(paused[12]!.state.observedNoExposureStreakDays).toBe(11);
    expect(paused[12]!.state.phase).toBe("verified-rest-or-grace");
  });

  it("cessation does not instantly remove muscle tissue (C-C01)", () => {
    const dayZero = rebuildExperimentalCessationDetrainingTrajectoryV1({
      days: trainingThenObservedRest(1),
    });
    const firstRest = dayZero[1]!;
    expect(firstRest.state.observedNoExposureStreakDays).toBe(1);
    expect(firstRest.estimatedSkeletalMuscleDeltaKg).toBe(0);
    expect(firstRest.lowerBoundKg).toBe(0);
    expect(firstRest.upperBoundKg).toBe(0);
    expect(firstRest.state.relativeCumulativeDeltaKg)
      .toBe(dayZero[0]!.state.relativeCumulativeDeltaKg);
    expect(firstRest.reasons).toContain(
      "verified-cessation-day-zero-or-grace-has-no-negative-sm-step",
    );

    const grace = rebuildExperimentalCessationDetrainingTrajectoryV1({
      days: trainingThenObservedRest(ENGINEERING_CESSATION_GRACE_DAYS_V1),
    });
    for (const row of grace.slice(1)) {
      expect(row.estimatedSkeletalMuscleDeltaKg).toBe(0);
      expect(row.state.phase).toBe("verified-rest-or-grace");
    }
    expect(grace[grace.length - 1]!.state.observedNoExposureStreakDays)
      .toBe(ENGINEERING_CESSATION_GRACE_DAYS_V1);
  });

  it("prolonged observed no-exposure applies a bounded non-positive relative delta", () => {
    const trajectory = rebuildExperimentalCessationDetrainingTrajectoryV1({
      days: trainingThenObservedRest(ENGINEERING_CESSATION_GRACE_DAYS_V1 + 5),
    });
    const firstDetrain = trajectory[ENGINEERING_CESSATION_GRACE_DAYS_V1 + 1]!;
    expect(firstDetrain.state.phase).toBe("detraining");
    expect(firstDetrain.estimatedSkeletalMuscleDeltaKg).toBeLessThanOrEqual(0);
    expect(firstDetrain.lowerBoundKg).toBeLessThanOrEqual(firstDetrain.estimatedSkeletalMuscleDeltaKg);
    expect(firstDetrain.estimatedSkeletalMuscleDeltaKg).toBeLessThanOrEqual(firstDetrain.upperBoundKg);
    expect(firstDetrain.upperBoundKg).toBeLessThanOrEqual(0);
    expect(firstDetrain.state.absoluteSkeletalMuscleKg).toBeNull();
    expect(firstDetrain.features.absoluteSkeletalMuscleKg).toBeNull();
    expect(firstDetrain.supportedDomain).toBe("relative-cessation-detraining-delta-shadow-only");
    expect(firstDetrain.reasons).toContain(
      "prolonged-verified-no-exposure-applies-bounded-nonpositive-delta",
    );
    expect(firstDetrain.reasons).toContain(
      "engineering-atrophy-rate-not-universal-scientific-curve",
    );
    expect(firstDetrain.features.rejectedConversions).toContain("universal-scientific-atrophy-curve");
    expect(trajectory[0]!.provenance).toBe(EXPERIMENTAL_CESSATION_DETRAINING_V1_PROVENANCE);
    expect(trajectory[0]!.contractVersion).toBe(EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION);
  });

  it("longer cessation cannot produce less cumulative loss inside supported domain (C-C02)", () => {
    const shorter = rebuildExperimentalCessationDetrainingTrajectoryV1({
      days: trainingThenObservedRest(ENGINEERING_CESSATION_GRACE_DAYS_V1 + 6),
    });
    const longer = rebuildExperimentalCessationDetrainingTrajectoryV1({
      days: trainingThenObservedRest(ENGINEERING_CESSATION_GRACE_DAYS_V1 + 16),
    });
    const shorterEnd = shorter[shorter.length - 1]!.state.relativeCumulativeDeltaKg!;
    const longerAtSameDay = longer[shorter.length - 1]!.state.relativeCumulativeDeltaKg!;
    const longerEnd = longer[longer.length - 1]!.state.relativeCumulativeDeltaKg!;
    expect(longerAtSameDay).toBe(shorterEnd);
    expect(longerEnd).toBeLessThanOrEqual(shorterEnd);
    expect(longerEnd).toBeLessThan(shorterEnd);
    for (let index = 1; index < longer.length; index += 1) {
      expect(longer[index]!.state.relativeCumulativeDeltaKg!)
        .toBeLessThanOrEqual(longer[index - 1]!.state.relativeCumulativeDeltaKg!);
      expect(longer[index]!.estimatedSkeletalMuscleDeltaKg).toBeLessThanOrEqual(0);
    }
    expect(longer[longer.length - 1]!.features.muscleMemoryBonusApplied).toBe(false);
  });

  it("training resumption stops detraining", () => {
    const restDays = ENGINEERING_CESSATION_GRACE_DAYS_V1 + 5;
    const trainingDelta = 0.012;
    const trajectory = rebuildExperimentalCessationDetrainingTrajectoryV1({
      days: [
        ...trainingThenObservedRest(restDays, 0.01),
        day(restDays + 1, "qualified-mapped-training", trainingDelta),
      ],
    });
    const lastRest = trajectory[restDays]!;
    const resume = trajectory[restDays + 1]!;
    expect(lastRest.state.phase).toBe("detraining");
    expect(resume.state.phase).toBe("not-in-cessation");
    expect(resume.state.observedNoExposureStreakDays).toBe(0);
    expect(resume.estimatedSkeletalMuscleDeltaKg).toBe(trainingDelta);
    expect(resume.state.relativeCumulativeDeltaKg)
      .toBe(lastRest.state.relativeCumulativeDeltaKg! + trainingDelta);
    expect(resume.reasons).toContain(
      "training-resumption-stops-detraining-without-memory-bonus",
    );
    expect(resume.features.muscleMemoryBonusApplied).toBe(false);
  });

  it("does not apply an automatic muscle-memory or retraining bonus", () => {
    const prior = rebuildExperimentalCessationDetrainingTrajectoryV1({
      days: trainingThenObservedRest(ENGINEERING_CESSATION_GRACE_DAYS_V1 + 8),
    });
    const last = prior[prior.length - 1]!;
    const plain = transitionExperimentalCessationDetrainingV1({
      exposureKind: "qualified-mapped-training",
      prior: last.state,
      trainingSkeletalMuscleDeltaKg: 0.02,
    });
    const withBonus = transitionExperimentalCessationDetrainingV1({
      exposureKind: "qualified-mapped-training",
      prior: last.state,
      trainingSkeletalMuscleDeltaKg: 0.02,
      muscleMemoryBonus: 0.5,
    });
    expect(withBonus.estimatedSkeletalMuscleDeltaKg).toBe(plain.estimatedSkeletalMuscleDeltaKg);
    expect(withBonus.state.relativeCumulativeDeltaKg).toBe(plain.state.relativeCumulativeDeltaKg);
    expect(withBonus.features.muscleMemoryBonusApplied).toBe(false);
    expect(withBonus.reasons).toContain("muscle-memory-bonus-ignored");
    expect(withBonus.features.rejectedConversions).toContain("muscle-memory-numeric-bonus");
    expect(withBonus.estimatedSkeletalMuscleDeltaKg).toBe(0.02);
  });

  it("reproduces the same trajectory on deterministic historical rebuild", () => {
    const days = [
      day(0, "qualified-mapped-training", 0.01),
      day(1, "verified-no-exposure"),
      day(2, "unresolved-missing-training"),
      ...Array.from(
        { length: ENGINEERING_CESSATION_GRACE_DAYS_V1 + 3 },
        (_, index) => day(index + 3, "verified-no-exposure"),
      ),
      day(ENGINEERING_CESSATION_GRACE_DAYS_V1 + 6, "qualified-mapped-training", 0.008),
    ];
    const a = rebuildExperimentalCessationDetrainingTrajectoryV1({ days });
    const b = rebuildExperimentalCessationDetrainingTrajectoryV1({ days });
    expect(a.map((row) => row.fingerprint)).toEqual(b.map((row) => row.fingerprint));
    expect(a.map((row) => row.estimatedSkeletalMuscleDeltaKg))
      .toEqual(b.map((row) => row.estimatedSkeletalMuscleDeltaKg));
    expect(a.map((row) => row.state.relativeCumulativeDeltaKg))
      .toEqual(b.map((row) => row.state.relativeCumulativeDeltaKg));
    expect(a.map((row) => row.state.phase)).toEqual(b.map((row) => row.state.phase));
  });

  it("classifies grace and atrophy-rate constants as engineering priors", () => {
    expect(ENGINEERING_CESSATION_GRACE_DAYS_V1).toBe(14);
    expect(EXPERIMENTAL_CESSATION_PRIORS_V1.graceDays.classification).toBe("engineering");
    expect(EXPERIMENTAL_CESSATION_PRIORS_V1.graceDays.scientificDecision).toBe("deferred-by-P-C01");
    expect(EXPERIMENTAL_CESSATION_PRIORS_V1.atrophyMonthlyEnvelopeKg.classification)
      .toBe("engineering-order-of-magnitude-band-not-universal-atrophy-curve");
    expect(EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1.upperKgPerMonth).toBe(0);
    expect(EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1.pointKgPerMonth).toBeLessThan(0);
    expect(EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1.lowerKgPerMonth)
      .toBeLessThan(EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1.pointKgPerMonth);
    expect(EXPERIMENTAL_CESSATION_PRIORS_V1.noSameDayNegativeStep.classification)
      .toBe("scientific-invariant");
    expect(EXPERIMENTAL_CESSATION_PRIORS_V1.longerCessationDoesNotReduceLossRisk.classification)
      .toBe("scientific-ordering");
    expect(EXPERIMENTAL_CESSATION_PRIORS_V1.missingFeedIsNotCessation.classification)
      .toBe("scientific-input-contract");
    expect(EXPERIMENTAL_CESSATION_PRIORS_V1.restDayIsNotCessation.classification)
      .toBe("scientific-input-contract");
  });

  it("does not appear in production forecast, TDEE, daily-runtime, or FatWeightShadow mean paths", () => {
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const tdee = readFileSync("src/model/base-tdee.ts", "utf8");
    const mean = readFileSync("src/model/physiology-v7/fat-weight-shadow-v1.ts", "utf8");
    const symbol = "transitionExperimentalCessationDetrainingV1";
    expect(runtime).not.toContain(symbol);
    expect(forecast).not.toContain(symbol);
    expect(tdee).not.toContain(symbol);
    expect(mean).not.toContain(symbol);
    expect(runtime).not.toContain("experimental-cessation-detraining");
    expect(forecast).not.toContain("experimental-cessation-detraining");
    expect(tdee).not.toContain("experimental-cessation-detraining");
  });
});
