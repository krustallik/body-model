import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EXPERIMENTAL_GLYCOGEN_RELATIVE_BASELINE_V1,
  EXPERIMENTAL_GLYCOGEN_STATE_V1_PROVENANCE,
  EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION,
  initialExperimentalGlycogenStateV1,
  rebuildExperimentalGlycogenStateTrajectoryV1,
  transitionExperimentalGlycogenStateV1,
} from "@/model/physiology-v7/experimental-glycogen-state-v1";
import { SCIENTIFIC_GLYCOGEN_ASSOCIATED_WATER_RATIO_KG_PER_KG_V1 } from "@/model/physiology-v7/experimental-glycogen-associated-water-v1";
import { GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7 } from "@/model/physiology-v7/glycogen-transition-v7";

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental glycogen state v1", () => {
  it("does not let repeated high-carb rest days drift above relative baseline 0", () => {
    const depleted = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: -0.05,
      workoutFeedObserved: true,
      carbsG: 40,
    });
    const trajectory = rebuildExperimentalGlycogenStateTrajectoryV1({
      prior: depleted.state,
      days: Array.from({ length: 8 }, (_, index) => ({
        date: `2026-09-${String(10 + index).padStart(2, "0")}`,
        exerciseDepletionKg: null,
        workoutFeedObserved: true as const,
        carbsG: 400,
      })),
    });
    for (const day of trajectory) {
      expect(day.state.relativeDeviationKg!).toBeLessThanOrEqual(0);
      expect(day.state.relativeDeviationUpperKg!).toBeLessThanOrEqual(0);
      expect(day.state.absoluteGlycogenKg).toBeNull();
    }
    const last = trajectory[trajectory.length - 1]!;
    expect(last.state.relativeDeviationKg).toBe(0);
    expect(last.features.rejectedConversions).toContain(
      "positive-supercompensation-without-capacity",
    );
  });

  it("allows multi-day depletion debt to be repaid across later high-carb days", () => {
    const trajectory = rebuildExperimentalGlycogenStateTrajectoryV1({
      days: [
        {
          date: "2026-09-01",
          exerciseDepletionKg: -0.12,
          workoutFeedObserved: true,
          carbsG: 60,
        },
        {
          date: "2026-09-02",
          exerciseDepletionKg: null,
          workoutFeedObserved: true,
          carbsG: 300,
        },
        {
          date: "2026-09-03",
          exerciseDepletionKg: null,
          workoutFeedObserved: true,
          carbsG: 300,
        },
        {
          date: "2026-09-04",
          exerciseDepletionKg: null,
          workoutFeedObserved: true,
          carbsG: 300,
        },
      ],
    });
    expect(trajectory[0]!.state.relativeDeviationKg!).toBeLessThan(0);
    expect(trajectory[1]!.state.relativeDeviationKg!)
      .toBeGreaterThan(trajectory[0]!.state.relativeDeviationKg!);
    expect(trajectory[2]!.state.relativeDeviationKg!)
      .toBeGreaterThanOrEqual(trajectory[1]!.state.relativeDeviationKg!);
    expect(trajectory[trajectory.length - 1]!.state.relativeDeviationKg!)
      .toBeGreaterThan(trajectory[0]!.state.relativeDeviationKg!);
    expect(trajectory[trajectory.length - 1]!.state.relativeDeviationKg!)
      .toBeLessThanOrEqual(0);
  });

  it("accumulates repeated training-day depletion debt when carbs are modest", () => {
    const trajectory = rebuildExperimentalGlycogenStateTrajectoryV1({
      days: [
        {
          date: "2026-09-10",
          exerciseDepletionKg: -0.06,
          workoutFeedObserved: true,
          carbsG: 80,
        },
        {
          date: "2026-09-11",
          exerciseDepletionKg: -0.06,
          workoutFeedObserved: true,
          carbsG: 80,
        },
      ],
    });
    expect(trajectory[1]!.state.relativeDeviationKg!)
      .toBeLessThan(trajectory[0]!.state.relativeDeviationKg!);
    expect(trajectory[0]!.state.absoluteGlycogenKg).toBeNull();
    expect(trajectory[1]!.state.absoluteGlycogenKg).toBeNull();
  });

  it("does not require a negative physical-store assumption or 0.5 kg absolute floor", () => {
    const result = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: -5,
      workoutFeedObserved: true,
      carbsG: 0,
    });
    expect(result.state.relativeDeviationKg).toBe(-5);
    expect(result.state.absoluteGlycogenKg).toBeNull();
    expect(result.state.absoluteGlycogenLowerKg).toBeNull();
    expect(result.state.absoluteGlycogenUpperKg).toBeNull();
    expect(result.absoluteStoreFabricationRejected).toBe(true);
    expect(result.features.rejectedConversions).toContain("invented-absolute-0.5kg-store");
    expect(result.reasons).toContain("absolute-glycogen-store-intentionally-unavailable");
    expect(EXPERIMENTAL_GLYCOGEN_RELATIVE_BASELINE_V1.relativeDeviationKg).toBe(0);
    expect(EXPERIMENTAL_GLYCOGEN_RELATIVE_BASELINE_V1.absoluteStore).toBe("unavailable");
    expect(EXPERIMENTAL_GLYCOGEN_RELATIVE_BASELINE_V1.classification)
      .toBe("relative-depletion-debt-baseline");
  });

  it("reproduces the same trajectory on deterministic historical rebuild", () => {
    const days = [
      {
        date: "2026-09-20",
        exerciseDepletionKg: -0.07,
        exerciseDepletionLowerKg: -0.1,
        exerciseDepletionUpperKg: -0.04,
        workoutFeedObserved: true as const,
        carbsG: 150,
      },
      {
        date: "2026-09-21",
        exerciseDepletionKg: null,
        workoutFeedObserved: true as const,
        carbsG: 260,
      },
      {
        date: "2026-09-22",
        exerciseDepletionKg: -0.05,
        workoutFeedObserved: true as const,
        carbsG: 180,
      },
    ];
    const a = rebuildExperimentalGlycogenStateTrajectoryV1({ days });
    const b = rebuildExperimentalGlycogenStateTrajectoryV1({ days });
    expect(a.map((row) => row.fingerprint)).toEqual(b.map((row) => row.fingerprint));
    expect(a.map((row) => row.state)).toEqual(b.map((row) => row.state));
    expect(a.every((row) => row.state.relativeDeviationKg! <= 0)).toBe(true);
  });

  it("keeps prior uncertainty correlated with a zero transition (A-C, J)", () => {
    for (const prior of [
      { point: -0.1, lower: -0.2, upper: 0 },
      { point: -0.1, lower: -0.11, upper: -0.09 },
      { point: -0.1, lower: -0.5, upper: 0 },
    ]) {
      const result = transitionExperimentalGlycogenStateV1({
        prior: {
          ...initialExperimentalGlycogenStateV1(),
          relativeDeviationKg: prior.point,
          relativeDeviationLowerKg: prior.lower,
          relativeDeviationUpperKg: prior.upper,
        },
        exerciseDepletionKg: 0,
        workoutFeedObserved: true,
        carbsG: 0,
      });
      expect(result.state.relativeDeviationKg).toBe(prior.point);
      expect(result.state.relativeDeviationLowerKg).toBe(prior.lower);
      expect(result.state.relativeDeviationUpperKg).toBe(prior.upper);
      expect(result.netGlycogenDeltaKg).toBe(0);
      expect(result.netGlycogenDeltaLowerKg).toBe(0);
      expect(result.netGlycogenDeltaUpperKg).toBe(0);
      expect(result.glycogenAssociatedWater?.estimatedGlycogenWaterDeltaKg).toBe(0);
      expect(result.glycogenAssociatedWater?.lowerBoundKg).toBe(0);
      expect(result.glycogenAssociatedWater?.upperBoundKg).toBe(0);
    }
  });

  it("keeps depletion/repletion branches dependent through caps (E-G, I, J)", () => {
    const prior = {
      ...initialExperimentalGlycogenStateV1(),
      relativeDeviationKg: -0.1,
      relativeDeviationLowerKg: -0.2,
      relativeDeviationUpperKg: -0.05,
    };
    const depletionOnly = transitionExperimentalGlycogenStateV1({
      prior,
      exerciseDepletionKg: -0.1,
      exerciseDepletionLowerKg: -0.2,
      exerciseDepletionUpperKg: -0.05,
      workoutFeedObserved: true,
      carbsG: 0,
    });
    expect(depletionOnly.netGlycogenDeltaKg).toBe(-0.1);
    expect(depletionOnly.netGlycogenDeltaLowerKg).toBe(-0.2);
    expect(depletionOnly.netGlycogenDeltaUpperKg).toBe(-0.05);

    const cappedRepletion = transitionExperimentalGlycogenStateV1({
      prior,
      exerciseDepletionKg: 0,
      workoutFeedObserved: true,
      carbsG: 10_000,
    });
    // The upper branch alone reaches zero debt. The transition range is still
    // the range of corresponding branch deltas, not a cross-subtraction of
    // state envelopes (which would have manufactured [-0.2, +0.2]).
    expect(cappedRepletion.state.relativeDeviationKg).toBeCloseTo(-0.05);
    expect(cappedRepletion.state.relativeDeviationLowerKg).toBeCloseTo(-0.19);
    expect(cappedRepletion.state.relativeDeviationUpperKg).toBe(0);
    expect(cappedRepletion.netGlycogenDeltaKg).toBeCloseTo(0.05);
    expect(cappedRepletion.netGlycogenDeltaLowerKg).toBeCloseTo(0.01);
    expect(cappedRepletion.netGlycogenDeltaUpperKg).toBeCloseTo(0.05);
    expect(cappedRepletion.glycogenAssociatedWater?.estimatedGlycogenWaterDeltaKg).toBeCloseTo(0.175);
    expect(cappedRepletion.glycogenAssociatedWater?.lowerBoundKg).toBeCloseTo(0.03);
    expect(cappedRepletion.glycogenAssociatedWater?.upperBoundKg).toBeCloseTo(0.2);

    const offsetThenCapped = transitionExperimentalGlycogenStateV1({
      prior,
      exerciseDepletionKg: -0.1,
      exerciseDepletionLowerKg: -0.2,
      exerciseDepletionUpperKg: -0.05,
      workoutFeedObserved: true,
      carbsG: 10_000,
    });
    expect(offsetThenCapped.state.relativeDeviationKg).toBeCloseTo(-0.15);
    expect(offsetThenCapped.netGlycogenDeltaKg).toBeCloseTo(-0.05);
    expect(offsetThenCapped.netGlycogenDeltaLowerKg).toBeCloseTo(-0.19);
    expect(offsetThenCapped.netGlycogenDeltaUpperKg).toBeCloseTo(0.05);
  });

  it("does not invent a lower absolute-store clamp when depletion is extreme (H)", () => {
    const result = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: -5,
      workoutFeedObserved: true,
      carbsG: 0,
    });
    expect(result.state.relativeDeviationKg).toBe(-5);
    expect(result.netGlycogenDeltaKg).toBe(-5);
    expect(result.state.absoluteGlycogenKg).toBeNull();
  });

  it("treats missing carbs as unavailable repletion, not zero", () => {
    const result = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: -0.05,
      workoutFeedObserved: true,
      carbsG: null,
    });
    expect(result.repletionCoverage).toBe("skipped-missing-carbohydrate");
    expect(result.repletionDeltaKg).toBeNull();
    expect(result.reasons).toContain("missing-carbohydrate-is-not-zero-repletion");
    expect(result.state.relativeDeviationKg!).toBeLessThan(0);
  });

  it("does not treat missing workout feed as rest", () => {
    const missingFeed = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: null,
      workoutFeedObserved: null,
      carbsG: 200,
    });
    const observedRest = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: null,
      workoutFeedObserved: true,
      carbsG: 200,
    });
    expect(missingFeed.exerciseCoverage).toBe("unresolved-missing-workout-feed");
    expect(missingFeed.depletionDeltaKg).toBeNull();
    expect(missingFeed.reasons).toContain("missing-workout-feed-is-not-rest");
    expect(observedRest.exerciseCoverage).toBe("observed-rest-zero-depletion");
    expect(observedRest.depletionDeltaKg).toBe(0);
    expect(missingFeed.state.relativeDeviationKg).toBe(0);
    expect(observedRest.state.relativeDeviationKg).toBe(0);
  });

  it("bridges a fully missing day without asserting a zero net change or water", () => {
    const prior = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(), exerciseDepletionKg: -0.04,
      workoutFeedObserved: true, carbsG: null,
    }).state;
    const gap = transitionExperimentalGlycogenStateV1({
      prior, exerciseDepletionKg: null, workoutFeedObserved: null, carbsG: null,
    });
    expect(gap.features.coverageState).toBe("modeled-gap-bridge");
    expect(gap.features.netChangeAsserted).toBe(false);
    expect(gap.netGlycogenDeltaKg).toBeNull();
    expect(gap.glycogenAssociatedWater).toBeNull();
    expect(gap.state.relativeDeviationKg).toBe(prior.relativeDeviationKg);
  });

  it("rejects scale-weight residual and literature capacity clamps", () => {
    const result = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: -0.02,
      workoutFeedObserved: true,
      carbsG: 100,
    });
    expect(result.features.rejectedConversions).toContain("scale-weight-residual");
    expect(result.literatureCapacityClampRejected).toBe(true);
    expect(result.state.personalCapacityKg).toBeNull();
    const lit = GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg;
    expect(result.state.relativeDeviationKg).not.toBe(lit.upperKg);
    expect(result.adultCapacityClampPolicy.personalCapacityDerivation)
      .toBe("intentionally-rejected");
    expect(result.provenance).toBe(EXPERIMENTAL_GLYCOGEN_STATE_V1_PROVENANCE);
    expect(result.contractVersion).toBe(EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION);
  });

  it("derives glycogen-associated water from the net relative glycogen change", () => {
    const result = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: -0.04,
      workoutFeedObserved: true,
      carbsG: 40,
    });
    expect(result.glycogenAssociatedWater?.availability).toBe("available");
    expect(result.compartmentSeparation.glycogenAssociatedWater)
      .toBe("derived-from-net-relative-glycogen-delta");
    expect(result.glycogenAssociatedWater!.estimatedGlycogenWaterDeltaKg!).toBeCloseTo(
      result.netGlycogenDeltaKg!
        * SCIENTIFIC_GLYCOGEN_ASSOCIATED_WATER_RATIO_KG_PER_KG_V1.pointKgPerKg,
    );
    expect(Math.sign(result.glycogenAssociatedWater!.estimatedGlycogenWaterDeltaKg!))
      .toBe(Math.sign(result.netGlycogenDeltaKg!));
  });

  it("does not appear in production daily-runtime, forecast, TDEE, or v7 glycogen paths", () => {
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const tdee = readFileSync("src/model/base-tdee.ts", "utf8");
    const transition = readFileSync("src/model/physiology-v7/glycogen-transition-v7.ts", "utf8");
    const water = readFileSync("src/model/physiology-v7/glycogen-water-transition-v7.ts", "utf8");
    expect(runtime).not.toContain("transitionExperimentalGlycogenStateV1");
    expect(forecast).not.toContain("transitionExperimentalGlycogenStateV1");
    expect(tdee).not.toContain("transitionExperimentalGlycogenStateV1");
    expect(transition).not.toContain("transitionExperimentalGlycogenStateV1");
    expect(water).not.toContain("transitionExperimentalGlycogenStateV1");
  });
});
