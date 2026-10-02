import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { EXPECTED_MS100_V1, EXPECTED_GOLDEN_V1 } from "../fixtures/training-history-stage01/expected-v1";
import {
  STAGE01_GOLDEN_TOTALS_V1,
  STAGE01_PULL_ROWS_V1,
  STAGE01_PUSH_ROWS_V1,
} from "../fixtures/training-load-accounting-stage01-golden-v1";
import { requireIsolatedStage01Database } from "../../src/modules/training/testing/require-isolated-database";
import { CANONICAL_PUSH_UP_CONFIG_VERSION_V1 } from "../../src/modules/training/load-accounting-v1";
import {
  createTrainingHistoryStage01FixtureV1,
  TRAINING_HISTORY_STAGE01_CREATED_AT,
  TRAINING_HISTORY_STAGE01_PROFILE_ID,
} from "../fixtures/training-history-stage01/fixture-v1";

const SENTINEL_WORKOUT_ID = 15_000_001;
const SENTINEL_SOURCE_IDENTITY = "sentinel:stage01-cleanup-preservation-check";
const SENTINEL_SET_ID = 15_000_002;
const SENTINEL_PROGRAM_EXERCISE_ID = 15_000_003;
const SENTINEL_SESSION_EXERCISE_ID = 15_000_004;
const SENTINEL_PROGRAM_VERSION_ID = 15_000_005;
const SENTINEL_PROGRAM_CHANGE_ID = 15_000_006;
const SENTINEL_SUPERSEDED_WORKOUT_ID = 15_000_007;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function observeTransactionBackendPid(db: PrismaClient, onPid: (pid: number) => void): PrismaClient {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "$transaction") {
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
      const transaction = Reflect.get(target, property, target) as (...args: unknown[]) => unknown;
      return (callback: unknown, ...options: unknown[]) => transaction.call(
        target,
        async (tx: Prisma.TransactionClient) => {
          const observedTx = new Proxy(tx, {
            get(transactionTarget, transactionProperty, transactionReceiver) {
              if (transactionProperty !== "$queryRaw") {
                const value = Reflect.get(transactionTarget, transactionProperty, transactionReceiver);
                return typeof value === "function" ? value.bind(transactionTarget) : value;
              }
              const queryRaw = Reflect.get(transactionTarget, transactionProperty, transactionTarget) as (...args: unknown[]) => Promise<unknown>;
              return async (...args: unknown[]) => {
                const rows = await transactionTarget.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
                onPid(rows[0]!.pid);
                return queryRaw.apply(transactionTarget, args);
              };
            },
          }) as Prisma.TransactionClient;
          return (callback as (client: Prisma.TransactionClient) => Promise<unknown>)(observedTx);
        },
        ...options,
      );
    },
  }) as PrismaClient;
}

async function waitForPostgresLockWait(db: PrismaClient, pid: number, blockerPids: readonly number[]): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const rows = await db.$queryRaw<Array<{
      waitEventType: string | null;
      blockingPids: number[];
    }>>`
      SELECT wait_event_type AS "waitEventType", pg_blocking_pids(pid) AS "blockingPids"
      FROM pg_stat_activity
      WHERE pid = ${pid}
    `;
    if (rows[0]?.waitEventType === "Lock" && rows[0].blockingPids.some((blockingPid) => blockerPids.includes(blockingPid))) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`PostgreSQL backend ${pid} did not enter the expected row-lock wait behind ${blockerPids.join(", ")}`);
}

