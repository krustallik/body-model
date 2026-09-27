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
      "logged-sets",
      "no-logged-sets",
    ]);
    expect(fact.events.map((event) => event.executionStatus)).toEqual(["partial", "in-progress"]);
    expect(fact.events[0]?.durationMinutes).toBe(20);
    expect(fact.events[1]?.durationMinutes).toBeNull();
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

  it("invalidates diary shadow energy when same-day mass changes without a session revision bump", async () => {
    const freshDate = "2046-02-10";
    await prisma.dailyHealthData.deleteMany({ where: { date: { in: [freshDate, "2046-02-09"] } } });
    await prisma.dailyHealthData.create({
      data: { date: "2046-02-09", weightKg: 79.5, rawPayload: { marker: "day-fact-freshness-prior" } },
    });
    await prisma.dailyHealthData.create({
      data: { date: freshDate, weightKg: 80, rawPayload: { marker: "day-fact-freshness-same-day" } },
    });
    const program = await prisma.trainingProgram.findFirst({
      where: { name: programName },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    }) ?? await prisma.trainingProgram.create({
      data: {
        name: programName,
        versions: { create: { versionNumber: 1, exercises: { create: [] } } },
      },
      include: { versions: true },
    });
    const versionId = program.versions[0]?.id
      ?? (await prisma.trainingProgramVersion.create({
        data: { programId: program.id, versionNumber: 1 },
      })).id;
    const { strengthInputFingerprintV1, strengthSetFingerprintV1 } = await import(
      "@/modules/training/strength-publication-v1"
    );
    const session = await prisma.strengthDiarySession.create({
      data: {
        programId: program.id,
        programVersionId: versionId,
        status: "COMPLETED",
        entryMode: "LIVE",
        revision: 1,
        webStartedAt: new Date("2046-02-10T08:00:00.000Z"),
        webEndedAt: new Date("2046-02-10T09:00:00.000Z"),
        matchStatus: "UNMATCHED",
        exercises: {
          create: [{
            sortOrder: 0,
            snapshotExerciseName: exerciseName,
            plannedSets: 1,
            resistanceType: "EXTERNAL_WEIGHT",
            sets: {
              create: [{ setNumber: 1, reps: 8, weightKg: 60, rir: null }],
            },
          }],
        },
      },
      include: { exercises: { include: { sets: true } } },
    });
    const setRows = session.exercises.flatMap((exercise) => exercise.sets).map((set) => ({
      id: set.id,
      reps: set.reps,
      weightKg: set.weightKg?.toNumber() ?? null,
      bandNominalResistanceKg: set.bandNominalResistanceKg?.toNumber() ?? null,
      rir: set.rir,
    }));
    const fingerprint = strengthInputFingerprintV1({
      sessionId: session.id,
      sessionRevision: 1,
      massKg: 80,
      sameDayMassKg: 80,
      startOfDayMassKg: 79.5,
      setFingerprint: strengthSetFingerprintV1(setRows),
    });
    await prisma.experimentalStrengthEnergyShadow.create({
      data: {
        sessionId: session.id,
        profileId: 1,
        sourceFingerprint: fingerprint,
        modelRevision: "experimental-strength-active-energy-v1",
        features: {},
        result: {
          estimatedActiveKcal: 270,
          sessionRevision: 1,
          inputFingerprint: fingerprint,
        },
      },
    });

    const fresh = await facts.forDate(freshDate);
    expect(fresh.events[0]).toMatchObject({
      diaryOnly: true,
      activeEnergyKcal: 270,
      energySource: "shadow-diary-estimate",
    });

    await prisma.dailyHealthData.update({
      where: { date: freshDate },
      data: { weightKg: 81.4 },
    });
    const stale = await facts.forDate(freshDate);
    // Stored shadow is stale after historical same-day mass correction; read path
    // recomputes as-of-date BodyCast instead of showing the old shadow or inventing
    // today's mass. Original shadow row remains untouched.
    expect(stale.events[0]?.energySource).toBe("shadow-diary-estimate");
    expect(stale.events[0]?.activeEnergyKcal).not.toBeNull();
    expect(stale.events[0]?.activeEnergyKcal).not.toBe(270);

    await prisma.experimentalStrengthEnergyShadow.deleteMany({ where: { sessionId: session.id } });
    await prisma.strengthDiarySession.delete({ where: { id: session.id } });
    await prisma.dailyHealthData.deleteMany({ where: { date: { in: [freshDate, "2046-02-09"] } } });
  });
});
