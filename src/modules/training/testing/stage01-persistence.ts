import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createTrainingHistoryStage01FixtureV1,
  TRAINING_HISTORY_STAGE01_CREATED_AT,
  STAGE01_PROGRAM_EXERCISE_ID_BASE,
  TRAINING_HISTORY_STAGE01_NAMESPACE_V1,
  type Stage01ExerciseFixture,
} from "../../../../tests/fixtures/training-history-stage01/fixture-v1";

const PROGRAM_ID_BASE = 972_001;
const FIXTURE_MARKER = TRAINING_HISTORY_STAGE01_NAMESPACE_V1;

async function fixtureCatalogIdMap(tx: Prisma.TransactionClient, fixture: ReturnType<typeof createTrainingHistoryStage01FixtureV1>) {
  const canonical = fixture.catalogExercises.filter((row) => row.kind === "canonical");
  const canonicalRows = await tx.exerciseCatalog.findMany({
    where: { profileId: fixture.profiles[0]!.id, stableKey: { in: canonical.map((row) => row.stableKey!) } },
    select: { id: true, stableKey: true, name: true },
  });
  const canonicalByKey = new Map(canonicalRows.map((row) => [row.stableKey, row]));
  if (canonicalRows.length !== canonical.length) throw new Error("Stage 01 requires the migration-seeded canonical exercise catalog.");
  const catalogIdMap = new Map<number, number>();
  for (const expected of canonical) {
    const actual = canonicalByKey.get(expected.stableKey);
    if (!actual || actual.name !== expected.name) throw new Error("Stage 01 canonical catalog does not match its registry identity.");
    catalogIdMap.set(expected.id, actual.id);
  }
  for (const custom of fixture.catalogExercises.filter((row) => row.fixtureOwned)) catalogIdMap.set(custom.id, custom.id);
  return catalogIdMap;
}

function rowSignature(values: readonly unknown[]): string {
  return JSON.stringify(values);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function assertFixtureOwnedRows<Actual extends { id: number }, Expected extends { id: number }>(
  table: string,
  actualRows: readonly Actual[],
  expectedRows: readonly Expected[],
  actualSignature: (row: Actual) => string,
  expectedSignature: (row: Expected) => string,
): void {
  const expectedById = new Map(expectedRows.map((row) => [row.id, expectedSignature(row)]));
  for (const row of actualRows) {
    if (expectedById.get(row.id) !== actualSignature(row)) {
      throw new Error(`Stage 01 cleanup refused an unexpected ${table} ID or parent collision.`);
    }
  }
}

function fixtureProgramExerciseId(programId: number, versionNumber: number, index: number): number {
  const slot = programId - PROGRAM_ID_BASE;
  return STAGE01_PROGRAM_EXERCISE_ID_BASE + slot * 10_000 + versionNumber * 100 + index + 1;
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

function fixtureSetRows(fixture: ReturnType<typeof createTrainingHistoryStage01FixtureV1>) {
  return fixture.sessions.flatMap((session) => session.exercises.flatMap((exercise) => exercise.sets.map((set) => ({
    id: set.id,
    sessionExerciseId: exercise.id,
    setNumber: set.setNumber,
    reps: set.reps,
    weightKg: set.weightKg,
    bandNominalResistanceKg: set.bandNominalResistanceKg,
    rir: set.rir,
    comment: set.comment,
    completedAt: set.completedAt ? new Date(set.completedAt) : null,
    createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT),
    updatedAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT),
  }))));
}

function profileSignature(row: {
  id: number; sex: string; dateOfBirth: Date; heightCm: Prisma.Decimal; targetWeightKg: Prisma.Decimal | null;
  targetDate: Date | null; locale: string; autoAdvanceExercises: boolean; createdAt: Date; updatedAt: Date;
}): string {
  return rowSignature([
    row.id, row.sex, dateOnly(row.dateOfBirth), Number(row.heightCm), row.targetWeightKg === null ? null : Number(row.targetWeightKg),
    row.targetDate ? dateOnly(row.targetDate) : null, row.locale, row.autoAdvanceExercises, iso(row.createdAt), iso(row.updatedAt),
  ]);
}

