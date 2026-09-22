import { describe, expect, it } from "vitest";
import { rebuildExperimentalDataGapContextsV1, type ExperimentalSourceCoverageV1 } from "@/model/physiology-v7/experimental-data-gap-context-v1";
import { rebuildExperimentalCessationDetrainingTrajectoryV1 } from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import { rebuildExperimentalGlycogenStateTrajectoryV1 } from "@/model/physiology-v7/experimental-glycogen-state-v1";
import { rebuildExperimentalTransientExerciseWaterTrajectoryV1 } from "@/model/physiology-v7/experimental-transient-exercise-water-v1";
import {
  initialExperimentalFatWeightUncertaintyStateV1,
  rebuildExperimentalFatWeightUncertaintyTrajectoryV1,
} from "@/model/physiology-v7/experimental-fat-weight-uncertainty-v1";

const complete = { training: "observed", nutrition: "observed", weight: "observed", sleep: "observed" } as const;
const absent = { training: "unresolved", nutrition: "missing", weight: "missing", sleep: "missing" } as const;
const weightOnly = { training: "unresolved", nutrition: "missing", weight: "observed", sleep: "missing" } as const;
const mean = { fatMassKg: 16, slowNonFatKg: 55, availability: "available" as const, provenance: "episode-bia-derived-estimate" as const, uncertainty: "personal-unavailable" as const };

function days(count: number, sources: Readonly<Record<string, ExperimentalSourceCoverageV1>> = complete, start = 1) {
  return Array.from({ length: count }, (_, index) => ({ date: `2026-01-${String(start + index).padStart(2, "0")}`, sources }));
}