describe("Training History Stage 01 PostgreSQL persistence", () => {
  let prisma: import("@prisma/client").PrismaClient | undefined;
  let persistence: typeof import("../../src/modules/training/testing/stage01-persistence") | undefined;
  let seededCounts: Awaited<ReturnType<NonNullable<typeof persistence>["seedStage01Namespace"]>> | undefined;

  beforeAll(async () => {
    requireIsolatedStage01Database(process.env.DATABASE_URL, process.env.BODYCAST_STAGE01_MODE, "test");
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    await prisma.$connect();
    persistence = await import("../../src/modules/training/testing/stage01-persistence");
    await persistence.cleanupStage01Namespace(prisma);
    seededCounts = await persistence.seedStage01Namespace(prisma);
  }, 60_000);

  afterAll(async () => {
    if (!prisma || !persistence) return;
    try {
      await persistence.cleanupStage01Namespace(prisma);
    } finally {
      await prisma.$disconnect();
    }
  }, 60_000);

  it("persists distinct exercise/set rows, snapshots, program versions, and runtime schema", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    expect(seededCounts).toMatchObject({
      namespace: fixture.namespace,
      profiles: 1,
      catalogExercises: fixture.catalogExercises.length,
      programs: 7,
      programVersions: 19,
      sessions: 51,
      workouts: 5,
      dailyHealthRows: 2,
    });
    expect(await db.strengthDiarySession.count({ where: { id: { in: fixture.sessions.map((row) => row.id) } } })).toBe(fixture.sessions.length);
    expect(await db.strengthSessionExercise.count({ where: { sessionId: { in: fixture.sessions.map((row) => row.id) } } })).toBe(seededCounts!.sessionExercises);
    expect(await db.strengthSet.count({ where: { sessionExercise: { sessionId: { in: fixture.sessions.map((row) => row.id) } } } })).toBe(seededCounts!.sets);
    expect(await db.programExercise.count({ where: { programVersionId: { in: fixture.programVersions.map((row) => row.id) } } })).toBe(seededCounts!.programExercises);
    expect(await db.strengthDiaryProgramChange.count({ where: { sessionId: { in: fixture.sessions.map((row) => row.id) } } })).toBe(fixture.programChanges.length);
    expect(await db.profile.findUnique({ where: { id: TRAINING_HISTORY_STAGE01_PROFILE_ID }, select: { id: true } })).toEqual({ id: TRAINING_HISTORY_STAGE01_PROFILE_ID });

    const emptyDiary = await db.strengthDiarySession.findUnique({ where: { id: fixture.sessions.find((row) => row.scenarioId === "edge-cases")!.id }, include: { exercises: true } });
    expect(emptyDiary?.entryMode).toBe("RETROSPECTIVE");
    expect(emptyDiary?.webStartedAt).toBeNull();
    expect(emptyDiary?.exercises).toHaveLength(0);
    expect(emptyDiary?.matchedWorkoutId).not.toBeNull();

    const customMapped = fixture.sessions.find((row) => row.scenarioId === "exercise-order" && row.weekNumber === 11)!.exercises.find((row) => row.snapshotStableKey === "seated_dumbbell_press" && row.stableKey === null)!;
    const persistedSnapshot = await db.strengthSessionExercise.findUnique({ where: { id: customMapped.id }, select: { muscleMappingSnapshot: true, sourceExerciseCatalogId: true, sortOrder: true } });
    expect(persistedSnapshot?.muscleMappingSnapshot).toEqual(customMapped.muscleMappingSnapshot);
    expect(persistedSnapshot?.sourceExerciseCatalogId).toBe(customMapped.sourceExerciseCatalogId);
    expect(persistedSnapshot?.sortOrder).toBe(customMapped.sortOrder);
    const catalog = await db.exerciseCatalog.findUnique({ where: { id: customMapped.sourceExerciseCatalogId }, select: { stableKey: true } });
    expect(catalog?.stableKey).toBeNull();

    const dailyRows = await db.dailyHealthData.findMany({ where: { id: { in: fixture.dailyHealthRows.map((row) => row.id) } }, orderBy: { date: "asc" } });
    expect(dailyRows.map((row) => [row.weightKg, row.steps])).toEqual([[null, 8421], [null, null]]);
    const sourceFallback = fixture.workouts.find((row) => row.scenario === "ms100-boundary" && row.externalId === null)!;
    expect(sourceFallback.sourceIdentity).toBe(EXPECTED_MS100_V1.intervals[0]!.sourceIdentity);
    expect((await db.workout.findUnique({ where: { id: sourceFallback.id }, select: { sourceIdentity: true } }))?.sourceIdentity).toBe(sourceFallback.sourceIdentity);
    const matchedPush = fixture.sessions.find((row) => row.scenarioId === "golden-push")!;
    const pushWorkout = await db.workout.findUnique({ where: { id: matchedPush.matchedWorkoutId! }, select: { externalId: true, sourceIdentity: true, type: true } });
    expect(pushWorkout).toEqual({ externalId: null, sourceIdentity: EXPECTED_GOLDEN_V1.push.sourceIdentity, type: "Traditional Strength Training" });

    const strengthSetColumns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'StrengthSet'
    `;
    const exerciseColumns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'StrengthSessionExercise'
    `;
    const setColumnNames = strengthSetColumns.map((row) => row.column_name);
    const exerciseColumnNames = exerciseColumns.map((row) => row.column_name);
    expect(setColumnNames).toEqual(expect.arrayContaining(["reps", "weightKg", "bandNominalResistanceKg", "rir"]));
    expect(setColumnNames).not.toContain("repsPerSide");
    expect(exerciseColumnNames).not.toContain("equipment");
    const migrationRows = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name
    `;
    expect(migrationRows.length).toBeGreaterThan(0);
  });

  it("matches the Stage 02 literal rows and accounting totals against persisted Stage 01 golden sessions", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    const sessions = [
      { id: fixture.sessions.find((row) => row.scenarioId === "golden-pull")!.id, rows: STAGE01_PULL_ROWS_V1, side: "pull" as const },
      { id: fixture.sessions.find((row) => row.scenarioId === "golden-push")!.id, rows: STAGE01_PUSH_ROWS_V1, side: "push" as const },
    ];
    const { calculateLoadAccountingV1 } = await import("../../src/modules/training/load-accounting-v1");
    const { TrainingService } = await import("../../src/modules/training/training.service");
    const { localDateTimeToInstant } = await import("../../src/model/time-zone");
    const service = new TrainingService(db);
    let pullObservationId: number | null = null;
    const syntheticProgramIds: number[] = [];
    const syntheticSessionIds: number[] = [];
    try {
    for (const expectedSession of sessions) {
      const persisted = await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: expectedSession.id },
        select: {
          exercises: {
            select: {
              sortOrder: true,
              sourceExerciseCatalog: { select: { stableKey: true } },
              sets: { orderBy: { setNumber: "asc" }, select: { setNumber: true, reps: true, weightKg: true, bandNominalResistanceKg: true, rir: true } },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
      const literalRows = persisted.exercises.flatMap((exercise) => exercise.sets.map((set) => [
        exercise.sourceExerciseCatalog?.stableKey ?? "",
        exercise.sortOrder,
        set.setNumber,
        set.reps,
        set.weightKg?.toNumber() ?? null,
        set.bandNominalResistanceKg?.toNumber() ?? null,
        set.rir,
      ]));
      expect(literalRows).toEqual(expectedSession.rows.map((row) => [row[0], row[1], row[2], row[3], row[4], row[5], row[7]]));

      const grouped = new Map<string, typeof persisted.exercises[number]["sets"]>();
      for (const exercise of persisted.exercises) {
        const key = exercise.sourceExerciseCatalog?.stableKey;
        if (!key) throw new Error("Stage 01 golden exercise is missing its stable key");
        grouped.set(key, [...(grouped.get(key) ?? []), ...exercise.sets]);
      }
      const exercises = [...grouped].map(([stableKey, sets]) => {
        const setBasis = expectedSession.rows.find((row) => row[0] === stableKey)?.[6];
        return {
          identity: { status: "known-legacy" as const, stableKey },
          resistanceHint: setBasis === "band-nominal-per-logged-side" ? "band-nominal" as const
            : setBasis === "bodyweight-reference-separate" ? "bodyweight" as const : "external" as const,
          sets: sets.map((set) => ({
            reps: set.reps,
            weightKg: set.weightKg?.toNumber() ?? null,
            bandNominalResistanceKg: set.bandNominalResistanceKg?.toNumber() ?? null,
          })),
        };
      });
      const result = calculateLoadAccountingV1({
        localDate: expectedSession.side === "pull" ? "2026-09-24" : "2026-09-25",
        exercises,
        ...(expectedSession.side === "pull" ? { bodyweightReference: {
          status: "observed" as const, valueKg: 87, localDate: "2026-09-24",
          source: "apple-health-shortcut" as const, sourceId: "stage01-golden-observation",
        } } : {}),
      });
      expect(result.externalLoadVolume.value).toBe(expectedSession.side === "pull"
        ? STAGE01_GOLDEN_TOTALS_V1.pullExternalKgReps : STAGE01_GOLDEN_TOTALS_V1.pushExternalKgReps);
      expect(result.bandNominalIndex.perLoggedSide.value).toBe(expectedSession.side === "pull"
        ? STAGE01_GOLDEN_TOTALS_V1.pullBandNominalPerLoggedSideKgReps : STAGE01_GOLDEN_TOTALS_V1.pushBandNominalPerLoggedSideKgReps);
      if (expectedSession.side === "pull") {
        expect(result.bodyweight.referenceVolume.value).toBe(STAGE01_GOLDEN_TOTALS_V1.pullUpReferenceKgReps);
      }

      const exerciseDefinitions = [...new Map(expectedSession.rows.map((row) => [row[1], row])).values()]
        .sort((left, right) => left[1] - right[1]);
      const exercisesForProgram = [];
      for (const row of exerciseDefinitions) {
        const catalog = await db.exerciseCatalog.findUniqueOrThrow({
          where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: row[0] } },
          select: { id: true },
        });
        const basis = row[6];
        exercisesForProgram.push({
          catalogId: catalog.id,
          plannedSets: expectedSession.rows.filter((candidate) => candidate[1] === row[1]).length,
          resistanceType: basis === "band-nominal-per-logged-side" ? "RESISTANCE_BAND" as const
            : basis === "bodyweight-reference-separate" ? "BODYWEIGHT" as const : "EXTERNAL_WEIGHT" as const,
        });
      }
      const program = await service.createProgram({
        name: `stage02-golden-${expectedSession.side}-${Date.now()}`,
        exercises: exercisesForProgram,
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      syntheticProgramIds.push(program.id);
      const synthetic = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "Europe/Bratislava");
      syntheticSessionIds.push(synthetic.id);
      const targetDate = expectedSession.side === "pull" ? "2026-09-24" : "2026-09-25";
      await service.updateSessionAccountingContext(synthetic.id, {
        effectiveAccountingAt: localDateTimeToInstant(targetDate, "12:00", "Europe/Bratislava").toISOString(),
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      for (const row of expectedSession.rows) {
        const exercise = synthetic.exercises[row[1]];
        if (!exercise) throw new Error(`missing synthetic Stage 01 exercise at sort order ${row[1]}`);
        await service.createSet(synthetic.id, exercise.id, {
          setNumber: row[2], reps: row[3], weightKg: row[4], bandNominalResistanceKg: row[5], rir: row[7],
        }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      }
      if (expectedSession.side === "pull") {
        const observed = await db.healthMetricSample.create({
          data: {
            date: targetDate,
            metric: "weight-kg",
            source: "apple-health-shortcut",
            timestamp: localDateTimeToInstant(targetDate, "12:00", "Europe/Bratislava"),
            value: 87,
          },
          select: { id: true },
        });
        pullObservationId = observed.id;
      }

      const persistedResult = await service.materializeSessionAccounting(synthetic.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(persistedResult.loadAccountingV1?.externalLoadVolume.value).toBe(expectedSession.side === "pull"
        ? STAGE01_GOLDEN_TOTALS_V1.pullExternalKgReps : STAGE01_GOLDEN_TOTALS_V1.pushExternalKgReps);
      expect(persistedResult.loadAccountingV1?.bandNominalIndex.perLoggedSide.value).toBe(expectedSession.side === "pull"
        ? STAGE01_GOLDEN_TOTALS_V1.pullBandNominalPerLoggedSideKgReps : STAGE01_GOLDEN_TOTALS_V1.pushBandNominalPerLoggedSideKgReps);
      const persistedSnapshot = await db.strengthSessionAccountingSnapshot.findFirstOrThrow({
        where: { sessionId: synthetic.id, snapshotRevision: persistedResult.snapshotRevision },
        select: { payload: true, payloadVersion: true },
      });
      const { persistedPayloadFromUnknown, PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2 } =
        await import("../../src/modules/training/persisted-load-accounting-v1");
      expect(persistedSnapshot.payloadVersion).toBe(PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2);
      const payload = persistedPayloadFromUnknown(persistedSnapshot.payload);
      if (!payload || !("breakdown" in payload)) throw new Error("persisted golden snapshot is missing strict V2 breakdown");
      expect(payload.result?.externalLoadVolume.value).toBe(expectedSession.side === "pull"
        ? STAGE01_GOLDEN_TOTALS_V1.pullExternalKgReps : STAGE01_GOLDEN_TOTALS_V1.pushExternalKgReps);
      expect(payload.result?.externalLoadVolume.availability).toBe("available");
      expect(payload.result?.bandNominalIndex.perLoggedSide.value).toBe(expectedSession.side === "pull"
        ? STAGE01_GOLDEN_TOTALS_V1.pullBandNominalPerLoggedSideKgReps : STAGE01_GOLDEN_TOTALS_V1.pushBandNominalPerLoggedSideKgReps);
      expect(payload.result?.bandNominalIndex.perLoggedSide.availability).toBe("available");
      if (expectedSession.side === "pull") {
        const hyperextensionRows = expectedSession.rows.filter((row) => row[0] === "hyperextension");
        expect(hyperextensionRows.reduce((total, row) => total + row[3] * row[4]!, 0))
          .toBe(STAGE01_GOLDEN_TOTALS_V1.hyperextensionKgReps);
        const hyperextension = await db.strengthSessionExercise.findFirstOrThrow({
          where: { sessionId: synthetic.id, sourceExerciseCatalog: { stableKey: "hyperextension" } },
          select: { loadAccountingConfigSnapshot: true },
        });
        expect(hyperextension.loadAccountingConfigSnapshot).toMatchObject({
          repsMeaning: "per-movement",
          implementsPerMovement: 1,
          configVersion: "bodycast-historical-load-entry-v1",
        });
      }
      expect(payload.result?.bandNominalIndex.perLoggedSide.value).toBe(expectedSession.side === "pull"
        ? STAGE01_GOLDEN_TOTALS_V1.pullBandNominalPerLoggedSideKgReps : STAGE01_GOLDEN_TOTALS_V1.pushBandNominalPerLoggedSideKgReps);
      expect(payload.result?.externalLoadVolume.provenance.some((row) => row.kind === "bodyweight-observation")).toBe(false);
      if (expectedSession.side === "pull") {
        expect(payload.massReference).toMatchObject({ status: "observed", valueKg: 87, source: "apple-health-shortcut" });
        expect(payload.result?.bodyweight.referenceVolume.value).toBe(STAGE01_GOLDEN_TOTALS_V1.pullUpReferenceKgReps);
        expect(payload.result?.bodyweight.referenceVolume.availability).toBe("available");
        expect(payload.result?.bodyweight.referenceVolume.provenance).toContainEqual(expect.objectContaining({
          kind: "bodyweight-observation", version: "apple-health-shortcut", localDate: "2026-09-24",
        }));
      }
      const persistedExercises = await db.strengthSessionExercise.findMany({
        where: { sessionId: synthetic.id },
        select: {
          id: true, sortOrder: true, snapshotExerciseName: true,
          sets: { select: { id: true, setNumber: true, reps: true } },
        },
      });
      expect(payload.breakdown.rows).toHaveLength(persistedExercises.reduce((total, exercise) => total + exercise.sets.length, 0));
      for (const row of payload.breakdown.rows) {
        const exercise = persistedExercises.find(({ id }) => id === row.sessionExerciseId);
        const set = exercise?.sets.find(({ id }) => id === row.strengthSetId);
        if (!exercise || !set) throw new Error("breakdown row does not point to persisted exercise/set");
        const fixtureRow = expectedSession.rows.find((candidate) =>
          candidate[1] === exercise.sortOrder && candidate[2] === set.setNumber);
        expect(fixtureRow).toBeDefined();
        expect([row.exerciseOrder, row.exerciseName, row.setNumber, row.scalarReps])
          .toEqual([exercise.sortOrder, exercise.snapshotExerciseName, set.setNumber, set.reps]);
        expect(row.stableKey).toBe(fixtureRow?.[0] ?? null);
        expect(row.accountingMethodVersion).toBe(payload.accountingMethodVersion);
        expect(row.config.resolved).not.toBeNull();
        const isVersionedPushUp = fixtureRow?.[0] === "pushup_handles";
        const expectedConfigProvenance = {
          kind: isVersionedPushUp ? "session-snapshot" : "legacy-interpretation",
          version: isVersionedPushUp ? CANONICAL_PUSH_UP_CONFIG_VERSION_V1 : "bodycast-historical-load-entry-v1",
          stableKey: fixtureRow?.[0],
        };
        expect(row.config.provenance).toMatchObject(expectedConfigProvenance);
        const expectedCategory = fixtureRow?.[6] === "band-nominal-per-logged-side"
          ? "bandNominalPerLoggedSide"
          : fixtureRow?.[6] === "bodyweight-reference-separate"
            ? "bodyweightReferenceVolume" : "externalLoadVolume";
        const contribution = row.contributions.find(({ category }) => category === expectedCategory);
        expect(contribution).toBeDefined();
        expect(contribution?.availability).toBe(expectedCategory === "bodyweightReferenceVolume"
          && payload.result.bodyweight.referenceVolume.availability === "unavailable"
          ? "unavailable" : "available");
        expect(contribution?.basis).toBe(row.config.resolved?.loadInput);
        expect(contribution?.provenance).toContainEqual(expect.objectContaining(expectedConfigProvenance));
      }
      const categoryTotal = (category: string) => payload.breakdown.rows
        .flatMap((row) => row.contributions)
        .filter((contribution) => contribution.category === category && contribution.availability === "available")
        .reduce((total, contribution) => total + (contribution.value ?? 0), 0);
      expect(categoryTotal("externalLoadVolume")).toBe(expectedSession.side === "pull"
        ? STAGE01_GOLDEN_TOTALS_V1.pullExternalKgReps : STAGE01_GOLDEN_TOTALS_V1.pushExternalKgReps);
      expect(categoryTotal("bandNominalPerLoggedSide")).toBeCloseTo(expectedSession.side === "pull"
        ? STAGE01_GOLDEN_TOTALS_V1.pullBandNominalPerLoggedSideKgReps
        : STAGE01_GOLDEN_TOTALS_V1.pushBandNominalPerLoggedSideKgReps, 10);
      if (expectedSession.side === "pull") {
        const hyperRows = payload.breakdown.rows.filter(({ stableKey }) => stableKey === "hyperextension");
        expect(hyperRows.reduce((sum, row) => sum + (row.contributions.find(({ category }) =>
          category === "externalLoadVolume")?.value ?? 0), 0)).toBe(STAGE01_GOLDEN_TOTALS_V1.hyperextensionKgReps);
        for (const row of hyperRows) {
          expect(row.config.effective).toMatchObject({
            repsMeaning: "per-movement",
            implementsPerMovement: 1,
            configVersion: "bodycast-historical-load-entry-v1",
          });
          expect(row.mechanics).toMatchObject({ implementsPerMovement: 1, effectiveMultiplier: 1 });
          expect(row.contributions).toContainEqual(expect.objectContaining({
            category: "externalLoadVolume",
            basis: "per-implement-kg",
            effectiveMultiplier: 1,
            availability: "available",
          }));
        }
        const pullUpRows = payload.breakdown.rows.filter(({ stableKey }) => stableKey === "pull_up");
        expect(pullUpRows.reduce((sum, row) => sum + (row.contributions.find(({ category }) =>
          category === "bodyweightReferenceVolume")?.value ?? 0), 0))
          .toBe(STAGE01_GOLDEN_TOTALS_V1.pullUpReferenceKgReps);
        if (payload.massReference.status !== "observed") throw new Error("golden pull snapshot mass is not observed");
        expect(payload.massReference).toMatchObject({ status: "observed", valueKg: 87, source: "apple-health-shortcut" });
        for (const row of pullUpRows) {
          expect(row.contributions).toContainEqual(expect.objectContaining({
            category: "bodyweightReferenceVolume",
            basis: "bodyweight-reference",
            unit: "bodyweight-reference-kg-repetitions",
            availability: "available",
            provenance: expect.arrayContaining([expect.objectContaining({
              kind: "bodyweight-observation",
              sourceId: payload.massReference.sourceId,
              localDate: "2026-09-24",
            })]),
          }));
        }
      }
      const reread = await service.getSession(synthetic.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(reread?.loadAccountingBreakdown).toMatchObject({
        status: "available",
        value: { schemaVersion: "bodycast-load-accounting-breakdown-v1" },
      });
      expect(reread?.loadAccountingV1?.externalLoadVolume.value).toBe(payload.result?.externalLoadVolume.value);
      expect(reread?.loadAccountingV1?.bandNominalIndex.perLoggedSide.value).toBe(payload.result?.bandNominalIndex.perLoggedSide.value);
      await service.finishSession(synthetic.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
    }
    } finally {
      if (syntheticSessionIds.length > 0) await db.strengthDiarySession.deleteMany({ where: { id: { in: syntheticSessionIds } } });
      if (syntheticProgramIds.length > 0) await db.trainingProgram.deleteMany({ where: { id: { in: syntheticProgramIds } } });
      if (pullObservationId !== null) await db.healthMetricSample.deleteMany({ where: { id: pullObservationId } });
    }
  });

  it("reads a legacy V1 current snapshot without inventing a breakdown", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let sessionId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const { PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1 } = await import("../../src/modules/training/persisted-load-accounting-v1");
      const service = new TrainingService(db);
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "flat_dumbbell_fly" } },
        select: { id: true },
      });
      const program = await service.createProgram({
        name: "stage02-legacy-breakdown-read",
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const session = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      sessionId = session.id;
      await service.createSet(session.id, session.exercises[0]!.id, { reps: 8, weightKg: 10 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const materialized = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const snapshot = await db.strengthSessionAccountingSnapshot.findFirstOrThrow({
        where: { sessionId: session.id, snapshotRevision: materialized.snapshotRevision },
        select: {
          snapshotRevision: true,
          accountingInputRevision: true,
          inputFingerprint: true,
          effectiveLocalDate: true,
          timeZone: true,
          timeZoneProvenance: true,
          accountingMethodVersion: true,
          massResolutionMethodVersion: true,
          massResolutionIdentity: true,
          payloadVersion: true,
          payload: true,
        },
      });
      const rawPayload = snapshot.payload as Record<string, unknown>;
      const legacyRevision = snapshot.snapshotRevision + 1;
      const legacyPayload: Record<string, unknown> = Object.fromEntries(
        Object.entries(rawPayload).filter(([key]) => key !== "breakdown"),
      );
      legacyPayload.schemaVersion = PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1;
      legacyPayload.snapshotRevision = legacyRevision;
      await db.strengthSessionAccountingSnapshot.create({
        data: {
          sessionId: session.id,
          snapshotRevision: legacyRevision,
          accountingInputRevision: snapshot.accountingInputRevision,
          inputFingerprint: snapshot.inputFingerprint,
          effectiveLocalDate: snapshot.effectiveLocalDate,
          timeZone: snapshot.timeZone,
          timeZoneProvenance: snapshot.timeZoneProvenance,
          accountingMethodVersion: snapshot.accountingMethodVersion,
          massResolutionMethodVersion: snapshot.massResolutionMethodVersion,
          massResolutionIdentity: snapshot.massResolutionIdentity,
          payloadVersion: PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1,
          payload: legacyPayload as Prisma.InputJsonValue,
        },
      });
      await db.strengthDiarySession.update({
        where: { id: session.id },
        data: { currentSnapshotRevision: legacyRevision },
      });
      const originalSnapshot = await db.strengthSessionAccountingSnapshot.findUniqueOrThrow({
        where: { sessionId_snapshotRevision: { sessionId: session.id, snapshotRevision: snapshot.snapshotRevision } },
        select: { payloadVersion: true, payload: true },
      });
      expect(originalSnapshot.payloadVersion).toBe("bodycast-persisted-load-accounting-v2");
      expect(originalSnapshot.payload).toEqual(rawPayload);

      const read = await service.getSession(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(read?.materializationState).toBe("current");
      expect(read?.loadAccountingV1?.externalLoadVolume.value).toBe(160);
      expect(read?.loadAccountingBreakdown).toEqual({
        status: "unavailable",
        reason: "legacy-snapshot-no-breakdown",
      });
    } finally {
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
    }
  });

  it("uses explicit refresh for a better observed mass while ordinary materialization stays idempotent", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let sessionId: number | null = null;
    const sampleIds: number[] = [];
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const { localDateTimeToInstant } = await import("../../src/model/time-zone");
      const service = new TrainingService(db);
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "pull_up" } },
        select: { id: true },
      });
      const program = await service.createProgram({
        name: `stage02-refresh-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "BODYWEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const session = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "Europe/Bratislava");
      sessionId = session.id;
      const { instantToLocalDateTime } = await import("../../src/model/time-zone");
      const date = instantToLocalDateTime(new Date(session.webStartedAt!), "Europe/Bratislava").date;
      await service.createSet(session.id, session.exercises[0]!.id, { reps: 10 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const firstSample = await db.healthMetricSample.create({
        data: { date, metric: "weight-kg", source: "apple-health-shortcut", timestamp: localDateTimeToInstant(date, "10:00", "Europe/Bratislava"), value: 80 },
        select: { id: true },
      });
      sampleIds.push(firstSample.id);
      const first = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(first.loadAccountingV1?.bodyweight.reference).toMatchObject({ status: "observed", valueKg: 80 });
      const secondSample = await db.healthMetricSample.create({
        data: { date, metric: "weight-kg", source: "apple-health-shortcut", timestamp: localDateTimeToInstant(date, "14:00", "Europe/Bratislava"), value: 82 },
        select: { id: true },
      });
      sampleIds.push(secondSample.id);
      const ordinary = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(ordinary.snapshotRevision).toBe(first.snapshotRevision);
      expect(ordinary.loadAccountingV1?.bodyweight.reference.valueKg).toBe(80);
      const refreshed = await service.refreshSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "stage02-refresh-once");
      expect(refreshed.snapshotRevision).toBeGreaterThan(first.snapshotRevision!);
      expect(refreshed.loadAccountingV1?.bodyweight.reference).toMatchObject({ status: "observed", valueKg: 82 });
      const repeatedRefresh = await service.refreshSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "stage02-refresh-once");
      expect(repeatedRefresh.snapshotRevision).toBe(refreshed.snapshotRevision);
      const history = await db.strengthSessionAccountingSnapshot.findMany({
        where: { sessionId: session.id }, orderBy: { snapshotRevision: "asc" }, select: { snapshotRevision: true, payload: true },
      });
      expect(history).toHaveLength(2);
      expect((history[0]!.payload as { massReference: { valueKg: number } }).massReference.valueKg).toBe(80);
      expect((history[1]!.payload as { massReference: { valueKg: number } }).massReference.valueKg).toBe(82);
    } finally {
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
      if (sampleIds.length > 0) await db.healthMetricSample.deleteMany({ where: { id: { in: sampleIds } } });
    }
  });

  it("rejects a deterministic stale candidate and never exposes it as current", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let sessionId: number | null = null;
    let sampleId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const { TrainingRepository, StaleAccountingCandidateError } = await import("../../src/modules/training/training.repository");
      const { localDateTimeToInstant } = await import("../../src/model/time-zone");
      const service = new TrainingService(db);
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "pull_up" } },
        select: { id: true },
      });
      const program = await service.createProgram({
        name: `stage02-stale-candidate-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "BODYWEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const session = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "Europe/Bratislava");
      sessionId = session.id;
      const exercise = session.exercises[0]!;
      const set = await service.createSet(session.id, exercise.id, { reps: 8 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const { instantToLocalDateTime } = await import("../../src/model/time-zone");
      const date = instantToLocalDateTime(new Date(), "Europe/Bratislava").date;
      const sample = await db.healthMetricSample.create({
        data: { date, metric: "weight-kg", source: "apple-health-shortcut", timestamp: localDateTimeToInstant(date, "12:00", "Europe/Bratislava"), value: 80 },
        select: { id: true },
      });
      sampleId = sample.id;
      let changed = false;
      const wrapped = new Proxy(db, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (property !== "healthMetricSample" || !value) return typeof value === "function" ? value.bind(target) : value;
          return new Proxy(value, {
            get(model, modelProperty, modelReceiver) {
              const method = Reflect.get(model, modelProperty, modelReceiver);
              if (modelProperty !== "findMany") return typeof method === "function" ? method.bind(model) : method;
              return async (...args: unknown[]) => {
                if (!changed) {
                  changed = true;
                  await service.updateSet(session.id, set.id, { reps: 9 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
                }
                return method.apply(model, args);
              };
            },
          });
        },
      });
      const staleRepository = new TrainingRepository(wrapped as unknown as typeof db);
      await expect(staleRepository.materializeAccounting({ sessionId: session.id, profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID }))
        .rejects.toBeInstanceOf(StaleAccountingCandidateError);
      expect(changed).toBe(true);
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: session.id } })).toBe(0);
      const pending = await service.getSession(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(pending?.materializationState).not.toBe("current");
      const current = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(current.loadAccountingV1?.bodyweight.referenceVolume.value).toBe(720);
      expect(current.exercises[0]?.sets[0]?.reps).toBe(9);
    } finally {
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
      if (sampleId !== null) await db.healthMetricSample.deleteMany({ where: { id: sampleId } });
    }
  });

  it("rejects a candidate captured before a same-local-date timestamp correction", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let sessionId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const { TrainingRepository, StaleAccountingCandidateError } = await import("../../src/modules/training/training.repository");
      const service = new TrainingService(db);
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "pull_up" } },
        select: { id: true },
      });
      const program = await service.createProgram({
        name: `stage02-stale-timestamp-candidate-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "BODYWEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const session = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "Europe/Bratislava");
      sessionId = session.id;
      await service.updateSessionAccountingContext(
        session.id,
        { effectiveAccountingAt: "2045-01-01T10:00:00.000Z" },
        TRAINING_HISTORY_STAGE01_PROFILE_ID,
      );
      await service.createSet(session.id, session.exercises[0]!.id, { reps: 8 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const before = await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: session.id },
        select: { accountingInputRevision: true },
      });
      let changed = false;
      const wrapped = new Proxy(db, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (property !== "healthMetricSample" || !value) return typeof value === "function" ? value.bind(target) : value;
          return new Proxy(value, {
            get(model, modelProperty, modelReceiver) {
              const method = Reflect.get(model, modelProperty, modelReceiver);
              if (modelProperty !== "findMany") return typeof method === "function" ? method.bind(model) : method;
              return async (...args: unknown[]) => {
                if (!changed) {
                  changed = true;
                  await service.updateSessionAccountingContext(
                    session.id,
                    { effectiveAccountingAt: "2045-01-01T10:01:00.000Z" },
                    TRAINING_HISTORY_STAGE01_PROFILE_ID,
                  );
                }
                return method.apply(model, args);
              };
            },
          });
        },
      });

      const staleRepository = new TrainingRepository(wrapped as unknown as typeof db);
      await expect(staleRepository.materializeAccounting({ sessionId: session.id, profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID }))
        .rejects.toBeInstanceOf(StaleAccountingCandidateError);
      expect(changed).toBe(true);
      const afterStaleCandidate = await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: session.id },
        select: { accountingInputRevision: true, currentSnapshotRevision: true },
      });
      expect(afterStaleCandidate.accountingInputRevision).toBe(before.accountingInputRevision);
      expect(afterStaleCandidate.currentSnapshotRevision).toBeNull();
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: session.id } })).toBe(0);

      const current = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const persisted = await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: session.id },
        select: {
          effectiveAccountingAt: true,
          currentAccountingSnapshot: { select: { snapshotRevision: true, payload: true } },
        },
      });
      expect(persisted.currentAccountingSnapshot?.snapshotRevision).toBe(current.snapshotRevision);
      expect((persisted.currentAccountingSnapshot?.payload as { effectiveAccountingAt: string }).effectiveAccountingAt)
        .toBe(persisted.effectiveAccountingAt?.toISOString());
    } finally {
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
    }
  });

  it("serializes a stale refresh candidate behind a timestamp rebase at the PostgreSQL row lock", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let sessionId: number | null = null;
    let sampleId: number | null = null;
    const candidateCaptured = deferred();
    const resumeCandidate = deferred();
    const gateReady = deferred<number>();
    const releaseGate = deferred();
    const correctionPidReady = deferred<number>();
    const candidatePidReady = deferred<number>();
    let gateTransaction: Promise<unknown> | null = null;
    let correctionPromise: Promise<void> | null = null;
    let candidatePromise: Promise<number> | null = null;
    try {
      const { TrainingRepository, StaleAccountingCandidateError } = await import("../../src/modules/training/training.repository");
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const service = new TrainingService(db);
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "pull_up" } },
        select: { id: true },
      });
      const program = await service.createProgram({
        name: `stage02-row-lock-rebase-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "BODYWEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const session = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "Europe/Bratislava");
      sessionId = session.id;
      await service.updateSessionAccountingContext(
        session.id,
        { effectiveAccountingAt: "2045-01-01T10:00:00.000Z" },
        TRAINING_HISTORY_STAGE01_PROFILE_ID,
      );
      await service.createSet(session.id, session.exercises[0]!.id, { reps: 8 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const sample = await db.healthMetricSample.create({
        data: {
          date: "2045-01-01",
          metric: "weight-kg",
          source: "apple-health-shortcut",
          timestamp: new Date("2045-01-01T11:00:00.000Z"),
          value: 80,
        },
        select: { id: true },
      });
      sampleId = sample.id;
      const initial = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const initialSnapshot = await db.strengthSessionAccountingSnapshot.findUniqueOrThrow({
        where: {
          sessionId_snapshotRevision: { sessionId: session.id, snapshotRevision: initial.snapshotRevision },
        },
      });
      const correctionAt = new Date("2045-01-01T10:01:00.000Z");

      gateTransaction = db.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: number }>>`
          SELECT "id" FROM "StrengthDiarySession" WHERE "id" = ${session.id} FOR UPDATE
        `;
        const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        gateReady.resolve(rows[0]!.pid);
        await releaseGate.promise;
      });
      const gatePid = await gateReady.promise;

      const pausedMassClient = new Proxy(db, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (property !== "healthMetricSample" || !value) return typeof value === "function" ? value.bind(target) : value;
          return new Proxy(value, {
            get(model, modelProperty, modelReceiver) {
              const method = Reflect.get(model, modelProperty, modelReceiver);
              if (modelProperty !== "findMany") return typeof method === "function" ? method.bind(model) : method;
              return async (...args: unknown[]) => {
                const samples = await (method as (...queryArgs: unknown[]) => Promise<unknown>).apply(model, args);
                candidateCaptured.resolve();
                await resumeCandidate.promise;
                return samples;
              };
            },
          });
        },
      }) as PrismaClient;
      const candidateDb = observeTransactionBackendPid(pausedMassClient, (pid) => candidatePidReady.resolve(pid));
      const candidateRepository = new TrainingRepository(candidateDb);
      candidatePromise = candidateRepository.materializeAccounting({
        sessionId: session.id,
        profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID,
        mode: "refresh",
        idempotencyKey: "stage02-row-lock-timestamp-candidate",
      });
      await candidateCaptured.promise;

      const correctionDb = observeTransactionBackendPid(db, (pid) => correctionPidReady.resolve(pid));
      correctionPromise = new TrainingRepository(correctionDb).updateAccountingContext({
        sessionId: session.id,
        profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID,
        effectiveAccountingAt: correctionAt,
      });
      const correctionPid = await correctionPidReady.promise;
      await waitForPostgresLockWait(db, correctionPid, [gatePid]);

      resumeCandidate.resolve();
      const candidatePid = await candidatePidReady.promise;
      await waitForPostgresLockWait(db, candidatePid, [gatePid, correctionPid]);

      releaseGate.resolve();
      await gateTransaction;
      await correctionPromise;
      await expect(candidatePromise).rejects.toBeInstanceOf(StaleAccountingCandidateError);

      const persisted = await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: session.id },
        select: {
          effectiveAccountingAt: true,
          accountingInputRevision: true,
          currentSnapshotRevision: true,
          currentAccountingSnapshot: { select: { snapshotRevision: true, payload: true } },
        },
      });
      const snapshots = await db.strengthSessionAccountingSnapshot.findMany({
        where: { sessionId: session.id },
        orderBy: { snapshotRevision: "asc" },
      });
      expect(persisted.effectiveAccountingAt?.toISOString()).toBe(correctionAt.toISOString());
      expect(persisted.accountingInputRevision).toBe(initialSnapshot.accountingInputRevision);
      expect(snapshots).toHaveLength(2);
      expect(snapshots.map((snapshot) => snapshot.snapshotRevision)).toEqual([
        initial.snapshotRevision,
        initial.snapshotRevision + 1,
      ]);
      expect(snapshots[0]).toEqual(initialSnapshot);
      const rebased = snapshots[1]!;
      expect(rebased.accountingInputRevision).toBe(initialSnapshot.accountingInputRevision);
      expect(rebased.inputFingerprint).toBe(initialSnapshot.inputFingerprint);
      expect(rebased.snapshotRevision).toBe(persisted.currentSnapshotRevision);
      expect(persisted.currentAccountingSnapshot?.snapshotRevision).toBe(rebased.snapshotRevision);
      expect((rebased.payload as { effectiveAccountingAt: string }).effectiveAccountingAt)
        .toBe(persisted.effectiveAccountingAt?.toISOString());
      const calculationPayload = (value: unknown) => {
        const payload = { ...(value as Record<string, unknown>) };
        delete payload.snapshotRevision;
        delete payload.effectiveAccountingAt;
        return payload;
      };
      expect(calculationPayload(rebased.payload)).toEqual(calculationPayload(initialSnapshot.payload));
      expect(await db.strengthSessionAccountingOperation.findUnique({
        where: {
          sessionId_idempotencyKey: {
            sessionId: session.id,
            idempotencyKey: "stage02-row-lock-timestamp-candidate",
          },
        },
      })).toBeNull();
    } finally {
      resumeCandidate.resolve();
      releaseGate.resolve();
      await Promise.allSettled([
        ...(gateTransaction ? [gateTransaction] : []),
        ...(correctionPromise ? [correctionPromise] : []),
        ...(candidatePromise ? [candidatePromise] : []),
      ]);
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
      if (sampleId !== null) await db.healthMetricSample.deleteMany({ where: { id: sampleId } });
    }
  });

  it("persists the asymmetric 12/10 override as 220 while leaving scalar reps at 12", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let sessionId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const service = new TrainingService(db);
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "flat_dumbbell_fly" } },
        select: { id: true },
      });
      const program = await service.createProgram({
        name: `stage02-asymmetric-persisted-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const session = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      sessionId = session.id;
      const set = await service.createSet(session.id, session.exercises[0]!.id, {
        reps: 12,
        weightKg: 10,
        loadAccountingOverride: { reps: { kind: "asymmetric-per-side", left: 12, right: 10 } },
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(set.reps).toBe(12);
      const materialized = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(materialized.loadAccountingV1?.externalLoadVolume.value).toBe(220);
      const persisted = await db.strengthSet.findUniqueOrThrow({
        where: { id: set.id },
        select: { reps: true, weightKg: true, loadAccountingOverride: true },
      });
      expect(persisted).toMatchObject({ reps: 12, loadAccountingOverride: { reps: { kind: "asymmetric-per-side", left: 12, right: 10 } } });
      expect(persisted.weightKg?.toNumber()).toBe(10);
      const snapshot = await db.strengthSessionAccountingSnapshot.findFirstOrThrow({
        where: { sessionId: session.id, snapshotRevision: materialized.snapshotRevision },
        select: { payload: true },
      });
      expect((snapshot.payload as { result: { externalLoadVolume: { value: number } } }).result.externalLoadVolume.value).toBe(220);
      const { persistedPayloadFromUnknown } = await import("../../src/modules/training/persisted-load-accounting-v1");
      const parsedSnapshot = persistedPayloadFromUnknown(snapshot.payload);
      if (!parsedSnapshot || !("breakdown" in parsedSnapshot)) throw new Error("asymmetric snapshot is missing breakdown");
      const breakdownRow = parsedSnapshot.breakdown.rows.find(({ strengthSetId }) => strengthSetId === set.id);
      expect(breakdownRow).toMatchObject({
        scalarReps: 12,
        effectiveReps: 22,
        asymmetricReps: { left: 12, right: 10 },
        enteredLoad: { externalKg: 10 },
        contributions: [expect.objectContaining({
          category: "externalLoadVolume",
          basis: "per-implement-kg",
          value: 220,
          effectiveMultiplier: 1,
          availability: "available",
          provenance: [expect.objectContaining({ kind: "set-override" })],
        })],
      });
      expect((await service.getSession(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID))?.exercises[0]?.sets[0]?.reps).toBe(12);
      expect((await service.getSession(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID))?.loadAccountingBreakdown?.status).toBe("available");
    } finally {
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
    }
  });

  it("keeps ordinary GET read-only and finalizes expired sessions idempotently", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let ordinarySessionId: number | null = null;
    let expiredSessionId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const service = new TrainingService(db);
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "incline_dumbbell_press_30deg" } },
        select: { id: true },
      });
      const program = await service.createProgram({
        name: `stage02-get-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const ordinary = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      ordinarySessionId = ordinary.id;
      await service.createSet(ordinary.id, ordinary.exercises[0]!.id, { reps: 8, weightKg: 10 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      await service.materializeSessionAccounting(ordinary.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const before = await db.strengthDiarySession.findUniqueOrThrow({ where: { id: ordinary.id }, select: { accountingInputRevision: true, currentSnapshotRevision: true } });
      const [snapshotCount, operationCount] = await Promise.all([
        db.strengthSessionAccountingSnapshot.count({ where: { sessionId: ordinary.id } }),
        db.strengthSessionAccountingOperation.count({ where: { sessionId: ordinary.id } }),
      ]);
      await Promise.all([service.getSession(ordinary.id, TRAINING_HISTORY_STAGE01_PROFILE_ID), service.getSession(ordinary.id, TRAINING_HISTORY_STAGE01_PROFILE_ID)]);
      const after = await db.strengthDiarySession.findUniqueOrThrow({ where: { id: ordinary.id }, select: { accountingInputRevision: true, currentSnapshotRevision: true } });
      expect(after).toEqual(before);
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: ordinary.id } })).toBe(snapshotCount);
      expect(await db.strengthSessionAccountingOperation.count({ where: { sessionId: ordinary.id } })).toBe(operationCount);
      await service.finishSession(ordinary.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);

      const expired = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expiredSessionId = expired.id;
      const lastSetAt = new Date(Date.now() - 31 * 60_000);
      await service.createSet(expired.id, expired.exercises[0]!.id, {
        reps: 12, weightKg: 10, completedAt: lastSetAt.toISOString(),
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const [one, two] = await Promise.all([
        service.getSession(expired.id, TRAINING_HISTORY_STAGE01_PROFILE_ID),
        service.getSession(expired.id, TRAINING_HISTORY_STAGE01_PROFILE_ID),
      ]);
      expect(one?.status).toBe("COMPLETED");
      expect(two?.status).toBe("COMPLETED");
      expect(one?.webEndedAt).toBe(lastSetAt.toISOString());
      expect(two?.webEndedAt).toBe(one?.webEndedAt);
      expect(one?.loadAccountingV1?.externalLoadVolume.value).toBe(240);
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: expired.id } })).toBe(1);
      expect(await db.strengthSessionAccountingOperation.count({ where: { sessionId: expired.id, idempotencyKey: { startsWith: `inactivity-finalize:${expired.id}:` } } })).toBe(1);
      const revision = await db.strengthDiarySession.findUniqueOrThrow({ where: { id: expired.id }, select: { currentSnapshotRevision: true } });
      const repeated = await service.getSession(expired.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(repeated?.loadAccountingV1?.externalLoadVolume.value).toBe(240);
      expect((await db.strengthDiarySession.findUniqueOrThrow({ where: { id: expired.id }, select: { currentSnapshotRevision: true } })).currentSnapshotRevision)
        .toBe(revision.currentSnapshotRevision);
    } finally {
      if (ordinarySessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: ordinarySessionId } });
      if (expiredSessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: expiredSessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
    }
  });

  it("finishes with unavailable bodyweight mass while preserving external metrics", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let sessionId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const service = new TrainingService(db);
      const catalogs = await Promise.all(["pull_up", "incline_dumbbell_press_30deg"].map((stableKey) =>
        db.exerciseCatalog.findUniqueOrThrow({ where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey } }, select: { id: true } })));
      const program = await service.createProgram({
        name: `stage02-unavailable-finish-${Date.now()}`,
        exercises: [
          { catalogId: catalogs[0]!.id, plannedSets: 1, resistanceType: "BODYWEIGHT" },
          { catalogId: catalogs[1]!.id, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT" },
        ],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const session = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "Europe/Bratislava");
      sessionId = session.id;
      await service.updateSessionAccountingContext(session.id, { effectiveAccountingAt: "2010-04-15T10:00:00.000Z" }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      await service.createSet(session.id, session.exercises[0]!.id, { reps: 10 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      await service.createSet(session.id, session.exercises[1]!.id, { reps: 8, weightKg: 20 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const finished = await service.finishSession(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.loadAccountingV1?.bodyweight.reference).toMatchObject({ status: "unavailable", valueKg: null });
      expect(finished.loadAccountingV1?.bodyweight.referenceVolume).toMatchObject({ value: null, availability: "unavailable" });
      expect(finished.loadAccountingV1?.externalLoadVolume).toMatchObject({ value: 320, availability: "available" });
      const reloaded = await service.getSession(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(reloaded?.status).toBe("COMPLETED");
      expect(reloaded?.loadAccountingV1?.bodyweight.reference.valueKg).toBeNull();
      expect(reloaded?.loadAccountingV1?.externalLoadVolume.value).toBe(320);
    } finally {
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
    }
  });

  it("keeps an unavailable current mass on a no-op and re-resolves it after an accounting edit", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let sessionId: number | null = null;
    let sampleId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const { localDateTimeToInstant } = await import("../../src/model/time-zone");
      const service = new TrainingService(db);
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "pull_up" } },
        select: { id: true },
      });
      const program = await service.createProgram({
        name: `stage02-unavailable-refresh-on-edit-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "BODYWEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const session = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "Europe/Bratislava");
      sessionId = session.id;
      await service.updateSessionAccountingContext(
        session.id,
        { effectiveAccountingAt: "2010-04-15T10:00:00.000Z" },
        TRAINING_HISTORY_STAGE01_PROFILE_ID,
      );
      const set = await service.createSet(session.id, session.exercises[0]!.id, { reps: 10 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const unavailable = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(unavailable.loadAccountingV1?.bodyweight.reference)
        .toMatchObject({ status: "unavailable", valueKg: null, localDate: "2010-04-15" });

      const sample = await db.healthMetricSample.create({
        data: {
          date: "2010-04-15",
          metric: "weight-kg",
          source: "apple-health-shortcut",
          timestamp: localDateTimeToInstant("2010-04-15", "12:00", "Europe/Bratislava"),
          value: 80,
        },
        select: { id: true },
      });
      sampleId = sample.id;

      const unchanged = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(unchanged.snapshotRevision).toBe(unavailable.snapshotRevision);
      expect(unchanged.loadAccountingV1?.bodyweight.reference.status).toBe("unavailable");

      await service.updateSet(session.id, set.id, { reps: 11 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const available = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(available.snapshotRevision).toBeGreaterThan(unavailable.snapshotRevision!);
      expect(available.loadAccountingV1?.bodyweight.reference)
        .toMatchObject({ status: "observed", valueKg: 80, source: "apple-health-shortcut" });
      expect(available.loadAccountingV1?.bodyweight.referenceVolume.value).toBe(880);
      const snapshots = await db.strengthSessionAccountingSnapshot.findMany({
        where: { sessionId: session.id },
        orderBy: { snapshotRevision: "asc" },
        select: { snapshotRevision: true, payload: true },
      });
      expect(snapshots).toHaveLength(2);
      expect((snapshots[0]!.payload as { massReference: { status: string } }).massReference.status).toBe("unavailable");
      expect((snapshots[1]!.payload as { massReference: { valueKg: number } }).massReference.valueKg).toBe(80);
    } finally {
      if (sampleId !== null) await db.healthMetricSample.deleteMany({ where: { id: sampleId } });
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
    }
  });

  it("keeps same-local-date matching stable and invalidates when manual match changes the accounting date", async () => {
    const db = prisma!;
    let programId: number | null = null;
    const sessionIds: number[] = [];
    const dates = ["2045-01-01", "2045-01-02", "2045-01-03"];
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const { PrismaHealthSyncRepository } = await import("../../src/modules/health/health.repository");
      const service = new TrainingService(db);
      const sync = new PrismaHealthSyncRepository(db);
      const syncWorkout = async (date: string, startAt: string, externalId: string, durationMinutes = 30) => {
        const day = { date, workouts: [{ externalId, type: "Traditional Strength Training", startAt, endAt: new Date(Date.parse(startAt) + durationMinutes * 60_000).toISOString() }] };
        await sync.syncDay(day, day, { timezone: "UTC", receivedAt: new Date(), syncedAt: null });
        return db.workout.findFirstOrThrow({ where: { externalId }, select: { id: true, startAt: true } });
      };
      const firstWorkout = await syncWorkout(dates[0]!, "2045-01-01T10:00:00.000Z", "stage02-refreshable-linked-workout");
      const nextDayWorkout = await syncWorkout(dates[1]!, "2045-01-02T10:00:00.000Z", "stage02-nextday-linked-workout");
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "incline_dumbbell_press_30deg" } },
        select: { id: true },
      });
      const program = await service.createProgram({
        name: `stage02-match-invalidation-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;

      const sameDate = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "Pacific/Auckland");
      sessionIds.push(sameDate.id);
      await service.updateSessionAccountingContext(sameDate.id, { effectiveAccountingAt: "2045-01-01T09:00:00.000Z" }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      await service.createSet(sameDate.id, sameDate.exercises[0]!.id, { reps: 8, weightKg: 10 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      await service.finishSession(sameDate.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const beforeMatch = await db.strengthDiarySession.findUniqueOrThrow({ where: { id: sameDate.id }, select: { accountingInputRevision: true, currentSnapshotRevision: true } });
      const generationBeforeSameDateMatch = await db.physiologyV7Lifecycle.findUnique({
        where: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID },
        select: { invalidationGeneration: true },
      });
      const matched = await service.manualMatch(sameDate.id, { workoutId: firstWorkout.id }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const generationAfterSameDateMatch = await db.physiologyV7Lifecycle.findUniqueOrThrow({
        where: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID },
        select: { invalidationGeneration: true, staleFromDate: true },
      });
      expect(generationAfterSameDateMatch.invalidationGeneration)
        .toBeGreaterThan(generationBeforeSameDateMatch?.invalidationGeneration ?? 0);
      expect(generationAfterSameDateMatch.staleFromDate).not.toBeNull();
      expect(matched.effectiveAccountingAt).toBe(firstWorkout.startAt.toISOString());
      const afterSameDateMatch = await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: sameDate.id },
        select: {
          effectiveAccountingAt: true,
          accountingInputRevision: true,
          currentSnapshotRevision: true,
          currentAccountingSnapshot: { select: { snapshotRevision: true, payload: true } },
        },
      });
      expect(afterSameDateMatch.accountingInputRevision).toBe(beforeMatch.accountingInputRevision);
      expect(afterSameDateMatch.currentSnapshotRevision).toBeGreaterThan(beforeMatch.currentSnapshotRevision!);
      expect(afterSameDateMatch.currentAccountingSnapshot?.snapshotRevision).toBe(afterSameDateMatch.currentSnapshotRevision);
      expect((afterSameDateMatch.currentAccountingSnapshot?.payload as { effectiveAccountingAt: string }).effectiveAccountingAt)
        .toBe(afterSameDateMatch.effectiveAccountingAt?.toISOString());
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: sameDate.id } })).toBe(2);
      const snapshotBeforeTimestampCorrection = await db.strengthSessionAccountingSnapshot.findUniqueOrThrow({
        where: {
          sessionId_snapshotRevision: {
            sessionId: sameDate.id,
            snapshotRevision: afterSameDateMatch.currentSnapshotRevision!,
          },
        },
      });

      await syncWorkout(dates[0]!, "2045-01-01T10:30:00.000Z", "stage02-refreshable-linked-workout");
      const afterSameDateHealthCorrection = await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: sameDate.id },
        select: {
          effectiveAccountingAt: true,
          accountingInputRevision: true,
          currentSnapshotRevision: true,
          currentAccountingSnapshot: { select: { snapshotRevision: true, payload: true } },
        },
      });
      expect(afterSameDateHealthCorrection.effectiveAccountingAt?.toISOString()).toBe("2045-01-01T10:30:00.000Z");
      expect(afterSameDateHealthCorrection.accountingInputRevision).toBe(beforeMatch.accountingInputRevision);
      expect(afterSameDateHealthCorrection.currentAccountingSnapshot?.snapshotRevision)
        .toBe(afterSameDateHealthCorrection.currentSnapshotRevision);
      expect((afterSameDateHealthCorrection.currentAccountingSnapshot?.payload as { effectiveAccountingAt: string }).effectiveAccountingAt)
        .toBe(afterSameDateHealthCorrection.effectiveAccountingAt?.toISOString());
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: sameDate.id } })).toBe(3);
      const oldSnapshotAfterCorrection = await db.strengthSessionAccountingSnapshot.findUniqueOrThrow({
        where: {
          sessionId_snapshotRevision: {
            sessionId: sameDate.id,
            snapshotRevision: snapshotBeforeTimestampCorrection.snapshotRevision,
          },
        },
      });
      const rebasedSnapshot = await db.strengthSessionAccountingSnapshot.findUniqueOrThrow({
        where: {
          sessionId_snapshotRevision: {
            sessionId: sameDate.id,
            snapshotRevision: afterSameDateHealthCorrection.currentSnapshotRevision!,
          },
        },
      });
      expect(oldSnapshotAfterCorrection).toEqual(snapshotBeforeTimestampCorrection);
      expect(rebasedSnapshot.snapshotRevision).toBe(snapshotBeforeTimestampCorrection.snapshotRevision + 1);
      expect(rebasedSnapshot.accountingInputRevision).toBe(snapshotBeforeTimestampCorrection.accountingInputRevision);
      expect(rebasedSnapshot.inputFingerprint).toBe(snapshotBeforeTimestampCorrection.inputFingerprint);
      expect(rebasedSnapshot).toMatchObject({
        effectiveLocalDate: snapshotBeforeTimestampCorrection.effectiveLocalDate,
        timeZone: snapshotBeforeTimestampCorrection.timeZone,
        timeZoneProvenance: snapshotBeforeTimestampCorrection.timeZoneProvenance,
        accountingMethodVersion: snapshotBeforeTimestampCorrection.accountingMethodVersion,
        massResolutionMethodVersion: snapshotBeforeTimestampCorrection.massResolutionMethodVersion,
        massResolutionIdentity: snapshotBeforeTimestampCorrection.massResolutionIdentity,
        payloadVersion: snapshotBeforeTimestampCorrection.payloadVersion,
      });
      const snapshotCalculation = (value: unknown) => {
        const payload = { ...(value as Record<string, unknown>) };
        delete payload.snapshotRevision;
        delete payload.effectiveAccountingAt;
        return payload;
      };
      expect(snapshotCalculation(rebasedSnapshot.payload)).toEqual(snapshotCalculation(snapshotBeforeTimestampCorrection.payload));
      expect((rebasedSnapshot.payload as { effectiveAccountingAt: string }).effectiveAccountingAt)
        .toBe(afterSameDateHealthCorrection.effectiveAccountingAt?.toISOString());
      expect((rebasedSnapshot.payload as { snapshotRevision: number }).snapshotRevision)
        .toBe(afterSameDateHealthCorrection.currentSnapshotRevision);
      expect(afterSameDateHealthCorrection.currentSnapshotRevision).toBe(rebasedSnapshot.snapshotRevision);

      await syncWorkout(dates[0]!, "2045-01-01T23:00:00.000Z", "stage02-refreshable-linked-workout");
      const afterHealthCorrection = await db.strengthDiarySession.findUniqueOrThrow({ where: { id: sameDate.id }, select: { effectiveAccountingAt: true, accountingInputRevision: true, currentSnapshotRevision: true } });
      expect(afterHealthCorrection.effectiveAccountingAt?.toISOString()).toBe("2045-01-01T23:00:00.000Z");
      expect(afterHealthCorrection.accountingInputRevision).toBe(beforeMatch.accountingInputRevision + 1);
      expect(afterHealthCorrection.currentSnapshotRevision).toBeNull();
      const correctedSnapshot = await service.materializeSessionAccounting(sameDate.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: sameDate.id } })).toBe(4);
      expect((await db.strengthSessionAccountingSnapshot.findFirstOrThrow({ where: { sessionId: sameDate.id, snapshotRevision: correctedSnapshot.snapshotRevision }, select: { effectiveLocalDate: true } })).effectiveLocalDate)
        .toBe("2045-01-02");

      const changedDate = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "UTC");
      sessionIds.push(changedDate.id);
      await service.updateSessionAccountingContext(changedDate.id, { effectiveAccountingAt: "2045-01-01T09:00:00.000Z" }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      await service.createSet(changedDate.id, changedDate.exercises[0]!.id, { reps: 8, weightKg: 10 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      await service.finishSession(changedDate.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const beforeLateMatch = await db.strengthDiarySession.findUniqueOrThrow({ where: { id: changedDate.id }, select: { accountingInputRevision: true, currentSnapshotRevision: true } });
      const generationBeforeLateMatch = await db.physiologyV7Lifecycle.findUnique({
        where: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID },
        select: { invalidationGeneration: true },
      });
      const lateMatched = await service.manualMatch(changedDate.id, { workoutId: nextDayWorkout.id }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const generationAfterLateMatch = await db.physiologyV7Lifecycle.findUniqueOrThrow({
        where: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID },
        select: { invalidationGeneration: true, staleFromDate: true },
      });
      expect(generationAfterLateMatch.invalidationGeneration)
        .toBeGreaterThan(generationBeforeLateMatch?.invalidationGeneration ?? 0);
      expect(generationAfterLateMatch.staleFromDate).not.toBeNull();
      expect(lateMatched.effectiveAccountingAt).toBe(nextDayWorkout.startAt.toISOString());
      const afterLateMatch = await db.strengthDiarySession.findUniqueOrThrow({ where: { id: changedDate.id }, select: { accountingInputRevision: true, currentSnapshotRevision: true } });
      expect(afterLateMatch.accountingInputRevision).toBe(beforeLateMatch.accountingInputRevision + 1);
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: changedDate.id } })).toBe(2);
      const generationBeforeUnmatch = generationAfterLateMatch.invalidationGeneration;
      const unmatched = await service.manualMatch(changedDate.id, { workoutId: null }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const generationAfterUnmatch = await db.physiologyV7Lifecycle.findUniqueOrThrow({
        where: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID },
        select: { invalidationGeneration: true, staleFromDate: true },
      });
      expect(generationAfterUnmatch.invalidationGeneration).toBeGreaterThan(generationBeforeUnmatch);
      expect(generationAfterUnmatch.staleFromDate).not.toBeNull();
      expect(unmatched.matchedWorkoutId).toBeNull();
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: changedDate.id } })).toBe(3);

      const lateAuto = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "UTC");
      sessionIds.push(lateAuto.id);
      await service.updateSessionAccountingContext(lateAuto.id, { effectiveAccountingAt: "2045-01-02T23:30:00.000Z" }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      await service.createSet(lateAuto.id, lateAuto.exercises[0]!.id, { reps: 8, weightKg: 10 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      await service.finishSession(lateAuto.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const beforeAutoMatch = await db.strengthDiarySession.findUniqueOrThrow({ where: { id: lateAuto.id }, select: { accountingInputRevision: true } });
      await db.strengthDiarySession.update({
        where: { id: lateAuto.id },
        data: { webStartedAt: new Date("2045-01-02T23:30:00.000Z"), webEndedAt: new Date("2045-01-03T01:00:00.000Z") },
      });
      const lateWorkout = await syncWorkout(dates[2]!, "2045-01-03T00:00:00.000Z", "stage02-late-auto-match", 60);
      const generationBeforeAutoMatch = await db.physiologyV7Lifecycle.findUnique({
        where: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID },
        select: { invalidationGeneration: true },
      });
      await service.afterHealthSyncMatch(dates[2]!, { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, timezone: "UTC" });
      const generationAfterAutoMatch = await db.physiologyV7Lifecycle.findUniqueOrThrow({
        where: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID },
        select: { invalidationGeneration: true, staleFromDate: true },
      });
      expect(generationAfterAutoMatch.invalidationGeneration)
        .toBeGreaterThan(generationBeforeAutoMatch?.invalidationGeneration ?? 0);
      expect(generationAfterAutoMatch.staleFromDate).not.toBeNull();
      const autoMatched = await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: lateAuto.id },
        select: { matchedWorkoutId: true, effectiveAccountingAt: true, currentSnapshotRevision: true, accountingInputRevision: true },
      });
      expect(autoMatched.matchedWorkoutId).toBe(lateWorkout.id);
      expect(autoMatched.effectiveAccountingAt?.toISOString()).toBe("2045-01-03T00:00:00.000Z");
      expect(autoMatched.accountingInputRevision).toBe(beforeAutoMatch.accountingInputRevision + 1);
      expect(autoMatched.currentSnapshotRevision).toBeNull();
      const rematerialized = await service.materializeSessionAccounting(lateAuto.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(rematerialized.effectiveAccountingAt).toBe("2045-01-03T00:00:00.000Z");
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: lateAuto.id } })).toBe(2);
    } finally {
      if (sessionIds.length > 0) await db.strengthDiarySession.deleteMany({ where: { id: { in: sessionIds } } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
      await db.healthSyncSnapshot.deleteMany({ where: { date: { in: dates } } });
      await db.workout.deleteMany({ where: { dailyHealthData: { date: { in: dates } } } });
      await db.dailyHealthData.deleteMany({ where: { date: { in: dates } } });
    }
  });

  it("keeps an unfinished session compatible with a legacy client while storing an explicit asymmetric override", async () => {
    const db = prisma!;
    const catalog = await db.exerciseCatalog.create({
      data: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, name: `stage02-compat-${Date.now()}` },
      select: { id: true },
    });
    let programId: number | null = null;
    let sessionId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const service = new TrainingService(db);
      await service.updateCatalogLoadAccountingConfig(catalog.id, {
        loadAccountingConfig: {
          schemaVersion: 1,
          configVersion: "integration-pair-v1",
          inventoryCount: 2,
          loadedSides: 2,
          execution: "simultaneous",
          equipment: { equipmentId: "dumbbell", setupId: "pair" },
          accountingKind: "external-per-implement-per-side",
          resistanceType: "external",
          loadInput: "per-implement-kg",
          repsMeaning: "per-side",
        },
      });
      const program = await service.createProgram({
        name: `stage02-compat-program-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 2, resistanceType: "EXTERNAL_WEIGHT" }],
      });
      programId = program.id;
      const session = await service.startSession(program.id);
      sessionId = session.id;
      const exerciseId = session.exercises[0]!.id;

      // Existing clients send only the pre-Stage-02 scalar fields.
      const oldClientSet = await service.createSet(session.id, exerciseId, { reps: 12, weightKg: 10 });
      expect(oldClientSet).toMatchObject({ reps: 12, weightKg: 10, loadAccountingOverride: null });
      const asymmetricSet = await service.createSet(session.id, exerciseId, {
        reps: 12,
        weightKg: 10,
        loadAccountingOverride: {
          reps: { kind: "asymmetric-per-side", left: 12, right: 10 },
        },
      });
      expect(asymmetricSet.reps).toBe(12);

      await service.materializeSessionAccounting(session.id);
      const stillActive = await service.getSession(session.id);
      expect(stillActive?.status).toBe("ACTIVE");
      expect(stillActive?.exercises[0]?.sets.map(({ reps }) => reps)).toEqual([12, 12]);
      expect(stillActive?.loadAccountingV1?.externalLoadVolume.value).toBe(460);
      expect(stillActive?.loadAccountingV1?.externalLoadVolume.coverage).toMatchObject({
        eligibleRows: 2, accountedRows: 2, omittedRows: 0,
      });
    } finally {
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
      await db.exerciseCatalog.deleteMany({ where: { id: catalog.id } });
    }
  });

  it("persists one scalar band rep count as equal contributions on both sides", async () => {
    const db = prisma!;
    const catalog = await db.exerciseCatalog.create({
      data: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, name: `stage02-band-pair-${Date.now()}` },
      select: { id: true },
    });
    let programId: number | null = null;
    let sessionId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const { persistedPayloadFromUnknown } = await import("../../src/modules/training/persisted-load-accounting-v1");
      const service = new TrainingService(db);
      await service.updateCatalogLoadAccountingConfig(catalog.id, {
        loadAccountingConfig: {
          schemaVersion: 1,
          configVersion: "integration-band-both-sides-v1",
          inventoryCount: 1,
          loadedSides: 2,
          execution: "unilateral",
          equipment: { equipmentId: "resistance-band", setupId: "both-sides" },
          accountingKind: "band-nominal-per-side",
          resistanceType: "band-nominal",
          loadInput: "nominal-kg-per-logged-side",
          repsMeaning: "per-side",
        },
      });
      const program = await service.createProgram({
        name: `stage02-band-pair-program-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "RESISTANCE_BAND" }],
      });
      programId = program.id;
      const active = await service.startSession(program.id);
      sessionId = active.id;
      const exerciseId = active.exercises[0]!.id;

      // This is the old scalar set-entry shape: reps is entered once, without side fields.
      const set = await service.createSet(active.id, exerciseId, {
        reps: 12,
        bandNominalResistanceKg: 20,
      });
      expect(set).toMatchObject({ reps: 12, loadAccountingOverride: null });
      const finished = await service.finishSession(active.id);
      expect(finished.loadAccountingV1?.bandNominalIndex.leftSide.value).toBe(240);
      expect(finished.loadAccountingV1?.bandNominalIndex.rightSide.value).toBe(240);
      expect(finished.loadAccountingV1?.bandNominalIndex.perLoggedSide.value).toBe(0);

      const current = await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: active.id },
        select: { currentSnapshotRevision: true },
      });
      const snapshot = await db.strengthSessionAccountingSnapshot.findFirstOrThrow({
        where: { sessionId: active.id, snapshotRevision: current.currentSnapshotRevision! },
        select: { payload: true },
      });
      const payload = persistedPayloadFromUnknown(snapshot.payload);
      if (!payload || !("breakdown" in payload)) {
        throw new Error("persisted band-pair snapshot is missing its V2 breakdown");
      }
      const row = payload.breakdown.rows[0]!;
      expect(row.scalarReps).toBe(12);
      expect(row.effectiveReps).toBe(24);
      expect(row.asymmetricReps).toBeNull();
      expect(row.contributions).toEqual(expect.arrayContaining([
        expect.objectContaining({ category: "bandNominalLeftSide", value: 240, availability: "available" }),
        expect.objectContaining({ category: "bandNominalRightSide", value: 240, availability: "available" }),
      ]));
      expect(row.contributions.some(({ category }) => category === "bandNominalPerLoggedSide")).toBe(false);
      const reloaded = await service.getSession(active.id);
      expect(reloaded?.loadAccountingV1?.bandNominalIndex.leftSide.value).toBe(240);
      expect(reloaded?.loadAccountingV1?.bandNominalIndex.rightSide.value).toBe(240);
      expect((reloaded?.loadAccountingV1?.bandNominalIndex.leftSide.value ?? 0)
        + (reloaded?.loadAccountingV1?.bandNominalIndex.rightSide.value ?? 0)).toBe(480);
    } finally {
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
      await db.exerciseCatalog.deleteMany({ where: { id: catalog.id } });
    }
  });

  it("preserves a legacy client's active workout across catalog changes, reload, and finish", async () => {
    const db = prisma!;
    const catalog = await db.exerciseCatalog.findUniqueOrThrow({
      where: {
        profileId_stableKey: {
          profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID,
          stableKey: "incline_dumbbell_press_30deg",
        },
      },
      select: { id: true, currentLoadAccountingConfigId: true, updatedAt: true },
    });
    expect(catalog.currentLoadAccountingConfigId).toBeNull();

    let programId: number | null = null;
    let sessionId: number | null = null;
    let mutatedConfigId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const service = new TrainingService(db);
      const program = await service.createProgram({
        name: `stage02-old-client-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 3, resistanceType: "EXTERNAL_WEIGHT" }],
      });
      programId = program.id;
      const session = await service.startSession(program.id);
      sessionId = session.id;
      const exerciseId = session.exercises[0]!.id;
      const initialSnapshot = session.exercises[0]!.loadAccountingConfigSnapshot;
      expect(initialSnapshot).toMatchObject({
        configVersion: "bodycast-historical-load-entry-v1",
        inventoryCount: 2,
      });

      const firstSet = await service.createSet(session.id, exerciseId, { reps: 12, weightKg: 10, rir: 2 });
      const secondSet = await service.createSet(session.id, exerciseId, { reps: 8, weightKg: 20, rir: 1 });
      expect([firstSet, secondSet].map(({ reps, rir, loadAccountingOverride }) => [reps, rir, loadAccountingOverride]))
        .toEqual([[12, 2, null], [8, 1, null]]);

      const { persistedPayloadFromUnknown } = await import("../../src/modules/training/persisted-load-accounting-v1");
      const historicalMaterialization = await service.materializeSessionAccounting(
        session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID,
      );
      const historicalSnapshot = await db.strengthSessionAccountingSnapshot.findFirstOrThrow({
        where: { sessionId: session.id, snapshotRevision: historicalMaterialization.snapshotRevision },
        select: { snapshotRevision: true, payload: true },
      });
      const historicalPayload = persistedPayloadFromUnknown(historicalSnapshot.payload);
      if (!historicalPayload || !("breakdown" in historicalPayload)) {
        throw new Error("catalog-change fixture is missing a V2 historical breakdown");
      }
      const historicalRows = structuredClone(historicalPayload.breakdown.rows);
      expect(historicalRows).toHaveLength(2);

      await service.updateCatalogLoadAccountingConfig(catalog.id, {
        loadAccountingConfig: {
          schemaVersion: 1,
          configVersion: `integration-mutated-${Date.now()}`,
          inventoryCount: 1,
          loadedSides: 1,
          execution: "unilateral",
          equipment: { equipmentId: "dumbbell", setupId: "single" },
          accountingKind: "external-per-implement-per-side",
          resistanceType: "external",
          loadInput: "per-implement-kg",
          repsMeaning: "per-side",
        },
      });
      mutatedConfigId = (await db.exerciseCatalog.findUniqueOrThrow({
        where: { id: catalog.id }, select: { currentLoadAccountingConfigId: true },
      })).currentLoadAccountingConfigId;
      expect(mutatedConfigId).not.toBeNull();

      const historicalAfterCatalogChange = await db.strengthSessionAccountingSnapshot.findFirstOrThrow({
        where: { sessionId: session.id, snapshotRevision: historicalSnapshot.snapshotRevision },
        select: { payload: true },
      });
      expect(historicalAfterCatalogChange.payload).toEqual(historicalSnapshot.payload);
      const rereadHistoricalPayload = persistedPayloadFromUnknown(historicalAfterCatalogChange.payload);
      if (!rereadHistoricalPayload || !("breakdown" in rereadHistoricalPayload)) {
        throw new Error("catalog change caused historical V2 breakdown to become unreadable");
      }
      expect(rereadHistoricalPayload.breakdown.rows).toEqual(historicalRows);

      const thirdSet = await service.createSet(session.id, exerciseId, { reps: 6, weightKg: 5, rir: 3 });
      expect(thirdSet).toMatchObject({ reps: 6, rir: 3, loadAccountingOverride: null });

      const snapshotA = await service.materializeSessionAccounting(session.id, undefined, "stage02-a-b-a-first");
      const newlyMaterializedSnapshot = await db.strengthSessionAccountingSnapshot.findFirstOrThrow({
        where: { sessionId: session.id, snapshotRevision: snapshotA.snapshotRevision },
        select: { payload: true },
      });
      const newlyMaterializedPayload = persistedPayloadFromUnknown(newlyMaterializedSnapshot.payload);
      if (!newlyMaterializedPayload || !("breakdown" in newlyMaterializedPayload)) {
        throw new Error("new materialization after catalog change is missing V2 breakdown");
      }
      expect(newlyMaterializedPayload.breakdown.rows).toHaveLength(3);
      const historicalConfigVersion = historicalRows[0]?.config.sourceSnapshot?.configVersion;
      expect(historicalConfigVersion).toBeDefined();
      expect(newlyMaterializedPayload.breakdown.rows.every((row) =>
        row.config.sourceSnapshot?.configVersion === historicalConfigVersion)).toBe(true);
      const repeatedA = await service.materializeSessionAccounting(session.id, undefined, "stage02-a-b-a-first");
      expect(repeatedA.snapshotRevision).toBe(snapshotA.snapshotRevision);
      const concurrentA = await Promise.all([
        service.materializeSessionAccounting(session.id),
        service.materializeSessionAccounting(session.id),
      ]);
      expect(concurrentA.map(({ snapshotRevision }) => snapshotRevision)).toEqual([
        snapshotA.snapshotRevision, snapshotA.snapshotRevision,
      ]);

      await service.updateSet(session.id, firstSet.id, { reps: 20 });
      const snapshotB = await service.materializeSessionAccounting(session.id);
      await service.updateSet(session.id, firstSet.id, { reps: 12 });
      const snapshotAAgain = await service.materializeSessionAccounting(session.id);
      expect(snapshotB.snapshotRevision).toBeGreaterThan(snapshotA.snapshotRevision!);
      expect(snapshotAAgain.snapshotRevision).toBeGreaterThan(snapshotB.snapshotRevision!);
      const revisions = await db.strengthSessionAccountingSnapshot.findMany({
        where: { sessionId: session.id },
        orderBy: { snapshotRevision: "asc" },
        select: { snapshotRevision: true, inputFingerprint: true },
      });
      expect(revisions).toHaveLength(4);
      expect(revisions[0]!.snapshotRevision).toBe(historicalSnapshot.snapshotRevision);
      expect(revisions[0]!.inputFingerprint).not.toBe(revisions[1]!.inputFingerprint);
      expect(revisions[1]!.inputFingerprint).not.toBe(revisions[2]!.inputFingerprint);
      expect(revisions[1]!.inputFingerprint).toBe(revisions[3]!.inputFingerprint);

      const contextChanged = await service.updateSessionAccountingContext(session.id, {
        effectiveAccountingAt: "2026-09-29T12:00:00.000Z",
        timeZone: "Europe/Bratislava",
      });
      expect(contextChanged.materializationState).toBe("missing");
      const contextSnapshot = await service.materializeSessionAccounting(session.id);
      expect(contextSnapshot.accountingTimeZone).toBe("Europe/Bratislava");
      expect(contextSnapshot.effectiveAccountingAt).toBe("2026-09-29T12:00:00.000Z");

      const reloadedActive = await service.getSession(session.id);
      expect(reloadedActive?.status).toBe("ACTIVE");
      expect(reloadedActive?.exercises[0]?.loadAccountingConfigSnapshot).toEqual(initialSnapshot);
      expect(reloadedActive?.exercises[0]?.sets.map(({ setNumber }) => setNumber)).toEqual([1, 2, 3]);
      expect(new Set(reloadedActive!.exercises[0]!.sets.map(({ id }) => id)).size).toBe(3);
      expect(reloadedActive?.exercises[0]?.sets.map(({ reps, rir, loadAccountingOverride }) => [reps, rir, loadAccountingOverride]))
        .toEqual([[12, 2, null], [8, 1, null], [6, 3, null]]);
      expect(reloadedActive?.ordinaryTonnageKg).toBe(620);
      expect(reloadedActive?.loadAccountingV1?.externalLoadVolume).toMatchObject({
        value: 620,
        coverage: { eligibleRows: 3, accountedRows: 3, omittedRows: 0 },
      });

      const persistedBeforeFinish = await db.strengthSessionExercise.findUniqueOrThrow({
        where: { id: exerciseId },
        select: { sets: { orderBy: { setNumber: "asc" }, select: {
          id: true, setNumber: true, reps: true, rir: true, completedAt: true, createdAt: true, updatedAt: true,
        } } },
      });
      const finished = await service.finishSession(session.id);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.webEndedAt).not.toBeNull();

      const reloadedCompleted = await service.getSession(session.id);
      expect(reloadedCompleted?.status).toBe("COMPLETED");
      expect(reloadedCompleted?.webEndedAt).toBe(finished.webEndedAt);
      expect(reloadedCompleted?.exercises[0]?.loadAccountingConfigSnapshot).toEqual(initialSnapshot);
      expect(reloadedCompleted?.exercises[0]?.sets.map(({ reps, rir, loadAccountingOverride }) => [reps, rir, loadAccountingOverride]))
        .toEqual([[12, 2, null], [8, 1, null], [6, 3, null]]);
      expect(reloadedCompleted?.ordinaryTonnageKg).toBe(620);
      expect(reloadedCompleted?.loadAccountingV1?.externalLoadVolume.value).toBe(620);

      const persistedAfterFinish = await db.strengthSessionExercise.findUniqueOrThrow({
        where: { id: exerciseId },
        select: { sets: { orderBy: { setNumber: "asc" }, select: {
          id: true, setNumber: true, reps: true, rir: true, completedAt: true, createdAt: true, updatedAt: true,
        } } },
      });
      expect(persistedAfterFinish.sets).toEqual(persistedBeforeFinish.sets);
      expect(persistedAfterFinish.sets).toHaveLength(3);
    } finally {
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
      if (mutatedConfigId !== null) {
        await db.$transaction(async (tx) => {
          await tx.exerciseCatalog.update({
            where: { id: catalog.id },
            data: { currentLoadAccountingConfigId: catalog.currentLoadAccountingConfigId, updatedAt: catalog.updatedAt },
          });
          await tx.exerciseLoadConfiguration.deleteMany({ where: { id: mutatedConfigId! } });
        });
      }
    }
  });

  it("persists and applies the versioned approximate push-up bodyweight share", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let sessionId: number | null = null;
    let sourceId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const { instantToLocalDateTime, localDateTimeToInstant } = await import("../../src/model/time-zone");
      const { CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1, CANONICAL_PUSH_UP_CONFIG_VERSION_V1 } =
        await import("../../src/modules/training/load-accounting-v1");
      const service = new TrainingService(db);
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "pushup_handles" } },
        select: { id: true, currentLoadAccountingConfigId: true },
      });
      expect(catalog.currentLoadAccountingConfigId).toBeNull();
      const program = await service.createProgram({
        name: `stage02-pushup-approx-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "BODYWEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const version = await db.trainingProgramVersion.findFirstOrThrow({
        where: { programId: program.id, versionNumber: 1 }, select: { id: true },
      });
      const programExercise = await db.programExercise.findFirstOrThrow({
        where: { programVersionId: version.id, exerciseCatalogId: catalog.id },
        select: { loadAccountingConfigSnapshot: true },
      });
      expect(programExercise.loadAccountingConfigSnapshot).toMatchObject({
        configVersion: CANONICAL_PUSH_UP_CONFIG_VERSION_V1,
        bodyweightFraction: CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1,
      });

      const session = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "Europe/Bratislava");
      sessionId = session.id;
      const localDate = instantToLocalDateTime(new Date(session.webStartedAt!), "Europe/Bratislava").date;
      const sample = await db.healthMetricSample.create({
        data: {
          date: localDate,
          metric: "weight-kg",
          source: "apple-health-shortcut",
          timestamp: localDateTimeToInstant(localDate, "12:00", "Europe/Bratislava"),
          value: 80,
        },
        select: { id: true },
      });
      sourceId = sample.id;
      const exercise = session.exercises[0]!;
      expect(exercise.loadAccountingConfigSnapshot).toMatchObject({
        configVersion: CANONICAL_PUSH_UP_CONFIG_VERSION_V1,
        bodyweightFraction: CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1,
      });
      const set = await service.createSet(session.id, exercise.id, { reps: 10 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const materialized = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(materialized.loadAccountingV1?.bodyweight.reference).toMatchObject({
        status: "observed", valueKg: 80, source: "apple-health-shortcut",
      });
      expect(materialized.loadAccountingV1?.bodyweight.referenceVolume).toMatchObject({
        value: 560,
        unit: "bodyweight-reference-kg-repetitions",
        availability: "available",
      });

      const persistedSnapshot = await db.strengthSessionAccountingSnapshot.findFirstOrThrow({
        where: { sessionId: session.id, snapshotRevision: materialized.snapshotRevision },
        select: { payload: true },
      });
      const { persistedPayloadFromUnknown } = await import("../../src/modules/training/persisted-load-accounting-v1");
      const payload = persistedPayloadFromUnknown(persistedSnapshot.payload);
      if (!payload || !("breakdown" in payload)) throw new Error("push-up approximation snapshot is missing V2 breakdown");
      const row = payload.breakdown.rows.find(({ strengthSetId }) => strengthSetId === set.id);
      if (!row) throw new Error("push-up approximation snapshot is missing its persisted set row");
      expect(row).toMatchObject({ stableKey: "pushup_handles", scalarReps: 10, effectiveReps: 10 });
      expect(row.config.resolved).toMatchObject({
        configVersion: CANONICAL_PUSH_UP_CONFIG_VERSION_V1,
        bodyweightFraction: CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1,
      });
      expect(row.config.effective).toMatchObject({
        configVersion: CANONICAL_PUSH_UP_CONFIG_VERSION_V1,
        bodyweightFraction: CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1,
      });
      expect(row.mechanics?.effectiveMultiplier).toBe(CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1);
      expect(row.contributions).toContainEqual(expect.objectContaining({
        category: "bodyweightReferenceVolume",
        basis: "bodyweight-reference",
        value: 560,
        effectiveMultiplier: CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1,
        availability: "available",
        provenance: expect.arrayContaining([expect.objectContaining({
          kind: "bodyweight-observation",
          sourceId: String(sample.id),
          localDate,
        })]),
      }));
      expect(await db.strengthSessionAccountingSnapshot.count({ where: { sessionId: session.id } })).toBe(1);
    } finally {
      if (sourceId !== null) await db.healthMetricSample.deleteMany({ where: { id: sourceId } });
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
    }
  });

  it("keeps a materialized observed mass after source deletion and uses it for edited repetitions", async () => {
    const db = prisma!;
    let programId: number | null = null;
    let sessionId: number | null = null;
    let sourceId: number | null = null;
    try {
      const { TrainingService } = await import("../../src/modules/training/training.service");
      const { instantToLocalDateTime, localDateTimeToInstant } = await import("../../src/model/time-zone");
      const service = new TrainingService(db);
      const catalog = await db.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId: TRAINING_HISTORY_STAGE01_PROFILE_ID, stableKey: "pull_up" } },
        select: { id: true },
      });
      const program = await service.createProgram({
        name: `stage02-mass-snapshot-${Date.now()}`,
        exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "BODYWEIGHT" }],
      }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      programId = program.id;
      const session = await service.startSession(program.id, TRAINING_HISTORY_STAGE01_PROFILE_ID, "Europe/Bratislava");
      sessionId = session.id;
      const localDate = instantToLocalDateTime(new Date(session.webStartedAt!), "Europe/Bratislava").date;
      const sample = await db.healthMetricSample.create({
        data: {
          date: localDate,
          metric: "weight-kg",
          source: "apple-health-shortcut",
          timestamp: localDateTimeToInstant(localDate, "12:00", "Europe/Bratislava"),
          value: 87,
        },
        select: { id: true },
      });
      sourceId = sample.id;
      const exercise = session.exercises[0]!;
      const set = await service.createSet(session.id, exercise.id, { reps: 18 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const initial = await service.materializeSessionAccounting(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(initial.loadAccountingV1?.bodyweight.referenceVolume.value).toBe(1566);
      expect(initial.loadAccountingV1?.bodyweight.reference).toMatchObject({
        status: "observed", valueKg: 87, source: "apple-health-shortcut",
      });

      const { persistedPayloadFromUnknown } = await import("../../src/modules/training/persisted-load-accounting-v1");
      const initialSnapshot = await db.strengthSessionAccountingSnapshot.findFirstOrThrow({
        where: { sessionId: session.id, snapshotRevision: initial.snapshotRevision },
        select: { snapshotRevision: true, payload: true },
      });
      const initialPayload = persistedPayloadFromUnknown(initialSnapshot.payload);
      if (!initialPayload || !("breakdown" in initialPayload)) {
        throw new Error("source-deletion fixture is missing a V2 historical breakdown");
      }
      const initialBodyweightRow = initialPayload.breakdown.rows.find(({ strengthSetId }) =>
        strengthSetId === set.id);
      if (!initialBodyweightRow) throw new Error("source-deletion fixture is missing its persisted set row");
      expect(initialPayload.massReference).toMatchObject({
        status: "observed", valueKg: 87, sourceId: String(sample.id),
      });
      expect(initialBodyweightRow.contributions).toContainEqual(expect.objectContaining({
        category: "bodyweightReferenceVolume",
        basis: "bodyweight-reference",
        value: 1566,
        unit: "bodyweight-reference-kg-repetitions",
        availability: "available",
        provenance: expect.arrayContaining([expect.objectContaining({
          kind: "bodyweight-observation",
          sourceId: String(sample.id),
          version: "apple-health-shortcut",
        })]),
      }));
      const frozenHistoricalPayload = structuredClone(initialSnapshot.payload);
      const frozenHistoricalRow = structuredClone(initialBodyweightRow);

      await db.healthMetricSample.delete({ where: { id: sample.id } });
      expect(await db.healthMetricSample.findUnique({ where: { id: sample.id }, select: { id: true } })).toBeNull();
      const afterDelete = await service.getSession(session.id, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      expect(afterDelete?.loadAccountingV1?.bodyweight.referenceVolume.value).toBe(1566);

      await service.updateSet(session.id, set.id, { reps: 20 }, TRAINING_HISTORY_STAGE01_PROFILE_ID);
      const invalidated = await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: session.id },
        select: { currentSnapshotRevision: true },
      });
      expect(invalidated.currentSnapshotRevision).toBeNull();

      // Exercise the exact route used by the missing-snapshot UI action. This
      // must use ordinary materialization so the previously persisted mass is
      // reused after its HealthMetricSample source has been deleted.
      const materializeRoute = await import("../../src/app/api/v1/training/sessions/[id]/accounting/materialize/route");
      const response = await materializeRoute.POST(
        new Request(`http://localhost/api/v1/training/sessions/${session.id}/accounting/materialize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: `stage02-frozen-mass-${session.id}` }),
        }),
        { params: Promise.resolve({ id: String(session.id) }) },
      );
      expect(response.status).toBe(200);
      const materializeBody = await response.json() as { session: Awaited<ReturnType<typeof service.materializeSessionAccounting>> };
      const edited = materializeBody.session;
      if (!edited) throw new Error("ordinary materialization route returned no session");
      expect(edited.loadAccountingV1?.bodyweight.reference).toMatchObject({
        status: "observed", valueKg: 87, source: "apple-health-shortcut",
      });
      expect(edited.loadAccountingV1?.bodyweight.referenceVolume.value).toBe(1740);
      expect(await db.strengthDiarySession.findUniqueOrThrow({
        where: { id: session.id },
        select: { currentSnapshotRevision: true },
      })).toMatchObject({ currentSnapshotRevision: edited.snapshotRevision });
      const persistedSnapshots = await db.strengthSessionAccountingSnapshot.findMany({
        where: { sessionId: session.id },
        orderBy: { snapshotRevision: "asc" },
        select: { snapshotRevision: true, payload: true },
      });
      expect(persistedSnapshots).toHaveLength(2);
      const rereadHistoricalSnapshot = persistedSnapshots.find(({ snapshotRevision }) =>
        snapshotRevision === initialSnapshot.snapshotRevision);
      expect(rereadHistoricalSnapshot?.payload).toEqual(frozenHistoricalPayload);
      const rereadHistoricalPayload = persistedPayloadFromUnknown(rereadHistoricalSnapshot?.payload);
      if (!rereadHistoricalPayload || !("breakdown" in rereadHistoricalPayload)) {
        throw new Error("source deletion changed historical V2 breakdown readability");
      }
      expect(rereadHistoricalPayload.massReference).toEqual(initialPayload.massReference);
      const rereadHistoricalRow = rereadHistoricalPayload.breakdown.rows.find(({ strengthSetId }) =>
        strengthSetId === set.id);
      expect(rereadHistoricalRow).toEqual(frozenHistoricalRow);
      expect(rereadHistoricalRow?.contributions).toContainEqual(expect.objectContaining({
        category: "bodyweightReferenceVolume",
        basis: "bodyweight-reference",
        value: 1566,
        unit: "bodyweight-reference-kg-repetitions",
        availability: "available",
        provenance: expect.arrayContaining([expect.objectContaining({
          kind: "bodyweight-observation",
          sourceId: String(sample.id),
          version: "apple-health-shortcut",
        })]),
      }));
      expect((persistedSnapshots[0]!.payload as { massReference: { sourceId: string; valueKg: number } }).massReference)
        .toMatchObject({ sourceId: String(sample.id), valueKg: 87 });
      expect((persistedSnapshots[1]!.payload as { massReference: { sourceId: string; valueKg: number } }).massReference)
        .toMatchObject({ sourceId: String(sample.id), valueKg: 87 });
    } finally {
      if (sourceId !== null) await db.healthMetricSample.deleteMany({ where: { id: sourceId } });
      if (sessionId !== null) await db.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (programId !== null) await db.trainingProgram.deleteMany({ where: { id: programId } });
    }
  });

  it("deduplicates a repeated Workout source identity by the database unique key", async () => {
    const db = prisma!;
    const row = createTrainingHistoryStage01FixtureV1().workouts.find((workout) => workout.scenario === "ms100-boundary" && workout.externalId === null)!;
    const before = await db.workout.count({ where: { dailyHealthDataId: row.dailyHealthDataId } });
    const first = await db.workout.findUnique({ where: { dailyHealthDataId_sourceIdentity: { dailyHealthDataId: row.dailyHealthDataId, sourceIdentity: row.sourceIdentity } } });
    const upserted = await db.workout.upsert({
      where: { dailyHealthDataId_sourceIdentity: { dailyHealthDataId: row.dailyHealthDataId, sourceIdentity: row.sourceIdentity } },
      update: {},
      create: {
        dailyHealthDataId: row.dailyHealthDataId,
        sourceIdentity: row.sourceIdentity,
        type: row.type,
        startAt: new Date(row.startAt),
        endAt: new Date(row.endAt),
      },
    });
    expect(upserted.id).toBe(first?.id);
    expect(await db.workout.count({ where: { dailyHealthDataId: row.dailyHealthDataId } })).toBe(before);
    expect(await db.workout.count({ where: { dailyHealthDataId: row.dailyHealthDataId, sourceIdentity: row.sourceIdentity } })).toBe(1);
  });

  it("retains retrospective provenance and mapping snapshots after a set edit", async () => {
    const db = prisma!;
    const pull = createTrainingHistoryStage01FixtureV1().sessions.find((row) => row.scenarioId === "golden-pull")!;
    const before = await db.strengthDiarySession.findUnique({
      where: { id: pull.id },
      include: { matchedWorkout: true, exercises: { orderBy: { sortOrder: "asc" }, include: { sets: { orderBy: { setNumber: "asc" } } } } },
    });
    expect(before?.entryMode).toBe("RETROSPECTIVE");
    expect(before?.webStartedAt).toBeNull();
    expect(before?.matchedWorkout?.sourceIdentity).toBe("ext:stage01-golden-pull-source");
    const selectedExercise = before!.exercises[0]!;
    const snapshotBefore = JSON.stringify(selectedExercise.muscleMappingSnapshot);
    const selectedSet = selectedExercise.sets[0]!;
    try {
      await db.$transaction(async (tx) => {
        await tx.strengthSet.update({ where: { id: selectedSet.id }, data: { reps: selectedSet.reps + 1 } });
        await tx.strengthDiarySession.update({ where: { id: pull.id }, data: { revision: { increment: 1 } } });
      });
      const after = await db.strengthDiarySession.findUnique({
        where: { id: pull.id },
        include: { exercises: { where: { id: selectedExercise.id }, include: { sets: { where: { id: selectedSet.id } } } } },
      });
      expect(after?.revision).toBe(pull.revision + 1);
      expect(after?.exercises[0]?.muscleMappingSnapshot).toEqual(selectedExercise.muscleMappingSnapshot);
      expect(JSON.stringify(after?.exercises[0]?.muscleMappingSnapshot)).toBe(snapshotBefore);
      expect(after?.exercises[0]?.sets[0]?.reps).toBe(selectedSet.reps + 1);
    } finally {
      await db.$transaction(async (tx) => {
        await tx.strengthSet.update({ where: { id: selectedSet.id }, data: { reps: selectedSet.reps, updatedAt: selectedSet.updatedAt } });
        await tx.strengthDiarySession.update({ where: { id: pull.id }, data: { revision: pull.revision, updatedAt: before!.updatedAt } });
      });
    }
  });

  it("reseeds idempotently from fixed IDs without duplicating rows", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    const secondSeed = await persistence!.seedStage01Namespace(db);
    expect(secondSeed).toEqual(seededCounts);
    expect(await db.strengthDiarySession.count({ where: { id: { in: fixture.sessions.map((row) => row.id) } } })).toBe(fixture.sessions.length);
    expect(await db.workout.count({ where: { id: { in: fixture.workouts.map((row) => row.id) } } })).toBe(fixture.workouts.length);
    expect(await db.strengthSet.count({ where: { sessionExercise: { sessionId: { in: fixture.sessions.map((row) => row.id) } } } })).toBe(secondSeed.sets);
  });

  it("retains MS100 overlap and midnight boundary without diary set conversion", async () => {
    const db = prisma!;
    const ms100 = createTrainingHistoryStage01FixtureV1().workouts.filter((row) => row.scenario === "ms100-boundary");
    const rows = await db.workout.findMany({ where: { id: { in: ms100.map((row) => row.id) } }, orderBy: { startAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => ({
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      sourceIdentity: row.sourceIdentity,
      durationMinutes: row.durationMinutes,
      manualStepCount: row.manualStepCount,
    }))).toEqual(EXPECTED_MS100_V1.intervals.map((expected) => ({
      startAt: expected.startAt,
      endAt: expected.endAt,
      sourceIdentity: expected.sourceIdentity,
      durationMinutes: expected.durationMinutes,
      manualStepCount: expected.manualStepCount,
    })));
    expect(Math.min(...rows.map((row) => row.endAt.getTime())) - Math.max(...rows.map((row) => row.startAt.getTime())))
      .toBe(EXPECTED_MS100_V1.overlapMinutes * 60_000);
    const formatLocalDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bratislava" }).format(date);
    expect(formatLocalDate(rows[0]!.startAt)).toBe("2026-09-24");
    expect(formatLocalDate(rows[0]!.endAt)).toBe("2026-09-25");
    expect(rows.every((row) => row.externalId === null)).toBe(true);
    expect(rows.map((row) => row.manualStepCount === null || row.durationMinutes === null ? null : row.manualStepCount / row.durationMinutes))
      .toEqual(EXPECTED_MS100_V1.intervals.map((row) => row.cadenceStepsPerMinute));
    expect(rows.every((row) => row.energyKcal === null && row.activeEnergyKcal === null && row.manualActiveEnergyKcal === null)).toBe(true);
    expect(await db.heartRateSample.count({ where: { dailyHealthDataId: { in: ms100.map((row) => row.dailyHealthDataId) } } })).toBe(EXPECTED_MS100_V1.heartRateSamples);
    expect(await db.restingHeartRateSample.count({ where: { dailyHealthDataId: { in: ms100.map((row) => row.dailyHealthDataId) } } })).toBe(0);
    expect(await db.strengthDiarySession.count({ where: { matchedWorkoutId: { in: ms100.map((row) => row.id) } } })).toBe(0);
  });

  it("does not overwrite or delete a pre-existing default Profile during repeated seed and cleanup", async () => {
    const db = prisma!;
    await persistence!.cleanupStage01Namespace(db);
    const existing = await db.profile.findUnique({ where: { id: 1 } });
    const inserted = existing === null;
    const sentinel = existing
      ? await db.profile.update({ where: { id: 1 }, data: {
        sex: "female",
        dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
        heightCm: "170.00",
        locale: "uk",
        updatedAt: new Date("2020-01-01T00:00:00.000Z"),
      } })
      : await db.profile.create({
        data: {
          id: 1,
          sex: "female",
          dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
          heightCm: "170.00",
          locale: "uk",
          createdAt: new Date("2020-01-01T00:00:00.000Z"),
          updatedAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      });
    try {
      await persistence!.seedStage01Namespace(db);
      expect(await db.profile.findUnique({ where: { id: 1 } })).toEqual(sentinel);
      expect(await db.profile.findUnique({ where: { id: TRAINING_HISTORY_STAGE01_PROFILE_ID }, select: { id: true } }))
        .toEqual({ id: TRAINING_HISTORY_STAGE01_PROFILE_ID });
      await persistence!.seedStage01Namespace(db);
      expect(await db.profile.findUnique({ where: { id: 1 } })).toEqual(sentinel);
      await persistence!.cleanupStage01Namespace(db);
      expect(await db.profile.findUnique({ where: { id: 1 } })).toEqual(sentinel);
    } finally {
      await persistence!.cleanupStage01Namespace(db);
      if (inserted) await db.profile.delete({ where: { id: 1 } });
      else await db.profile.update({ where: { id: 1 }, data: {
        sex: existing!.sex,
        dateOfBirth: existing!.dateOfBirth,
        heightCm: existing!.heightCm,
        locale: existing!.locale,
        targetWeightKg: existing!.targetWeightKg,
        targetDate: existing!.targetDate,
        autoAdvanceExercises: existing!.autoAdvanceExercises,
        createdAt: existing!.createdAt,
        updatedAt: existing!.updatedAt,
      } });
      await persistence!.seedStage01Namespace(db);
    }
  });

  it("refuses fixed-ID parent mismatches before deleting any Stage 01 rows", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    const refuse = async (mutate: () => Promise<unknown>, restore: () => Promise<unknown>) => {
      await mutate();
      try {
        await expect(persistence!.cleanupStage01Namespace(db)).rejects.toThrow(/collision/);
      } finally {
        await restore();
      }
    };

    const workout = fixture.workouts[0]!;
    const workoutOriginal = await db.workout.findUniqueOrThrow({ where: { id: workout.id } });
    const otherDayId = fixture.dailyHealthRows.find((row) => row.id !== workout.dailyHealthDataId)!.id;
    await refuse(
      () => db.workout.update({ where: { id: workout.id }, data: { dailyHealthDataId: otherDayId } }),
      () => db.workout.update({ where: { id: workout.id }, data: { dailyHealthDataId: workoutOriginal.dailyHealthDataId, updatedAt: workoutOriginal.updatedAt } }),
    );

    const set = fixture.sessions.flatMap((session) => session.exercises.flatMap((exercise) => exercise.sets.map((row) => ({ row, exercise }))))[0]!;
    const otherExercise = fixture.sessions.flatMap((session) => session.exercises).find((exercise) => exercise.id !== set.exercise.id);
    const setOriginal = await db.strengthSet.findUniqueOrThrow({ where: { id: set.row.id } });
    await refuse(
      () => db.strengthSet.update({ where: { id: set.row.id }, data: { sessionExerciseId: otherExercise!.id, setNumber: 999 } }),
      () => db.strengthSet.update({ where: { id: set.row.id }, data: { sessionExerciseId: setOriginal.sessionExerciseId, setNumber: setOriginal.setNumber, updatedAt: setOriginal.updatedAt } }),
    );

    const planned = await db.programExercise.findFirstOrThrow({ where: { programVersionId: fixture.programVersions[0]!.id } });
    const otherVersionId = fixture.programVersions.find((row) => row.id !== planned.programVersionId)!.id;
    const plannedOriginal = { programVersionId: planned.programVersionId, sortOrder: planned.sortOrder, updatedAt: planned.updatedAt };
    await refuse(
      () => db.programExercise.update({ where: { id: planned.id }, data: { programVersionId: otherVersionId, sortOrder: 99 } }),
      () => db.programExercise.update({ where: { id: planned.id }, data: { ...plannedOriginal } }),
    );

    const sessionExercise = fixture.sessions.find((row) => row.exercises.length > 0)!.exercises[0]!;
    const sessionExerciseOriginal = await db.strengthSessionExercise.findUniqueOrThrow({ where: { id: sessionExercise.id } });
    const otherSessionId = fixture.sessions.find((row) => row.id !== sessionExerciseOriginal.sessionId)!.id;
    await refuse(
      () => db.strengthSessionExercise.update({ where: { id: sessionExercise.id }, data: { sessionId: otherSessionId, sortOrder: 99 } }),
      () => db.strengthSessionExercise.update({ where: { id: sessionExercise.id }, data: { sessionId: sessionExerciseOriginal.sessionId, sortOrder: sessionExerciseOriginal.sortOrder, updatedAt: sessionExerciseOriginal.updatedAt } }),
    );

    const version = fixture.programVersions[0]!;
    const versionOriginal = await db.trainingProgramVersion.findUniqueOrThrow({ where: { id: version.id } });
    const otherProgramId = fixture.programs.find((row) => row.id !== versionOriginal.programId)!.id;
    await refuse(
      () => db.trainingProgramVersion.update({ where: { id: version.id }, data: { programId: otherProgramId, versionNumber: 99 } }),
      () => db.trainingProgramVersion.update({ where: { id: version.id }, data: { programId: versionOriginal.programId, versionNumber: versionOriginal.versionNumber } }),
    );

    const session = fixture.sessions[0]!;
    const sessionOriginal = await db.strengthDiarySession.findUniqueOrThrow({ where: { id: session.id } });
    const otherProgram = fixture.programs.find((row) => row.id !== sessionOriginal.programId)!;
    await refuse(
      () => db.strengthDiarySession.update({ where: { id: session.id }, data: { programId: otherProgram.id, programVersionId: otherProgram.currentVersionId } }),
      () => db.strengthDiarySession.update({ where: { id: session.id }, data: { programId: sessionOriginal.programId, programVersionId: sessionOriginal.programVersionId, updatedAt: sessionOriginal.updatedAt } }),
    );

    const change = fixture.programChanges[0]!;
    const changeOriginal = await db.strengthDiaryProgramChange.findUniqueOrThrow({ where: { id: change.id } });
    const otherChangeSession = fixture.sessions.find((row) => row.id !== changeOriginal.sessionId)!.id;
    await refuse(
      () => db.strengthDiaryProgramChange.update({ where: { id: change.id }, data: { sessionId: otherChangeSession } }),
      () => db.strengthDiaryProgramChange.update({ where: { id: change.id }, data: { sessionId: changeOriginal.sessionId } }),
    );

    const day = fixture.dailyHealthRows[0]!;
    const dailyOriginal = await db.dailyHealthData.findUniqueOrThrow({ where: { id: day.id } });
    await refuse(
      () => db.dailyHealthData.update({ where: { id: day.id }, data: { rawPayload: { sentinel: "same ID, foreign payload" } } }),
      () => db.dailyHealthData.update({ where: { id: day.id }, data: { rawPayload: dailyOriginal.rawPayload as object, updatedAt: dailyOriginal.updatedAt } }),
    );

    expect(await db.strengthDiarySession.count({ where: { id: { in: fixture.sessions.map((row) => row.id) } } })).toBe(fixture.sessions.length);
    await persistence!.cleanupStage01Namespace(db);
    await persistence!.seedStage01Namespace(db);
  });

  it("refuses extra fixture-parent children before cascades and preserves each sentinel", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    const parentExercise = fixture.sessions.find((row) => row.exercises.length > 0)!.exercises[0]!;
    const parentSession = fixture.sessions.find((row) => row.exercises.some((exercise) => exercise.id === parentExercise.id))!;
    const parentVersion = fixture.programVersions[0]!;
    const unusedCatalog = fixture.catalogExercises.find((row) => !parentVersion.plannedExercises.some((exercise) => exercise.exerciseCatalogId === row.id))!;
    await db.strengthSet.create({
      data: { id: SENTINEL_SET_ID, sessionExerciseId: parentExercise.id, setNumber: 999, reps: 1, createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT), updatedAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) },
    });
    await db.programExercise.create({
      data: { id: SENTINEL_PROGRAM_EXERCISE_ID, programVersionId: parentVersion.id, exerciseCatalogId: unusedCatalog.id, sortOrder: 99, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT", createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT), updatedAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) },
    });
    await db.strengthSessionExercise.create({
      data: { id: SENTINEL_SESSION_EXERCISE_ID, sessionId: parentSession.id, sourceExerciseCatalogId: unusedCatalog.id, snapshotExerciseName: "Stage 01 sentinel exercise", sortOrder: 99, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT", origin: "EXTRA", createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT), updatedAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) },
    });
    await db.trainingProgramVersion.create({
      data: { id: SENTINEL_PROGRAM_VERSION_ID, programId: parentVersion.programId, versionNumber: 99, createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) },
    });
    await db.strengthDiaryProgramChange.create({
      data: { id: SENTINEL_PROGRAM_CHANGE_ID, sessionId: parentSession.id, fromProgramId: parentSession.programId, fromProgramVersionId: parentSession.programVersionId, toProgramId: parentSession.programId, toProgramVersionId: parentSession.programVersionId, createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) },
    });
    const supersededWorkout = fixture.workouts[0]!;
    await db.workout.create({
      data: {
        id: SENTINEL_SUPERSEDED_WORKOUT_ID,
        dailyHealthDataId: supersededWorkout.dailyHealthDataId,
        sourceIdentity: "sentinel:stage01-superseded-workout-protection",
        type: "sentinel",
        startAt: new Date("2026-09-24T16:00:00.000Z"),
        endAt: new Date("2026-09-24T16:01:00.000Z"),
        supersededByWorkoutId: supersededWorkout.id,
      },
    });

    await expect(persistence!.cleanupStage01Namespace(db)).rejects.toThrow(/collision/);
    expect(await db.strengthSet.findUnique({ where: { id: SENTINEL_SET_ID } })).not.toBeNull();
    expect(await db.programExercise.findUnique({ where: { id: SENTINEL_PROGRAM_EXERCISE_ID } })).not.toBeNull();
    expect(await db.strengthSessionExercise.findUnique({ where: { id: SENTINEL_SESSION_EXERCISE_ID } })).not.toBeNull();
    expect(await db.trainingProgramVersion.findUnique({ where: { id: SENTINEL_PROGRAM_VERSION_ID } })).not.toBeNull();
    expect(await db.strengthDiaryProgramChange.findUnique({ where: { id: SENTINEL_PROGRAM_CHANGE_ID } })).not.toBeNull();
    expect(await db.workout.findUnique({ where: { id: SENTINEL_SUPERSEDED_WORKOUT_ID } })).not.toBeNull();

    await db.strengthSet.delete({ where: { id: SENTINEL_SET_ID } });
    await db.programExercise.delete({ where: { id: SENTINEL_PROGRAM_EXERCISE_ID } });
    await db.strengthSessionExercise.delete({ where: { id: SENTINEL_SESSION_EXERCISE_ID } });
    await db.strengthDiaryProgramChange.delete({ where: { id: SENTINEL_PROGRAM_CHANGE_ID } });
    await db.trainingProgramVersion.delete({ where: { id: SENTINEL_PROGRAM_VERSION_ID } });
    await db.workout.delete({ where: { id: SENTINEL_SUPERSEDED_WORKOUT_ID } });
    await persistence!.cleanupStage01Namespace(db);
    await persistence!.seedStage01Namespace(db);
  });

  it("cleans only the fixture namespace and preserves an unrelated sentinel", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    const dailyId = fixture.dailyHealthRows[0]!.id;
    expect(await db.workout.findUnique({ where: { id: SENTINEL_WORKOUT_ID } })).toBeNull();
    await db.workout.create({
      data: {
        id: SENTINEL_WORKOUT_ID,
        dailyHealthDataId: dailyId,
        sourceIdentity: SENTINEL_SOURCE_IDENTITY,
        type: "sentinel",
        startAt: new Date("2026-09-24T16:00:00.000Z"),
        endAt: new Date("2026-09-24T16:01:00.000Z"),
      },
    });
    const profileBeforeCleanup = await db.profile.findUnique({ where: { id: fixture.profiles[0]!.id } });
    const firstCleanup = await persistence!.cleanupStage01Namespace(db);
    expect(await db.workout.findUnique({ where: { id: SENTINEL_WORKOUT_ID }, select: { sourceIdentity: true } })).toEqual({ sourceIdentity: SENTINEL_SOURCE_IDENTITY });
    expect(await db.dailyHealthData.findUnique({ where: { id: dailyId } })).not.toBeNull();
    expect(await db.strengthDiarySession.count({ where: { id: { in: fixture.sessions.map((row) => row.id) } } })).toBe(0);
    expect(await db.profile.findUnique({ where: { id: fixture.profiles[0]!.id } })).toEqual(firstCleanup.deletedProfiles > 0 ? null : profileBeforeCleanup);
    await db.workout.delete({ where: { id: SENTINEL_WORKOUT_ID } });
    const finalCleanup = await persistence!.cleanupStage01Namespace(db);
    expect(await db.dailyHealthData.findUnique({ where: { id: dailyId } })).toBeNull();
    expect(await db.profile.findUnique({ where: { id: fixture.profiles[0]!.id } })).toEqual(finalCleanup.deletedProfiles > 0 ? null : profileBeforeCleanup);
    expect(await db.exerciseCatalog.count({ where: { stableKey: { not: null } } })).toBe(13);
  });
});
