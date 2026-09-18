import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { partitionEnergyBalance } from "@/model/body-composition/partition";
import {
  ENGINEERING_MAX_FFM_RETENTION_EFFECT_V1,
  EXPERIMENTAL_FFM_RETENTION_PRIORS_V1,
  EXPERIMENTAL_FFM_RETENTION_V1_PROVENANCE,
  EXPERIMENTAL_FFM_RETENTION_V1_REVISION,
  estimateExperimentalFfmRetentionV1,
  rebuildExperimentalFfmRetentionTrajectoryV1,
} from "@/model/physiology-v7/experimental-ffm-retention-v1";

const deficitRt = {
  energyBalanceKcal: -400,
  proteinGPerKg: 1.6,
  trainingExposureKind: "qualified-mapped-training" as const,
  hallForbesReferenceFatMassKg: 20,
};

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental ffm retention v1", () => {
  it("protein does not worsen retention during studied deficits (C-D02)", () => {
    const low = estimateExperimentalFfmRetentionV1({
      ...deficitRt,
      proteinGPerKg: 1.1,
    });
    const high = estimateExperimentalFfmRetentionV1({
      ...deficitRt,
      proteinGPerKg: 2.3,
    });
    expect(low.availability).toBe("available");
    expect(high.availability).toBe("available");
    expect(high.retentionEffect.point!).toBeGreaterThanOrEqual(low.retentionEffect.point!);
    expect(high.retentionEffect.lower!).toBeGreaterThanOrEqual(low.retentionEffect.lower!);
    expect(high.retentionEffect.upper!).toBeGreaterThanOrEqual(low.retentionEffect.upper!);
    expect(high.muscleGainGuaranteed).toBe(false);
    expect(high.skeletalMuscleKg).toBeNull();
    expect(high.features.proteinAdequacy!).toBeGreaterThan(low.features.proteinAdequacy!);
  });

  it("deeper deficit does not improve retention", () => {
    const mild = estimateExperimentalFfmRetentionV1(deficitRt);
    const deep = estimateExperimentalFfmRetentionV1({
      ...deficitRt,
      energyBalanceKcal: -900,
    });
    expect(deep.retentionEffect.point!).toBeLessThanOrEqual(mild.retentionEffect.point!);
    expect(deep.features.deficitRetentionCapacity!)
      .toBeLessThan(mild.features.deficitRetentionCapacity!);
  });

  it("resistance training does not worsen expected FFM retention versus diet-only (C-E03)", () => {
    const dietOnly = estimateExperimentalFfmRetentionV1({
      ...deficitRt,
      trainingExposureKind: "verified-no-exposure",
    });
    const trained = estimateExperimentalFfmRetentionV1(deficitRt);
    expect(trained.retentionEffect.point!)
      .toBeGreaterThanOrEqual(dietOnly.retentionEffect.point!);
    expect(trained.features.resistanceTrainingScale).toBe(1);
    expect(dietOnly.features.resistanceTrainingScale).toBe(0);
    expect(trained.skeletalMuscleKg).toBeNull();
  });

  it("does not require a surplus for deficit FFM retention", () => {
    const deficit = estimateExperimentalFfmRetentionV1(deficitRt);
    const maintenance = estimateExperimentalFfmRetentionV1({
      ...deficitRt,
      energyBalanceKcal: 0,
    });
    expect(deficit.retentionEffect.point!).toBeGreaterThan(0);
    expect(maintenance.retentionEffect.point).toBe(0);
    expect(deficit.reasons).toContain("muscle-gain-not-guaranteed");
    expect(maintenance.reasons).toContain(
      "retention-effect-is-deficit-construct-surplus-not-required",
    );
    expect(deficit.features.rejectedConversions).toContain("surplus-required-for-retention");
  });

  it("does not convert lean/FFM/BIA/DXA into skeletalMuscleKg", () => {
    const plain = estimateExperimentalFfmRetentionV1(deficitRt);
    const withProxies = estimateExperimentalFfmRetentionV1({
      ...deficitRt,
      leanMassKg: 62,
      biaOrDxaFfmKg: 64,
      scaleWeightResidualKg: 1.4,
      skeletalMuscleKg: 28,
    });
    expect(withProxies.retentionEffect).toEqual(plain.retentionEffect);
    expect(withProxies.skeletalMuscleKg).toBeNull();
    expect(withProxies.features.absoluteSkeletalMuscleKg).toBeNull();
    expect(withProxies.reasons).toContain("lean-mass-not-converted-to-skeletalMuscleKg");
    expect(withProxies.reasons).toContain("bia-dxa-ffm-ignored-as-truth");
    expect(withProxies.reasons).toContain("scale-weight-residual-not-fitted");
    expect(withProxies.features.rejectedConversions).toEqual(
      expect.arrayContaining([
        "lean-to-skeletalMuscleKg",
        "ffm-to-skeletalMuscleKg",
        "bia-dxa-as-ffm-truth",
        "scale-weight-residual-fit",
      ]),
    );
  });

  it("treats missing energy, protein, and training as unavailable rather than zero", () => {
    const missingEnergy = estimateExperimentalFfmRetentionV1({
      ...deficitRt,
      energyBalanceKcal: null,
    });
    const missingProtein = estimateExperimentalFfmRetentionV1({
      ...deficitRt,
      proteinGPerKg: null,
    });
    const missingTraining = estimateExperimentalFfmRetentionV1({
      ...deficitRt,
      trainingExposureKind: "unresolved-missing-training",
    });
    for (const row of [missingEnergy, missingProtein, missingTraining]) {
      expect(row.availability).toBe("unavailable");
      expect(row.retentionEffect.point).toBeNull();
      expect(row.retentionEffect.lower).toBeNull();
      expect(row.retentionEffect.upper).toBeNull();
    }
    expect(missingEnergy.unavailableReason).toBe("missing-energy-balance");
    expect(missingProtein.unavailableReason).toBe("missing-protein");
    expect(missingTraining.unavailableReason).toBe("missing-training-exposure");
    expect(missingProtein.reasons).toContain("missing-protein-is-not-zero");
    expect(missingTraining.reasons).toContain(
      "missing-training-exposure-is-not-diet-only-zero",
    );
  });

  it("keeps the retention effect bounded and uses Hall/Forbes only as unmodified reference", () => {
    const result = estimateExperimentalFfmRetentionV1(deficitRt);
    expect(result.availability).toBe("available");
    expect(result.retentionEffect.lower!)
      .toBeLessThanOrEqual(result.retentionEffect.point!);
    expect(result.retentionEffect.point!)
      .toBeLessThanOrEqual(result.retentionEffect.upper!);
    expect(result.retentionEffect.lower!).toBeGreaterThanOrEqual(0);
    expect(result.retentionEffect.upper!)
      .toBeLessThanOrEqual(ENGINEERING_MAX_FFM_RETENTION_EFFECT_V1);
    const hall = partitionEnergyBalance({
      availableEnergyKcal: deficitRt.energyBalanceKcal,
      fatMassKg: deficitRt.hallForbesReferenceFatMassKg,
    });
    expect(result.hallForbesUnmodifiedSlowNonFatDeltaKg).toBe(hall.deltaLeanTissueKg);
    expect(result.relativeSlowNonFatLossDifferenceKg.point!).toBeGreaterThan(0);
    expect(result.relativeSlowNonFatLossDifferenceKg.point!)
      .toBeCloseTo(-hall.deltaLeanTissueKg * result.retentionEffect.point!, 12);
    expect(result.features.hallForbesMeanUnchanged).toBe(true);
    expect(result.provenance).toBe(EXPERIMENTAL_FFM_RETENTION_V1_PROVENANCE);
    expect(result.contractVersion).toBe(EXPERIMENTAL_FFM_RETENTION_V1_REVISION);
    expect(EXPERIMENTAL_FFM_RETENTION_PRIORS_V1.mixWeights.classification)
      .toBe("engineering-order-of-magnitude-weights");
    expect(EXPERIMENTAL_FFM_RETENTION_PRIORS_V1.proteinWindowGPerKg.classification)
      .toBe("literature-informed-engineering-window-not-personal-switch");
  });

  it("reproduces the same trajectory on deterministic historical rebuild", () => {
    const days = [
      {
        date: "2026-09-10",
        energyBalanceKcal: -350,
        proteinGPerKg: 1.4,
        trainingExposureKind: "qualified-mapped-training" as const,
        hallForbesReferenceFatMassKg: 22,
      },
      {
        date: "2026-09-11",
        energyBalanceKcal: -500,
        proteinGPerKg: 1.8,
        trainingExposureKind: "verified-no-exposure" as const,
        hallForbesReferenceFatMassKg: 21.7,
      },
      {
        date: "2026-09-12",
        energyBalanceKcal: 100,
        proteinGPerKg: 1.6,
        trainingExposureKind: "qualified-mapped-training" as const,
        hallForbesReferenceFatMassKg: 21.4,
      },
    ];
    const a = rebuildExperimentalFfmRetentionTrajectoryV1({ days });
    const b = rebuildExperimentalFfmRetentionTrajectoryV1({ days });
    expect(a.map((row) => row.fingerprint)).toEqual(b.map((row) => row.fingerprint));
    expect(a.map((row) => row.retentionEffect.point))
      .toEqual(b.map((row) => row.retentionEffect.point));
    expect(a.map((row) => row.relativeSlowNonFatLossDifferenceKg.point))
      .toEqual(b.map((row) => row.relativeSlowNonFatLossDifferenceKg.point));
  });

  it("does not appear in production forecast, TDEE, daily-runtime, or FatWeightShadow mean paths", () => {
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const tdee = readFileSync("src/model/base-tdee.ts", "utf8");
    const mean = readFileSync("src/model/physiology-v7/fat-weight-shadow-v1.ts", "utf8");
    const partition = readFileSync("src/model/body-composition/partition.ts", "utf8");
    const symbol = "estimateExperimentalFfmRetentionV1";
    expect(runtime).not.toContain(symbol);
    expect(forecast).not.toContain(symbol);
    expect(tdee).not.toContain(symbol);
    expect(mean).not.toContain(symbol);
    expect(mean).not.toContain("experimental-ffm-retention");
    expect(forecast).not.toContain("experimental-ffm-retention");
    expect(tdee).not.toContain("experimental-ffm-retention");
    expect(partition).not.toContain("experimental-ffm-retention");
  });
});