function expectedProfileSignature(row: ReturnType<typeof createTrainingHistoryStage01FixtureV1>["profiles"][number]): string {
  return rowSignature([row.id, row.sex, row.dateOfBirth, Number(row.heightCm), null, null, row.locale, false, row.createdAt, row.createdAt]);
}

async function assertCleanupOwnership(tx: Prisma.TransactionClient, fixture: ReturnType<typeof createTrainingHistoryStage01FixtureV1>) {
  const sessionIds = fixture.sessions.map((row) => row.id);
  const sessionExerciseIds = fixture.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.id));
  const programVersionIds = fixture.programVersions.map((row) => row.id);
  const programIds = fixture.programs.map((row) => row.id);
  const ownedCatalogs = fixture.catalogExercises.filter((row) => row.fixtureOwned);
  const catalogIds = ownedCatalogs.map((row) => row.id);
  const workoutIds = fixture.workouts.map((row) => row.id);
  const dailyIds = fixture.dailyHealthRows.map((row) => row.id);
  const profileIds = fixture.profiles.map((row) => row.id);
  const catalogIdMap = await fixtureCatalogIdMap(tx, fixture);
  const plannedRows = programExerciseRows(fixture, catalogIdMap);
  const sessionExerciseRows = fixture.sessions.flatMap((session) => fixtureSessionExerciseRows(session.exercises, session.id, catalogIdMap));
  const setRows = fixtureSetRows(fixture);
  const sessionRows = fixture.sessions.map((session) => ({
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
  }));
  const programRows = fixture.programs.map((program) => ({
    ...program,
    archivedAt: null,
    createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT),
    updatedAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT),
  }));
  const programVersionRows = fixture.programVersions.map((version) => ({
    id: version.id,
    programId: version.programId,
    versionNumber: version.versionNumber,
    createdAt: new Date(version.createdAt),
  }));
  const changeRows = fixture.programChanges.map((change) => ({ ...change, createdAt: new Date(change.createdAt) }));
  const catalogRows = ownedCatalogs.map((exercise) => ({
    id: exercise.id,
    profileId: exercise.profileId,
    name: exercise.name,
    stableKey: exercise.stableKey,
    isActive: true,
    archivedAt: null,
    muscleMapping: null,
    createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT),
    updatedAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT),
  }));
  const workoutRows = fixture.workouts.map((workout) => ({
    ...workout,
    startAt: new Date(workout.startAt),
    endAt: new Date(workout.endAt),
    supersededByWorkoutId: null,
    supersededAt: null,
    supersessionReason: null,
    createdAt: new Date(workout.startAt),
    updatedAt: new Date(workout.startAt),
  }));
  const [profiles, catalogs, programs, versions, programExercises, sessions, changes, sessionExercises, sets, workouts, dailyHealth] = await Promise.all([
    tx.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, sex: true, dateOfBirth: true, heightCm: true, targetWeightKg: true, targetDate: true, locale: true, autoAdvanceExercises: true, createdAt: true, updatedAt: true } }),
    tx.exerciseCatalog.findMany({
      where: { id: { in: catalogIds } },
      select: { id: true, profileId: true, name: true, stableKey: true, isActive: true, archivedAt: true, muscleMapping: true, createdAt: true, updatedAt: true },
    }),
    tx.trainingProgram.findMany({
      where: { OR: [{ id: { in: programIds } }, { currentVersionId: { in: programVersionIds } }] },
      select: { id: true, profileId: true, name: true, archivedAt: true, currentVersionId: true, createdAt: true, updatedAt: true },
    }),
    tx.trainingProgramVersion.findMany({
      where: { OR: [{ id: { in: programVersionIds } }, { programId: { in: programIds } }] },
      select: { id: true, programId: true, versionNumber: true, createdAt: true },
    }),
    tx.programExercise.findMany({
      where: { OR: [{ id: { in: plannedRows.map((row) => row.id) } }, { programVersionId: { in: programVersionIds } }, { exerciseCatalogId: { in: catalogIds } }] },
      select: { id: true, programVersionId: true, exerciseCatalogId: true, sortOrder: true, plannedSets: true, resistanceType: true, createdAt: true, updatedAt: true },
    }),
    tx.strengthDiarySession.findMany({
      where: { OR: [{ id: { in: sessionIds } }, { programId: { in: programIds } }, { programVersionId: { in: programVersionIds } }, { matchedWorkoutId: { in: workoutIds } }] },
      select: { id: true, profileId: true, programId: true, programVersionId: true, status: true, entryMode: true, webStartedAt: true, webEndedAt: true, revision: true, matchedWorkoutId: true, matchStatus: true, matchMethod: true, matchedAt: true, createdAt: true, updatedAt: true },
    }),
    tx.strengthDiaryProgramChange.findMany({
      where: { OR: [{ id: { in: fixture.programChanges.map((row) => row.id) } }, { sessionId: { in: sessionIds } }, { fromProgramId: { in: programIds } }, { toProgramId: { in: programIds } }, { fromProgramVersionId: { in: programVersionIds } }, { toProgramVersionId: { in: programVersionIds } }] },
      select: { id: true, sessionId: true, fromProgramId: true, fromProgramVersionId: true, toProgramId: true, toProgramVersionId: true, createdAt: true },
    }),
    tx.strengthSessionExercise.findMany({
      where: { OR: [{ id: { in: sessionExerciseIds } }, { sessionId: { in: sessionIds } }, { sourceExerciseCatalogId: { in: catalogIds } }] },
      select: { id: true, sessionId: true, sourceExerciseCatalogId: true, snapshotExerciseName: true, sortOrder: true, plannedSets: true, resistanceType: true, origin: true, muscleMappingSnapshot: true, createdAt: true, updatedAt: true },
    }),
    tx.strengthSet.findMany({
      where: { OR: [{ id: { in: setRows.map((row) => row.id) } }, { sessionExerciseId: { in: sessionExerciseIds } }] },
      select: { id: true, sessionExerciseId: true, setNumber: true, reps: true, weightKg: true, bandNominalResistanceKg: true, rir: true, comment: true, completedAt: true, createdAt: true, updatedAt: true },
    }),
    tx.workout.findMany({ where: { OR: [{ id: { in: workoutIds } }, { supersededByWorkoutId: { in: workoutIds } }] }, select: { id: true, dailyHealthDataId: true, externalId: true, sourceIdentity: true, type: true, startAt: true, endAt: true, durationMinutes: true, energyKcal: true, activeEnergyKcal: true, syncProtected: true, hiddenFromHistory: true, manualStepCount: true, manualActiveEnergyKcal: true, supersededByWorkoutId: true, supersededAt: true, supersessionReason: true, createdAt: true, updatedAt: true } }),
    tx.dailyHealthData.findMany({ where: { id: { in: dailyIds } }, select: { id: true, date: true, weightKg: true, bodyFatPercent: true, caloriesKcal: true, proteinG: true, fatG: true, carbsG: true, steps: true, activeEnergyKcal: true, averageWalkingSpeedKmh: true, walkingDistanceKm: true, strengthTrainingMinutes: true, workoutFeedObserved: true, rawPayload: true, createdAt: true, updatedAt: true } }),
  ]);

  const profileCreatedFlags = dailyHealth.map((row) => {
    const payload = row.rawPayload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
    return payload.stage01ProfileCreated;
  });
  if (profileCreatedFlags.some((flag) => typeof flag !== "boolean") || new Set(profileCreatedFlags).size > 1) {
    if (dailyHealth.length > 0) throw new Error("Stage 01 cleanup refused an invalid Profile ownership marker collision.");
  }
  const profileCreatedByFixture = profileCreatedFlags[0] === true;
  let canDeleteProfile = true;
  if (profileCreatedByFixture) {
    assertFixtureOwnedRows("Profile", profiles, fixture.profiles,
      (row) => profileSignature(row),
      (row) => expectedProfileSignature(row),
    );
  }
  assertFixtureOwnedRows("ExerciseCatalog", catalogs, catalogRows,
    (row) => rowSignature([row.id, row.profileId, row.name, row.stableKey, row.isActive, row.archivedAt, stableJson(row.muscleMapping), iso(row.createdAt), iso(row.updatedAt)]),
    (row) => rowSignature([row.id, row.profileId, row.name, row.stableKey, row.isActive, row.archivedAt, stableJson(row.muscleMapping), iso(row.createdAt), iso(row.updatedAt)]),
  );
  assertFixtureOwnedRows("TrainingProgram", programs, programRows,
    (row) => rowSignature([row.id, row.profileId, row.name, row.archivedAt, row.currentVersionId, iso(row.createdAt), iso(row.updatedAt)]),
    (row) => rowSignature([row.id, row.profileId, row.name, row.archivedAt, row.currentVersionId, iso(row.createdAt), iso(row.updatedAt)]),
  );
  assertFixtureOwnedRows("TrainingProgramVersion", versions, programVersionRows,
    (row) => rowSignature([row.id, row.programId, row.versionNumber, iso(row.createdAt)]),
    (row) => rowSignature([row.id, row.programId, row.versionNumber, iso(row.createdAt)]),
  );
  assertFixtureOwnedRows("ProgramExercise", programExercises, plannedRows,
    (row) => rowSignature([row.id, row.programVersionId, row.exerciseCatalogId, row.sortOrder, row.plannedSets, row.resistanceType, iso(row.createdAt), iso(row.updatedAt)]),
    (row) => rowSignature([row.id, row.programVersionId, row.exerciseCatalogId, row.sortOrder, row.plannedSets, row.resistanceType, iso(row.createdAt), iso(row.updatedAt)]),
  );
  assertFixtureOwnedRows("StrengthDiarySession", sessions, sessionRows,
    (row) => rowSignature([row.id, row.profileId, row.programId, row.programVersionId, row.status, row.entryMode, iso(row.webStartedAt), iso(row.webEndedAt), row.revision, row.matchedWorkoutId, row.matchStatus, row.matchMethod, iso(row.matchedAt), iso(row.createdAt), iso(row.updatedAt)]),
    (row) => rowSignature([row.id, row.profileId, row.programId, row.programVersionId, row.status, row.entryMode, iso(row.webStartedAt), iso(row.webEndedAt), row.revision, row.matchedWorkoutId, row.matchStatus, row.matchMethod, iso(row.matchedAt), iso(row.createdAt), iso(row.updatedAt)]),
  );
  assertFixtureOwnedRows("StrengthDiaryProgramChange", changes, changeRows,
    (row) => rowSignature([row.id, row.sessionId, row.fromProgramId, row.fromProgramVersionId, row.toProgramId, row.toProgramVersionId, iso(row.createdAt)]),
    (row) => rowSignature([row.id, row.sessionId, row.fromProgramId, row.fromProgramVersionId, row.toProgramId, row.toProgramVersionId, iso(row.createdAt)]),
  );
  assertFixtureOwnedRows("StrengthSessionExercise", sessionExercises, sessionExerciseRows,
    (row) => rowSignature([row.id, row.sessionId, row.sourceExerciseCatalogId, row.snapshotExerciseName, row.sortOrder, row.plannedSets, row.resistanceType, row.origin, stableJson(row.muscleMappingSnapshot), iso(row.createdAt), iso(row.updatedAt)]),
    (row) => rowSignature([row.id, row.sessionId, row.sourceExerciseCatalogId, row.snapshotExerciseName, row.sortOrder, row.plannedSets, row.resistanceType, row.origin, stableJson(row.muscleMappingSnapshot), iso(row.createdAt), iso(row.updatedAt)]),
  );
  assertFixtureOwnedRows("StrengthSet", sets, setRows,
    (row) => rowSignature([row.id, row.sessionExerciseId, row.setNumber, row.reps, row.weightKg === null ? null : Number(row.weightKg), row.bandNominalResistanceKg === null ? null : Number(row.bandNominalResistanceKg), row.rir, row.comment, iso(row.completedAt), iso(row.createdAt), iso(row.updatedAt)]),
    (row) => rowSignature([row.id, row.sessionExerciseId, row.setNumber, row.reps, row.weightKg, row.bandNominalResistanceKg, row.rir, row.comment, iso(row.completedAt), iso(row.createdAt), iso(row.updatedAt)]),
  );
  assertFixtureOwnedRows("Workout", workouts, workoutRows,
    (row) => rowSignature([row.id, row.dailyHealthDataId, row.externalId, row.sourceIdentity, row.type, iso(row.startAt), iso(row.endAt), row.durationMinutes, row.energyKcal, row.activeEnergyKcal, row.syncProtected, row.hiddenFromHistory, row.manualStepCount, row.manualActiveEnergyKcal, row.supersededByWorkoutId, iso(row.supersededAt), row.supersessionReason, iso(row.createdAt), iso(row.updatedAt)]),
    (row) => rowSignature([row.id, row.dailyHealthDataId, row.externalId, row.sourceIdentity, row.type, iso(row.startAt), iso(row.endAt), row.durationMinutes, row.energyKcal, row.activeEnergyKcal, row.syncProtected, row.hiddenFromHistory, row.manualStepCount, row.manualActiveEnergyKcal, row.supersededByWorkoutId, iso(row.supersededAt), row.supersessionReason, iso(row.createdAt), iso(row.updatedAt)]),
  );
  const dailyRows = fixture.dailyHealthRows.map((row) => ({
    ...row,
    bodyFatPercent: null,
    caloriesKcal: null,
    proteinG: null,
    fatG: null,
    carbsG: null,
    activeEnergyKcal: null,
    averageWalkingSpeedKmh: null,
    walkingDistanceKm: null,
    strengthTrainingMinutes: null,
    rawPayload: { ...row.rawPayload, stage01ProfileCreated: profileCreatedByFixture },
    createdAt: new Date(`${row.date}T00:00:00.000Z`),
    updatedAt: new Date(`${row.date}T00:00:00.000Z`),
  }));
  assertFixtureOwnedRows("DailyHealthData", dailyHealth, dailyRows,
    (row) => rowSignature([row.id, row.date, row.weightKg, row.bodyFatPercent?.toString() ?? null, row.caloriesKcal, row.proteinG, row.fatG, row.carbsG, row.steps, row.activeEnergyKcal, row.averageWalkingSpeedKmh?.toString() ?? null, row.walkingDistanceKm?.toString() ?? null, row.strengthTrainingMinutes?.toString() ?? null, row.workoutFeedObserved, stableJson(row.rawPayload), iso(row.createdAt), iso(row.updatedAt)]),
    (row) => rowSignature([row.id, row.date, row.weightKg, row.bodyFatPercent, row.caloriesKcal, row.proteinG, row.fatG, row.carbsG, row.steps, row.activeEnergyKcal, row.averageWalkingSpeedKmh, row.walkingDistanceKm, row.strengthTrainingMinutes, row.workoutFeedObserved, stableJson(row.rawPayload), iso(row.createdAt), iso(row.updatedAt)]),
  );

  const stageOwnedRows = catalogs.length + programs.length + versions.length + programExercises.length + sessions.length + changes.length + sessionExercises.length + sets.length + workouts.length;
  if (stageOwnedRows > 0 && dailyHealth.length === 0) {
    throw new Error("Stage 01 cleanup refused unmarked fixture rows with colliding IDs.");
  }
  if (dailyHealth.length > 0 && profiles.length === 0) {
    throw new Error("Stage 01 cleanup refused a fixture marker whose Profile is missing.");
  }
  const [energyShadows, glycogenShadows, waterShadows, stepperEnergyShadows, stepperGlycogenShadows, reconciliationGroups, reconciliationCandidates] = await Promise.all([
    tx.experimentalStrengthEnergyShadow.count({ where: { sessionId: { in: sessionIds } } }),
    tx.experimentalStrengthGlycogenDemandShadow.count({ where: { sessionId: { in: sessionIds } } }),
    tx.experimentalTransientExerciseWaterShadow.count({ where: { sessionId: { in: sessionIds } } }),
    tx.experimentalStepperActiveEnergyShadow.count({ where: { workoutId: { in: workoutIds } } }),
    tx.experimentalStepperGlycogenDemandShadow.count({ where: { workoutId: { in: workoutIds } } }),
    tx.stepperReconciliationGroup.count({ where: { provisionalWorkoutId: { in: workoutIds } } }),
    tx.stepperReconciliationCandidate.count({ where: { OR: [{ manualWorkoutId: { in: workoutIds } }, { garminWorkoutId: { in: workoutIds } }] } }),
  ]);
  if (energyShadows + glycogenShadows + waterShadows + stepperEnergyShadows + stepperGlycogenShadows + reconciliationGroups + reconciliationCandidates > 0) {
    throw new Error("Stage 01 cleanup refused to cascade into an unrelated session or workout record.");
  }
  if (profileCreatedByFixture) {
    const canonicalCatalogIds = [...catalogIdMap.entries()]
      .filter(([fixtureId]) => !catalogIds.includes(fixtureId))
      .map(([, actualId]) => actualId);
    const profileTables = await tx.$queryRaw<Array<{ tableName: string }>>`
      SELECT table_name AS "tableName"
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name = 'profileId'
    `;
    const excludedIdsByTable = new Map<string, number[]>([
      ["StrengthDiarySession", sessionIds],
      ["TrainingProgram", programIds],
      ["ExerciseCatalog", [...catalogIds, ...canonicalCatalogIds]],
    ]);
    const profileReferenceQueries = profileTables.map(({ tableName }) => {
      const quotedTableName = `"${tableName.replaceAll('"', '""')}"`;
      const excludedIds = excludedIdsByTable.get(tableName) ?? [];
      const excludeOwnedRows = excludedIds.length > 0 ? ` AND "id" NOT IN (${excludedIds.join(",")})` : "";
      const quotedLabel = `'${tableName.replaceAll("'", "''")}'`;
      return `SELECT ${quotedLabel} AS "tableName", COUNT(*) AS "count" FROM ${quotedTableName} WHERE "profileId" = $1${excludeOwnedRows}`;
    });
    const profileReferenceSql = profileReferenceQueries.length > 0
      ? profileReferenceQueries.join(" UNION ALL ")
      : "SELECT ''::text AS \"tableName\", 0::bigint AS \"count\"";
    const profileReferenceCounts = await tx.$queryRawUnsafe<Array<{ tableName: string; count: bigint }>>(profileReferenceSql, profileIds[0]);
    const unrelatedTables = profileReferenceCounts.filter(({ count }) => count > BigInt(0)).map(({ tableName, count }) => `${tableName} (${count})`);
    canDeleteProfile = unrelatedTables.length === 0;
  }
  return { profileCreatedByFixture, canDeleteProfile };
}

