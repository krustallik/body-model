import { describe, expect, it } from "vitest";
import { hasExplicitStrengthWorkouts } from "@/model/activity/workout-energy";
import {
  runForecast,
  sampleForecastBehaviorPath,
} from "@/modules/model-forecast/forecast-engine";
import { forecastScenarioFingerprint } from "@/modules/model-forecast/forecast-fingerprint";
import {
  DEFAULT_FORECAST_CONFIG,
  type ForecastBehaviorDay,
  type RunForecastInput,
} from "@/modules/model-forecast/forecast.types";
import {
  buildForecastWorkoutSchedule,
  createForecastWorkoutEvent,
} from "@/modules/model-forecast/forecast-workout-scenario";
import { ForecastModelRequestSchema } from "@/modules/model-forecast/model-forecast.schema";
import { projectReliableForecastBehaviorDay } from "@/modules/model-forecast/model-forecast.service";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { SeededRandom } from "@/modules/model-recovery/recovery-math";
import { persistedEpisodeFixture, sourceDay } from "./model-episode-fixtures";

const episode = persistedEpisodeFixture("2026-08-22");

const baseNutrition = { caloriesKcal: 2_200, proteinG: 170, fatG: 70, carbsG: 230 };

const centralDay: ForecastBehaviorDay = {
  nutrition: baseNutrition,
  outsideWorkWalkingDistanceKm: 5,
  averageWalkingSpeedKmh: 5,
  strengthTrainingMinutes: 0,
  occupation: [],
};

function forecastInput(overrides: Partial<RunForecastInput> = {}): RunForecastInput {
  return {
    seed: 1601,
    startDate: "2026-08-23",
    horizonDays: 14,
    modelVersion: episode.modelVersion,
    recoveryVersion: null,
    sourceFingerprint: "source",
    scenarioFingerprint: "scenario",
    initialStateQuality: "deterministic",
    initialParticles: [{ state: episode.initialState, weight: 1 }],
    parameters: episode.simulatorParameters,
    personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
    ecfPolicy: "hold-ecf",
    scenario: { mode: "fixed", schedule: { defaultDay: centralDay } },
    reliableDonorDays: Array.from({ length: 21 }, () => centralDay),
    variabilityEvidence: {
      donorDayCount: 21,
      source: "explicit-scenario",
      nutritionLogStandardDeviation: 0.2,
      macroCompositionLogStandardDeviation: 0.1,
      walkingLogStandardDeviation: 0.3,
    },
    config: { pathCount: 8 },
    ...overrides,
  };
}

