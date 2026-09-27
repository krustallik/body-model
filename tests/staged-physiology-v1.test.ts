import { describe, expect, it } from "vitest";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { CURRENT_MODEL_VERSION, usesSelectionV1, usesWorkoutAwareActivity } from "@/modules/model-episodes/model-version";
import { selectCanonicalBodyMassV1 } from "@/model/activity/canonical-activity-policy-v1";
import { adaptManualStepperEnergyV1 } from "@/modules/training/manual-stepper-fields-v1";
import { evaluateStepperReconciliationV1 } from "@/modules/training/stepper-reconciliation-v1";
import { strengthPublicationDecisionV1, strengthInputFingerprintV1, strengthEstimateFreshV1, strengthSetFingerprintV1 } from "@/modules/training/strength-publication-v1";
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION } from "@/modules/training/experimental-strength-active-energy-v1";
import { runSyntheticReplayV1 } from "@/modules/model-episodes/staged-replay-v1";
import {
  activateVisibilityGenerationV1,
  memoryVisibilityStoreV1,
  rollbackVisibilityGenerationV1,
} from "@/modules/model-episodes/activation-rollback-v1";
import {
  buildForecastWorkoutSchedule,
  toProductionWorkoutActivity,
} from "@/modules/model-forecast/forecast-workout-scenario";
import { resolveExplicitWorkoutActivityKcal } from "@/model/activity/workout-energy";
import { sourceDay } from "./model-episode-fixtures";
import { localDayBoundV1 } from "@/model/activity/distance-ledger-v1";

const date = "2026-09-23";
const version = "bodycast-physiology-v7+selection-v1";