async function cleanupWithinTransaction(tx: Prisma.TransactionClient) {
  const fixture = createTrainingHistoryStage01FixtureV1();
  const sessionIds = fixture.sessions.map((row) => row.id);
  const sessionExerciseIds = fixture.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.id));
  const setRows = fixtureSetRows(fixture);
  const setIds = setRows.map((row) => row.id);
  const programVersionIds = fixture.programVersions.map((row) => row.id);
  const programIds = fixture.programs.map((row) => row.id);
  const ownedCatalogs = fixture.catalogExercises.filter((row) => row.fixtureOwned);
  const catalogIds = ownedCatalogs.map((row) => row.id);
  const workoutIds = fixture.workouts.map((row) => row.id);
  const profileIds = fixture.profiles.map((row) => row.id);
  const catalogIdMap = await fixtureCatalogIdMap(tx, fixture);
  const plannedRows = programExerciseRows(fixture, catalogIdMap);
  const { profileCreatedByFixture, canDeleteProfile } = await assertCleanupOwnership(tx, fixture);

  const deletedSets = await tx.strengthSet.deleteMany({ where: { id: { in: setIds } } });
  const deletedExercises = await tx.strengthSessionExercise.deleteMany({ where: { id: { in: sessionExerciseIds }, sessionId: { in: sessionIds } } });
  const deletedChanges = await tx.strengthDiaryProgramChange.deleteMany({ where: { id: { in: fixture.programChanges.map((row) => row.id) } } });
  const deletedSessions = await tx.strengthDiarySession.deleteMany({ where: { id: { in: sessionIds }, profileId: { in: profileIds } } });
  await tx.trainingProgram.updateMany({ where: { id: { in: programIds }, profileId: { in: profileIds } }, data: { currentVersionId: null } });
  const deletedProgramExercises = await tx.programExercise.deleteMany({ where: { id: { in: plannedRows.map((row) => row.id) } } });
  const deletedVersions = await tx.trainingProgramVersion.deleteMany({ where: { id: { in: programVersionIds }, programId: { in: programIds } } });
  const deletedPrograms = await tx.trainingProgram.deleteMany({ where: { id: { in: programIds }, profileId: { in: profileIds } } });
  const deletedWorkouts = await tx.workout.deleteMany({ where: { id: { in: workoutIds }, sourceIdentity: { in: fixture.workouts.map((row) => row.sourceIdentity) } } });
  const deletedCatalog = await tx.exerciseCatalog.deleteMany({ where: { id: { in: catalogIds }, profileId: { in: profileIds } } });

  let deletedDailyHealthRows = 0;
  for (const fixtureDay of fixture.dailyHealthRows) {
    const day = await tx.dailyHealthData.findUnique({ where: { id: fixtureDay.id } });
    if (!day) continue;
    if (day.date !== fixtureDay.date || typeof day.rawPayload !== "object" || day.rawPayload === null || Array.isArray(day.rawPayload)
      || day.rawPayload.fixtureNamespace !== FIXTURE_MARKER || day.rawPayload.fixtureProfileId !== fixture.profiles[0]?.id) {
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
  const remainingFixtureDailyRows = await tx.dailyHealthData.count({ where: { id: { in: fixture.dailyHealthRows.map((row) => row.id) } } });
  if (profileCreatedByFixture && canDeleteProfile && remainingFixtureDailyRows === 0) {
    const profile = fixture.profiles[0]!;
    const deleted = await tx.profile.deleteMany({
      where: {
        id: profile.id,
        sex: profile.sex,
        dateOfBirth: new Date(`${profile.dateOfBirth}T00:00:00.000Z`),
        heightCm: profile.heightCm,
        targetWeightKg: null,
        targetDate: null,
        locale: profile.locale,
        autoAdvanceExercises: false,
        createdAt: new Date(profile.createdAt),
        updatedAt: new Date(profile.createdAt),
      },
    });
    deletedProfiles += deleted.count;
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

    const catalogIdMap = await fixtureCatalogIdMap(tx, fixture);
    const profile = fixture.profiles[0]!;
    const profileCreatedByFixture = !(await tx.profile.findUnique({ where: { id: profile.id }, select: { id: true } }));
    if (profileCreatedByFixture) {
      await tx.profile.create({
        data: {
          id: profile.id,
          sex: profile.sex,
          dateOfBirth: new Date(`${profile.dateOfBirth}T00:00:00.000Z`),
          heightCm: profile.heightCm,
          locale: profile.locale,
          targetWeightKg: null,
          targetDate: null,
          autoAdvanceExercises: false,
          createdAt: new Date(profile.createdAt),
          updatedAt: new Date(profile.createdAt),
        },
      });
    }
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
      await tx.trainingProgram.update({ where: { id: program.id }, data: { currentVersionId: program.currentVersionId, updatedAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) } });
    }
    await tx.dailyHealthData.createMany({ data: fixture.dailyHealthRows.map((row) => ({
      id: row.id,
      date: row.date,
      weightKg: row.weightKg,
      steps: row.steps,
      workoutFeedObserved: row.workoutFeedObserved,
      rawPayload: { ...row.rawPayload, stage01ProfileCreated: profileCreatedByFixture } as Prisma.InputJsonValue,
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
