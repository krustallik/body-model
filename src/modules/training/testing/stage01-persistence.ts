import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createTrainingHistoryStage01FixtureV1,
  STAGE01_PROGRAM_EXERCISE_ID_BASE,
  TRAINING_HISTORY_STAGE01_NAMESPACE_V1,
  type Stage01ExerciseFixture,
} from "../../../../tests/fixtures/training-history-stage01/fixture-v1";

const PROGRAM_ID_BASE = 972_001;
const FIXTURE_MARKER = TRAINING_HISTORY_STAGE01_NAMESPACE_V1;

async function resolveCanonicalCatalogIdMap(
  tx: Prisma.TransactionClient,
  fixture: ReturnType<typeof createTrainingHistoryStage01FixtureV1>,
) {
  const expectedCanonical = fixture.catalogExercises.filter((row) => row.kind === "canonical");
  const canonicalRows = await tx.exerciseCatalog.findMany({
    where: { profileId: 1, stableKey: { in: expectedCanonical.map((row) => row.stableKey!) } },
    select: { id: true, stableKey: true, name: true },
  });
  const canonicalByKey = new Map(canonicalRows.map((row) => [row.stableKey, row]));
  if (canonicalRows.length !== expectedCanonical.length) throw new Error("Stage 01 requires the full migration-seeded canonical exercise catalog.");
  const catalogIdMap = new Map<number, number>();
  for (const expected of expectedCanonical) {
    const actual = canonicalByKey.get(expected.stableKey);
    if (!actual || actual.name !== expected.name) throw new Error("Stage 01 canonical catalog does not match its versioned registry identity.");
    catalogIdMap.set(expected.id, actual.id);
  }
  return catalogIdMap;
}

function fixtureProgramExerciseId(programId: number, versionNumber: number, index: number): number {
  const slot = programId - PROGRAM_ID_BASE;
  return STAGE01_PROGRAM_EXERCISE_ID_BASE + slot * 10_000 + versionNumber * 100 + index + 1;
}

function programExerciseIds(fixture: ReturnType<typeof createTrainingHistoryStage01FixtureV1>) {
  return fixture.programVersions.flatMap((version) => version.plannedExercises.map((_, index) =>
    fixtureProgramExerciseId(version.programId, version.versionNumber, index),
  ));
}

function programExerciseRows(
  fixture: ReturnType<typeof createTrainingHistoryStage01FixtureV1>,
  catalogIdMap: ReadonlyMap<number, number>,
) {
  return fixture.programVersions.flatMap((version) => version.plannedExercises.map((exercise, index) => ({
    id: fixtureProgramExerciseId(version.programId, version.versionNumber, index),
    programVersionId: version.id,
    exerciseCatalogId: catalogIdMap.get(exercise.exerciseCatalogId) ?? (() => { throw new Error("Stage 01 catalog identity could not be resolved."); })(),
    sortOrder: exercise.sortOrder,
    plannedSets: exercise.plannedSets,
    resistanceType: exercise.resistanceType,
    createdAt: new Date(version.createdAt),
    updatedAt: new Date(version.createdAt),
  })));
}

