import { describe, expect, it } from "vitest";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { CURRENT_MODEL_VERSION } from "@/modules/model-episodes/model-version";
import { calculateEpisodeHistory } from "@/modules/model-episodes/episode-calculation";
import type {
  BuiltSimulationDay,
  HistoricalModelSources,
} from "@/modules/model-episodes/model-episode.types";
import type { PhysiologicalDailyInput } from "@/model/physiological-simulator";
import { sourceDay, stableSourceDays, persistedEpisodeFixture } from "./model-episode-fixtures";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";
import type { PrismaClient } from "@prisma/client";

const stairDate = "2026-08-22";
const instant = (time: string) => new Date(`2026-08-22T${time}:00+02:00`);

/** Model-driving canonical input only (excludes transient diagnostics). */
function canonicalInputFingerprint(input: PhysiologicalDailyInput): unknown {
  return {
    date: input.date,
    caloriesKcal: input.caloriesKcal,
    proteinG: input.proteinG,
    fatG: input.fatG,
    carbsG: input.carbsG,
    outsideWorkWalkingDistanceKm: input.outsideWorkWalkingDistanceKm,
    averageWalkingSpeedKmh: input.averageWalkingSpeedKmh,
    strengthTrainingMinutes: input.strengthTrainingMinutes,
    sodiumChangeMgPerDay: input.sodiumChangeMgPerDay,
    measuredWeightKg: input.measuredWeightKg,
    occupationalActivity: {
      category: input.occupationalActivity.category,
      durationHours: input.occupationalActivity.durationHours,
      intervals: input.occupationalActivity.intervals?.map((interval) => ({
        category: interval.category,
        durationHours: interval.durationHours,
        breakDurationHours: interval.breakDurationHours,
        workWalkingDistanceKm: interval.workWalkingDistanceKm,
        averageWalkingSpeedKmh: interval.averageWalkingSpeedKmh,
      })) ?? null,
    },
    workoutActivity: input.workoutActivity
      ? {
          events: input.workoutActivity.events.map((event) => ({
            type: event.type,
            canonicalType: event.canonicalType,
            classification: event.classification,
            startAt: event.startAt,
            endAt: event.endAt,
            durationMinutes: event.durationMinutes,
            activeEnergyKcal: event.activeEnergyKcal,
          })),
        }
      : null,
  };
}

/** Every PhysiologicalDailyInput key must appear in the fingerprint (field-by-field DoD). */
const PHYSIOLOGICAL_INPUT_KEYS = [
  "date",
  "caloriesKcal",
  "proteinG",
  "fatG",
  "carbsG",
  "outsideWorkWalkingDistanceKm",
  "averageWalkingSpeedKmh",
  "strengthTrainingMinutes",
  "workoutActivity",
  "occupationalActivity",
  "sodiumChangeMgPerDay",
  "measuredWeightKg",
] as const satisfies readonly (keyof PhysiologicalDailyInput)[];


function fingerprintDays(days: readonly BuiltSimulationDay[]): unknown[] {
  return days.map((day) => canonicalInputFingerprint(day.input));
}

function stairAwareSources(includeSnapshots: boolean): HistoricalModelSources {
  return {
    days: [sourceDay(stairDate, {
      walkingDistanceKm: 5.0,
      averageWalkingSpeedKmh: 5.0,
      strengthTrainingMinutes: 75,
      workoutFeedObserved: true,
    })],
    snapshots: includeSnapshots
      ? [
          {
            id: 1,
            date: stairDate,
            receivedAt: instant("07:55"),
            syncedAt: instant("07:55"),
            steps: 4_000,
            walkingDistanceKm: 3.0,
          },
          {
            id: 2,
            date: stairDate,
            receivedAt: instant("08:05"),
            syncedAt: instant("08:05"),
            steps: 5_000,
            walkingDistanceKm: 3.6,
          },
          {
            id: 3,
            date: stairDate,
            receivedAt: instant("16:00"),
            syncedAt: instant("16:00"),
            steps: 8_000,
            walkingDistanceKm: 5.0,
          },
        ]
      : [],
    workIntervals: [{
      id: 1,
      date: stairDate,
      startAt: instant("09:00"),
      endAt: instant("17:00"),
      timezone: "Europe/Bratislava",
      category: "standingLight",
      breakMinutes: 30,
    }],
    workouts: [
      {
        id: 1,
        date: stairDate,
        externalId: "stair-1",
        type: STAIR_CLIMBING_TYPE,
        startAt: instant("08:00"),
        endAt: new Date("2026-08-22T08:10:00+02:00"),
        durationMinutes: 10,
        energyKcal: null,
        activeEnergyKcal: 154,
      },
      {
        id: 2,
        date: stairDate,
        externalId: "strength-1",
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        startAt: instant("18:00"),
        endAt: new Date("2026-08-22T19:00:00+02:00"),
        durationMinutes: 60,
        energyKcal: null,
        activeEnergyKcal: 562,
      },
    ],
  };
}

