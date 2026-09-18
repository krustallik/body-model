import { describe, expect, it } from "vitest";
import { partitionEnergyBalance } from "@/model/body-composition/partition";
import {
  FAT_WEIGHT_SHADOW_V1_VERSION,
  transitionFatWeightShadowV1,
} from "@/model/physiology-v7/fat-weight-shadow-v1";

const prior = {
  fatMassKg: 20,
  slowNonFatKg: 50,
  availability: "available" as const,
  provenance: "episode-bia-derived-estimate" as const,
  uncertainty: "personal-unavailable" as const,
};

describe("fat weight shadow v1", () => {
  it("is deterministic, directionally partitions energy, and never overwrites state from observations", () => {
    const deficit = transitionFatWeightShadowV1({
      prior, energyBalanceKcal: -500, observedWeightKg: 100, observedBodyFatPercent: 5,
    });
    const surplus = transitionFatWeightShadowV1({
      prior, energyBalanceKcal: 500, observedWeightKg: 1, observedBodyFatPercent: 99,
    });
    expect(deficit.state.fatMassKg).toBeLessThan(20);
    expect(deficit.state.slowNonFatKg).toBeLessThan(50);
    expect(surplus.state.fatMassKg).toBeGreaterThan(20);
    expect(surplus.state.slowNonFatKg).toBeGreaterThan(50);
    expect(transitionFatWeightShadowV1({
      prior, energyBalanceKcal: 500, observedWeightKg: 1, observedBodyFatPercent: 99,
    })).toEqual(surplus);
  });

  it("applies the closed Hall/Forbes partition and ignores scale residual and BIA fat", () => {
    const observedWeightKg = 100;
    const observedBodyFatPercent = 5;
    const result = transitionFatWeightShadowV1({
      prior, energyBalanceKcal: -500, observedWeightKg, observedBodyFatPercent,
    });
    const partition = partitionEnergyBalance({ fatMassKg: 20, availableEnergyKcal: -500 });
    expect(result.modelVersion).toBe(FAT_WEIGHT_SHADOW_V1_VERSION);
    expect(result.state).toEqual({
      fatMassKg: 20 + partition.deltaFatMassKg,
      slowNonFatKg: 50 + partition.deltaLeanTissueKg,
      availability: "available",
      provenance: "episode-bia-derived-estimate",
      uncertainty: "personal-unavailable",
    });
    expect(result.observation).toEqual({
      scaleWeightKg: observedWeightKg,
      bodyFatPercent: observedBodyFatPercent,
      handling: "noisy-not-state-overwrite",
    });
    expect(result.state.fatMassKg! + result.state.slowNonFatKg!).not.toBe(observedWeightKg);
    expect(result.state.fatMassKg).not.toBe(observedWeightKg * observedBodyFatPercent / 100);
    expect(result.state).not.toHaveProperty("skeletalMuscleKg");
    expect(result.state).not.toHaveProperty("glycogenKg");
  });

  it("keeps identical fingerprints for identical inputs and changes them only when inputs change", () => {
    const input = {
      prior, energyBalanceKcal: -250, observedWeightKg: 81.2, observedBodyFatPercent: 21.5,
    };
    const first = transitionFatWeightShadowV1(input);
    expect(transitionFatWeightShadowV1(input).fingerprint).toBe(first.fingerprint);
    expect(transitionFatWeightShadowV1({
      ...input, observedWeightKg: 140,
    }).state).toEqual(first.state);
    expect(transitionFatWeightShadowV1({
      ...input, observedBodyFatPercent: 8,
    }).state).toEqual(first.state);
    expect(transitionFatWeightShadowV1({
      ...input, energyBalanceKcal: 250,
    }).fingerprint).not.toBe(first.fingerprint);
  });

  it("keeps missing initialization unavailable rather than allocating residual", () => {
    const result = transitionFatWeightShadowV1({
      prior: { ...prior, fatMassKg: null, availability: "unavailable", provenance: null },
      energyBalanceKcal: 100,
      observedWeightKg: 80,
      observedBodyFatPercent: 20,
    });
    expect(result.state).toEqual({
      fatMassKg: null,
      slowNonFatKg: null,
      availability: "unavailable",
      provenance: null,
      uncertainty: "personal-unavailable",
    });
    expect(result.reasons).toEqual(["missing-defensible-initial-fat-state"]);
    expect(result.observation.handling).toBe("noisy-not-state-overwrite");
  });

  it("keeps missing energy balance unavailable rather than writing zero tissue change", () => {
    const result = transitionFatWeightShadowV1({
      prior, energyBalanceKcal: null, observedWeightKg: 80, observedBodyFatPercent: 20,
    });
    expect(result.state.fatMassKg).toBeNull();
    expect(result.state.slowNonFatKg).toBeNull();
    expect(result.state.availability).toBe("unavailable");
    expect(result.reasons).toEqual(["missing-energy-balance"]);
  });

  it("does not recover after an unavailable day, even when later energy exists", () => {
    const missing = transitionFatWeightShadowV1({
      prior, energyBalanceKcal: null, observedWeightKg: 80, observedBodyFatPercent: 20,
    });
    const later = transitionFatWeightShadowV1({
      prior: missing.state,
      energyBalanceKcal: -300,
      observedWeightKg: 79.5,
      observedBodyFatPercent: 19.5,
    });
    expect(later.state.availability).toBe("unavailable");
    expect(later.state.fatMassKg).toBeNull();
    expect(later.reasons).toContain("missing-defensible-initial-fat-state");
  });
});