function fixtureSessionExerciseRows(exercises: Stage01ExerciseFixture[], sessionId: number, catalogIdMap: ReadonlyMap<number, number>) {
  return exercises.map((exercise) => ({
    id: exercise.id,
    sessionId,
    sourceExerciseCatalogId: catalogIdMap.get(exercise.sourceExerciseCatalogId) ?? (() => { throw new Error("Stage 01 session catalog identity could not be resolved."); })(),
    snapshotExerciseName: exercise.snapshotExerciseName,
    sortOrder: exercise.sortOrder,
    plannedSets: exercise.plannedSets,
    resistanceType: exercise.resistanceType,
    origin: exercise.origin,
    muscleMappingSnapshot: exercise.muscleMappingSnapshot as Prisma.InputJsonValue,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
}

async function cleanupWithinTransaction(tx: Prisma.TransactionClient) {
  const fixture = createTrainingHistoryStage01FixtureV1();
  const sessionIds = fixture.sessions.map((row) => row.id);
  const sessionExerciseIds = fixture.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.id));
  const setIds = fixture.sessions.flatMap((session) => session.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id)));
  const programVersionIds = fixture.programVersions.map((row) => row.id);
  const programExerciseIdList = programExerciseIds(fixture);
  const programIds = fixture.programs.map((row) => row.id);
  const ownedCatalogs = fixture.catalogExercises.filter((row) => row.fixtureOwned);
  const catalogIds = ownedCatalogs.map((row) => row.id);
  const workoutIds = fixture.workouts.map((row) => row.id);
  const profileIds = fixture.profiles.map((row) => row.id);
  const canonicalCatalogIdMap = await resolveCanonicalCatalogIdMap(tx, fixture);
  const canonicalCatalogIds = [...canonicalCatalogIdMap.values()];

  const foundWorkouts = await tx.workout.findMany({ where: { id: { in: workoutIds } }, select: { id: true, sourceIdentity: true } });
  const expectedSource = new Map(fixture.workouts.map((row) => [row.id, row.sourceIdentity]));
  for (const row of foundWorkouts) {
    if (row.sourceIdentity !== expectedSource.get(row.id)) throw new Error("Stage 01 cleanup refused an unexpected Workout ID collision.");
  }
  const foundCatalog = await tx.exerciseCatalog.findMany({ where: { id: { in: catalogIds } }, select: { id: true, profileId: true, name: true } });
  const expectedCatalog = new Map(ownedCatalogs.map((row) => [row.id, `${row.profileId}|${row.name}`]));
  for (const row of foundCatalog) {
    if (`${row.profileId}|${row.name}` !== expectedCatalog.get(row.id)) throw new Error("Stage 01 cleanup refused an unexpected catalog ID collision.");
  }
  const foundProfiles = await tx.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, sex: true, dateOfBirth: true, heightCm: true, locale: true } });
  for (const row of foundProfiles) {
    const dateOfBirth = row.dateOfBirth.toISOString().slice(0, 10);
    if (row.sex !== "male" || dateOfBirth !== "1900-01-01" || Number(row.heightCm) !== 1 || row.locale !== "en") {
      throw new Error("Stage 01 cleanup refused an unexpected Profile ID collision.");
    }
  }

  const deletedSets = await tx.strengthSet.deleteMany({ where: { id: { in: setIds } } });
  const deletedExercises = await tx.strengthSessionExercise.deleteMany({ where: { id: { in: sessionExerciseIds }, sessionId: { in: sessionIds } } });
  const deletedChanges = await tx.strengthDiaryProgramChange.deleteMany({ where: { id: { in: fixture.programChanges.map((row) => row.id) }, sessionId: { in: sessionIds } } });
  const deletedSessions = await tx.strengthDiarySession.deleteMany({ where: { id: { in: sessionIds }, profileId: { in: profileIds } } });
  await tx.trainingProgram.updateMany({ where: { id: { in: programIds }, profileId: { in: profileIds } }, data: { currentVersionId: null } });
  const deletedProgramExercises = await tx.programExercise.deleteMany({ where: { id: { in: programExerciseIdList } } });
  const deletedVersions = await tx.trainingProgramVersion.deleteMany({ where: { id: { in: programVersionIds }, programId: { in: programIds } } });
  const deletedPrograms = await tx.trainingProgram.deleteMany({ where: { id: { in: programIds }, profileId: { in: profileIds } } });
  const deletedWorkouts = await tx.workout.deleteMany({ where: { id: { in: workoutIds }, sourceIdentity: { in: fixture.workouts.map((row) => row.sourceIdentity) } } });
  const deletedCatalog = await tx.exerciseCatalog.deleteMany({ where: { id: { in: catalogIds }, profileId: { in: profileIds } } });

  let deletedDailyHealthRows = 0;
  for (const fixtureDay of fixture.dailyHealthRows) {
    const day = await tx.dailyHealthData.findUnique({ where: { id: fixtureDay.id } });
    if (!day) continue;
    if (day.date !== fixtureDay.date || typeof day.rawPayload !== "object" || day.rawPayload === null || Array.isArray(day.rawPayload)
      || day.rawPayload.fixtureNamespace !== FIXTURE_MARKER) {
      throw new Error("Stage 01 cleanup refused an unexpected DailyHealthData ID collision.");
    }
    const [workouts, heartRates, restingHeartRates, syncSnapshots, metricSamples] = await Promise.all([
      tx.workout.count({ where: { dailyHealthDataId: day.id } }),
      tx.heartRateSample.count({ where: { dailyHealthDataId: day.id } }),
      tx.restingHeartRateSample.count({ where: { dailyHealthDataId: day.id } }),
      tx.healthSyncSnapshot.count({ where: { dailyHealthDataId: day.id } }),
      tx.healthMetricSample.count({ where: { dailyHealthDataId: day.id } }),
    ]);
    if (workouts + heartRates + restingHeartRates + syncSnapshots + metricSamples === 0) {
      const deleted = await tx.dailyHealthData.deleteMany({ where: { id: day.id, date: fixtureDay.date } });
      deletedDailyHealthRows += deleted.count;
    }
  }

  let deletedProfiles = 0;
  for (const profile of foundProfiles) {
    const [diarySessions, equipmentAssignments, modelEpisodes, catalogs] = await Promise.all([
      tx.strengthDiarySession.count({ where: { profileId: profile.id } }),
      tx.stepperEquipmentAssignment.count({ where: { profileId: profile.id } }),
      tx.modelEpisode.count({ where: { profileId: profile.id } }),
      tx.exerciseCatalog.count({ where: { profileId: profile.id, id: { notIn: canonicalCatalogIds } } }),
    ]);
    if (diarySessions + equipmentAssignments + modelEpisodes + catalogs === 0) {
      const deleted = await tx.profile.deleteMany({ where: { id: profile.id, sex: "male", locale: "en" } });
      deletedProfiles += deleted.count;
    }
  }

  return {
    deletedSets: deletedSets.count,
    deletedExercises: deletedExercises.count,
    deletedProgramChanges: deletedChanges.count,
    deletedSessions: deletedSessions.count,
    deletedProgramExercises: deletedProgramExercises.count,
    deletedProgramVersions: deletedVersions.count,
    deletedPrograms: deletedPrograms.count,
    deletedWorkouts: deletedWorkouts.count,
    deletedCatalog: deletedCatalog.count,
    deletedDailyHealthRows,
    deletedProfiles,
  };
}

