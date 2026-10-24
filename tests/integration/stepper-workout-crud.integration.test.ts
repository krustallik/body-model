import { Prisma, PrismaClient } from "@prisma/client";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";
import { MANUAL_STEPPER_SOURCE_PREFIX } from "@/modules/health/workout-source-identity";
import { StepperWorkoutRepository } from "@/modules/training/stepper-workout.repository";
import type { StepperWorkoutInput } from "@/modules/training/stepper-workout.schema";
import { clearUnifiedPublicationBlockFixtures } from "../helpers/clear-unified-publication-blocks";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
process.env.DATABASE_URL = databaseUrl;
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const stepperWorkouts = new StepperWorkoutRepository(prisma);
const healthSync = new PrismaHealthSyncRepository(prisma);
const dates = ["2042-03-15", "2042-03-16"];
const fixtureStepperSourceKeys = new Set<string>();
let priorTrainingRefreshState: {
  queue: Awaited<ReturnType<typeof prisma.trainingRefreshJob.findUnique>>;
  sourceChanges: Awaited<ReturnType<typeof prisma.trainingSourceChange.findMany>>;
} | null = null;

async function readTrainingRefreshState() {
  const [queue, sourceChanges] = await Promise.all([
    prisma.trainingRefreshJob.findUnique({ where: { profileId: 1 } }),
    prisma.trainingSourceChange.findMany({ where: { profileId: 1 } }),
  ]);
  return { queue, sourceChanges };
}

async function restoreTrainingRefreshState(state: NonNullable<typeof priorTrainingRefreshState>) {
  await prisma.trainingSourceChange.deleteMany({ where: { profileId: 1 } });
  await prisma.trainingRefreshJob.deleteMany({ where: { profileId: 1 } });
  if (state.sourceChanges.length > 0) {
    await prisma.trainingSourceChange.createMany({ data: state.sourceChanges.map((row) => ({
      ...row,
      oldSourceIdentity: row.oldSourceIdentity === null ? Prisma.DbNull : row.oldSourceIdentity as Prisma.InputJsonValue,
      newSourceIdentity: row.newSourceIdentity === null ? Prisma.DbNull : row.newSourceIdentity as Prisma.InputJsonValue,
      oldEventInstants: row.oldEventInstants === null ? Prisma.DbNull : row.oldEventInstants as Prisma.InputJsonValue,
      newEventInstants: row.newEventInstants === null ? Prisma.DbNull : row.newEventInstants as Prisma.InputJsonValue,
    })) });
  }
  if (state.queue) await prisma.trainingRefreshJob.create({ data: state.queue });
}

async function clean() {
  await clearUnifiedPublicationBlockFixtures(prisma, [
    ...[...fixtureStepperSourceKeys].map((sourceKey) => ({ profileId: 1, source: "stepper" as const, sourceKey })),
  ]);
  await prisma.healthSyncSnapshot.deleteMany({ where: { date: { in: dates } } });
  await deleteDailyHealthRows(prisma, dates);
}

const syncMeta = (receivedAt: string) => ({
  timezone: "Europe/Bratislava",
  receivedAt: new Date(receivedAt),
  syncedAt: null,
});

