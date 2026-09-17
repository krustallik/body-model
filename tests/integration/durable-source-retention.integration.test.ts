import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { CURRENT_MODEL_VERSION } from "@/modules/model-episodes/model-version";
import { calculateEpisodeHistory } from "@/modules/model-episodes/episode-calculation";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { persistedEpisodeFixture } from "../model-episode-fixtures";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";
import type { BuiltSimulationDay } from "@/modules/model-episodes/model-episode.types";
import type { PhysiologicalDailyInput } from "@/model/physiological-simulator";

const prisma = new PrismaClient();
const prefix = "2045-";
const stairDate = "2045-03-15";
const oldDate = "2045-01-01"; // >45 days before a late-March sync reference
const timezone = "Europe/Bratislava";

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
    occupationalActivity: input.occupationalActivity,
    workoutActivity: input.workoutActivity ?? null,
  };
}

function fingerprintDays(days: readonly BuiltSimulationDay[]): unknown[] {
  return days.map((day) => canonicalInputFingerprint(day.input));
}

async function cleanFixtureDates(dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const sorted = [...dates].sort();
  await prisma.healthSyncSnapshot.deleteMany({ where: { date: { in: dates } } });
  await prisma.workInterval.deleteMany({ where: { date: { in: dates } } });
  await prisma.heartRateSample.deleteMany({ where: { date: { in: dates } } });
  await prisma.restingHeartRateSample.deleteMany({ where: { date: { in: dates } } });
  await prisma.sleepSegment.deleteMany({
    where: {
      startAt: {
        gte: new Date(`${sorted[0]}T00:00:00.000Z`),
        lt: new Date(`${addCalendarDays(sorted[sorted.length - 1]!, 1)}T00:00:00.000Z`),
      },
    },
  });
  await deleteDailyHealthRows(prisma, dates);
}

