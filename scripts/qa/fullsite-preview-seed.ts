import { PrismaClient } from "@prisma/client";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";
import { addCalendarDays, enumerateCalendarDates, latestCompletedLocalDate } from "@/modules/model-episodes/model-calendar";
import { initializeNewModelEpisode, recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import { rebuildAndPersistPhysiologyForProfileRangeV7 } from "@/modules/model-episodes/physiology-v7-persisted-rebuild.service";

const prisma = new PrismaClient();
const DATABASE_NAME = "bodycast_qa";
const DATABASE_USER = "bodycast_qa";
const DATABASE_HOST = "127.0.0.1";
const DATABASE_PORT = "55434";
const TIME_ZONE = "Europe/Bratislava";
const SOURCE = "bodycast-fullsite-preview-v1";

function assertSafeConnectionUrl(): URL {
  if (process.env.NODE_ENV === "production") throw new Error("Fullsite preview seed refuses NODE_ENV=production");
  if (process.env.BODYCAST_QA_MODE !== "1") throw new Error("Set BODYCAST_QA_MODE=1 for the isolated preview database");
  if (process.env.BODYCAST_DEMO_MODE === "1") throw new Error("Set BODYCAST_DEMO_MODE=0 so the preview uses real application APIs");
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is required");
  const url = new URL(rawUrl);
  if (url.protocol !== "postgresql:" || url.hostname !== DATABASE_HOST || url.port !== DATABASE_PORT
    || url.pathname !== `/${DATABASE_NAME}` || decodeURIComponent(url.username) !== DATABASE_USER) {
    throw new Error(`Refusing seed: DATABASE_URL must target ${DATABASE_USER}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}`);
  }
  return url;
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

// All fixture dates fall in Central European summer time (UTC+2).
function localTime(date: string, hour: number, minute = 0): Date {
  return new Date(Date.UTC(
    Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)),
    hour - 2, minute,
  ));
}

async function verifyDatabaseIdentity() {
  const rows = await prisma.$queryRaw<Array<{ databaseName: string; databaseUser: string }>>`
    SELECT current_database() AS "databaseName", current_user AS "databaseUser"
  `;
  if (rows[0]?.databaseName !== DATABASE_NAME || rows[0]?.databaseUser !== DATABASE_USER) {
    throw new Error("Database server identity does not match the isolated fullsite QA database/user");
  }
}

