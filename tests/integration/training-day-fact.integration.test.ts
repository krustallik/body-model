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
  await prisma.healthMetricSample.deleteMany({
    where: { metric: "weight-kg", timestamp: new Date("2046-02-10T08:30:00.000Z") },
  });
  for (const [date, marker] of [
    ["2046-02-09", "day-fact-freshness-prior"],
    ["2046-02-10", "day-fact-freshness-same-day"],
  ] as const) {
    const row = await prisma.dailyHealthData.findUnique({ where: { date } });
    if (row && typeof row.rawPayload === "object" && row.rawPayload !== null
      && !Array.isArray(row.rawPayload)
      && (row.rawPayload as { marker?: unknown }).marker === marker) {
      await prisma.dailyHealthData.delete({ where: { date } });
    }
  }
  const sessions = await prisma.strengthDiarySession.findMany({
    where: { program: { name: programName } },
    select: { id: true },
  });
  const aliases = sessions.length === 0 ? [] : await prisma.activeEnergyEventAlias.findMany({
    where: { profileId: 1, sourceType: "strength-session", sourceId: { in: sessions.map(({ id }) => String(id)) } },
    select: { eventId: true },
  });
  if (aliases.length > 0) {
    await prisma.activeEnergyCanonicalEvent.deleteMany({
      where: { id: { in: [...new Set(aliases.map(({ eventId }) => eventId))] } },
    });
  }
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

  it("recomputes canonical diary energy from refreshed Stage 02 mass without a session revision bump", async () => {
    const freshDate = "2046-02-10";
    await clean();
    await prisma.dailyHealthData.create({
      data: { date: "2046-02-09", weightKg: 79.5, rawPayload: { marker: "day-fact-freshness-prior" } },
    });
    await prisma.dailyHealthData.create({
      data: { date: freshDate, weightKg: 80, rawPayload: { marker: "day-fact-freshness-same-day" } },
    });
    const massSample = await prisma.healthMetricSample.create({
      data: {
        date: freshDate,
        metric: "weight-kg",
        source: "apple-health-shortcut",
        timestamp: new Date("2046-02-10T08:30:00.000Z"),
        value: 80,
      },
      select: { id: true },
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
    const session = await prisma.strengthDiarySession.create({
      data: {
        programId: program.id,
        programVersionId: versionId,
        status: "COMPLETED",
        entryMode: "LIVE",
        revision: 1,
        webStartedAt: new Date("2046-02-10T08:00:00.000Z"),
        webEndedAt: new Date("2046-02-10T09:00:00.000Z"),
        effectiveAccountingAt: new Date("2046-02-10T08:00:00.000Z"),
        accountingTimeZone: "Europe/Bratislava",
        accountingTimeZoneProvenance: "client-session",
        matchStatus: "UNMATCHED",
        exercises: {
          create: [{
            sortOrder: 0,
            snapshotExerciseName: exerciseName,
            plannedSets: 1,
            resistanceType: "BODYWEIGHT",
            sets: {
              create: [{
                setNumber: 1,
                reps: 8,
                weightKg: 60,
                rir: null,
                completedAt: new Date("2046-02-10T08:30:00.000Z"),
              }],
            },
          }],
        },
      },
      include: { exercises: { include: { sets: true } } },
    });
    const { TrainingService } = await import("@/modules/training/training.service");
    const { recordExperimentalStrengthEnergyShadowBySessionId } = await import(
      "@/modules/training/experimental-strength-energy-shadow.service"
    );
    const service = new TrainingService(prisma);
    const initialAccounting = await service.refreshSessionAccounting(
      session.id,
      1,
      `day-fact-stage02-initial-${session.id}`,
    );
    expect(initialAccounting.activeEnergyMassReference?.reference).toMatchObject({ status: "observed", valueKg: 80 });
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: session.id, profileId: 1 });
    const initialShadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: session.id } });
    const initialKcal = (initialShadow.result as { estimatedActiveKcal: number }).estimatedActiveKcal;
    expect(initialKcal).toBeGreaterThan(0);

    const fresh = await facts.forDate(freshDate);
    expect(fresh.events[0]).toMatchObject({
      diaryOnly: true,
      activeEnergyKcal: initialKcal,
      energySource: "bodycast-strength-estimate",
    });

    await prisma.dailyHealthData.update({
      where: { date: freshDate },
      data: { weightKg: 81.4 },
    });
    await prisma.healthMetricSample.update({ where: { id: massSample.id }, data: { value: 81.4 } });
    const refreshedAccounting = await service.refreshSessionAccounting(
      session.id,
      1,
      `day-fact-stage02-refreshed-${session.id}`,
    );
    expect(refreshedAccounting.activeEnergyMassReference?.reference).toMatchObject({ status: "observed", valueKg: 81.4 });
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: session.id, profileId: 1 });
    const stale = await facts.forDate(freshDate);
    // The source edit is incorporated by refreshing the persisted Stage 02
    // mass snapshot and regenerating its shadow candidate.
    expect(stale.events[0]?.energySource).toBe("bodycast-strength-estimate");
    expect(stale.events[0]?.activeEnergyKcal).not.toBeNull();
    expect(stale.events[0]?.activeEnergyKcal).not.toBe(initialKcal);

    await clean();
  });
});
