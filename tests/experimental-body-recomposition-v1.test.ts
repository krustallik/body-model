import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EXPERIMENTAL_BODY_RECOMPOSITION_V1_PROVENANCE,
  EXPERIMENTAL_BODY_RECOMPOSITION_V1_REVISION,
  estimateExperimentalBodyRecompositionV1,
  rebuildExperimentalBodyRecompositionTrajectoryV1,
} from "@/model/physiology-v7/experimental-body-recomposition-v1";
import {
  initialExperimentalCessationStateV1,
  transitionExperimentalCessationDetrainingV1,
} from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import type { FatWeightShadowStateV1 } from "@/model/physiology-v7/fat-weight-shadow-v1";

const fat = (fatMassKg: number | null, availability: "available" | "unavailable" = "available"): FatWeightShadowStateV1 => ({
  fatMassKg,
  slowNonFatKg: availability === "available" ? 55 : null,
  availability,
  provenance: availability === "available" ? "episode-bia-derived-estimate" : null,
  uncertainty: "personal-unavailable",
});

const sm = (relativeCumulativeDeltaKg: number | null, availability: "available" | "unavailable" = "available") => ({
  availability,
  state: { absoluteSkeletalMuscleKg: null, relativeCumulativeDeltaKg },
});

const base = {
  fatStart: fat(20),
  fatEnd: fat(19.4),
  skeletalMuscleStart: sm(0),
  skeletalMuscleEnd: sm(0.12),
};

