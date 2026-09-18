import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENGINEERING_GLYCOGEN_BASELINE_REFERENCE_KG_V1,
  EXPERIMENTAL_GLYCOGEN_BASELINE_REFERENCE_V1,
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
  it("tracks multi-day depletion then partial/full repletion around the baseline", () => {
    const trajectory = rebuildExperimentalGlycogenStateTrajectoryV1({
      days: [
        {
          date: "2026-09-01",
          exerciseDepletionKg: -0.08,
          workoutFeedObserved: true,
          carbsG: 120,
        },
        {
          date: "2026-09-02",
          exerciseDepletionKg: null,
          workoutFeedObserved: true,
          carbsG: 280,
        },
        {
          date: "2026-09-03",
          exerciseDepletionKg: null,
          workoutFeedObserved: true,
          carbsG: 320,
        },
      ],
    });
    expect(trajectory).toHaveLength(3);
    expect(trajectory[0]!.state.relativeDeviationKg!).toBeLessThan(0);
    expect(trajectory[0]!.provenance).toBe(EXPERIMENTAL_GLYCOGEN_STATE_V1_PROVENANCE);
    expect(trajectory[0]!.contractVersion).toBe(EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION);
    // Rest/high-carb days raise relative state vs the depleted day.
    expect(trajectory[1]!.state.relativeDeviationKg!)
      .toBeGreaterThan(trajectory[0]!.state.relativeDeviationKg!);
    expect(trajectory[2]!.state.relativeDeviationKg!)
      .toBeGreaterThanOrEqual(trajectory[1]!.state.relativeDeviationKg!);
    expect(trajectory[2]!.state.baselineReferenceKg)
      .toBe(ENGINEERING_GLYCOGEN_BASELINE_REFERENCE_KG_V1);
  });

  it("accumulates repeated training-day depletion when carbs are modest", () => {
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
    expect(trajectory[1]!.state.absoluteGlycogenKg!)
      .toBeLessThan(trajectory[0]!.state.absoluteGlycogenKg!);
  });

  it("treats rest/high-carb days as recovery without inventing personal capacity", () => {
    const depleted = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: -0.1,
      workoutFeedObserved: true,
      carbsG: 50,
    });
    const rest = transitionExperimentalGlycogenStateV1({
      prior: depleted.state,
      exerciseDepletionKg: null,
      workoutFeedObserved: true,
      carbsG: 350,
    });
    expect(rest.exerciseCoverage).toBe("observed-rest-zero-depletion");
    expect(rest.repletionCoverage).toBe("applied");
    expect(rest.state.relativeDeviationKg!).toBeGreaterThan(depleted.state.relativeDeviationKg!);
    expect(rest.state.personalCapacityKg).toBeNull();
    expect(rest.literatureCapacityClampRejected).toBe(true);
    expect(EXPERIMENTAL_GLYCOGEN_BASELINE_REFERENCE_V1.personalCapacity).toBe(false);
    expect(EXPERIMENTAL_GLYCOGEN_BASELINE_REFERENCE_V1.classification)
      .toBe("engineering-baseline-reference");
    const lit = GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg;
    expect(rest.state.absoluteGlycogenKg).not.toBe(lit.upperKg);
    expect(rest.adultCapacityClampPolicy.personalCapacityDerivation)
      .toBe("intentionally-rejected");
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
    // Without inventing rest depletion, missing feed should not force a more
    // negative state than observed rest before repletion differences.
    expect(missingFeed.state.relativeDeviationKg!)
      .toBeGreaterThanOrEqual(observedRest.state.relativeDeviationKg! - 1e-12);
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
  });

  it("never allows an impossible negative absolute store when baseline is known", () => {
    const result = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: -5,
      workoutFeedObserved: true,
      carbsG: 0,
    });
    expect(result.state.absoluteGlycogenKg).toBe(0);
    expect(result.state.absoluteGlycogenLowerKg).toBe(0);
    expect(result.storeFloorApplied).toBe(true);
    expect(result.state.relativeDeviationKg)
      .toBe(-ENGINEERING_GLYCOGEN_BASELINE_REFERENCE_KG_V1);
  });

  it("rejects scale-weight residual allocation into glycogen state", () => {
    const result = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: -0.02,
      workoutFeedObserved: true,
      carbsG: 100,
    });
    expect(result.features.rejectedConversions).toContain("scale-weight-residual");
    expect(result.reasons).toContain("scale-weight-residual-intentionally-rejected");
  });

  it("derives glycogen-associated water from the net glycogen change", () => {
    const result = transitionExperimentalGlycogenStateV1({
      prior: initialExperimentalGlycogenStateV1(),
      exerciseDepletionKg: -0.04,
      workoutFeedObserved: true,
      carbsG: 40,
    });
    expect(result.glycogenAssociatedWater?.availability).toBe("available");
    expect(result.compartmentSeparation.glycogenAssociatedWater)
      .toBe("derived-from-glycogen-delta");
    expect(result.compartmentSeparation.ecfDeviation).toBe("not-a-fallback-or-residual");
    expect(result.compartmentSeparation.transientExerciseWater).toBe("not-mixed");
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
