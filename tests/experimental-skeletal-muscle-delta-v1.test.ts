import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1,
  EXPERIMENTAL_MONTHLY_SM_RATE_KG_V1,
  EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_PROVENANCE,
  EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
  engineeringEnergyScaleV1,
  engineeringProteinScaleV1,
  estimateExperimentalSkeletalMuscleDeltaV1,
  rebuildExperimentalSkeletalMuscleDeltaTrajectoryV1,
} from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";

const baseTraining = {
  qualifiedHardSetCount: 12,
  mappedMuscleGroupCount: 4,
  trainingExposureKind: "qualified-mapped-training" as const,
  proteinGPerKg: 1.8,
  energyBalanceKcal: 0,
  bodyMassKg: 80,
};

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental skeletal muscle delta v1", () => {
  it("estimates positive bounded relative delta under qualified training vs zero on verified rest", () => {
    const trained = estimateExperimentalSkeletalMuscleDeltaV1(baseTraining);
    const rest = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      qualifiedHardSetCount: 0,
      trainingExposureKind: "verified-no-exposure",
    });
    expect(trained.availability).toBe("available");
    expect(trained.estimatedSkeletalMuscleDeltaKg!).toBeGreaterThan(0);
    expect(trained.lowerBoundKg!).toBeLessThanOrEqual(trained.estimatedSkeletalMuscleDeltaKg!);
    expect(trained.estimatedSkeletalMuscleDeltaKg!).toBeLessThanOrEqual(trained.upperBoundKg!);
    expect(rest.estimatedSkeletalMuscleDeltaKg).toBe(0);
    expect(rest.lowerBoundKg).toBe(0);
    expect(rest.upperBoundKg).toBe(0);
    expect(trained.estimatedSkeletalMuscleDeltaKg!).toBeGreaterThan(rest.estimatedSkeletalMuscleDeltaKg!);
    expect(trained.provenance).toBe(EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_PROVENANCE);
    expect(trained.contractVersion).toBe(EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION);
    expect(trained.supportedDomain).toBe("relative-skeletal-muscle-delta-shadow-only");
    expect(trained.state.absoluteSkeletalMuscleKg).toBeNull();
  });

  it("added qualified hard-set count does not lower whole-body relative delta", () => {
    const low = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      qualifiedHardSetCount: 4,
      trainingStatus: "novice",
    });
    const high = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      qualifiedHardSetCount: 18,
      trainingStatus: "novice",
    });
    expect(high.estimatedSkeletalMuscleDeltaKg!)
      .toBeGreaterThanOrEqual(low.estimatedSkeletalMuscleDeltaKg!);
    expect(high.features.doseScale).toBeGreaterThan(low.features.doseScale);
  });

  it("training status shifts a response prior without pairwise determinism (C-B01)", () => {
    const novice = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      trainingStatus: "novice",
    });
    const advanced = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      trainingStatus: "advanced",
    });
    expect(novice.features.monthlyRatePointKg!)
      .toBeGreaterThan(advanced.features.monthlyRatePointKg!);
    expect(novice.estimatedSkeletalMuscleDeltaKg!)
      .toBeGreaterThan(advanced.estimatedSkeletalMuscleDeltaKg!);
    expect(EXPERIMENTAL_MONTHLY_SM_RATE_KG_V1.classification)
      .toBe("literature-informed-engineering-order-of-magnitude-band");
  });

  it("experience does not create an exact gain rate (C-B02)", () => {
    const novice = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      trainingStatus: "novice",
    });
    const advanced = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      trainingStatus: "advanced",
    });
    const noviceWidth = novice.upperBoundKg! - novice.lowerBoundKg!;
    const advancedWidth = advanced.upperBoundKg! - advanced.lowerBoundKg!;
    expect(noviceWidth).toBeGreaterThan(0);
    expect(advancedWidth).toBeGreaterThan(0);
    expect(novice.estimatedSkeletalMuscleDeltaKg).not.toBe(
      EXPERIMENTAL_MONTHLY_SM_RATE_KG_V1.novice.pointKgPerMonth / 30,
    );
    expect(advanced.lowerBoundKg!).toBeLessThan(advanced.upperBoundKg!);
  });

  it("program novelty is not chronic muscle (C-B03)", () => {
    const withNovelty = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      programNoveltyBonus: 0.5,
    });
    const without = estimateExperimentalSkeletalMuscleDeltaV1(baseTraining);
    expect(withNovelty.estimatedSkeletalMuscleDeltaKg).toBe(without.estimatedSkeletalMuscleDeltaKg);
    expect(withNovelty.features.rejectedConversions).toContain("novelty-tissue-bonus");
    expect(withNovelty.reasons).toContain("novelty-bonus-ignored");
  });

  it("acute MPS cannot directly set long-term gain (C-B04)", () => {
    const withMps = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      acuteMpsPercent: 120,
    });
    const without = estimateExperimentalSkeletalMuscleDeltaV1(baseTraining);
    expect(withMps.estimatedSkeletalMuscleDeltaKg).toBe(without.estimatedSkeletalMuscleDeltaKg);
    expect(withMps.features.rejectedConversions).toContain("acute-mps-to-kg");
    expect(withMps.reasons).toContain("acute-mps-context-ignored");
  });

  it("verified no-exposure rest day is zero relative delta, not same-day atrophy", () => {
    const rest = estimateExperimentalSkeletalMuscleDeltaV1({
      qualifiedHardSetCount: 0,
      mappedMuscleGroupCount: 0,
      trainingExposureKind: "verified-no-exposure",
      trainingStatus: "intermediate",
      proteinGPerKg: 1.6,
      energyBalanceKcal: -200,
      bodyMassKg: 75,
      priorRelativeCumulativeDeltaKg: 0.4,
    });
    expect(rest.availability).toBe("available");
    expect(rest.estimatedSkeletalMuscleDeltaKg).toBe(0);
    expect(rest.lowerBoundKg).toBe(0);
    expect(rest.upperBoundKg).toBe(0);
    expect(rest.state.relativeCumulativeDeltaKg).toBe(0.4);
    expect(rest.reasons).toContain("verified-no-exposure-zero-delta-not-same-day-atrophy");
  });

  it("protein benefit is non-worsening and bounded (C-D01)", () => {
    const low = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      proteinGPerKg: 0.7,
    });
    const mid = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      proteinGPerKg: 1.3,
    });
    const high = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      proteinGPerKg: 2.0,
    });
    expect(mid.estimatedSkeletalMuscleDeltaKg!)
      .toBeGreaterThanOrEqual(low.estimatedSkeletalMuscleDeltaKg!);
    expect(high.estimatedSkeletalMuscleDeltaKg!)
      .toBeGreaterThanOrEqual(mid.estimatedSkeletalMuscleDeltaKg!);
    expect(high.features.proteinScale).toBe(1);
    expect(low.features.proteinScale!).toBeLessThan(mid.features.proteinScale!);
  });

  it("adequate protein cannot override training and physiological bounds (C-D03)", () => {
    const highProteinNoTraining = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      qualifiedHardSetCount: 0,
      trainingExposureKind: "verified-no-exposure",
      proteinGPerKg: 3.5,
    });
    const highProteinTrained = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      proteinGPerKg: 3.5,
    });
    expect(highProteinNoTraining.estimatedSkeletalMuscleDeltaKg).toBe(0);
    expect(Math.abs(highProteinTrained.estimatedSkeletalMuscleDeltaKg!))
      .toBeLessThanOrEqual(ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1);
  });

  it("protein timing has no separate v7 coefficient (C-D05)", () => {
    const timed = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      proteinTimingCoefficient: 1.4,
    });
    const plain = estimateExperimentalSkeletalMuscleDeltaV1(baseTraining);
    expect(timed.estimatedSkeletalMuscleDeltaKg).toBe(plain.estimatedSkeletalMuscleDeltaKg);
    expect(timed.features.rejectedConversions).toContain("protein-timing-coefficient");
    expect(timed.reasons).toContain("protein-timing-coefficient-ignored");
  });

  it("larger sustained deficit does not improve expected muscle gain (C-E01)", () => {
    const mild = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      energyBalanceKcal: -300,
    });
    const deep = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      energyBalanceKcal: -900,
    });
    expect(deep.estimatedSkeletalMuscleDeltaKg!)
      .toBeLessThanOrEqual(mild.estimatedSkeletalMuscleDeltaKg!);
    expect(deep.features.energyScale!).toBeLessThan(mild.features.energyScale!);
  });

  it("surplus is not required for all hypertrophy (C-E04)", () => {
    const maintenance = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      energyBalanceKcal: 0,
    });
    expect(maintenance.estimatedSkeletalMuscleDeltaKg!).toBeGreaterThan(0);
    expect(maintenance.features.energyScale).toBe(1);
  });

  it("larger surplus cannot yield unlimited muscle (C-E05)", () => {
    const mildSurplus = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      energyBalanceKcal: 400,
    });
    const hugeSurplus = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      energyBalanceKcal: 2500,
    });
    expect(hugeSurplus.estimatedSkeletalMuscleDeltaKg!)
      .toBeLessThanOrEqual(ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1);
    expect(hugeSurplus.estimatedSkeletalMuscleDeltaKg!)
      .toBeLessThan(mildSurplus.estimatedSkeletalMuscleDeltaKg! * 3);
    expect(hugeSurplus.features.rejectedConversions).toContain("linear-kcal-to-muscle");
  });

  it("deficit and surplus are not mirror images (C-E06)", () => {
    const deficit = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      energyBalanceKcal: -500,
    });
    const surplus = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      energyBalanceKcal: 500,
    });
    const maintenance = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      energyBalanceKcal: 0,
    });
    const down = maintenance.estimatedSkeletalMuscleDeltaKg! - deficit.estimatedSkeletalMuscleDeltaKg!;
    const up = surplus.estimatedSkeletalMuscleDeltaKg! - maintenance.estimatedSkeletalMuscleDeltaKg!;
    expect(Math.abs(down - up)).toBeGreaterThan(1e-9);
    expect(deficit.features.rejectedConversions).toContain("symmetric-deficit-surplus-multiplier");
  });

  it("treats missing training, protein, and energy as unavailable rather than zero", () => {
    const missingTraining = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      qualifiedHardSetCount: null,
      trainingExposureKind: "unresolved-missing-training",
    });
    const missingProtein = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      proteinGPerKg: null,
    });
    const missingEnergy = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      energyBalanceKcal: null,
    });
    for (const row of [missingTraining, missingProtein, missingEnergy]) {
      expect(row.availability).toBe("unavailable");
      expect(row.estimatedSkeletalMuscleDeltaKg).toBeNull();
      expect(row.lowerBoundKg).toBeNull();
      expect(row.upperBoundKg).toBeNull();
    }
    expect(missingTraining.unavailableReason).toBe("missing-training-exposure");
    expect(missingProtein.unavailableReason).toBe("missing-protein");
    expect(missingEnergy.unavailableReason).toBe("missing-energy-balance");
    expect(missingProtein.reasons).toContain("missing-protein-is-not-zero");
    expect(missingEnergy.reasons).toContain("missing-energy-balance-is-not-zero-or-neutral");
    expect(missingProtein.support).toEqual({
      status: "degraded",
      reason: "required-input-unavailable",
      authoritativeUse: "forbidden",
    });
  });

  it("keeps engineering tier boundaries numerical-only and marks every available point diagnostic", () => {
    const proteinCases = [
      [0, 0.55],
      [0.799999, 0.55],
      [0.8, 0.7],
      [1.199999, 0.7],
      [1.2, 0.88],
      [1.599999, 0.88],
      [1.6, 1],
      [2.5, 1],
    ] as const;
    for (const [proteinGPerKg, expectedScale] of proteinCases) {
      const result = estimateExperimentalSkeletalMuscleDeltaV1({
        ...baseTraining,
        proteinGPerKg,
      });
      expect(engineeringProteinScaleV1(proteinGPerKg)).toBe(expectedScale);
      expect(result.features.proteinScale).toBe(expectedScale);
      expect(result.availability).toBe("available");
      expect(result.estimatedSkeletalMuscleDeltaKg).not.toBeNull();
      expect(result.support).toEqual({
        status: "degraded",
        reason: "no-defensible-personal-quantitative-supported-domain",
        authoritativeUse: "forbidden",
      });
      expect(result.provenance).toBe("experimental-heuristic");
    }

    const energyCases = [
      [-900, 0.45], [-750.001, 0.45], [-750, 0.45], [-749.999, 0.7],
      [-250.001, 0.7], [-250, 0.7], [-249.999, 1], [0, 1], [249.999, 1],
      [250, 1.08], [250.001, 1.08], [749.999, 1.08], [750, 1.12], [750.001, 1.12],
    ] as const;
    for (const [energyBalanceKcal, expectedScale] of energyCases) {
      const result = estimateExperimentalSkeletalMuscleDeltaV1({
        ...baseTraining,
        energyBalanceKcal,
      });
      expect(engineeringEnergyScaleV1(energyBalanceKcal).pointScale).toBe(expectedScale);
      expect(result.features.energyScale).toBe(expectedScale);
      expect(result.support.status).toBe("degraded");
      expect(result.support.authoritativeUse).toBe("forbidden");
    }
  });

  it("keeps extreme observed inputs distinct from missingness without changing coefficients", () => {
    const combined = [
      { name: "low protein + maintenance", proteinGPerKg: 0.5, energyBalanceKcal: 0 },
      { name: "adequate protein + severe deficit", proteinGPerKg: 1.6, energyBalanceKcal: -900 },
      { name: "low protein + severe deficit", proteinGPerKg: 0, energyBalanceKcal: -900 },
      { name: "low protein + surplus", proteinGPerKg: 0.5, energyBalanceKcal: 800 },
      { name: "high protein + severe deficit", proteinGPerKg: 2.2, energyBalanceKcal: -900 },
      { name: "qualified adequate engineering example", proteinGPerKg: 1.8, energyBalanceKcal: 0 },
    ] as const;
    for (const row of combined) {
      const result = estimateExperimentalSkeletalMuscleDeltaV1({ ...baseTraining, ...row });
      expect(result.availability, row.name).toBe("available");
      expect(result.estimatedSkeletalMuscleDeltaKg, row.name).not.toBeNull();
      expect(result.support.status, row.name).toBe("degraded");
      expect(result.support.reason, row.name)
        .toBe("no-defensible-personal-quantitative-supported-domain");
    }
  });

  it("rejects measurement-role conversions and keeps absolute skeletalMuscleKg unavailable", () => {
    const result = estimateExperimentalSkeletalMuscleDeltaV1({
      ...baseTraining,
      leanMassKg: 60,
      strengthDelta: 12,
      biaOrDxaSkeletalMuscleKg: 32,
      muscleMemoryBonus: 0.2,
    });
    expect(result.state.absoluteSkeletalMuscleKg).toBeNull();
    expect(result.features.absoluteSkeletalMuscleKg).toBeNull();
    expect(result.features.rejectedConversions).toEqual(
      expect.arrayContaining([
        "acute-mps-to-kg",
        "strength-to-kg",
        "lean-mass-to-skeletalMuscleKg",
        "bia-dxa-ultrasound-as-sm-truth",
        "scale-weight-residual",
        "muscle-memory-numeric-bonus",
      ]),
    );
    expect(result.reasons).toContain("lean-mass-context-ignored");
    expect(result.reasons).toContain("strength-delta-context-ignored");
    expect(result.reasons).toContain("bia-dxa-context-ignored");
    expect(result.reasons).toContain("muscle-memory-bonus-ignored");
  });

  it("bounds daily and weekly relative change against impossible jumps", () => {
    const days = Array.from({ length: 7 }, (_, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      qualifiedHardSetCount: 40,
      mappedMuscleGroupCount: 8,
      trainingExposureKind: "qualified-mapped-training" as const,
      trainingStatus: "novice" as const,
      proteinGPerKg: 2.5,
      energyBalanceKcal: 800,
      bodyMassKg: 70,
    }));
    const trajectory = rebuildExperimentalSkeletalMuscleDeltaTrajectoryV1({ days });
    for (const day of trajectory) {
      expect(Math.abs(day.estimatedSkeletalMuscleDeltaKg!))
        .toBeLessThanOrEqual(ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1);
    }
    const weekDelta = trajectory.reduce(
      (sum, day) => sum + (day.estimatedSkeletalMuscleDeltaKg ?? 0),
      0,
    );
    expect(Math.abs(weekDelta)).toBeLessThanOrEqual(ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1 * 7);
  });

  it("reproduces the same trajectory on deterministic historical rebuild", () => {
    const days = [
      {
        date: "2026-09-10",
        qualifiedHardSetCount: 10,
        mappedMuscleGroupCount: 3,
        trainingExposureKind: "qualified-mapped-training" as const,
        trainingStatus: "intermediate" as const,
        proteinGPerKg: 1.7,
        energyBalanceKcal: -100,
      },
      {
        date: "2026-09-11",
        qualifiedHardSetCount: 0,
        trainingExposureKind: "verified-no-exposure" as const,
        proteinGPerKg: 1.7,
        energyBalanceKcal: -50,
      },
      {
        date: "2026-09-12",
        qualifiedHardSetCount: 14,
        mappedMuscleGroupCount: 5,
        trainingExposureKind: "qualified-mapped-training" as const,
        trainingStatus: "intermediate" as const,
        proteinGPerKg: 1.9,
        energyBalanceKcal: 100,
      },
    ];
    const a = rebuildExperimentalSkeletalMuscleDeltaTrajectoryV1({ days });
    const b = rebuildExperimentalSkeletalMuscleDeltaTrajectoryV1({ days });
    expect(a.map((row) => row.fingerprint)).toEqual(b.map((row) => row.fingerprint));
    expect(a.map((row) => row.estimatedSkeletalMuscleDeltaKg))
      .toEqual(b.map((row) => row.estimatedSkeletalMuscleDeltaKg));
    expect(a[a.length - 1]!.state.relativeCumulativeDeltaKg)
      .toBe(b[b.length - 1]!.state.relativeCumulativeDeltaKg);
  });

  it("does not appear in production forecast, TDEE, daily-runtime, or FatWeightShadow mean paths", () => {
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const tdee = readFileSync("src/model/base-tdee.ts", "utf8");
    const mean = readFileSync("src/model/physiology-v7/fat-weight-shadow-v1.ts", "utf8");
    const symbol = "estimateExperimentalSkeletalMuscleDeltaV1";
    expect(runtime).not.toContain(symbol);
    expect(forecast).not.toContain(symbol);
    expect(tdee).not.toContain(symbol);
    expect(mean).not.toContain(symbol);
    expect(runtime).not.toContain("experimental-skeletal-muscle-delta");
    expect(forecast).not.toContain("experimental-skeletal-muscle-delta");
  });
});