/** EXPERIMENTAL harness — not scientific validation / GREEN oracle. */
describe("experimental body recomposition v1", () => {
  it("accepts the persisted cessation-aware unified relative trajectory", () => {
    const start = transitionExperimentalCessationDetrainingV1({
      exposureKind: "qualified-mapped-training", prior: initialExperimentalCessationStateV1(), trainingSkeletalMuscleDeltaKg: 0.02,
    });
    const end = transitionExperimentalCessationDetrainingV1({
      exposureKind: "verified-no-exposure", prior: start.state,
    });
    const result = estimateExperimentalBodyRecompositionV1({
      fatStart: fat(20), fatEnd: fat(19.8),
      skeletalMuscleStart: { availability: "available", state: start.state },
      skeletalMuscleEnd: { availability: "available", state: end.state },
    });
    expect(result.reasons).toContain("unified-relative-skeletal-muscle-trajectory-used-without-absolute-skeletalMuscleKg");
  });
  it("classifies fat loss plus positive relative SM delta as supported recomposition (C-E02)", () => {
    const result = estimateExperimentalBodyRecompositionV1(base);
    expect(result.status).toBe("available");
    expect(result.classification).toBe("positive-recomposition-supported");
    expect(result.evidenceStrength).toBe("strong");
    expect(result.fatDeltaKg).toBeCloseTo(-0.6, 12);
    expect(result.relativeSkeletalMuscleDeltaKg).toBeCloseTo(0.12, 12);
    expect(result.provenance).toBe(EXPERIMENTAL_BODY_RECOMPOSITION_V1_PROVENANCE);
    expect(result.modelRevision).toBe(EXPERIMENTAL_BODY_RECOMPOSITION_V1_REVISION);
  });

  it("classifies fat loss plus maintained relative SM as weaker recomposition evidence", () => {
    const result = estimateExperimentalBodyRecompositionV1({
      ...base,
      skeletalMuscleEnd: sm(0),
    });
    expect(result.classification).toBe("recomposition-maintenance-supported");
    expect(result.evidenceStrength).toBe("supportive");
    expect(result.relativeSkeletalMuscleDeltaKg).toBe(0);
  });

  it("does not classify fat loss plus negative relative SM delta as positive recomposition", () => {
    const result = estimateExperimentalBodyRecompositionV1({
      ...base,
      skeletalMuscleEnd: sm(-0.08),
    });
    expect(result.classification).toBe("not-positive-recomposition-muscle-loss");
    expect(result.evidenceStrength).toBe("none");
    expect(result.reasons).toContain(
      "fat-loss-plus-negative-relative-skeletal-muscle-delta-is-not-positive-recomposition",
    );
  });

  it("does not require surplus evidence", () => {
    const result = estimateExperimentalBodyRecompositionV1(base);
    expect(result.classification).toBe("positive-recomposition-supported");
    expect(result.features.rejectedConversions).toContain("surplus-required-for-recomposition");
    expect(result.reasons).toContain("surplus-not-required-for-recomposition-classification");
  });

  it("returns insufficient evidence when fat evidence is missing rather than no recomposition", () => {
    const result = estimateExperimentalBodyRecompositionV1({
      ...base,
      fatEnd: fat(null, "unavailable"),
    });
    expect(result.status).toBe("unavailable");
    expect(result.classification).toBe("insufficient-evidence");
    expect(result.unavailableReason).toBe("missing-fat-evidence");
    expect(result.reasons).toContain("missing-fat-evidence-is-not-no-recomposition");
  });

  it("returns insufficient evidence when relative SM evidence is missing rather than no recomposition", () => {
    const result = estimateExperimentalBodyRecompositionV1({
      ...base,
      skeletalMuscleEnd: sm(null, "unavailable"),
    });
    expect(result.status).toBe("unavailable");
    expect(result.classification).toBe("insufficient-evidence");
    expect(result.unavailableReason).toBe("missing-relative-skeletal-muscle-evidence");
    expect(result.reasons).toContain(
      "missing-relative-skeletal-muscle-evidence-is-not-no-recomposition",
    );
  });

  it("does not convert FFM/lean/BIA/DXA into skeletal muscle or allocate a residual", () => {
    const plain = estimateExperimentalBodyRecompositionV1(base);
    const withProxies = estimateExperimentalBodyRecompositionV1({
      ...base,
      leanMassKg: 64,
      biaOrDxaFfmKg: 66,
      scaleWeightResidualKg: 1.3,
      ffmRetentionContext: {
        availability: "available",
        retentionEffect: { lower: 0.1, point: 0.4, upper: 0.6 },
        relativeSlowNonFatLossDifferenceKg: { lower: 0.01, point: 0.03, upper: 0.05 },
      },
    });
    expect(withProxies.classification).toBe(plain.classification);
    expect(withProxies.relativeSkeletalMuscleDeltaKg).toBe(plain.relativeSkeletalMuscleDeltaKg);
    expect(withProxies.absoluteSkeletalMuscleKg).toBeNull();
    expect(withProxies.unallocatedResidualKg).toBeNull();
    expect(withProxies.features.ffmRetentionUsedForClassification).toBe(false);
    expect(withProxies.ffmRetentionContext.retentionEffectPoint).toBe(0.4);
    expect(withProxies.features.rejectedConversions).toEqual(expect.arrayContaining([
      "ffm-lean-to-skeletalMuscleKg",
      "bia-dxa-to-skeletalMuscleKg",
      "scale-residual-allocation",
      "fat-muscle-residual-balancing",
    ]));
  });

  it("rebuilds deterministically", () => {
    const days = [
      { date: "2026-09-10", ...base },
      { date: "2026-09-11", ...base, fatEnd: fat(19.2), skeletalMuscleStart: sm(0.12), skeletalMuscleEnd: sm(0.12) },
    ];
    const a = rebuildExperimentalBodyRecompositionTrajectoryV1({ days });
    const b = rebuildExperimentalBodyRecompositionTrajectoryV1({ days });
    expect(a.map((row) => row.fingerprint)).toEqual(b.map((row) => row.fingerprint));
    expect(a.map((row) => row.classification)).toEqual(b.map((row) => row.classification));
  });

  it("does not appear in production forecast, TDEE, daily runtime, or FatWeightShadow mean paths", () => {
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const tdee = readFileSync("src/model/base-tdee.ts", "utf8");
    const mean = readFileSync("src/model/physiology-v7/fat-weight-shadow-v1.ts", "utf8");
    const symbol = "estimateExperimentalBodyRecompositionV1";
    expect(runtime).not.toContain(symbol);
    expect(forecast).not.toContain(symbol);
    expect(tdee).not.toContain(symbol);
    expect(mean).not.toContain(symbol);
    expect(forecast).not.toContain("experimental-body-recomposition");
    expect(tdee).not.toContain("experimental-body-recomposition");
  });
});