export async function cleanupStage01Namespace(prisma: PrismaClient) {
  return prisma.$transaction((tx) => cleanupWithinTransaction(tx));
}

export async function seedStage01Namespace(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    await cleanupWithinTransaction(tx);
    const fixture = createTrainingHistoryStage01FixtureV1();
    const ownedCatalogs = fixture.catalogExercises.filter((row) => row.fixtureOwned);

    const dateConflicts = await tx.dailyHealthData.findMany({ where: { date: { in: fixture.dailyHealthRows.map((row) => row.date) } }, select: { date: true } });
    if (dateConflicts.length > 0) throw new Error("Stage 01 fixture dates collide with non-fixture DailyHealthData rows.");

    const catalogIdMap = await resolveCanonicalCatalogIdMap(tx, fixture);

    await tx.profile.createMany({ data: fixture.profiles.map((profile) => ({
      id: profile.id,
      sex: profile.sex,
      dateOfBirth: new Date(`${profile.dateOfBirth}T00:00:00.000Z`),
      heightCm: profile.heightCm,
      locale: profile.locale,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    })), skipDuplicates: true });
    await tx.exerciseCatalog.createMany({ data: ownedCatalogs.map((exercise) => ({
      id: exercise.id,
      profileId: exercise.profileId,
      name: exercise.name,
      stableKey: exercise.stableKey,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    })) });
    for (const custom of ownedCatalogs) catalogIdMap.set(custom.id, custom.id);
    await tx.trainingProgram.createMany({ data: fixture.programs.map((program) => ({
      id: program.id,
      profileId: program.profileId,
      name: program.name,
      currentVersionId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    })) });
    await tx.trainingProgramVersion.createMany({ data: fixture.programVersions.map((version) => ({
      id: version.id,
      programId: version.programId,
      versionNumber: version.versionNumber,
      createdAt: new Date(version.createdAt),
    })) });
    const plannedRows = programExerciseRows(fixture, catalogIdMap);
    if (plannedRows.length > 0) await tx.programExercise.createMany({ data: plannedRows });
    for (const program of fixture.programs) {
      await tx.trainingProgram.update({ where: { id: program.id }, data: { currentVersionId: program.currentVersionId } });
    }
    await tx.dailyHealthData.createMany({ data: fixture.dailyHealthRows.map((row) => ({
      id: row.id,
      date: row.date,
      weightKg: row.weightKg,
      steps: row.steps,
      workoutFeedObserved: row.workoutFeedObserved,
      rawPayload: row.rawPayload as Prisma.InputJsonValue,
      createdAt: new Date(`${row.date}T00:00:00.000Z`),
      updatedAt: new Date(`${row.date}T00:00:00.000Z`),
    })) });
    await tx.workout.createMany({ data: fixture.workouts.map((workout) => ({
      id: workout.id,
      dailyHealthDataId: workout.dailyHealthDataId,
      externalId: workout.externalId,
      sourceIdentity: workout.sourceIdentity,
      type: workout.type,
      startAt: new Date(workout.startAt),
      endAt: new Date(workout.endAt),
      durationMinutes: workout.durationMinutes,
      energyKcal: workout.energyKcal,
      activeEnergyKcal: workout.activeEnergyKcal,
      syncProtected: workout.syncProtected,
      hiddenFromHistory: workout.hiddenFromHistory,
      manualStepCount: workout.manualStepCount,
      manualActiveEnergyKcal: workout.manualActiveEnergyKcal,
      createdAt: new Date(workout.startAt),
      updatedAt: new Date(workout.startAt),
    })) });
    await tx.strengthDiarySession.createMany({ data: fixture.sessions.map((session) => ({
      id: session.id,
      profileId: session.profileId,
      programId: session.programId,
      programVersionId: session.programVersionId,
      status: session.status,
      entryMode: session.entryMode,
      webStartedAt: session.webStartedAt ? new Date(session.webStartedAt) : null,
      webEndedAt: session.webEndedAt ? new Date(session.webEndedAt) : null,
      revision: session.revision,
      matchedWorkoutId: session.matchedWorkoutId,
      matchStatus: session.matchStatus,
      matchMethod: session.matchMethod,
      matchedAt: session.matchedAt ? new Date(session.matchedAt) : null,
      createdAt: new Date(`${session.date}T00:00:00.000Z`),
      updatedAt: new Date(`${session.date}T00:00:00.000Z`),
    })) });
    await tx.strengthDiaryProgramChange.createMany({ data: fixture.programChanges.map((change) => ({
      ...change,
      createdAt: new Date(change.createdAt),
    })) });
    const exerciseRows = fixture.sessions.flatMap((session) => fixtureSessionExerciseRows(session.exercises, session.id, catalogIdMap));
    if (exerciseRows.length > 0) await tx.strengthSessionExercise.createMany({ data: exerciseRows });
    const setRows = fixture.sessions.flatMap((session) => session.exercises.flatMap((exercise) => exercise.sets.map((set) => ({
      id: set.id,
      sessionExerciseId: exercise.id,
      setNumber: set.setNumber,
      reps: set.reps,
      weightKg: set.weightKg,
      bandNominalResistanceKg: set.bandNominalResistanceKg,
      rir: set.rir,
      comment: set.comment,
      completedAt: set.completedAt ? new Date(set.completedAt) : null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }))));
    if (setRows.length > 0) await tx.strengthSet.createMany({ data: setRows });

    return {
      namespace: FIXTURE_MARKER,
      profiles: fixture.profiles.length,
      catalogExercises: fixture.catalogExercises.length,
      programs: fixture.programs.length,
      programVersions: fixture.programVersions.length,
      programExercises: plannedRows.length,
      sessions: fixture.sessions.length,
      sessionExercises: exerciseRows.length,
      sets: setRows.length,
      programChanges: fixture.programChanges.length,
      workouts: fixture.workouts.length,
      dailyHealthRows: fixture.dailyHealthRows.length,
    };
  }, { timeout: 30_000 });
}