async function clearIsolatedQaDatabase() {
  await verifyDatabaseIdentity();
  const rows = await prisma.$queryRaw<Array<{ tableName: string }>>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  // Keep Prisma migration history and the migration-seeded exercise catalog.
  const tables = rows.map(({ tableName }) => tableName)
    .filter((tableName) => tableName !== "_prisma_migrations" && tableName !== "ExerciseCatalog");
  if (!tables.includes("Profile") || !tables.includes("DailyHealthData")) {
    throw new Error("Expected BodyCast application tables were not found; refusing to clear the database");
  }
  const quotedTables = tables.map((tableName) => `"${tableName.replaceAll('"', '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);
}

async function seedDailyHistory(historyStart: string, finalDate: string, qaNow: Date) {
  const dates = enumerateCalendarDates(historyStart, finalDate);
  const dailyByDate = new Map<string, number>();
  const workoutRows: Array<{
    date: string; type: "Traditional Strength Training" | "Stair Climbing";
    startAt: Date; endAt: Date; durationMinutes: number; activeEnergyKcal: number;
  }> = [];
  const workIntervals: Array<{ date: string; startAt: Date; endAt: Date; breakMinutes: number; category: string }> = [];
  const snapshots: Array<Record<string, unknown>> = [];
  const stepIntervals: Array<Record<string, unknown>> = [];
  const heartRates: Array<Record<string, unknown>> = [];
  const restingHeartRates: Array<Record<string, unknown>> = [];
  const sleepSegments: Array<Record<string, unknown>> = [];

  for (const [index, date] of dates.entries()) {
    const day = weekday(date);
    const walkingKm = 3.4 + [0.2, 1.0, 0.5, 1.5, 0.7, 2.1, -0.3][index % 7]!;
    const caloriesKcal = 2_280 + [-100, 35, 90, -45, 125, -60, 10][index % 7]!;
    const isStrengthDay = day === 1 || day === 3 || day === 5;
    const isStepperDay = index % 23 === 8 || date === addCalendarDays(finalDate, -1);
    const stepCount = Math.round(6_200 + walkingKm * 720 + (isStepperDay ? 1_300 : 0));
    const health = await prisma.dailyHealthData.create({
      data: {
        date,
        weightKg: 82.4 - index * 0.011 + [0.06, -0.04, 0.02, -0.03, 0.05][index % 5]!,
        bodyFatPercent: index % 7 === 0 ? 21.4 + [0.1, -0.1, 0][index % 3]! : null,
        // Keep the initialization fitting interval and active model window
        // complete; several realistic intake/activity gaps remain in older history.
        caloriesKcal: index < 30 && index % 11 === 5 ? null : caloriesKcal,
        proteinG: index < 30 && index % 13 === 6 ? null : 156 + [0, 8, -5, 4][index % 4]!,
        fatG: index < 30 && index % 13 === 6 ? null : 71 + [0, 5, -3][index % 3]!,
        carbsG: index < 30 && index % 13 === 6 ? null : 238 + [0, 18, -12, 9][index % 4]!,
        steps: index < 30 && index % 9 === 2 ? null : stepCount,
        activeEnergyKcal: index % 19 === 6 ? null : 430 + (index % 6) * 17 + (isStepperDay ? 155 : 0),
        averageWalkingSpeedKmh: index < 30 && index % 9 === 2 ? null : 4.8 + [0, 0.2, -0.1][index % 3]!,
        walkingDistanceKm: index < 30 && index % 9 === 2 ? null : walkingKm,
        strengthTrainingMinutes: isStrengthDay ? 45 : 0,
        workoutFeedObserved: true,
        rawPayload: { source: SOURCE, fixtureVersion: 1 },
      },
    });
    dailyByDate.set(date, health.id);

    if (isStrengthDay) {
      const startAt = localTime(date, 17, 30);
      const endAt = new Date(startAt.getTime() + 48 * 60_000);
      workoutRows.push({ date, type: "Traditional Strength Training", startAt, endAt, durationMinutes: 48, activeEnergyKcal: 184 + (index % 4) * 9 });
    }
    if (isStepperDay) {
      const startAt = localTime(date, 8, 10);
      const endAt = new Date(startAt.getTime() + 42 * 60_000);
      workoutRows.push({ date, type: "Stair Climbing", startAt, endAt, durationMinutes: 42, activeEnergyKcal: 146 + (index % 5) * 8 });
      if (date === addCalendarDays(finalDate, -1)) {
        for (const [part, minutes, steps] of [[0, 0, 760], [1, 12, 820], [2, 24, 790], [3, 36, 720]] as const) {
          const intervalStart = new Date(startAt.getTime() + minutes * 60_000);
          const intervalEnd = new Date(startAt.getTime() + (minutes + 6) * 60_000);
          stepIntervals.push({
            date, metric: "steps", startAt: intervalStart, endAt: intervalEnd,
            value: steps, sourceFingerprint: `qa-step-${date}-${part}`,
          });
        }
        snapshots.push(
          { dailyHealthDataId: health.id, date, receivedAt: new Date(startAt.getTime() - 5 * 60_000), timezone: TIME_ZONE, steps: Math.max(0, stepCount - 3_090), rawPayload: { source: SOURCE, kind: "stepper-before" } },
          { dailyHealthDataId: health.id, date, receivedAt: new Date(endAt.getTime() + 5 * 60_000), timezone: TIME_ZONE, steps: stepCount, rawPayload: { source: SOURCE, kind: "stepper-after" } },
        );
      }
    }

    if (day >= 1 && day <= 5 && index % 2 === 0) {
      const startAt = localTime(date, 6);
      const endAt = localTime(date, 14);
      workIntervals.push({ date, startAt, endAt, breakMinutes: index % 3 === 0 ? 45 : 30, category: index % 4 === 0 ? "manualLight" : "standingLightModerate" });
      snapshots.push(
        { dailyHealthDataId: health.id, date, receivedAt: startAt, timezone: TIME_ZONE, steps: 900, walkingDistanceKm: 0.65, rawPayload: { source: SOURCE, kind: "work-start" } },
        { dailyHealthDataId: health.id, date, receivedAt: endAt, timezone: TIME_ZONE, steps: Math.round(stepCount * 0.62), walkingDistanceKm: Number((walkingKm * 0.61).toFixed(2)), rawPayload: { source: SOURCE, kind: "work-end" } },
      );
    }

    if (index % 17 !== 9) {
      const wakeMinute = 6 * 60 + (index % 7) * 7;
      const wakeAt = localTime(date, Math.floor(wakeMinute / 60), wakeMinute % 60);
      const stages = [
        ["core", 100 + (index % 5) * 5], ["deep", 40 + (index % 5) * 4],
        ["core", 85 + (index % 6) * 6], ["deep", 18 + (index % 5) * 3],
        ["rem", 40 + (index % 5) * 4], ["core", 24 + (index % 4) * 4],
        ["rem", 36 + (index % 6) * 4], ["awake", 6 + (index % 6) * 3],
      ] as const;
      const inBedMinutes = stages.reduce((total, [, minutes]) => total + minutes, 0);
      const inBedStart = new Date(wakeAt.getTime() - inBedMinutes * 60_000);
      const offset = 120;
      sleepSegments.push({
        profileId: 1, startAt: inBedStart, endAt: wakeAt,
        startOffsetMinutes: offset, endOffsetMinutes: offset, state: "inBed", rawState: "inBed", source: "shortcut",
      });
      let stageStart = inBedStart;
      for (const [state, stageMinutes] of stages) {
        const stageEnd = new Date(stageStart.getTime() + stageMinutes * 60_000);
        sleepSegments.push({
          profileId: 1, startAt: stageStart, endAt: stageEnd,
          startOffsetMinutes: offset, endOffsetMinutes: offset, state, rawState: state, source: "shortcut",
        });
        stageStart = stageEnd;
      }
    }

    const morning = localTime(date, 7, 10);
    if (index % 13 !== 7) {
      heartRates.push(
        { profileId: 1, dailyHealthDataId: health.id, date, timestamp: new Date(morning.getTime() - 30 * 60_000), bpm: 60 + (index % 5), source: "shortcut" },
        { profileId: 1, dailyHealthDataId: health.id, date, timestamp: localTime(date, 12, 20), bpm: 76 + (index % 8), source: "shortcut" },
        { profileId: 1, dailyHealthDataId: health.id, date, timestamp: localTime(date, 20, 10), bpm: 68 + (index % 6), source: "shortcut" },
      );
    }
    if (index % 14 !== 5) {
      restingHeartRates.push({
        profileId: 1, dailyHealthDataId: health.id, date, timestamp: morning,
        bpm: 57 + Math.round(index / 22) + (index % 3), source: "shortcut",
      });
    }
  }

  const partialDate = addCalendarDays(finalDate, 1);
  const partial = await prisma.dailyHealthData.create({
    data: {
      date: partialDate, weightKg: 81.42, bodyFatPercent: null, caloriesKcal: 620,
      proteinG: 38, fatG: null, carbsG: 64, steps: 1_860, activeEnergyKcal: null,
      averageWalkingSpeedKmh: null, walkingDistanceKm: null, strengthTrainingMinutes: null,
      workoutFeedObserved: null, rawPayload: { source: SOURCE, fixtureVersion: 1, partialDay: true, asOf: qaNow.toISOString() },
    },
  });
  dailyByDate.set(partialDate, partial.id);

  if (workIntervals.length) {
    await prisma.workInterval.createMany({ data: workIntervals.map(({ date, startAt, endAt, category, breakMinutes }) => ({ date, startAt, endAt, timezone: TIME_ZONE, category, breakMinutes })) });
  }
  if (snapshots.length) await prisma.healthSyncSnapshot.createMany({ data: snapshots as never[] });
  if (stepIntervals.length) await prisma.healthActivityInterval.createMany({ data: stepIntervals as never[] });
  if (heartRates.length) await prisma.heartRateSample.createMany({ data: heartRates as never[] });
  if (restingHeartRates.length) await prisma.restingHeartRateSample.createMany({ data: restingHeartRates as never[] });
  if (sleepSegments.length) await prisma.sleepSegment.createMany({ data: sleepSegments as never[] });

  const workouts = [];
  for (const [index, row] of workoutRows.entries()) {
    const externalId = `fullsite-${row.type === "Stair Climbing" ? "stepper" : "strength"}-${row.date}-${index}`;
    const workout = await prisma.workout.create({
      data: {
        dailyHealthDataId: dailyByDate.get(row.date)!, externalId,
        sourceIdentity: workoutSourceIdentity({ externalId, type: row.type, startAt: row.startAt, endAt: row.endAt }),
        type: row.type, startAt: row.startAt, endAt: row.endAt, durationMinutes: row.durationMinutes,
        energyKcal: null, activeEnergyKcal: row.activeEnergyKcal,
      },
    });
    workouts.push(workout);
    if (row.type === "Stair Climbing" && row.date === addCalendarDays(finalDate, -1)) {
      const samples = [
        { timestamp: new Date(row.startAt.getTime() + 2 * 60_000), bpm: 111 },
        { timestamp: new Date(row.startAt.getTime() + 14 * 60_000), bpm: 128 },
        { timestamp: new Date(row.startAt.getTime() + 27 * 60_000), bpm: 137 },
        { timestamp: new Date(row.startAt.getTime() + 39 * 60_000), bpm: 123 },
      ];
      await prisma.heartRateSample.createMany({ data: samples.map((sample) => ({ profileId: 1, dailyHealthDataId: dailyByDate.get(row.date)!, date: row.date, source: "shortcut", ...sample })) });
    }
  }

  return { dates, partialDate, workouts };
}

async function seedProgramsAndSessions(workouts: Awaited<ReturnType<typeof seedDailyHistory>>["workouts"], qaNow: Date) {
  const catalog = await prisma.exerciseCatalog.findMany({ where: { profileId: 1, isActive: true }, orderBy: { id: "asc" }, take: 10 });
  if (catalog.length < 6) throw new Error(`Expected at least six migration-seeded exercises, found ${catalog.length}`);

  const programConfigs = [
    { name: "Сила A — база", exercises: catalog.slice(0, 5) },
    { name: "Сила B — обсяг", exercises: catalog.slice(5, 10) },
  ];
  const programs = [];
  for (const [programIndex, config] of programConfigs.entries()) {
    const program = await prisma.trainingProgram.create({ data: { profileId: 1, name: config.name } });
    const version = await prisma.trainingProgramVersion.create({
      data: {
        programId: program.id, versionNumber: 1,
        exercises: { create: config.exercises.map((exercise, index) => ({
          exerciseCatalogId: exercise.id, sortOrder: index, plannedSets: index === 0 ? 4 : 3,
          resistanceType: index % 4 === 3 ? "BODYWEIGHT" : index % 4 === 2 ? "RESISTANCE_BAND" : "EXTERNAL_WEIGHT",
        })) },
      },
      include: { exercises: { orderBy: { sortOrder: "asc" } } },
    });
    await prisma.trainingProgram.update({ where: { id: program.id }, data: { currentVersionId: version.id } });
    programs.push({ ...program, version, config: programConfigs[programIndex]! });
  }

  await prisma.stepperEquipmentAssignment.create({
    data: { profileId: 1, machineFamily: "DOMYOS_MS100", configuration: "fixed", effectiveFrom: new Date("2026-06-30T00:00:00.000Z") },
  });

  const strengthWorkouts = workouts.filter((workout) => workout.type === "Traditional Strength Training").slice(-12);
  let completedSessionCount = 0;
  for (const [sessionIndex, workout] of strengthWorkouts.entries()) {
    const program = programs[sessionIndex % programs.length]!;
    const exercises = program.version.exercises;
    const session = await prisma.strengthDiarySession.create({
      data: {
        profileId: 1, programId: program.id, programVersionId: program.version.id,
        status: "COMPLETED", entryMode: "RETROSPECTIVE", matchStatus: "MATCHED",
        matchMethod: "DIRECT_BACKFILL", matchedAt: qaNow, matchedWorkoutId: workout.id,
        exercises: { create: exercises.map((exercise, exerciseIndex) => {
          const catalogRow = program.config.exercises[exerciseIndex]!;
          const isBodyweight = exercise.resistanceType === "BODYWEIGHT";
          return {
            sourceExerciseCatalogId: exercise.exerciseCatalogId, snapshotExerciseName: catalogRow.name,
            sortOrder: exercise.sortOrder, plannedSets: exercise.plannedSets,
            resistanceType: exercise.resistanceType, origin: "PLANNED",
            sets: { create: Array.from({ length: exercise.plannedSets }, (_, setIndex) => ({
              setNumber: setIndex + 1, reps: 8 + ((sessionIndex + exerciseIndex + setIndex) % 5),
              weightKg: isBodyweight ? null : 20 + exerciseIndex * 7.5 + sessionIndex * 0.5,
              bandNominalResistanceKg: exercise.resistanceType === "RESISTANCE_BAND" ? 18 + exerciseIndex * 2 : null,
              rir: [3, 2, 2, 1][setIndex] ?? 2,
              completedAt: new Date(workout.endAt.getTime() - (exercise.plannedSets - setIndex) * 60_000),
              comment: setIndex === 0 && exerciseIndex === 0 ? "QA preview set" : null,
            })) },
          };
        }) },
      },
    });
    void session;
    completedSessionCount += 1;
  }

  const activeProgram = programs[0]!;
  // The training API uses the real server clock for its 30-minute idle timeout.
  const activeNow = new Date();
  const activeWorkoutStart = new Date(activeNow.getTime() - 20 * 60_000);
  await prisma.strengthDiarySession.create({
    data: {
      profileId: 1, programId: activeProgram.id, programVersionId: activeProgram.version.id,
      status: "ACTIVE", entryMode: "LIVE", matchStatus: "PENDING", matchMethod: null,
      webStartedAt: activeWorkoutStart,
      exercises: { create: activeProgram.version.exercises.slice(0, 3).map((exercise, exerciseIndex) => ({
        sourceExerciseCatalogId: exercise.exerciseCatalogId,
        snapshotExerciseName: activeProgram.config.exercises[exerciseIndex]!.name,
        sortOrder: exercise.sortOrder, plannedSets: exercise.plannedSets,
        resistanceType: exercise.resistanceType, origin: "PLANNED",
        sets: { create: exerciseIndex === 0 ? [
          { setNumber: 1, reps: 10, weightKg: 35, rir: 3, completedAt: new Date(activeNow.getTime() - 9 * 60_000) },
          { setNumber: 2, reps: 9, weightKg: 35, rir: 2, completedAt: new Date(activeNow.getTime() - 2 * 60_000) },
        ] : [] },
      })) },
    },
  });

  return { programs: programs.length, completedSessionCount };
}

async function main() {
  const databaseUrl = assertSafeConnectionUrl();
  await verifyDatabaseIdentity();
  const qaNow = new Date(process.env.BODYCAST_QA_NOW ?? "2026-09-28T10:00:00.000Z");
  if (!Number.isFinite(qaNow.getTime())) throw new Error("BODYCAST_QA_NOW must be a valid date");
  const finalDate = latestCompletedLocalDate(qaNow, TIME_ZONE);
  const historyStart = addCalendarDays(finalDate, -119);
  const episodeStart = addCalendarDays(finalDate, -59);

  // Check the connection one final time immediately before the database reset.
  if (databaseUrl.hostname !== DATABASE_HOST || databaseUrl.port !== DATABASE_PORT || databaseUrl.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("QA database URL changed before reset; refusing to seed");
  }
  await clearIsolatedQaDatabase();
  await prisma.profile.create({
    data: {
      id: 1, locale: "uk", sex: "male", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
      heightCm: 180, targetWeightKg: 78, targetDate: new Date("2027-03-01T00:00:00.000Z"),
      autoAdvanceExercises: true,
    },
  });

  const seeded = await seedDailyHistory(historyStart, finalDate, qaNow);
  const training = await seedProgramsAndSessions(seeded.workouts, qaNow);
  const episode = await initializeNewModelEpisode({ startDate: episodeStart, timezone: TIME_ZONE, now: qaNow }, prisma);
  const calculation = await recalculateModelEpisode({ episodeId: episode.id, now: qaNow }, prisma);
  await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: 1, fromDate: historyStart, toDate: seeded.partialDate });
  const v7Rebuild = await rebuildAndPersistPhysiologyForProfileRangeV7({
    profileId: 1, fromDate: historyStart, toDate: seeded.partialDate,
    historyFromDate: historyStart, timeZone: TIME_ZONE,
  });

  const [dailyCount, workoutCount, hrCount, rhrCount, sleepCount, workCount, snapshotCount, intervalCount, stateCount, unifiedCount, v7SnapshotCount] = await Promise.all([
    prisma.dailyHealthData.count(), prisma.workout.count(), prisma.heartRateSample.count(), prisma.restingHeartRateSample.count(),
    prisma.sleepSegment.count(), prisma.workInterval.count(), prisma.healthSyncSnapshot.count(), prisma.healthActivityInterval.count(),
    prisma.dailyModelState.count({ where: { episodeId: episode.id } }), prisma.unifiedExperimentalPhysiologyState.count({ where: { profileId: 1 } }),
    prisma.physiologyV7DailyResult.count({ where: { profileId: 1 } }),
  ]);
  const workoutTypes = await prisma.workout.groupBy({ by: ["type"], _count: { _all: true }, orderBy: { type: "asc" } });
  console.log(JSON.stringify({
    fixture: "bodycast-fullsite-preview-v1", database: DATABASE_NAME, host: DATABASE_HOST, port: Number(DATABASE_PORT),
    qaNow: qaNow.toISOString(), historyStart, finalDate, partialDate: seeded.partialDate,
    sourceDays: seeded.dates.length, episodeId: episode.id, episodeStart,
    model: { status: calculation.status, daysPersisted: calculation.daysPersisted, latestModeledDate: calculation.latestModeledDate },
    unifiedStateRows: unifiedCount, v7SnapshotRows: v7SnapshotCount, v7RebuiltDays: v7Rebuild.persistedDayCount,
    profileCount: await prisma.profile.count(), dailyHealthRows: dailyCount,
    workoutRows: workoutCount, workoutsByType: workoutTypes.map((row) => ({ type: row.type, count: row._count._all })),
    heartRateSamples: hrCount, restingHeartRateSamples: rhrCount, sleepSegments: sleepCount,
    workIntervals: workCount, healthSyncSnapshots: snapshotCount, stepperActivityIntervals: intervalCount,
    trainingPrograms: training.programs, completedMatchedSessions: training.completedSessionCount,
    activeSessionCount: await prisma.strengthDiarySession.count({ where: { status: "ACTIVE" } }),
    persistedModelDays: stateCount,
    missingStates: { bodyFat: "weekly only", calories: "isolated gaps before model calibration", macros: "isolated shared gaps before model calibration", steps: "isolated gaps before model calibration", today: "partial, no fabricated activity energy or workout feed" },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