/** Cross-shadow E2E contracts: raw gaps remain raw gaps while each transition keeps only its own defensible state. */
describe("experimental shadow gap E2E", () => {
  it("1: short all-source gap bridges context, widens modestly, then recovers without raw invention", () => {
    const result = rebuildExperimentalDataGapContextsV1({ days: [...days(7), ...days(2, absent, 8), ...days(1, complete, 10)] });
    expect(result[8]!).toMatchObject({ gapLengthDays: 2, bridgeProvenance: "modeled-gap-bridge" });
    expect(result[8]!.sources.nutrition).toBe("missing");
    expect(result[9]!).toMatchObject({ dataQuality: "recovering", gapLengthDays: 0 });
    expect(result[9]!.uncertaintyWidthMultiplier).toBeGreaterThan(1);
  });

  it("2: scale-only days preserve scale evidence without inventing food or training", () => {
    const result = rebuildExperimentalDataGapContextsV1({ days: [...days(7), ...days(3, weightOnly, 8), ...days(1, complete, 11)] });
    expect(result[7]!.sources).toMatchObject({ weight: "observed", nutrition: "missing", training: "unresolved" });
    expect(result[7]!.gapLengthDays).toBe(0);
  });

  it("3: a seven-day all-source gap is degraded but resumes without reset", () => {
    const result = rebuildExperimentalDataGapContextsV1({ days: [...days(7), ...days(7, absent, 8), ...days(1, complete, 15)] });
    expect(result[13]!).toMatchObject({ gapLengthDays: 7, gapSeverity: "large-data-gap", dataQuality: "degraded" });
    expect(result[14]!.dataQuality).toBe("recovering");
  });

  it("3a: an exact ten-day all-source gap is large, not extended, and never invents observations", () => {
    const result = rebuildExperimentalDataGapContextsV1({ days: [...days(1), ...days(10, absent, 2), ...days(1, complete, 12)] });
    const gap = result[10]!;
    expect(gap).toMatchObject({ gapLengthDays: 10, gapSeverity: "large-data-gap", dataQuality: "degraded", bridgeProvenance: "modeled-gap-bridge", rawSourceMutationAllowed: false });
    expect(gap.sources).toEqual(absent);
    expect(gap.uncertaintyWidthMultiplier).toBeGreaterThan(1);
    expect(result[11]!.dataQuality).toBe("recovering");
    expect(rebuildExperimentalDataGapContextsV1({ days: [...days(1), ...days(10, absent, 2), ...days(1, complete, 12)] })).toEqual(result);
  });

  it("4: missing workout coverage does not extend verified-rest cessation evidence", () => {
    const trajectory = rebuildExperimentalCessationDetrainingTrajectoryV1({ days: [
      { date: "2026-01-01", exposureKind: "qualified-mapped-training", trainingSkeletalMuscleDeltaKg: 0.01 },
      ...Array.from({ length: 10 }, (_, index) => ({ date: `2026-01-${String(index + 2).padStart(2, "0")}`, exposureKind: "verified-no-exposure" as const })),
      { date: "2026-01-12", exposureKind: "unresolved-missing-training" },
      { date: "2026-01-13", exposureKind: "unresolved-missing-training" },
      ...Array.from({ length: 5 }, (_, index) => ({ date: `2026-01-${String(index + 14).padStart(2, "0")}`, exposureKind: "verified-no-exposure" as const })),
    ] });
    expect(trajectory.at(-1)!.state.observedNoExposureStreakDays).toBe(15);
    expect(trajectory[11]!.state.phase).toBe("unknown-coverage-not-cessation");
  });

  it("5: nutrition gap gives glycogen a bridge rather than a fake zero net", () => {
    const rows = rebuildExperimentalGlycogenStateTrajectoryV1({ days: [
      { date: "2026-01-01", exerciseDepletionKg: -0.08, workoutFeedObserved: true, carbsG: 100 },
      { date: "2026-01-02", exerciseDepletionKg: null, workoutFeedObserved: null, carbsG: null },
      { date: "2026-01-03", exerciseDepletionKg: null, workoutFeedObserved: true, carbsG: 250 },
    ] });
    expect(rows[1]!.features.coverageState).toBe("modeled-gap-bridge");
    expect(rows[1]!.netGlycogenDeltaKg).toBeNull();
    expect(rows[2]!.state.relativeDeviationKg).not.toBeNull();
  });

  it("6: transient water ages across three missing dates without an impulse", () => {
    const rows = rebuildExperimentalTransientExerciseWaterTrajectoryV1({ priorTransientWaterKg: 0, days: [
      { date: "2026-01-01", resistanceSession: { qualifiedHardSetCount: 8, exposureContext: "novel-or-unknown" } },
      { date: "2026-01-04" },
    ] });
    expect(rows[1]!.acuteImpulseKg.point).toBe(0);
    expect(rows[1]!.resultingTransientWaterKg.point).toBeLessThan(rows[0]!.resultingTransientWaterKg.point!);
  });

  it("7: a reconstructed gap is deterministic and replaces the prior bridge", () => {
    const bridged = rebuildExperimentalDataGapContextsV1({ days: [...days(1), ...days(2, absent, 2), ...days(1, complete, 4)] });
    const corrected = rebuildExperimentalDataGapContextsV1({ days: days(4) });
    expect(bridged[2]!.bridgeProvenance).toBe("modeled-gap-bridge");
    expect(corrected[2]!.bridgeProvenance).toBe("none");
    expect(corrected).toEqual(rebuildExperimentalDataGapContextsV1({ days: days(4) }));
  });

  it("8: shuffled source history gives the same chronological gap result", () => {
    const source = [...days(2), ...days(2, absent, 3), ...days(1, complete, 5)];
    const ordered = rebuildExperimentalDataGapContextsV1({ days: source.sort((a, b) => a.date.localeCompare(b.date)) });
    const shuffled = rebuildExperimentalDataGapContextsV1({ days: [source[3]!, source[0]!, source[4]!, source[1]!, source[2]!] });
    expect(shuffled).toEqual(ordered);
  });

  it("9: nutrition-only gaps leave unrelated coverage observed", () => {
    const rows = rebuildExperimentalDataGapContextsV1({ days: days(3, { training: "observed", nutrition: "missing", weight: "observed", sleep: "observed" }) });
    expect(rows[2]!.sources).toMatchObject({ training: "observed", weight: "observed", nutrition: "missing" });
    expect(rows[2]!.gapLengthDays).toBe(0);
  });

  it("10: missing weight widens modeled fat uncertainty without fabricating a scale record", () => {
    const rows = rebuildExperimentalFatWeightUncertaintyTrajectoryV1({ priorMean: mean, priorUncertainty: initialExperimentalFatWeightUncertaintyStateV1(), days: [
      { date: "2026-01-01", energyBalanceKcal: 0, observedWeightKg: 71, observedBodyFatPercent: null },
      { date: "2026-01-02", energyBalanceKcal: 0, observedWeightKg: null, observedBodyFatPercent: null },
      { date: "2026-01-03", energyBalanceKcal: 0, observedWeightKg: null, observedBodyFatPercent: null },
      { date: "2026-01-04", energyBalanceKcal: 0, observedWeightKg: null, observedBodyFatPercent: null },
      { date: "2026-01-05", energyBalanceKcal: 0, observedWeightKg: 71, observedBodyFatPercent: null },
    ] });
    expect(rows[3]!.observation.scaleWeightKg).toBeNull();
    expect(rows[3]!.uncertaintyState.weightHalfWidthKg!).toBeGreaterThan(rows[0]!.uncertaintyState.weightHalfWidthKg!);
    expect(rows[4]!.observation.scaleWeightKg).toBe(71);
  });
});
