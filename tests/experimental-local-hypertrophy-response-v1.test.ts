import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENGINEERING_WEEKLY_DIRECT_SET_SCALE_TAU_V1,
  EXPERIMENTAL_LOCAL_HYPERTROPHY_PRIORS_V1,
  EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_PROVENANCE,
  EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_REVISION,
  EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_UNIT,
  estimateExperimentalLocalHypertrophyResponseV1,
  rebuildExperimentalLocalHypertrophyResponseTrajectoryV1,
} from "@/model/physiology-v7/experimental-local-hypertrophy-response-v1";
import type { CanonicalMuscleGroupV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";

const weekStartDate = "2026-09-14";

function chest(directQualifiedSetCount: number | null, extra?: {
  indirectQualifiedSetCount?: number | null;
  unmappedSetCount?: number;
  sessionCount?: number;
  daysUnobserved?: number;
}) {
  return estimateExperimentalLocalHypertrophyResponseV1({
    weekStartDate,
    muscleGroups: [
      {
        muscleGroup: "chest",
        directQualifiedSetCount,
        indirectQualifiedSetCount: extra?.indirectQualifiedSetCount ?? 0,
      },
      {
        muscleGroup: "triceps",
        directQualifiedSetCount: 2,
        indirectQualifiedSetCount: 0,
      },
    ],
    unmappedSetCount: extra?.unmappedSetCount ?? 0,
    sessionCount: extra?.sessionCount ?? 3,
    daysUnobserved: extra?.daysUnobserved ?? 0,
    daysObservedMappedExposure: 3,
    daysObservedNoExposure: 4,
  });
}

function muscle(
  result: ReturnType<typeof estimateExperimentalLocalHypertrophyResponseV1>,
  group: CanonicalMuscleGroupV7,
) {
  return result.muscleResponses.find((row) => row.muscleGroup === group)!;
}

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental local hypertrophy response v1", () => {
  it("maps distinct muscle groups from direct qualified volume", () => {
    const result = estimateExperimentalLocalHypertrophyResponseV1({
      weekStartDate,
      muscleGroups: [
        { muscleGroup: "chest", directQualifiedSetCount: 12, indirectQualifiedSetCount: 0 },
        { muscleGroup: "hip_extensors", directQualifiedSetCount: 4, indirectQualifiedSetCount: 2 },
      ],
    });
    const chestRow = muscle(result, "chest");
    const hip = muscle(result, "hip_extensors");
    const unused = muscle(result, "forearms");
    expect(chestRow.availability).toBe("available");
    expect(hip.availability).toBe("available");
    expect(chestRow.expectedLocalResponse!).toBeGreaterThan(hip.expectedLocalResponse!);
    expect(chestRow.directQualifiedSetCount).toBe(12);
    expect(hip.directQualifiedSetCount).toBe(4);
    expect(unused.availability).toBe("unavailable");
    expect(result.provenance).toBe(EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_PROVENANCE);
    expect(result.contractVersion).toBe(EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_REVISION);
    expect(result.unit).toBe(EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_UNIT);
  });

  it("higher supported volume does not lower group-expected local hypertrophy (C-A01)", () => {
    const low = chest(4);
    const high = chest(18);
    const lowChest = muscle(low, "chest");
    const highChest = muscle(high, "chest");
    expect(lowChest.availability).toBe("available");
    expect(highChest.availability).toBe("available");
    expect(highChest.expectedLocalResponse!)
      .toBeGreaterThanOrEqual(lowChest.expectedLocalResponse!);
    expect(highChest.lowerBound!).toBeGreaterThanOrEqual(lowChest.lowerBound!);
    expect(highChest.upperBound!).toBeGreaterThanOrEqual(lowChest.upperBound!);
    expect(highChest.doseScale!).toBeGreaterThan(lowChest.doseScale!);
    expect(muscle(low, "triceps").expectedLocalResponse)
      .toBe(muscle(high, "triceps").expectedLocalResponse);
  });

  it("saturates without an optimal-set cutoff or linear kg/set slope", () => {
    const mid = muscle(chest(12), "chest");
    const high = muscle(chest(24), "chest");
    const veryHigh = muscle(chest(48), "chest");
    expect(high.expectedLocalResponse!).toBeGreaterThan(mid.expectedLocalResponse!);
    expect(veryHigh.expectedLocalResponse!).toBeGreaterThan(high.expectedLocalResponse!);
    const firstIncrement = high.expectedLocalResponse! - mid.expectedLocalResponse!;
    const secondIncrement = veryHigh.expectedLocalResponse! - high.expectedLocalResponse!;
    expect(secondIncrement).toBeLessThan(firstIncrement);
    expect(veryHigh.expectedLocalResponse!).toBeLessThan(1);
    expect(veryHigh.expectedLocalResponse!).toBeGreaterThan(0);
    expect(ENGINEERING_WEEKLY_DIRECT_SET_SCALE_TAU_V1).toBe(12);
    expect(EXPERIMENTAL_LOCAL_HYPERTROPHY_PRIORS_V1.classification)
      .toBe("engineering-saturating-scale-not-optimal-set-cutoff");
  });

  it("treats missing mapped dose as unavailable rather than zero response", () => {
    const missing = chest(null);
    const zero = chest(0);
    expect(muscle(missing, "chest").availability).toBe("unavailable");
    expect(muscle(missing, "chest").expectedLocalResponse).toBeNull();
    expect(muscle(missing, "chest").unavailableReason).toBe("missing-mapped-direct-dose");
    expect(muscle(zero, "chest").availability).toBe("available");
    expect(muscle(zero, "chest").expectedLocalResponse).toBe(0);
    expect(missing.reasons).toContain("missing-mapped-direct-dose-is-not-zero-response");
  });

  it("does not convert local response into kg/set or skeletalMuscleKg", () => {
    const result = chest(10);
    const chestRow = muscle(result, "chest");
    expect(result.unit).toBe("dimensionless-local-hypertrophy-response");
    expect(result.features.skeletalMuscleKg).toBeNull();
    expect(result.features.wholeBodySkeletalMuscleDeltaKg).toBeNull();
    expect(result.features.rejectedConversions).toEqual(
      expect.arrayContaining([
        "kg-per-set",
        "skeletalMuscleKg",
        "whole-body-skeletal-muscle-delta",
        "linear-volume-to-hypertrophy",
        "optimal-weekly-set-cutoff",
      ]),
    );
    expect(chestRow.expectedLocalResponse).not.toBe(10 / 12);
    expect(JSON.stringify(result)).not.toMatch(/estimatedSkeletalMuscleDeltaKg/);
  });

  it("does not mutate whole-body skeletal muscle and stays off production paths", () => {
    const math = readFileSync(
      "src/model/physiology-v7/experimental-local-hypertrophy-response-v1.ts",
      "utf8",
    );
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const tdee = readFileSync("src/model/base-tdee.ts", "utf8");
    const smDelta = readFileSync(
      "src/model/physiology-v7/experimental-skeletal-muscle-delta-v1.ts",
      "utf8",
    );
    expect(math).not.toContain("estimateExperimentalSkeletalMuscleDeltaV1");
    expect(runtime).not.toContain("estimateExperimentalLocalHypertrophyResponseV1");
    expect(forecast).not.toContain("estimateExperimentalLocalHypertrophyResponseV1");
    expect(tdee).not.toContain("estimateExperimentalLocalHypertrophyResponseV1");
    expect(smDelta).not.toContain("estimateExperimentalLocalHypertrophyResponseV1");
  });

  it("widens uncertainty with indirect work without raising the point", () => {
    const directOnly = muscle(chest(10, { indirectQualifiedSetCount: 0 }), "chest");
    const withIndirect = muscle(chest(10, { indirectQualifiedSetCount: 16 }), "chest");
    expect(withIndirect.expectedLocalResponse).toBe(directOnly.expectedLocalResponse);
    expect(withIndirect.upperBound! - withIndirect.lowerBound!)
      .toBeGreaterThan(directOnly.upperBound! - directOnly.lowerBound!);
  });

  it("does not apply a session-frequency multiplier at equated weekly volume", () => {
    const fewSessions = chest(12, { sessionCount: 2 });
    const manySessions = chest(12, { sessionCount: 6 });
    expect(muscle(fewSessions, "chest").expectedLocalResponse)
      .toBe(muscle(manySessions, "chest").expectedLocalResponse);
    expect(fewSessions.features.frequencyMultiplierApplied).toBe(false);
    expect(manySessions.features.rejectedConversions)
      .toContain("frequency-hypertrophy-multiplier");
  });

  it("reproduces the same weekly trajectory on deterministic rebuild", () => {
    const weeks = [
      {
        weekStartDate: "2026-09-07",
        muscleGroups: [
          { muscleGroup: "chest" as const, directQualifiedSetCount: 8, indirectQualifiedSetCount: 2 },
        ],
      },
      {
        weekStartDate: "2026-09-14",
        muscleGroups: [
          { muscleGroup: "chest" as const, directQualifiedSetCount: 14, indirectQualifiedSetCount: 1 },
        ],
      },
    ];
    const a = rebuildExperimentalLocalHypertrophyResponseTrajectoryV1(weeks);
    const b = rebuildExperimentalLocalHypertrophyResponseTrajectoryV1(weeks);
    expect(a.map((row) => row.fingerprint)).toEqual(b.map((row) => row.fingerprint));
    expect(a.map((row) => muscle(row, "chest").expectedLocalResponse))
      .toEqual(b.map((row) => muscle(row, "chest").expectedLocalResponse));
  });
});
