import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DailyMetricRepository } from "@/modules/days/day.repository";
import { TrainingDayFactRepository } from "@/modules/days/training-day-fact.repository";

const prisma = new PrismaClient();
const facts = new TrainingDayFactRepository(prisma);
const dailyMetrics = new DailyMetricRepository(prisma);
const programName = "stage00-training-day-fact-integration";
const exerciseName = "stage00-training-day-fact-exercise";
const localDate = "2046-01-02";
const garminLocalDate = "2046-01-03";
const garminSourcePrefix = "stage00-training-day-fact:";
const healthRowMarker = "stage00-training-day-fact-garmin-fixture";

async function clean(): Promise<void> {
  await prisma.strengthDiarySession.deleteMany({ where: { program: { name: programName } } });
  const healthRow = await prisma.dailyHealthData.findUnique({ where: { date: garminLocalDate } });
  if (healthRow && typeof healthRow.rawPayload === "object" && healthRow.rawPayload !== null
    && !Array.isArray(healthRow.rawPayload)
    && (healthRow.rawPayload as { marker?: unknown }).marker === healthRowMarker) {
    await prisma.workout.deleteMany({ where: { dailyHealthDataId: healthRow.id, sourceIdentity: { startsWith: garminSourcePrefix } } });
    await prisma.dailyHealthData.delete({ where: { id: healthRow.id } });
  }
  await prisma.programExercise.deleteMany({ where: { programVersion: { program: { name: programName } } } });
  await prisma.trainingProgram.updateMany({ where: { name: programName }, data: { currentVersionId: null } });
  await prisma.trainingProgramVersion.deleteMany({ where: { program: { name: programName } } });
  await prisma.trainingProgram.deleteMany({ where: { name: programName } });
  await prisma.exerciseCatalog.deleteMany({ where: { name: exerciseName } });
}

