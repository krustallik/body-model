import { describe, expect, it } from "vitest";
import { transitionFatWeightShadowV1 } from "@/model/physiology-v7/fat-weight-shadow-v1";
const prior = { fatMassKg: 20, slowNonFatKg: 50, availability: "available" as const, provenance: "legacy-model-initialization" as const, uncertainty: "personal-unavailable" as const };
describe("fat weight shadow v1", () => {
  it("is deterministic, directionally partitions energy, and never overwrites state from observations", () => {
    const deficit = transitionFatWeightShadowV1({ prior, energyBalanceKcal: -500, observedWeightKg: 100, observedBodyFatPercent: 5 });
    const surplus = transitionFatWeightShadowV1({ prior, energyBalanceKcal: 500, observedWeightKg: 1, observedBodyFatPercent: 99 });
    expect(deficit.state.fatMassKg).toBeLessThan(20); expect(deficit.state.slowNonFatKg).toBeLessThan(50);
    expect(surplus.state.fatMassKg).toBeGreaterThan(20); expect(surplus.state.slowNonFatKg).toBeGreaterThan(50);
    expect(transitionFatWeightShadowV1({ prior, energyBalanceKcal: 500, observedWeightKg: 1, observedBodyFatPercent: 99 })).toEqual(surplus);
  });
  it("keeps missing initialization unavailable rather than allocating residual", () => {
    const result = transitionFatWeightShadowV1({ prior: { ...prior, fatMassKg: null, availability: "unavailable", provenance: null }, energyBalanceKcal: 100, observedWeightKg: 80, observedBodyFatPercent: 20 });
    expect(result.state.fatMassKg).toBeNull(); expect(result.reasons).toContain("missing-defensible-initial-fat-state");
  });
});