describe("Stage 10 forecast workout scenarios", () => {
  it("preserves recent workout events and feed coverage on reliable donors", () => {
    const days = buildSimulationDays({
      from: "2026-08-20",
      to: "2026-08-21",
      modelVersion: "bodycast-physiology-v6",
      sources: {
        days: [
          sourceDay("2026-08-20", {
            strengthTrainingMinutes: null,
            workoutFeedObserved: true,
          }),
          sourceDay("2026-08-21", {
            strengthTrainingMinutes: null,
            workoutFeedObserved: false,
          }),
        ],
        snapshots: [],
        workIntervals: [],
        workouts: [{
          id: 1,
          date: "2026-08-20",
          externalId: "strength-1",
          type: "Traditional Strength Training",
          startAt: new Date("2026-08-20T17:00:00.000Z"),
          endAt: new Date("2026-08-20T18:00:00.000Z"),
          durationMinutes: 60,
          energyKcal: 500,
          activeEnergyKcal: 320,
        }],
      },
    });
    const trained = projectReliableForecastBehaviorDay(days[0]!);
    const missingFeed = projectReliableForecastBehaviorDay(days[1]!);
    expect(trained).not.toBeNull();
    expect(trained!.workoutActivity?.events).toHaveLength(1);
    expect(trained!.workoutActivity?.events[0]).toMatchObject({
      classification: "traditional-strength-training",
      activeEnergyKcal: 320,
      energyProvenance: "device-estimate",
    });
    expect(trained!.strengthTrainingMinutes).toBe(0);
    expect(trained!.workoutFeedObserved).toBe(true);
    // Missing feed with null strength is incomplete, not a rest donor.
    expect(missingFeed).toBeNull();
    expect(days[1]!.sourceQuality.status).toBe("missing-activity");
    expect(days[1]!.sourceQuality.issues).toContain("strengthTrainingMinutes");
  });

  it("distinguishes three vs four strength sessions without changing nutrition", () => {
    const three = buildForecastWorkoutSchedule({
      strengthWeekdays: [1, 3, 5],
      strengthDurationMinutes: 45,
      plannedSets: 12,
      programVersionId: 9,
    });
    const four = buildForecastWorkoutSchedule({
      strengthWeekdays: [1, 2, 4, 5],
      strengthDurationMinutes: 45,
      plannedSets: 12,
      programVersionId: 9,
    });
    const threePath = sampleForecastBehaviorPath({
      scenario: {
        mode: "fixed",
        schedule: { defaultDay: centralDay, workoutsByWeekday: three },
      },
      startDate: "2026-08-23",
      horizonDays: 7,
      reliableDonorDays: [],
      evidence: forecastInput().variabilityEvidence,
      random: new SeededRandom(1),
    });
    const fourPath = sampleForecastBehaviorPath({
      scenario: {
        mode: "fixed",
        schedule: { defaultDay: centralDay, workoutsByWeekday: four },
      },
      startDate: "2026-08-23",
      horizonDays: 7,
      reliableDonorDays: [],
      evidence: forecastInput().variabilityEvidence,
      random: new SeededRandom(1),
    });
    const strengthDays = (path: ForecastBehaviorDay[]) => path.filter((day) => (
      day.workoutActivity !== undefined && hasExplicitStrengthWorkouts(day.workoutActivity.events)
    ));
    expect(strengthDays(threePath)).toHaveLength(3);
    expect(strengthDays(fourPath)).toHaveLength(4);
    expect(threePath.map((day) => day.nutrition)).toEqual(fourPath.map((day) => day.nutrition));
    expect(threePath.map((day) => day.outsideWorkWalkingDistanceKm))
      .toEqual(fourPath.map((day) => day.outsideWorkWalkingDistanceKm));
  });

  it("carries program snapshot and planned-sets provenance without inventing kcal fields", () => {
    const schedule = buildForecastWorkoutSchedule({
      strengthWeekdays: [1],
      strengthDurationMinutes: 50,
      programId: 3,
      programVersionId: 11,
      programVersionNumber: 2,
      plannedSets: 18,
      strengthActiveEnergyKcal: null,
    });
    const day = sampleForecastBehaviorPath({
      scenario: { mode: "fixed", schedule: { defaultDay: centralDay, workoutsByWeekday: schedule } },
      startDate: "2026-08-24",
      horizonDays: 1,
      reliableDonorDays: [],
      evidence: forecastInput().variabilityEvidence,
      random: new SeededRandom(2),
    })[0]!;
    expect(day.workoutActivity?.events[0]).toMatchObject({
      programId: 3,
      programVersionId: 11,
      programVersionNumber: 2,
      plannedSets: 18,
      activeEnergyKcal: null,
      energyProvenance: "strength-met-fallback",
    });
    expect(day.strengthTrainingMinutes).toBe(0);
  });

  it("schedules stepper frequency separately from strength", () => {
    const schedule = buildForecastWorkoutSchedule({
      strengthWeekdays: [1, 3],
      strengthDurationMinutes: 45,
      stepperWeekdays: [2, 4, 6],
      stepperDurationMinutes: 20,
      stepperActiveEnergyKcal: 150,
    });
    const path = sampleForecastBehaviorPath({
      scenario: { mode: "fixed", schedule: { defaultDay: centralDay, workoutsByWeekday: schedule } },
      startDate: "2026-08-23",
      horizonDays: 7,
      reliableDonorDays: [],
      evidence: forecastInput().variabilityEvidence,
      random: new SeededRandom(3),
    });
    const strength = path.filter((day) => day.workoutActivity?.events.some(
      (event) => event.classification === "traditional-strength-training",
    ));
    const stepper = path.filter((day) => day.workoutActivity?.events.some(
      (event) => event.classification === "stair-climbing",
    ));
    expect(strength).toHaveLength(2);
    expect(stepper).toHaveLength(3);
    expect(stepper.every((day) => day.workoutActivity!.events.some(
      (event) => event.activeEnergyKcal === 150,
    ))).toBe(true);
  });

  it("keeps nutrition and walking identical when only the workout scenario changes", () => {
    const quiet = runForecast(forecastInput({
      scenario: { mode: "fixed", schedule: { defaultDay: centralDay } },
      scenarioFingerprint: "quiet",
    }));
    const loaded = runForecast(forecastInput({
      scenario: {
        mode: "fixed",
        schedule: {
          defaultDay: centralDay,
          workoutsByWeekday: buildForecastWorkoutSchedule({
            strengthWeekdays: [1, 3, 5],
            strengthDurationMinutes: 60,
            strengthActiveEnergyKcal: 400,
          }),
        },
      },
      scenarioFingerprint: "loaded",
    }));
    expect(quiet.dates.map((day) => day.energyIntakeKcal.median))
      .toEqual(loaded.dates.map((day) => day.energyIntakeKcal.median));
    expect(loaded.dates.some((day, index) => (
      day.netActivityKcalPerDay.median !== quiet.dates[index]!.netActivityKcalPerDay.median
    ))).toBe(true);
  });

  it("is deterministic for identical workout scenarios and fingerprints change with workouts", () => {
    const schedule = {
      defaultDay: centralDay,
      workoutsByWeekday: buildForecastWorkoutSchedule({
        strengthWeekdays: [1, 3, 5],
        strengthDurationMinutes: 45,
        programVersionId: 4,
        plannedSets: 15,
      }),
    };
    const first = runForecast(forecastInput({
      scenario: { mode: "fixed", schedule },
      scenarioFingerprint: "a",
    }));
    const second = runForecast(forecastInput({
      scenario: { mode: "fixed", schedule },
      scenarioFingerprint: "a",
    }));
    expect(second).toEqual(first);
    const withSets = forecastScenarioFingerprint({
      scenario: { mode: "fixed", schedule },
      seed: 1601,
      horizonDays: 14,
      config: DEFAULT_FORECAST_CONFIG,
    });
    const alteredSets = forecastScenarioFingerprint({
      scenario: {
        mode: "fixed",
        schedule: {
          defaultDay: centralDay,
          workoutsByWeekday: buildForecastWorkoutSchedule({
            strengthWeekdays: [1, 3, 5],
            strengthDurationMinutes: 45,
            programVersionId: 4,
            plannedSets: 20,
          }),
        },
      },
      seed: 1601,
      horizonDays: 14,
      config: DEFAULT_FORECAST_CONFIG,
    });
    expect(alteredSets).not.toBe(withSets);
  });

  it("accepts canonical workout events in the request schema", () => {
    const event = createForecastWorkoutEvent({
      type: "Traditional Strength Training",
      durationMinutes: 45,
      activeEnergyKcal: 300,
      programVersionId: 2,
      plannedSets: 10,
    });
    expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 30,
      scenario: {
        mode: "fixed",
        schedule: {
          defaultDay: {
            ...centralDay,
            workoutActivity: { events: [event] },
          },
          workoutsByWeekday: {
            "1": { events: [event] },
          },
        },
      },
    }).success).toBe(true);
  });
});