describe("TrainingDayFact PostgreSQL repository", () => {
  beforeAll(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("resolves started diary events on local start date without a Health row and excludes non-events", async () => {
    const dailyHealthRow = await prisma.dailyHealthData.findUnique({ where: { date: localDate } });
    expect(dailyHealthRow).toBeNull();

    const exercise = await prisma.exerciseCatalog.create({ data: { name: exerciseName } });
    const program = await prisma.trainingProgram.create({
      data: {
        name: programName,
        versions: {
          create: {
            versionNumber: 1,
            exercises: {
              create: [{
                exerciseCatalogId: exercise.id,
                sortOrder: 0,
                plannedSets: 1,
                resistanceType: "EXTERNAL_WEIGHT",
              }],
            },
          },
        },
      },
      include: { versions: true },
    });
    const versionId = program.versions[0]!.id;
    await prisma.trainingProgram.update({ where: { id: program.id }, data: { currentVersionId: versionId } });

    await prisma.strengthDiarySession.create({
      data: {
        programId: program.id,
        programVersionId: versionId,
        status: "ACTIVE",
        entryMode: "LIVE",
        // 23:30 UTC is 00:30 on the next Europe/Bratislava calendar day.
        webStartedAt: new Date("2046-01-01T23:30:00.000Z"),
      },
    });
    const cancelledWithSet = await prisma.strengthDiarySession.create({
      data: {
        programId: program.id,
        programVersionId: versionId,
        status: "CANCELLED",
        entryMode: "LIVE",
        webStartedAt: new Date("2046-01-02T02:00:00.000Z"),
        webEndedAt: new Date("2046-01-02T02:20:00.000Z"),
        exercises: {
          create: [{
            sourceExerciseCatalogId: exercise.id,
            snapshotExerciseName: exerciseName,
            sortOrder: 0,
            plannedSets: 1,
            resistanceType: "EXTERNAL_WEIGHT",
            sets: { create: [{ setNumber: 1, reps: 8, weightKg: 12 }] },
          }],
        },
      },
    });
    await prisma.strengthDiarySession.create({
      data: {
        programId: program.id,
        programVersionId: versionId,
        status: "CANCELLED",
        entryMode: "LIVE",
        webStartedAt: new Date("2046-01-02T04:00:00.000Z"),
      },
    });
    await prisma.strengthDiarySession.create({
      data: {
        programId: program.id,
        programVersionId: versionId,
        status: "COMPLETED",
        entryMode: "LIVE",
        // A created record without a trusted start time is not an occurrence.
        webStartedAt: null,
      },
    });

    const fact = await facts.forDate(localDate);
    expect(fact).toMatchObject({
      date: localDate,
      eventCount: 2,
      durationMinutes: null,
      hiddenEventCount: 0,
    });
    expect(fact.events.map((event) => event.exerciseDetailAvailability)).toEqual([
      "no-logged-sets",
      "logged-sets",
    ]);
    expect(fact.events.map((event) => event.executionStatus)).toEqual(["in-progress", "partial"]);
    expect(fact.events[0]?.durationMinutes).toBeNull();
    expect(fact.events[1]?.durationMinutes).toBe(20);
    expect(fact.events.every((event) => event.diaryOnly)).toBe(true);

    const firstAllHistoryPage = await dailyMetrics.listWithTrainingFacts({
      to: localDate,
      limit: 100,
      offset: 0,
      includeTrainingDays: true,
    });
    expect(firstAllHistoryPage.days.some((day) => day.date === localDate)).toBe(false);
    expect(firstAllHistoryPage.trainingDays.find((day) => day.date === localDate)).toMatchObject({ eventCount: 2 });

    await prisma.strengthSet.deleteMany({
      where: { sessionExercise: { sessionId: cancelledWithSet.id } },
    });
    const afterLastSetDelete = await facts.forDate(localDate);
    expect(afterLastSetDelete.eventCount).toBe(1);
    expect(afterLastSetDelete.events[0]?.executionStatus).toBe("in-progress");
  });

  it("counts a persisted matched pair once and keeps hidden events without exposing details", async () => {
    const program = await prisma.trainingProgram.findFirstOrThrow({ where: { name: programName }, include: { versions: true } });
    const daily = await prisma.dailyHealthData.create({
      data: { date: garminLocalDate, rawPayload: { marker: healthRowMarker } },
    });
    const matchedWorkout = await prisma.workout.create({
      data: {
        dailyHealthDataId: daily.id,
        sourceIdentity: garminSourcePrefix + "matched",
        externalId: garminSourcePrefix + "matched",
        type: "Traditional Strength Training",
        startAt: new Date("2046-01-03T08:00:00.000Z"),
        endAt: new Date("2046-01-03T09:00:00.000Z"),
        durationMinutes: 60,
      },
    });
    await prisma.strengthDiarySession.create({
      data: {
        programId: program.id,
        programVersionId: program.versions[0]!.id,
        status: "COMPLETED",
        entryMode: "RETROSPECTIVE",
        webStartedAt: null,
        matchStatus: "MATCHED",
        matchMethod: "DIRECT_BACKFILL",
        matchedWorkoutId: matchedWorkout.id,
      },
    });
    await prisma.workout.create({
      data: {
        dailyHealthDataId: daily.id,
        sourceIdentity: garminSourcePrefix + "only",
        externalId: garminSourcePrefix + "only",
        type: "Traditional Strength Training",
        startAt: new Date("2046-01-03T10:00:00.000Z"),
        endAt: new Date("2046-01-03T11:00:00.000Z"),
        durationMinutes: null,
      },
    });

    const visible = await facts.forDate(garminLocalDate);
    expect(visible).toMatchObject({ date: garminLocalDate, eventCount: 2, durationMinutes: 120, hiddenEventCount: 0 });
    expect(visible.events.map((event) => event.source).sort()).toEqual(["matched", "workout"]);
    expect(visible.events.find((event) => event.source === "matched")).toMatchObject({
      diaryOnly: false,
      exerciseDetailAvailability: "no-logged-sets",
      loggedSetCount: 0,
    });
    expect(visible.events.find((event) => event.source === "workout")).toMatchObject({
      exerciseDetailAvailability: "unavailable",
      loggedSetCount: null,
    });

    await prisma.workout.update({ where: { id: matchedWorkout.id }, data: { hiddenFromHistory: true } });
    const hidden = await facts.forDate(garminLocalDate);
    expect(hidden).toMatchObject({ eventCount: 2, hiddenEventCount: 1, durationMinutes: null });
    expect(hidden.events).toHaveLength(1);
    expect(hidden.events[0]?.source).toBe("workout");
  });
});