describe("durable source — snapshot necessity for identical rebuild", () => {
  it("proves removing cumulative snapshots changes canonical simulation input", () => {
    const withSnapshots = buildSimulationDays({
      from: stairDate,
      to: stairDate,
      sources: stairAwareSources(true),
      modelVersion: CURRENT_MODEL_VERSION,
    });
    const withoutSnapshots = buildSimulationDays({
      from: stairDate,
      to: stairDate,
      sources: stairAwareSources(false),
      modelVersion: CURRENT_MODEL_VERSION,
    });

    const inputA = withSnapshots[0]!.input;
    const inputB = withoutSnapshots[0]!.input;

    expect(inputA.outsideWorkWalkingDistanceKm)
      .not.toEqual(inputB.outsideWorkWalkingDistanceKm);
    expect(inputA.occupationalActivity.intervals?.[0]?.workWalkingDistanceKm)
      .not.toEqual(inputB.occupationalActivity.intervals?.[0]?.workWalkingDistanceKm);
    // Strength / workout events themselves do not depend on snapshots.
    expect(inputA.strengthTrainingMinutes).toBe(inputB.strengthTrainingMinutes);
    expect(inputA.workoutActivity?.events).toEqual(inputB.workoutActivity?.events);
    expect(fingerprintDays(withSnapshots)).not.toEqual(fingerprintDays(withoutSnapshots));
  });

  it("keeps identical canonical input when snapshots remain after retention no-op", async () => {
    const sources = stairAwareSources(true);
    const before = buildSimulationDays({
      from: stairDate,
      to: stairDate,
      sources,
      modelVersion: CURRENT_MODEL_VERSION,
    });

    const repository = new PrismaHealthSyncRepository({} as PrismaClient);
    const pruned = await repository.pruneOlderThan("2026-07-01");
    expect(pruned).toEqual({
      cutoffDate: "2026-07-01",
      deletedDays: 0,
      deletedSnapshots: 0,
    });

    const after = buildSimulationDays({
      from: stairDate,
      to: stairDate,
      sources,
      modelVersion: CURRENT_MODEL_VERSION,
    });
    expect(fingerprintDays(after)).toEqual(fingerprintDays(before));
  });
});

describe("durable source — 120-day input + output equivalence", () => {
  it("rebuilds identical canonical inputs and physiology outputs when durable sources kept", () => {
    const endDate = "2026-09-16";
    const days = stableSourceDays({
      count: 120,
      endDate,
      override: (index, date) => ({
        workoutFeedObserved: true,
        strengthTrainingMinutes: index % 7 === 0 ? 45 : 0,
        walkingDistanceKm: 4 + (index % 3) * 0.5,
      }),
    });
    const startDate = days[0]!.date;
    const snapshots = days.flatMap((day, index) => {
      if (index % 11 !== 0) return [];
      const morning = new Date(`${day.date}T06:00:00.000Z`);
      const evening = new Date(`${day.date}T18:00:00.000Z`);
      return [
        {
          id: index * 2 + 1,
          date: day.date,
          receivedAt: morning,
          syncedAt: morning,
          steps: 2_000,
          walkingDistanceKm: 1.5,
        },
        {
          id: index * 2 + 2,
          date: day.date,
          receivedAt: evening,
          syncedAt: evening,
          steps: 8_000,
          walkingDistanceKm: day.walkingDistanceKm,
        },
      ];
    });
    const workIntervals = days
      .filter((_, index) => index % 5 === 0)
      .map((day, index) => ({
        id: index + 1,
        date: day.date,
        startAt: new Date(`${day.date}T08:00:00.000Z`),
        endAt: new Date(`${day.date}T16:00:00.000Z`),
        timezone: "UTC",
        category: "standingLight" as const,
        breakMinutes: 30,
      }));
    const workouts = days
      .filter((_, index) => index % 7 === 0)
      .map((day, index) => ({
        id: index + 1,
        date: day.date,
        externalId: `w-${day.date}`,
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        startAt: new Date(`${day.date}T17:00:00.000Z`),
        endAt: new Date(`${day.date}T18:00:00.000Z`),
        durationMinutes: 60,
        energyKcal: null,
        activeEnergyKcal: 400,
      }));

    const sources: HistoricalModelSources = { days, snapshots, workIntervals, workouts };
    const builtBefore = buildSimulationDays({
      from: startDate,
      to: endDate,
      sources,
      modelVersion: CURRENT_MODEL_VERSION,
    });
    expect(builtBefore).toHaveLength(120);
    const sample = builtBefore[0]!.input;
    expect(Object.keys(sample).sort()).toEqual([...PHYSIOLOGICAL_INPUT_KEYS].sort());
    expect(Object.keys(canonicalInputFingerprint(sample) as object).sort())
      .toEqual([...PHYSIOLOGICAL_INPUT_KEYS].sort());

    // Retention no longer deletes durable sources — same sources after "cleanup".
    const builtAfter = buildSimulationDays({
      from: startDate,
      to: endDate,
      sources,
      modelVersion: CURRENT_MODEL_VERSION,
    });
    expect(fingerprintDays(builtAfter)).toEqual(fingerprintDays(builtBefore));

    const episode = persistedEpisodeFixture(addCalendarDays(startDate, 30));
    episode.modelVersion = CURRENT_MODEL_VERSION;
    const calcBefore = calculateEpisodeHistory({ episode, days: builtBefore });
    const calcAfter = calculateEpisodeHistory({ episode, days: builtAfter });

    expect(calcAfter.dailyStates.map((state) => ({
      date: state.date,
      tdee: state.energyExpenditureKcal,
      fat: state.fatMassKg,
      lean: state.leanTissueKg,
      glycogen: state.glycogenKg,
      weight: state.endWeightKg,
    }))).toEqual(calcBefore.dailyStates.map((state) => ({
      date: state.date,
      tdee: state.energyExpenditureKcal,
      fat: state.fatMassKg,
      lean: state.leanTissueKg,
      glycogen: state.glycogenKg,
      weight: state.endWeightKg,
    })));
  });
});