describe("durable source retention PostgreSQL", () => {
  const repository = new PrismaHealthSyncRepository(prisma);
  const episodeRepository = new ModelEpisodeRepository(prisma);

  beforeAll(async () => {
    const existing = await prisma.dailyHealthData.findMany({
      where: { date: { startsWith: prefix } },
      select: { date: true },
    });
    await cleanFixtureDates(existing.map((row) => row.date));
  });

  afterAll(async () => {
    const existing = await prisma.dailyHealthData.findMany({
      where: { date: { startsWith: prefix } },
      select: { date: true },
    });
    await cleanFixtureDates(existing.map((row) => row.date));
    await prisma.sleepSegment.deleteMany({
      where: { startAt: { gte: new Date("2045-01-01T00:00:00.000Z"), lt: new Date("2046-01-01T00:00:00.000Z") } },
    });
    await prisma.$disconnect();
  });

  it("Test A — 45d+ durable sources survive retention prune", async () => {
    await cleanFixtureDates([oldDate]);

    const day = await prisma.dailyHealthData.create({
      data: {
        date: oldDate,
        caloriesKcal: 2_400,
        proteinG: 140,
        fatG: 70,
        carbsG: 240,
        steps: 8_000,
        walkingDistanceKm: 5.2,
        averageWalkingSpeedKmh: 5.0,
        weightKg: 81,
        bodyFatPercent: 19.5,
        workoutFeedObserved: true,
        strengthTrainingMinutes: 0,
        rawPayload: { source: "durable-test-a" },
        workouts: {
          create: [{
            externalId: "old-workout",
            type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
            startAt: new Date(`${oldDate}T17:00:00.000Z`),
            endAt: new Date(`${oldDate}T18:00:00.000Z`),
            durationMinutes: 60,
            activeEnergyKcal: 420,
            sourceIdentity: workoutSourceIdentity({
              externalId: "old-workout",
              type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
              startAt: new Date(`${oldDate}T17:00:00.000Z`),
              endAt: new Date(`${oldDate}T18:00:00.000Z`),
            }),
          }],
        },
      },
      include: { workouts: true },
    });

    await prisma.healthSyncSnapshot.create({
      data: {
        dailyHealthDataId: day.id,
        date: oldDate,
        timezone,
        receivedAt: new Date(`${oldDate}T12:00:00.000Z`),
        syncedAt: new Date(`${oldDate}T12:00:00.000Z`),
        steps: 8_000,
        walkingDistanceKm: 5.2,
        rawPayload: {},
      },
    });
    await prisma.workInterval.create({
      data: {
        date: oldDate,
        startAt: new Date(`${oldDate}T08:00:00.000Z`),
        endAt: new Date(`${oldDate}T16:00:00.000Z`),
        timezone,
        category: "standingLight",
        breakMinutes: 30,
      },
    });
    await prisma.heartRateSample.create({
      data: {
        profileId: 1,
        dailyHealthDataId: day.id,
        date: oldDate,
        timestamp: new Date(`${oldDate}T10:00:00.000Z`),
        bpm: 72,
        source: "shortcut",
      },
    });
    await prisma.restingHeartRateSample.create({
      data: {
        profileId: 1,
        dailyHealthDataId: day.id,
        date: oldDate,
        timestamp: new Date(`${oldDate}T06:00:00.000Z`),
        bpm: 54,
        source: "shortcut",
      },
    });
    await prisma.sleepSegment.create({
      data: {
        profileId: 1,
        startAt: new Date(`${oldDate}T22:00:00.000Z`),
        endAt: new Date(`${addCalendarDays(oldDate, 1)}T06:00:00.000Z`),
        state: "asleep",
        rawState: "ASLEEP",
        source: "shortcut",
      },
    });

    const pruned = await repository.pruneOlderThan("2045-02-15");
    expect(pruned.deletedDays).toBe(0);
    expect(pruned.deletedSnapshots).toBe(0);

    expect(await prisma.dailyHealthData.count({ where: { date: oldDate } })).toBe(1);
    expect(await prisma.workout.count({ where: { dailyHealthDataId: day.id } })).toBe(1);
    expect(await prisma.healthSyncSnapshot.count({ where: { date: oldDate } })).toBe(1);
    expect(await prisma.heartRateSample.count({ where: { date: oldDate } })).toBe(1);
    expect(await prisma.restingHeartRateSample.count({ where: { date: oldDate } })).toBe(1);
    expect(await prisma.workInterval.count({ where: { date: oldDate } })).toBe(1);
    expect(await prisma.sleepSegment.count({
      where: { startAt: new Date(`${oldDate}T22:00:00.000Z`) },
    })).toBe(1);
  });

  it("Test B — snapshot-dependent stair day inputs identical after retention", async () => {
    await cleanFixtureDates([stairDate]);

    const day = await prisma.dailyHealthData.create({
      data: {
        date: stairDate,
        walkingDistanceKm: 5.0,
        averageWalkingSpeedKmh: 5.0,
        strengthTrainingMinutes: 75,
        caloriesKcal: 2_500,
        proteinG: 150,
        fatG: 75,
        carbsG: 250,
        workoutFeedObserved: true,
        rawPayload: { source: "durable-test-b" },
        workouts: {
          create: [
            {
              type: STAIR_CLIMBING_TYPE,
              startAt: new Date(`${stairDate}T08:00:00+02:00`),
              endAt: new Date(`${stairDate}T08:20:00+02:00`),
              durationMinutes: 20,
              activeEnergyKcal: 154,
              sourceIdentity: workoutSourceIdentity({
                type: STAIR_CLIMBING_TYPE,
                startAt: new Date(`${stairDate}T08:00:00+02:00`),
                endAt: new Date(`${stairDate}T08:20:00+02:00`),
              }),
            },
            {
              type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
              startAt: new Date(`${stairDate}T16:00:00+02:00`),
              endAt: new Date(`${stairDate}T17:00:00+02:00`),
              durationMinutes: 60,
              activeEnergyKcal: 562,
              sourceIdentity: workoutSourceIdentity({
                type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
                startAt: new Date(`${stairDate}T16:00:00+02:00`),
                endAt: new Date(`${stairDate}T17:00:00+02:00`),
              }),
            },
          ],
        },
      },
    });

    await prisma.workInterval.create({
      data: {
        date: stairDate,
        startAt: new Date(`${stairDate}T09:00:00+02:00`),
        endAt: new Date(`${stairDate}T17:00:00+02:00`),
        timezone,
        category: "standingLight",
        breakMinutes: 0,
      },
    });

    await prisma.healthSyncSnapshot.createMany({
      data: [
        {
          dailyHealthDataId: day.id,
          date: stairDate,
          timezone,
          receivedAt: new Date(`${stairDate}T05:55:00.000Z`),
          syncedAt: new Date(`${stairDate}T05:55:00.000Z`),
          steps: 1_000,
          walkingDistanceKm: 2.0,
          rawPayload: {},
        },
        {
          dailyHealthDataId: day.id,
          date: stairDate,
          timezone,
          receivedAt: new Date(`${stairDate}T06:25:00.000Z`),
          syncedAt: new Date(`${stairDate}T06:25:00.000Z`),
          steps: 1_600,
          walkingDistanceKm: 2.6,
          rawPayload: {},
        },
        {
          dailyHealthDataId: day.id,
          date: stairDate,
          timezone,
          receivedAt: new Date(`${stairDate}T16:00:00.000Z`),
          syncedAt: new Date(`${stairDate}T16:00:00.000Z`),
          steps: 8_000,
          walkingDistanceKm: 5.0,
          rawPayload: {},
        },
      ],
    });

    const sourcesBefore = await episodeRepository.loadSources(stairDate, stairDate);
    const inputsBefore = buildSimulationDays({
      from: stairDate,
      to: stairDate,
      sources: sourcesBefore,
      modelVersion: CURRENT_MODEL_VERSION,
    });

    await repository.pruneOlderThan("2045-02-01");

    const sourcesAfter = await episodeRepository.loadSources(stairDate, stairDate);
    const inputsAfter = buildSimulationDays({
      from: stairDate,
      to: stairDate,
      sources: sourcesAfter,
      modelVersion: CURRENT_MODEL_VERSION,
    });

    expect(sourcesAfter.snapshots).toHaveLength(sourcesBefore.snapshots.length);
    expect(fingerprintDays(inputsAfter)).toEqual(fingerprintDays(inputsBefore));
    expect(inputsAfter[0]?.input.outsideWorkWalkingDistanceKm).toBe(
      inputsBefore[0]?.input.outsideWorkWalkingDistanceKm,
    );
    expect(inputsAfter[0]?.input.strengthTrainingMinutes).toBe(0);
    expect(inputsAfter[0]?.sourceQuality.stairWalkingOverlap?.[0]?.overlapApplied)
      .toBe(inputsBefore[0]?.sourceQuality.stairWalkingOverlap?.[0]?.overlapApplied);
  });

  it("Test C — 120-day rebuild keeps inputs and physiology after retention", async () => {
    const endDate = "2045-06-30";
    const startDate = addCalendarDays(endDate, -119);
    const dates = Array.from({ length: 120 }, (_, index) => addCalendarDays(startDate, index));
    await cleanFixtureDates(dates);

    for (const [index, date] of dates.entries()) {
      const day = await prisma.dailyHealthData.create({
        data: {
          date,
          caloriesKcal: 2_450 + (index % 5) * 20,
          proteinG: 150,
          fatG: 70,
          carbsG: 240,
          weightKg: 80 + (index % 7) * 0.05,
          steps: 7_000 + index,
          walkingDistanceKm: 4.5,
          averageWalkingSpeedKmh: 5.0,
          workoutFeedObserved: true,
          strengthTrainingMinutes: 0,
          rawPayload: { source: "durable-test-c", index },
          ...(index % 10 === 0
            ? {
                workouts: {
                  create: [{
                    type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
                    startAt: new Date(`${date}T17:00:00.000Z`),
                    endAt: new Date(`${date}T18:00:00.000Z`),
                    durationMinutes: 60,
                    activeEnergyKcal: 400,
                    sourceIdentity: workoutSourceIdentity({
                      type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
                      startAt: new Date(`${date}T17:00:00.000Z`),
                      endAt: new Date(`${date}T18:00:00.000Z`),
                    }),
                  }],
                },
              }
            : {}),
        },
      });
      await prisma.healthSyncSnapshot.create({
        data: {
          dailyHealthDataId: day.id,
          date,
          timezone,
          receivedAt: new Date(`${date}T12:00:00.000Z`),
          syncedAt: new Date(`${date}T12:00:00.000Z`),
          steps: 7_000 + index,
          walkingDistanceKm: 4.5,
          rawPayload: {},
        },
      });
      if (index % 6 === 0) {
        await prisma.workInterval.create({
          data: {
            date,
            startAt: new Date(`${date}T08:00:00.000Z`),
            endAt: new Date(`${date}T16:00:00.000Z`),
            timezone,
            category: "standingLight",
            breakMinutes: 30,
          },
        });
      }
      if (index % 15 === 0) {
        await prisma.heartRateSample.create({
          data: {
            profileId: 1,
            dailyHealthDataId: day.id,
            date,
            timestamp: new Date(`${date}T10:00:00.000Z`),
            bpm: 70 + (index % 5),
          },
        });
        await prisma.restingHeartRateSample.create({
          data: {
            profileId: 1,
            dailyHealthDataId: day.id,
            date,
            timestamp: new Date(`${date}T06:00:00.000Z`),
            bpm: 55,
          },
        });
        await prisma.sleepSegment.create({
          data: {
            profileId: 1,
            startAt: new Date(`${date}T22:30:00.000Z`),
            endAt: new Date(`${addCalendarDays(date, 1)}T06:30:00.000Z`),
            state: "asleep",
            rawState: "ASLEEP",
            source: "shortcut",
          },
        });
      }
    }

    const sourcesBefore = await episodeRepository.loadSources(startDate, endDate);
    const inputsBefore = buildSimulationDays({
      from: startDate,
      to: endDate,
      sources: sourcesBefore,
      modelVersion: CURRENT_MODEL_VERSION,
    });

    await repository.pruneOlderThan(addCalendarDays(endDate, -30));

    expect(await prisma.dailyHealthData.count({
      where: { date: { gte: startDate, lte: endDate } },
    })).toBe(120);
    expect(await prisma.healthSyncSnapshot.count({
      where: { date: { gte: startDate, lte: endDate } },
    })).toBe(120);

    const sourcesAfter = await episodeRepository.loadSources(startDate, endDate);
    const inputsAfter = buildSimulationDays({
      from: startDate,
      to: endDate,
      sources: sourcesAfter,
      modelVersion: CURRENT_MODEL_VERSION,
    });
    expect(fingerprintDays(inputsAfter)).toEqual(fingerprintDays(inputsBefore));

    const episode = persistedEpisodeFixture(addCalendarDays(startDate, 30));
    episode.modelVersion = CURRENT_MODEL_VERSION;
    const beforeCalc = calculateEpisodeHistory({ episode, days: inputsBefore });
    const afterCalc = calculateEpisodeHistory({ episode, days: inputsAfter });
    expect(afterCalc.dailyStates.map((s) => [
      s.date, s.energyExpenditureKcal, s.fatMassKg, s.leanTissueKg,
      s.glycogenKg, s.endWeightKg,
    ])).toEqual(beforeCalc.dailyStates.map((s) => [
      s.date, s.energyExpenditureKcal, s.fatMassKg, s.leanTissueKg,
      s.glycogenKg, s.endWeightKg,
    ]));
  }, 120_000);

  it("Test D — accidental day delete cannot silently wipe workouts / HR / sleep", async () => {
    const date = "2045-04-01";
    await cleanFixtureDates([date]);

    const day = await prisma.dailyHealthData.create({
      data: {
        date,
        caloriesKcal: 2_000,
        rawPayload: { source: "durable-test-d" },
        workouts: {
          create: [{
            type: "walk",
            startAt: new Date(`${date}T10:00:00.000Z`),
            endAt: new Date(`${date}T10:30:00.000Z`),
            durationMinutes: 30,
            activeEnergyKcal: 100,
            sourceIdentity: workoutSourceIdentity({
              type: "walk",
              startAt: new Date(`${date}T10:00:00.000Z`),
              endAt: new Date(`${date}T10:30:00.000Z`),
            }),
          }],
        },
      },
    });
    await prisma.heartRateSample.create({
      data: {
        profileId: 1,
        dailyHealthDataId: day.id,
        date,
        timestamp: new Date(`${date}T10:05:00.000Z`),
        bpm: 110,
      },
    });
    await prisma.restingHeartRateSample.create({
      data: {
        profileId: 1,
        dailyHealthDataId: day.id,
        date,
        timestamp: new Date(`${date}T06:00:00.000Z`),
        bpm: 58,
      },
    });
    await prisma.sleepSegment.create({
      data: {
        profileId: 1,
        startAt: new Date(`${date}T23:00:00.000Z`),
        endAt: new Date(`${addCalendarDays(date, 1)}T07:00:00.000Z`),
        state: "asleep",
        rawState: "ASLEEP",
        source: "shortcut",
      },
    });

    await expect(prisma.dailyHealthData.delete({ where: { id: day.id } }))
      .rejects.toMatchObject({ code: "P2003" });

    expect(await prisma.workout.count({ where: { dailyHealthDataId: day.id } })).toBe(1);
    expect(await prisma.heartRateSample.count({ where: { date } })).toBe(1);
    expect(await prisma.restingHeartRateSample.count({ where: { date } })).toBe(1);
    expect(await prisma.sleepSegment.count({
      where: { startAt: new Date(`${date}T23:00:00.000Z`) },
    })).toBe(1);

    // Explicit application delete (History day delete) removes workouts then day;
    // HR SetNulls and sleep remains.
    await deleteDailyHealthRows(prisma, [date]);
    expect(await prisma.workout.count({
      where: { dailyHealthData: { date } },
    })).toBe(0);
    expect(await prisma.dailyHealthData.count({ where: { date } })).toBe(0);
    expect(await prisma.heartRateSample.count({ where: { date } })).toBe(1);
    expect(await prisma.heartRateSample.findFirst({ where: { date } }))
      .toMatchObject({ dailyHealthDataId: null });
    expect(await prisma.restingHeartRateSample.findFirst({ where: { date } }))
      .toMatchObject({ dailyHealthDataId: null });
    expect(await prisma.sleepSegment.count({
      where: { startAt: new Date(`${date}T23:00:00.000Z`) },
    })).toBe(1);
  });
});
