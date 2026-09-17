import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/health/sync/route";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import {
  CURRENT_MODEL_VERSION,
  LEGACY_PHYSIOLOGY_V5,
} from "@/modules/model-episodes/model-version";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const apiKey = process.env.IOS_SHORTCUT_API_KEY ?? "integration-test-secret";
const date = "2042-06-15";
const timezone = "Europe/Bratislava";

function syncRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/health/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
}

async function clean(): Promise<void> {
  await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
  await prisma.workInterval.deleteMany({ where: { date } });
  await deleteDailyHealthRows(prisma, date);
}

describe("v6 workout activity PostgreSQL integration", () => {
  beforeAll(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("syncs mixed-case Stair + Stair + Strength payload and persists activeEnergyKcal", async () => {
    await clean();
    const response = await POST(syncRequest({
      timezone,
      days: [{
        date,
        walkingDistanceKm: 5.0,
        averageWalkingSpeedKmh: 5.0,
        strengthTrainingMinutes: 75,
        Trainingtype: "stair Climbing\nSTAIR CLIMBING\ntraditional Strength Training",
        Trainingactivekcal: "154\n18\n562",
        trainingTimestamps: [
          `${date}T08:00:00+02:00`,
          `${date}T12:00:00+02:00`,
          `${date}T16:00:00+02:00`,
          `${date}T08:20:00+02:00`,
          `${date}T12:10:00+02:00`,
          `${date}T17:00:00+02:00`,
        ].join("\n"),
      }],
    }));
    expect(response.status).toBe(200);

    const stored = await prisma.dailyHealthData.findUniqueOrThrow({
      where: { date },
      include: { workouts: { orderBy: { startAt: "asc" } } },
    });
    expect(stored.workouts).toHaveLength(3);
    expect(stored.workouts.map((workout) => workout.type)).toEqual([
      "stair Climbing",
      "STAIR CLIMBING",
      "traditional Strength Training",
    ]);
    expect(stored.workouts.map((workout) => workout.activeEnergyKcal)).toEqual([154, 18, 562]);
    expect(stored.workouts.every((workout) => workout.energyKcal === null)).toBe(true);
  });

  it("loads workouts for fresh v6 sources and ignores them on legacy v5 path", async () => {
    const repository = new ModelEpisodeRepository(prisma);
    const sources = await repository.loadSources(date, date);
    expect(sources.workouts).toHaveLength(3);
    expect(sources.workouts?.every((workout) => workout.activeEnergyKcal !== null)).toBe(true);

    const v6 = buildSimulationDays({
      from: date,
      to: date,
      sources,
      modelVersion: CURRENT_MODEL_VERSION,
    });
    expect(v6[0]?.input.workoutActivity?.events).toHaveLength(3);
    expect(v6[0]?.input.workoutActivity?.events.map((event) => ({
      raw: event.type,
      canonical: event.canonicalType,
      classification: event.classification,
    }))).toEqual([
      {
        raw: "stair Climbing",
        canonical: STAIR_CLIMBING_TYPE,
        classification: "stair-climbing",
      },
      {
        raw: "STAIR CLIMBING",
        canonical: STAIR_CLIMBING_TYPE,
        classification: "stair-climbing",
      },
      {
        raw: "traditional Strength Training",
        canonical: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        classification: "traditional-strength-training",
      },
    ]);
    expect(v6[0]?.input.strengthTrainingMinutes).toBe(0);

    const v5 = buildSimulationDays({
      from: date,
      to: date,
      sources,
      modelVersion: LEGACY_PHYSIOLOGY_V5,
    });
    expect(v5[0]?.input.workoutActivity).toBeUndefined();
    expect(v5[0]?.input.strengthTrainingMinutes).toBe(75);
    expect(v5[0]?.input.outsideWorkWalkingDistanceKm).toBe(5);
  });

  it("applies stair snapshot overlap through repository/input-builder and skips weak snapshots", async () => {
    await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
    const day = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date } });

    // Strong boundaries within 10 minutes of first stair (08:00–08:20 local / 06:00–06:20Z).
    await prisma.healthSyncSnapshot.createMany({
      data: [
        {
          dailyHealthDataId: day.id,
          date,
          timezone,
          receivedAt: new Date(`${date}T05:55:00.000Z`),
          syncedAt: new Date(`${date}T05:55:00.000Z`),
          steps: 1_000,
          walkingDistanceKm: 2.0,
          rawPayload: {},
        },
        {
          dailyHealthDataId: day.id,
          date,
          timezone,
          receivedAt: new Date(`${date}T06:25:00.000Z`),
          syncedAt: new Date(`${date}T06:25:00.000Z`),
          steps: 1_600,
          walkingDistanceKm: 2.6,
          rawPayload: {},
        },
      ],
    });

    const repository = new ModelEpisodeRepository(prisma);
    const sources = await repository.loadSources(date, date);
    const withOverlap = buildSimulationDays({
      from: date,
      to: date,
      sources,
      modelVersion: CURRENT_MODEL_VERSION,
    });
    expect(withOverlap[0]?.input.outsideWorkWalkingDistanceKm).toBeCloseTo(4.4, 8);
    const stairDiag = withOverlap[0]?.sourceQuality.stairWalkingOverlap?.[0];
    expect(stairDiag?.overlapApplied).toBe(true);
    expect(stairDiag?.reason).toBe("applied");
    expect(stairDiag?.overlapDistanceAppliedKm).toBeCloseTo(0.6, 8);

    await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
    // Weak/missing after boundary: only a too-early before snapshot.
    await prisma.healthSyncSnapshot.create({
      data: {
        dailyHealthDataId: day.id,
        date,
        timezone,
        receivedAt: new Date(`${date}T04:00:00.000Z`),
        syncedAt: new Date(`${date}T04:00:00.000Z`),
        steps: 500,
        walkingDistanceKm: 1.0,
        rawPayload: {},
      },
    });
    const weakSources = await repository.loadSources(date, date);
    const withoutOverlap = buildSimulationDays({
      from: date,
      to: date,
      sources: weakSources,
      modelVersion: CURRENT_MODEL_VERSION,
    });
    expect(withoutOverlap[0]?.input.outsideWorkWalkingDistanceKm).toBe(5);
    expect(
      withoutOverlap[0]?.sourceQuality.stairWalkingOverlap?.every(
        (item) => item.overlapApplied === false,
      ),
    ).toBe(true);
    expect(withoutOverlap[0]?.input.workoutActivity?.events.reduce(
      (total, event) => total + (event.activeEnergyKcal ?? 0),
      0,
    )).toBe(734);
  });

  it("keeps legacy Workout rows readable after activeEnergyKcal migration round-trip", async () => {
    await clean();
    const day = await prisma.dailyHealthData.create({
      data: {
        date,
        walkingDistanceKm: 3,
        averageWalkingSpeedKmh: 5,
        strengthTrainingMinutes: 30,
        rawPayload: { date, legacy: true },
        workouts: {
          create: [{
            type: "legacy-spin",
            startAt: new Date(`${date}T10:00:00.000Z`),
            endAt: new Date(`${date}T10:30:00.000Z`),
            durationMinutes: 30,
            energyKcal: 220,
            activeEnergyKcal: null,
            sourceIdentity: workoutSourceIdentity({
              type: "legacy-spin",
              startAt: new Date(`${date}T10:00:00.000Z`),
              endAt: new Date(`${date}T10:30:00.000Z`),
            }),
          }],
        },
      },
      include: { workouts: true },
    });
    const legacyWorkout = day.workouts[0]!;
    expect(legacyWorkout.energyKcal).toBe(220);
    expect(legacyWorkout.activeEnergyKcal).toBeNull();

    const reloaded = await prisma.workout.findUniqueOrThrow({ where: { id: legacyWorkout.id } });
    expect(reloaded).toMatchObject({
      type: "legacy-spin",
      energyKcal: 220,
      activeEnergyKcal: null,
    });

    const sources = await new ModelEpisodeRepository(prisma).loadSources(date, date);
    expect(sources.workouts).toEqual([expect.objectContaining({
      type: "legacy-spin",
      energyKcal: 220,
      activeEnergyKcal: null,
    })]);
  });
});