describe("stepper CRUD and Apple Health sync protection with PostgreSQL", () => {
  beforeAll(async () => {
    priorTrainingRefreshState = await readTrainingRefreshState();
    await clean();
  });
  afterAll(async () => {
    try {
      await clean();
    } finally {
      if (priorTrainingRefreshState !== null) await restoreTrainingRefreshState(priorTrainingRefreshState);
      await prisma.$disconnect();
    }
  });

  it("creates manual workouts and preserves edited or deleted Health workouts across sync", async () => {
    const input: StepperWorkoutInput = { startAt: "2042-03-15T08:00:00.000Z", durationMinutes: 20 };
    const created = await stepperWorkouts.create(input);
    fixtureStepperSourceKeys.add(String(created.id));
    expect(created).toMatchObject({ type: "Stair Climbing", durationMinutes: 20, activeEnergyKcal: null, source: "manual" });
    const row = await prisma.workout.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.sourceIdentity).toMatch(new RegExp(`^${MANUAL_STEPPER_SOURCE_PREFIX}`));
    expect(row.energyKcal).toBeNull();

    const beforeNoOpJob = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
    const beforeNoOpChanges = await prisma.trainingSourceChange.count({
      where: { profileId: 1, affectedWorkoutIds: { has: created.id } },
    });
    await expect(stepperWorkouts.update(created.id, input)).resolves.toMatchObject({
      id: created.id, modelPublicationStatus: "not-run",
    });
    expect(await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } }))
      .toMatchObject({ requestedGeneration: beforeNoOpJob.requestedGeneration });
    expect(await prisma.trainingSourceChange.count({
      where: { profileId: 1, affectedWorkoutIds: { has: created.id } },
    })).toBe(beforeNoOpChanges);

    await healthSync.syncDay({
      date: dates[0]!,
      workouts: [{ externalId: "synced-stair", type: "Stair Climbing", startAt: "2042-03-15T09:00:00.000Z", endAt: "2042-03-15T09:10:00.000Z", durationMinutes: 10, activeEnergyKcal: 65 }],
    }, { date: dates[0], workouts: [{ type: "Stair Climbing", startAt: "2042-03-15T09:00:00.000Z" }] }, syncMeta("2042-03-15T12:00:00.000Z"));
    const synced = await prisma.workout.findFirstOrThrow({ where: { externalId: "synced-stair" } });
    fixtureStepperSourceKeys.add(String(synced.id));
    const healthEdited = await stepperWorkouts.update(synced.id, { startAt: "2042-03-15T10:30:00.000Z", durationMinutes: 25 });
    expect(healthEdited).toMatchObject({ id: synced.id, source: "health", syncProtected: true, editable: true, durationMinutes: 25 });

    await healthSync.syncDay({
      date: dates[0]!,
      workouts: [{ externalId: "synced-stair", type: "Stair Climbing", startAt: "2042-03-15T09:00:00.000Z", endAt: "2042-03-15T09:10:00.000Z", durationMinutes: 10, activeEnergyKcal: 65 }],
    }, { date: dates[0], workouts: [{ type: "Stair Climbing", startAt: "2042-03-15T09:00:00.000Z" }] }, syncMeta("2042-03-15T12:30:00.000Z"));
    const afterRepeatSync = await prisma.workout.findUniqueOrThrow({ where: { id: synced.id } });
    expect(afterRepeatSync.startAt.toISOString()).toBe("2042-03-15T10:30:00.000Z");
    expect(afterRepeatSync.durationMinutes).toBe(25);

    await healthSync.syncDay({ date: dates[0]!, workouts: [] }, { workouts: [] }, syncMeta("2042-03-15T13:00:00.000Z"));
    const afterEmptyFeed = await prisma.workout.findMany({ where: { dailyHealthData: { date: dates[0] } }, orderBy: { startAt: "asc" } });
    expect(afterEmptyFeed.map((workout) => workout.id)).toEqual([created.id, synced.id]);

    await expect(stepperWorkouts.delete(synced.id)).resolves.toMatchObject({ deleted: true, modelPublicationStatus: "not-run" });
    const hidden = await prisma.workout.findUniqueOrThrow({ where: { id: synced.id } });
    expect(hidden).toMatchObject({ syncProtected: true, hiddenFromHistory: true });
    await healthSync.syncDay({
      date: dates[0]!,
      workouts: [{ externalId: "synced-stair", type: "Stair Climbing", startAt: "2042-03-15T09:00:00.000Z", endAt: "2042-03-15T09:10:00.000Z", durationMinutes: 10, activeEnergyKcal: 65 }],
    }, { date: dates[0], workouts: [{ type: "Stair Climbing", startAt: "2042-03-15T09:00:00.000Z" }] }, syncMeta("2042-03-15T13:30:00.000Z"));
    expect(await prisma.workout.findUniqueOrThrow({ where: { id: synced.id } })).toMatchObject({ hiddenFromHistory: true, syncProtected: true });
    expect((await stepperWorkouts.list()).some((workout) => workout.id === synced.id)).toBe(false);

    const moved = await stepperWorkouts.update(created.id, { startAt: "2042-03-16T10:00:00.000Z", durationMinutes: 35 });
    expect(moved).toMatchObject({ id: created.id, durationMinutes: 35, source: "manual" });
    const movedRow = await prisma.workout.findUniqueOrThrow({ where: { id: created.id }, include: { dailyHealthData: { select: { date: true } } } });
    expect(movedRow.dailyHealthData.date).toBe(dates[1]);

    await expect(stepperWorkouts.delete(created.id)).resolves.toMatchObject({ deleted: true, modelPublicationStatus: "not-run" });
    expect(await stepperWorkouts.update(created.id, input)).toBeNull();
  });
});