describe("staged physiology v1", () => {
  it("keeps the production model version free of the selection suffix", () => {
    expect(CURRENT_MODEL_VERSION).toBe("bodycast-physiology-v7");
    expect(usesSelectionV1(CURRENT_MODEL_VERSION)).toBe(false);
    expect(usesWorkoutAwareActivity(version)).toBe(true);
    expect(usesSelectionV1(version)).toBe(true);
  });

  it("prefers same-day mass and otherwise uses the unified start-of-day mass", () => {
    expect(selectCanonicalBodyMassV1({ sameDayObservedKg: 81, unifiedStartOfDayKg: 80 }).source)
      .toBe("same-day-observed");
    expect(selectCanonicalBodyMassV1({ sameDayObservedKg: null, unifiedStartOfDayKg: 80 }))
      .toEqual({ massKg: 80, source: "unified-start-of-day" });
  });

  it("does not recalculate entered kcal and excludes declared steps from Apple", () => {
    const withKcal = adaptManualStepperEnergyV1({
      manualStepCount: 2000,
      manualActiveEnergyKcal: 150,
      bodyMassKg: 80,
    });
    expect(withKcal).toMatchObject({ manualKcalPresent: true, manualKcal: 150, mechanicalKcal: null, appleDenominatorSteps: null });
    const stepsOnly = adaptManualStepperEnergyV1({
      manualStepCount: 1000,
      manualActiveEnergyKcal: null,
      bodyMassKg: 80,
    });
    expect(stepsOnly.manualKcalPresent).toBe(false);
    expect(stepsOnly.mechanicalKcal).toBeGreaterThan(0);
    expect(stepsOnly.appleDenominatorSteps).toBeNull();
  });

  it("requires overlap both ways and does not hide rows before activation", () => {
    const manual = { id: 1, origin: "manual" as const, startMs: 0, endMs: 60 * 60_000, stepCount: 2000 };
    const garmin = { id: 2, origin: "garmin" as const, startMs: 0, endMs: 60 * 60_000, stepCount: 0 };
    const fragment = { ...garmin, id: 3, endMs: 10 * 60_000, stepCount: 100 };
    const pending = evaluateStepperReconciliationV1({
      manual: [manual],
      garmin: [garmin],
      synchronizedSteps: 8000,
    });
    expect(pending.status).toBe("pending");
    expect(pending.eventCounts).toMatchObject({ minimumDistinctEventCount: 1, maximumDistinctEventCount: 2 });
    expect(pending.visibilityMutation).toBeNull();
    expect(pending.displayedSteps).toBe(10000);
    expect(pending.potentialDuplication).toBe(true);
    expect(pending.candidates[0]?.stepEvidenceStatus).toBe("garmin-zero-does-not-replace-manual");
    const short = evaluateStepperReconciliationV1({
      manual: [manual],
      garmin: [fragment],
      synchronizedSteps: 8000,
    });
    expect(short.status).toBe("unrelated");
    expect(short.candidates[0]?.matched).toBe(false);
  });

  it("rejects a stale strength publication and keeps an older hidden workout hidden after rollback", async () => {
    const current = strengthInputFingerprintV1({ sessionId: 1, sessionRevision: 4, massKg: 80, setFingerprint: "a" });
    const newer = strengthInputFingerprintV1({ sessionId: 1, sessionRevision: 5, massKg: 81, setFingerprint: "b" });
    expect(strengthPublicationDecisionV1({
      sessionStatus: "COMPLETED",
      estimateKcal: 250,
      estimateFresh: true,
      massKg: 80,
      inputFingerprint: current,
      previousFingerprint: newer,
      previousSessionRevision: 5,
      sessionRevision: 4,
    }).reason).toBe("stale-inputs");
    const store = memoryVisibilityStoreV1([{
      recordId: 7,
      hiddenFromHistory: true,
      syncProtected: false,
      supersededByWorkoutId: null,
      revision: "r1",
    }]);
    await activateVisibilityGenerationV1({
      store,
      generationId: "gen",
      changes: [{ recordId: 7, supersedingWorkoutId: 9 }],
    });
    await rollbackVisibilityGenerationV1({ store, generationId: "gen" });
    expect(store.snapshot()[0]).toMatchObject({
      hiddenFromHistory: true,
      syncProtected: false,
      supersededByWorkoutId: null,
    });
  });

  it("marks strength estimates stale when late same-day mass changes without a revision bump", () => {
    const sets = strengthSetFingerprintV1([{ reps: 8, weightKg: 60 }]);
    const published = strengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 3,
      massKg: 80,
      sameDayMassKg: 80,
      startOfDayMassKg: 79.5,
      setFingerprint: sets,
      estimatorVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    });
    const afterLateWeight = strengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 3,
      massKg: 81.2,
      sameDayMassKg: 81.2,
      startOfDayMassKg: 79.5,
      setFingerprint: sets,
      estimatorVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    });
    expect(published).not.toBe(afterLateWeight);
    expect(strengthEstimateFreshV1({
      estimateKcal: 250,
      sessionRevision: 3,
      shadowSessionRevision: 3,
      storedInputFingerprint: published,
      currentInputFingerprint: afterLateWeight,
    })).toBe(false);
    expect(strengthEstimateFreshV1({
      estimateKcal: 250,
      sessionRevision: 3,
      shadowSessionRevision: 3,
      storedInputFingerprint: published,
      currentInputFingerprint: published,
    })).toBe(true);
  });

  it("replays deterministically, stops on a stale source, and resumes after an interruption", () => {
    const days = [
      { date: "2026-09-23", sourceRevision: "rev", project: () => ({ kcal: 200 }) },
      { date: "2026-09-24", sourceRevision: "rev", project: () => ({ kcal: 50 }) },
    ];
    const first = runSyntheticReplayV1({ days, expectedSourceRevision: "rev" });
    const second = runSyntheticReplayV1({ days, expectedSourceRevision: "rev" });
    expect(first.status).toBe("complete");
    expect(second.completed.map((day) => day.fingerprint)).toEqual(first.completed.map((day) => day.fingerprint));
    expect(runSyntheticReplayV1({
      days: [{ date: "2026-09-25", sourceRevision: "old", project: () => ({}) }],
      expectedSourceRevision: "rev",
    }).status).toBe("stale-source");
    const interrupted = runSyntheticReplayV1({
      days: [
        days[0]!,
        { date: "2026-09-24", sourceRevision: "rev", project: () => { throw new Error("stop"); } },
      ],
      expectedSourceRevision: "rev",
    });
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.completed.map((day) => day.date)).toEqual(["2026-09-23"]);
    expect(interrupted.resumeAt).toBe("2026-09-24");
  });

  it("feeds a complete accepted distance into outside walking and excludes stepper distance", () => {
    const bound = localDayBoundV1(date, "Europe/Bratislava");
    const start = new Date(bound.startMs + 8 * 3_600_000);
    const middle = new Date(bound.startMs + 9 * 3_600_000);
    const end = new Date(bound.startMs + 10 * 3_600_000);
    const [built] = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: version,
      sources: {
        days: [sourceDay(date, { walkingDistanceKm: 4, strengthTrainingMinutes: 0 })],
        snapshots: [],
        workIntervals: [{
          id: 1,
          date,
          startAt: start,
          endAt: middle,
          timezone: "Europe/Bratislava",
          category: "standingLight",
          breakMinutes: 0,
        }],
        workouts: [{
          id: 3,
          date,
          externalId: null,
          type: "Stair Climbing",
          startAt: start,
          endAt: middle,
          durationMinutes: 60,
          energyKcal: null,
          activeEnergyKcal: 100,
        }],
        activityIntervals: [
          { id: 10, date, metric: "walking-distance-km", startAt: start, endAt: end, value: 4 },
          { id: 11, date, metric: "steps", startAt: start, endAt: end, value: 2000 },
        ],
      },
    });
    expect(built!.input.outsideWorkWalkingDistanceKm).toBeCloseTo(2, 6);
    expect(built!.input.occupationalActivity.intervals?.[0]?.workWalkingDistanceKm).toBe(0);
    expect(built!.input.occupationalActivity.intervals?.[0]?.durationHours).toBe(0);
    expect(built!.sourceQuality.selectionV1?.historicalDonorEligible).toBe(true);
    expect(built!.input.workoutActivity?.selectionPolicy).toBe("bodycast-active-energy-selection-v1");
  });

  it("keeps a conflicted distance unknown instead of zero", () => {
    const bound = localDayBoundV1(date, "Europe/Bratislava");
    const start = new Date(bound.startMs + 8 * 3_600_000);
    const end = new Date(bound.startMs + 10 * 3_600_000);
    const nestedEnd = new Date(bound.startMs + 9 * 3_600_000);
    const [built] = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: version,
      sources: {
        days: [sourceDay(date, { walkingDistanceKm: null })],
        snapshots: [],
        workIntervals: [],
        activityIntervals: [
          { id: 1, date, metric: "walking-distance-km", startAt: start, endAt: end, value: 10 },
          { id: 2, date, metric: "walking-distance-km", startAt: start, endAt: nestedEnd, value: 2 },
        ],
      },
    });
    expect(built!.input.outsideWorkWalkingDistanceKm).toBeNull();
    expect(built!.sourceQuality.selectionV1?.distanceConflicted).toBe(true);
    expect(built!.sourceQuality.selectionV1?.historicalDonorEligible).toBe(false);
  });

  it("labels future strength MET as a forecast scenario and does not add historical MET", () => {
    const schedule = buildForecastWorkoutSchedule({
      strengthWeekdays: [1],
      strengthDurationMinutes: 60,
      strengthScenario: "forecast-scenario-strength-met",
      strengthScenarioWeightKg: 80,
      strengthScenarioRmrKcalPerDay: 1600,
    });
    const event = schedule[1]!.events[0]!;
    expect(event.energyProvenance).toBe("forecast-scenario-strength-met");
    expect(event.activeEnergyKcal).toBeGreaterThan(0);
    const production = toProductionWorkoutActivity({ events: [event] });
    expect(production?.selectionPolicy).toBeUndefined();
    const resolved = resolveExplicitWorkoutActivityKcal({
      weightKg: 80,
      rmrKcalPerDay: 1600,
      events: production?.events ?? [],
    });
    expect(resolved.strengthMetFallbackKcal).toBe(0);
    expect(resolved.workoutActivityKcal).toBe(event.activeEnergyKcal);
    expect(resolved.perEvent[0]?.source).toBe("forecast-scenario-strength-met");
  });
});
