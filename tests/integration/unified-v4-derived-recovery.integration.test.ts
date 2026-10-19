import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.BODYCAST_V4_RECOVERY_TEST_DATABASE_URL);
if (decodeURIComponent(new URL(databaseUrl).pathname.slice(1)).toLowerCase() !== "bodycast_v4_recovery_test") {
  throw new Error("V4 recovery integration requires its dedicated bodycast_v4_recovery_test database.");
}
const originalDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = databaseUrl;

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const profileId = 1;
const fromDate = "2026-10-01";
const trainingSessionIds = [20, 24, 25] as const;
const trainingDates = ["2026-10-19", "2026-10-23", "2026-10-25"] as const;
const healthDates = Array.from({ length: 9 }, (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`);
const localHypertrophyWeekStarts = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"];
const recoveryDerivedDates = Array.from({ length: 25 }, (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`);
const pagedInventoryFixtureDate = "2099-12-30";
const pagedInventoryFixtureMarker = "v4-recovery-bounded-inventory";
const referenceChunkCharacters = 1024 * 1024;
const referenceMaxRowBytes = 64 * 1024 * 1024;

function referenceCodePointLength(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff
        && index + 1 < value.length
        && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      index += 1;
    }
    count += 1;
  }
  return count;
}
const episodeFixture = {
  profileId,
  startDate: fromDate,
  timezone: "America/Los_Angeles",
  modelVersion: "bodycast-physiology-v6",
  active: true,
  latestModeledDate: trainingDates.at(-1)!,
  ecfPolicy: "hold-ecf",
  baselineEnergyIntakeKcalPerDay: 2_400,
  baselineCarbIntakeG: 220,
  baselineWindowStartDate: fromDate,
  baselineWindowEndDate: fromDate,
  baselineNutritionDayCount: 1,
  baselineWeightObservationCount: 1,
  baselineWeightTrendKgPerWeek: 0,
  baselineWeightTrendPercentPerWeek: 0,
  baselineDerivationMethod: "unified-v4-derived-recovery-integration",
  initialFatMassKg: 16,
  initialLeanTissueKg: 55,
  initialGlycogenKg: 0.5,
  baselineExtracellularFluidLiters: 18,
  initialExtracellularFluidDeviationLiters: 0,
  initialAdaptiveThermogenesisKcalPerDay: 0,
  initialFilteredWeightKg: 80,
  initialWeightFilterVarianceKg2: 1,
  initialRmrKcalPerDay: 1_700,
  dynamicRmrFatCoefficient: 3.2,
  dynamicRmrLeanCoefficient: 22,
  dynamicRmrCalibrationOffsetKcalPerDay: 0,
  adaptiveThermogenesisBeta: 0.14,
  adaptiveThermogenesisTimeConstantDays: 14,
  weightProcessNoiseVarianceKg2PerDay: 0.01,
  weightMeasurementNoiseVarianceKg2: 0.25,
  calibrationDiagnostics: {},
};

async function captureRecoveryBinding() {
  const { createV4RecoveryEvidenceBindingV1, inventoryV4RecoveryRawSourcesV1 } =
    await import("@/modules/model-episodes/unified-v4-derived-recovery.service");
  const [raw, lifecycle, blocks] = await Promise.all([
    inventoryV4RecoveryRawSourcesV1(prisma),
    prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } }),
    prisma.unifiedPublicationBlock.findMany({
      where: { profileId }, orderBy: [{ source: "asc" }, { sourceKey: "asc" }],
      select: { source: true, sourceKey: true, fromDate: true, revision: true },
    }),
  ]);
  return createV4RecoveryEvidenceBindingV1({ rawFingerprint: raw.fingerprint, blocks, lifecycle });
}

async function referenceHealthSnapshotDigestV2(): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const [countRow] = await tx.$queryRawUnsafe<Array<{ row_count: bigint }>>(
      'SELECT COUNT(*)::bigint AS row_count FROM public."HealthSyncSnapshot"',
    );
    if (!countRow) throw new Error("Could not count HealthSyncSnapshot rows for the independent fingerprint reference.");
    const rowCount = Number(countRow.row_count);
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new Error("HealthSyncSnapshot reference row count is invalid.");
    const digest = createHash("sha256").update(`HealthSyncSnapshot\0${rowCount}\0`);
    let afterId = -2_147_483_649;
    let scanned = 0;

    while (true) {
      const metadata = await tx.$queryRawUnsafe<Array<{
        id: number;
        raw_row_bytes: bigint;
        raw_row_characters: bigint;
      }>>(
        `SELECT source_row.id,
           octet_length(to_jsonb(source_row)::text)::bigint AS raw_row_bytes,
           char_length(to_jsonb(source_row)::text)::bigint AS raw_row_characters
         FROM public."HealthSyncSnapshot" AS source_row
         WHERE source_row.id > $1::bigint
         ORDER BY source_row.id
         LIMIT 250`,
        afterId,
      );
      if (metadata.length === 0) break;

      for (const row of metadata) {
        const bytes = Number(row.raw_row_bytes);
        const characters = Number(row.raw_row_characters);
        if (!Number.isSafeInteger(row.id) || row.id <= afterId || !Number.isSafeInteger(bytes) || bytes < 0
            || !Number.isSafeInteger(characters) || characters < 1 || bytes > referenceMaxRowBytes) {
          throw new Error("HealthSyncSnapshot reference metadata is invalid or exceeds its bounded row limit.");
        }
        digest.update(`${row.id}:${bytes}:`);
        if (bytes <= 8 * 1024 * 1024) {
          const [data] = await tx.$queryRawUnsafe<Array<{ id: number; raw_row: string }>>(
            `SELECT source_row.id, to_jsonb(source_row)::text AS raw_row
             FROM public."HealthSyncSnapshot" AS source_row
             WHERE source_row.id = $1::integer`,
            row.id,
          );
          if (!data || data.id !== row.id || Buffer.byteLength(data.raw_row, "utf8") !== bytes) {
            throw new Error("HealthSyncSnapshot reference row changed during its snapshot scan.");
          }
          digest.update(data.raw_row);
        } else {
          let chunkBytes = 0;
          let chunkCount = 0;
          for (let offset = 0; offset < characters; offset += referenceChunkCharacters) {
            const [chunk] = await tx.$queryRawUnsafe<Array<{ raw_row_chunk: string }>>(
              `SELECT substring(to_jsonb(source_row)::text
                 FROM $2::integer FOR $3::integer) AS raw_row_chunk
               FROM public."HealthSyncSnapshot" AS source_row
               WHERE source_row.id = $1::integer`,
              row.id,
              offset + 1,
              referenceChunkCharacters,
            );
            if (!chunk || typeof chunk.raw_row_chunk !== "string" || chunk.raw_row_chunk.length === 0) {
              throw new Error("HealthSyncSnapshot reference row chunk was missing.");
            }
            const chunkCharacters = referenceCodePointLength(chunk.raw_row_chunk);
            if (chunkCharacters > referenceChunkCharacters
                || (offset + chunkCharacters < characters && chunkCharacters !== referenceChunkCharacters)) {
              throw new Error("HealthSyncSnapshot reference row chunks were malformed.");
            }
            chunkCount += 1;
            if (chunkCount > Math.ceil(referenceMaxRowBytes / referenceChunkCharacters)) {
              throw new Error("HealthSyncSnapshot reference row exceeded its bounded chunk count.");
            }
            chunkBytes += Buffer.byteLength(chunk.raw_row_chunk, "utf8");
            digest.update(chunk.raw_row_chunk);
          }
          if (chunkBytes !== bytes) throw new Error("HealthSyncSnapshot reference row chunks changed byte length.");
        }
        digest.update("\n");
        afterId = row.id;
        scanned += 1;
      }
    }
    if (scanned !== rowCount) throw new Error("HealthSyncSnapshot reference row count changed during its snapshot scan.");
    return digest.digest("hex");
  }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 });
}

async function recoverWithCurrentEvidence(expectedEvidenceBinding?: Awaited<ReturnType<typeof captureRecoveryBinding>>) {
  const { recoverUnifiedV4FromPersistedSourcesV1 } =
    await import("@/modules/model-episodes/unified-v4-derived-recovery.service");
  return recoverUnifiedV4FromPersistedSourcesV1({
    profileId, ownerAuthorized: true, expectedEvidenceBinding: expectedEvidenceBinding ?? await captureRecoveryBinding(),
  });
}

describe("Unified V4 persisted-source recovery on isolated PostgreSQL", () => {
  let programId: number;
  let programVersionId: number;
  let episodeId: number;
  let workoutId: number;
  let matchedTrainingWorkoutId: number | undefined;
  const healthSnapshotIds: number[] = [];
  let healthAuditId: number;
  const healthMetricSampleIds: number[] = [];
  let sessionCreated = false;
  let profileCreated = false;
  let fixtureNamespaceReserved = false;
  let trainingFailureFunctionCreated = false;
  let trainingFailureTriggerCreated = false;
  let serializationFunctionCreated = false;
  let serializationTriggerCreated = false;
  let pagedInventoryFixtureReserved = false;
  const dailyHealthDataIds: number[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    const existingFixtureCounts = await Promise.all([
      prisma.profile.count({ where: { id: profileId } }),
      prisma.dailyHealthData.count({ where: { date: { in: healthDates } } }),
      prisma.healthSyncSnapshot.count({ where: { date: { in: healthDates } } }),
      prisma.healthSyncAudit.count({ where: { rawBody: { contains: "durable-health-audit" } } }),
      prisma.healthMetricSample.count({ where: { date: { in: healthDates } } }),
      prisma.workout.count({ where: { sourceIdentity: "recovery-fixture:garmin-1" } }),
      prisma.strengthDiarySession.count({ where: { id: { in: [...trainingSessionIds, 26, 27] } } }),
      prisma.trainingProgram.count({ where: { profileId, name: "V4 derived recovery fixture" } }),
      prisma.modelEpisode.count({ where: { profileId, startDate: fromDate } }),
      prisma.physiologyV7Lifecycle.count({ where: { profileId } }),
      prisma.unifiedPublicationBlock.count({ where: { profileId } }),
      prisma.experimentalFfmRetentionShadow.count({ where: { profileId, date: { in: recoveryDerivedDates } } }),
      prisma.experimentalLocalHypertrophyResponseShadow.count({ where: { profileId, weekStartDate: { in: localHypertrophyWeekStarts } } }),
      prisma.experimentalGlycogenStateShadow.count({ where: { profileId, date: { in: healthDates } } }),
      prisma.physiologyV7ShadowDiagnostic.count({ where: { profileId, date: { in: recoveryDerivedDates } } }),
      prisma.fatWeightShadowV1Result.count({ where: { profileId, date: { in: recoveryDerivedDates } } }),
      prisma.experimentalFatWeightUncertaintyShadow.count({ where: { profileId, date: { in: recoveryDerivedDates } } }),
      prisma.physiologyV7DailyResult.count({ where: { profileId, date: { in: recoveryDerivedDates } } }),
    ]);
    if (existingFixtureCounts.some((count) => count !== 0)) {
      throw new Error("V4 recovery disposable database contains pre-existing fixture identities.");
    }
    fixtureNamespaceReserved = true;
    const { prisma: dependencyPrisma } = await import("@/lib/db/prisma");
    const [dependencyDatabase] = await dependencyPrisma.$queryRawUnsafe<Array<{ database_name: string }>>(
      "SELECT current_database() AS database_name",
    );
    if (dependencyDatabase?.database_name !== "bodycast_v4_recovery_test") {
      throw new Error("V4 recovery dependencies did not resolve to the dedicated disposable database.");
    }
    await prisma.profile.create({
      data: { id: profileId, sex: "male", dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), heightCm: 180 },
    });
    profileCreated = true;
    const episode = await prisma.modelEpisode.create({ data: episodeFixture });
    episodeId = episode.id;
    const program = await prisma.trainingProgram.create({ data: { profileId, name: "V4 derived recovery fixture" } });
    programId = program.id;
    const version = await prisma.trainingProgramVersion.create({ data: { programId, versionNumber: 1 } });
    programVersionId = version.id;
    const firstHealthDay = await prisma.dailyHealthData.create({
      data: {
        date: healthDates[0]!, weightKg: 80, bodyFatPercent: 20, caloriesKcal: 2_200, proteinG: 160,
        carbsG: 200, fatG: 70, steps: 7_000, workoutFeedObserved: true,
        rawPayload: { fixture: "persisted-source-recovery", index: 0 },
      },
    });
    dailyHealthDataIds.push(firstHealthDay.id);
    const healthSnapshot = await prisma.healthSyncSnapshot.create({
      data: {
        dailyHealthDataId: firstHealthDay.id, date: healthDates[0]!, timezone: "UTC",
        receivedAt: new Date(`${healthDates[0]}T12:00:00.000Z`),
        syncedAt: new Date(`${healthDates[0]}T12:01:00.000Z`),
        weightKg: 80, caloriesKcal: 2_200, proteinG: 160, fatG: 70, carbsG: 200, steps: 7_000,
        rawPayload: { fixture: "durable-health-provenance", source: "shortcut", nonce: "raw-exact" },
      },
    });
    healthSnapshotIds.push(healthSnapshot.id);
    const healthAudit = await prisma.healthSyncAudit.create({
      data: {
        receivedAt: new Date(`${healthDates[0]}T12:02:00.000Z`), outcome: "accepted", httpStatus: 200,
        rawBody: "{\"fixture\":\"durable-health-audit\",\"source\":\"shortcut\"}",
        contentType: "application/json", errorType: null,
      },
    });
    healthAuditId = healthAudit.id;
    const healthMetricSample = await prisma.healthMetricSample.create({
      data: {
        dailyHealthDataId: firstHealthDay.id, date: healthDates[0]!, metric: "weight-kg",
        source: "apple-health-shortcut", timestamp: new Date(`${healthDates[0]}T12:00:00.000Z`), value: 80,
      },
    });
    healthMetricSampleIds.push(healthMetricSample.id);
    for (const [index, date] of healthDates.slice(1).entries()) {
      const healthDay = await prisma.dailyHealthData.create({
        data: {
          date, weightKg: 80 + (index + 1) / 10, bodyFatPercent: 20, caloriesKcal: 2_200, proteinG: 160,
          carbsG: 200, fatG: 70, steps: 7_000, workoutFeedObserved: true,
          rawPayload: { fixture: "persisted-source-recovery", index },
        },
      });
      dailyHealthDataIds.push(healthDay.id);
      const snapshot = await prisma.healthSyncSnapshot.create({
        data: {
          dailyHealthDataId: healthDay.id, date, timezone: "UTC",
          receivedAt: new Date(`${date}T12:00:00.000Z`), syncedAt: new Date(`${date}T12:01:00.000Z`),
          weightKg: 80 + (index + 1) / 10, caloriesKcal: 2_200, proteinG: 160, fatG: 70, carbsG: 200, steps: 7_000,
          rawPayload: { fixture: "durable-health-provenance", index: index + 1, nonce: "raw-exact" },
        },
      });
      healthSnapshotIds.push(snapshot.id);
      const metricSample = await prisma.healthMetricSample.create({
        data: {
          dailyHealthDataId: healthDay.id, date, metric: "weight-kg", source: "apple-health-shortcut",
          timestamp: new Date(`${date}T12:00:00.000Z`), value: 80 + (index + 1) / 10,
        },
      });
      healthMetricSampleIds.push(metricSample.id);
    }
    const workout = await prisma.workout.create({
      data: {
        dailyHealthDataId: firstHealthDay.id,
        sourceIdentity: "recovery-fixture:garmin-1",
        type: "Running",
        startAt: new Date(`${healthDates[0]}T10:00:00.000Z`),
        endAt: new Date(`${healthDates[0]}T10:30:00.000Z`),
        durationMinutes: 30,
        activeEnergyKcal: 250,
      },
    });
    workoutId = workout.id;
    const matchedTrainingWorkout = await prisma.workout.create({
      data: {
        dailyHealthDataId: dailyHealthDataIds[healthDates.indexOf("2026-10-09")]!,
        sourceIdentity: "recovery-fixture:training-workout-20",
        type: "Traditional Strength Training",
        startAt: new Date("2026-10-20T01:30:00.000Z"),
        endAt: new Date("2026-10-20T02:30:00.000Z"),
        durationMinutes: 60,
      },
    });
    matchedTrainingWorkoutId = matchedTrainingWorkout.id;
    for (const sessionId of trainingSessionIds) {
      const matched = sessionId === 20;
      const dayIndex = trainingSessionIds.indexOf(sessionId);
      const webStart = sessionId === 24 ? new Date("2026-10-23T21:00:00.000Z")
        : sessionId === 25 ? new Date("2026-10-25T21:00:00.000Z") : null;
      const effectiveAt = matched ? new Date("2026-10-21T00:30:00.000Z")
        : sessionId === 24 ? new Date("2026-10-23T22:30:00.000Z")
          : new Date("2026-10-25T22:30:00.000Z");
      await prisma.strengthDiarySession.create({
        data: {
          id: sessionId, profileId, programId, programVersionId: version.id, status: "COMPLETED",
          entryMode: matched || sessionId === 25 ? "RETROSPECTIVE" : "LIVE",
          webStartedAt: webStart,
          webEndedAt: webStart ? new Date(webStart.getTime() + 60 * 60_000) : null,
          effectiveAccountingAt: effectiveAt,
          accountingTimeZone: "Europe/Bratislava",
          accountingTimeZoneProvenance: "client-session",
          matchedWorkoutId: matched ? matchedTrainingWorkoutId : null,
          matchStatus: matched ? "MATCHED" : sessionId === 24 ? "PENDING" : "UNMATCHED",
          matchMethod: matched ? "DIRECT_BACKFILL" : sessionId === 25 ? "MANUAL" : null,
          matchedAt: matched ? new Date("2026-10-20T02:30:00.000Z") : null,
        },
      });
      sessionCreated = true;
      const sessionExercise = await prisma.strengthSessionExercise.create({
        data: {
          sessionId, snapshotExerciseName: `Fixture squat ${sessionId}`, sortOrder: 0,
          plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT",
        },
      });
      await prisma.strengthSet.create({
        data: { sessionExerciseId: sessionExercise.id, setNumber: 1, reps: 5 + dayIndex, weightKg: 60 },
      });
    }
    const { TrainingRepository } = await import("@/modules/training/training.repository");
    const trainingRepository = new TrainingRepository(prisma);
    for (const sessionId of trainingSessionIds) {
      await trainingRepository.materializeAccounting({
        sessionId, profileId, mode: "ordinary", idempotencyKey: `recovery-fixture-snapshot-${sessionId}`,
      });
    }
    for (const date of [...new Set(recoveryDerivedDates)]) {
      await prisma.dailyModelState.create({
        data: {
          episodeId, date, status: "complete", sourceQuality: {}, missingFields: [],
          modelVersion: "bodycast-physiology-v6", glycogenKg: 0.5,
          dynamicRmrKcalPerDay: 1_700, tefKcalPerDay: 200, activityKcalPerDay: 800,
          adaptiveThermogenesisKcalPerDay: 0, energyIntakeKcal: 2_200,
          energyExpenditureKcal: 2_700, energyBalanceKcal: -500,
        },
      });
    }
    const { currentPhysiologyV7Versions } = await import("@/modules/model-episodes/physiology-v7-persistence");
    const lifecycleFixture = {
        profileId, invalidationGeneration: 42, productionStaleFromDate: null,
        productionPublishedGeneration: 42, unifiedPublishedGeneration: null,
        unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
        unifiedRolloutEpoch: 1, unifiedPublishedRolloutEpoch: null,
        ...currentPhysiologyV7Versions,
      };
    await prisma.physiologyV7Lifecycle.upsert({
      where: { profileId }, create: lifecycleFixture, update: lifecycleFixture,
    });
    const { recalculateModelEpisode } = await import("@/modules/model-episodes/model-episode.service");
    await recalculateModelEpisode({ episodeId, skipTrainingAccountingMaterialization: true });
    const currentLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    await prisma.physiologyV7Lifecycle.update({
      where: { profileId },
      data: {
        productionStaleFromDate: null,
        productionPublishedGeneration: currentLifecycle.invalidationGeneration,
      },
    });
    const { PhysiologyV7PersistenceRepository } = await import("@/modules/model-episodes/physiology-v7-persistence.repository");
    const fences = new PhysiologyV7PersistenceRepository(prisma);
    for (const date of healthDates.slice(0, 8)) {
      await fences.blockUnifiedPublication({ profileId, fromDate: date, source: "health", sourceKey: date });
    }
    for (const [index, sessionId] of trainingSessionIds.entries()) {
      const fenceDates = ["2026-10-08", "2026-10-10", "2026-10-11"];
      await fences.blockUnifiedPublication({ profileId, fromDate: fenceDates[index]!, source: "training", sourceKey: String(sessionId) });
    }
    const { assertPersistedTrainingSessionRecoveryReadyV1 } = await import("@/modules/training/training.service");
    await expect(assertPersistedTrainingSessionRecoveryReadyV1({ sessionId: 20, profileId })).resolves.toBeUndefined();
    await expect(assertPersistedTrainingSessionRecoveryReadyV1({ sessionId: 25, profileId })).resolves.toBeUndefined();
    const originalMatchedWorkout = await prisma.workout.findUniqueOrThrow({ where: { id: matchedTrainingWorkoutId } });
    await prisma.workout.update({ where: { id: matchedTrainingWorkoutId }, data: { type: "Running" } });
    await expect(assertPersistedTrainingSessionRecoveryReadyV1({ sessionId: 20, profileId }))
      .rejects.toThrow("correctly linked persisted Workout");
    await prisma.workout.update({ where: { id: matchedTrainingWorkoutId }, data: {
      type: originalMatchedWorkout.type, updatedAt: originalMatchedWorkout.updatedAt,
    } });
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(11);
  }, 60_000);

  afterAll(async () => {
    try {
      if (pagedInventoryFixtureReserved) {
        await prisma.healthSyncSnapshot.deleteMany({ where: { date: pagedInventoryFixtureDate } });
      }
      if (fixtureNamespaceReserved && profileCreated) {
        if (serializationTriggerCreated) await prisma.$executeRawUnsafe('DROP TRIGGER "fixture_training_block_serialization_failure" ON public."UnifiedPublicationBlock"');
        if (serializationFunctionCreated) await prisma.$executeRawUnsafe('DROP FUNCTION public.fixture_training_block_serialization_failure()');
        if (trainingFailureTriggerCreated) await prisma.$executeRawUnsafe('DROP TRIGGER "fixture_training_dependent_refresh_failure" ON public."ExperimentalStrengthEnergyShadow"');
        if (trainingFailureFunctionCreated) await prisma.$executeRawUnsafe('DROP FUNCTION public.fixture_training_dependent_refresh_failure()');
        await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId } });
        await prisma.unifiedExperimentalPhysiologyStateV2.deleteMany({ where: { profileId } });
        if (episodeId !== undefined) {
          await prisma.dailyModelState.deleteMany({ where: { episodeId } });
          await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({ where: { modelEpisodeId: episodeId } });
          await prisma.experimentalCessationDetrainingShadow.deleteMany({ where: { modelEpisodeId: episodeId } });
          await prisma.modelEpisode.delete({ where: { id: episodeId } });
        }
        if (sessionCreated) await prisma.strengthDiarySession.deleteMany({ where: { id: { in: [...trainingSessionIds, 26, 27] } } });
        if (matchedTrainingWorkoutId !== undefined) await prisma.workout.delete({ where: { id: matchedTrainingWorkoutId } });
        if (workoutId !== undefined) await prisma.workout.delete({ where: { id: workoutId } });
        if (programId !== undefined) await prisma.trainingProgram.delete({ where: { id: programId } });
        if (dailyHealthDataIds.length > 0) await prisma.dailyHealthData.deleteMany({ where: { id: { in: dailyHealthDataIds } } });
        if (healthSnapshotIds.length > 0) await prisma.healthSyncSnapshot.deleteMany({ where: { id: { in: healthSnapshotIds } } });
        if (healthAuditId !== undefined) await prisma.healthSyncAudit.delete({ where: { id: healthAuditId } });
        if (healthMetricSampleIds.length > 0) await prisma.healthMetricSample.deleteMany({ where: { id: { in: healthMetricSampleIds } } });
        await prisma.experimentalFfmRetentionShadow.deleteMany({ where: { profileId, date: { in: recoveryDerivedDates } } });
        await prisma.experimentalLocalHypertrophyResponseShadow.deleteMany({ where: { profileId, weekStartDate: { in: localHypertrophyWeekStarts } } });
        await prisma.experimentalGlycogenStateShadow.deleteMany({ where: { profileId, date: { in: healthDates } } });
        await prisma.physiologyV7ShadowDiagnostic.deleteMany({ where: { profileId, date: { in: recoveryDerivedDates } } });
        await prisma.fatWeightShadowV1Result.deleteMany({ where: { profileId, date: { in: recoveryDerivedDates } } });
        await prisma.experimentalFatWeightUncertaintyShadow.deleteMany({ where: { profileId, date: { in: recoveryDerivedDates } } });
        await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId, date: { in: recoveryDerivedDates } } });
        await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId } });
        if (profileCreated) await prisma.profile.delete({ where: { id: profileId } });
      }
    } finally {
      try {
        await prisma.$disconnect();
      } finally {
        if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });

  it("fingerprints a multi-page and oversized Health snapshot set byte-for-byte without modifying it", async () => {
    const existingFixtureRows = await prisma.healthSyncSnapshot.count({ where: { date: pagedInventoryFixtureDate } });
    if (existingFixtureRows !== 0) {
      throw new Error("V4 recovery bounded-inventory fixture date is already occupied in the isolated database.");
    }
    pagedInventoryFixtureReserved = true;
    const ordinaryPayload = "p".repeat(32 * 1024);
    const snapshotData = Array.from({ length: 257 }, (_, index) => ({
      date: pagedInventoryFixtureDate,
      timezone: "UTC",
      rawPayload: { fixture: pagedInventoryFixtureMarker, index, payload: ordinaryPayload },
    }));
    snapshotData.push({
      date: pagedInventoryFixtureDate,
      timezone: "UTC",
      rawPayload: { fixture: pagedInventoryFixtureMarker, index: 257,
        payload: `${"q".repeat(1024 * 1024)}💪${"q".repeat(7 * 1024 * 1024)}` },
    });
    await prisma.healthSyncSnapshot.createMany({ data: snapshotData });
    const fixtureRawDigestsBefore = await prisma.$queryRawUnsafe<Array<{ id: number; raw_digest: string; raw_bytes: bigint }>>(
      `SELECT id, md5("rawPayload"::text) AS raw_digest,
         octet_length("rawPayload"::text)::bigint AS raw_bytes
       FROM public."HealthSyncSnapshot"
       WHERE date = $1
       ORDER BY id`,
      pagedInventoryFixtureDate,
    );
    expect(fixtureRawDigestsBefore).toHaveLength(258);
    expect(fixtureRawDigestsBefore.some((row) => row.raw_bytes > BigInt(8 * 1024 * 1024))).toBe(true);

    const { inventoryV4RecoveryRawSourcesV1 } = await import("@/modules/model-episodes/unified-v4-derived-recovery.service");
    const actual = await inventoryV4RecoveryRawSourcesV1(prisma);
    expect(actual.tables.HealthSyncSnapshot).toBe(await referenceHealthSnapshotDigestV2());
    const fixtureRawDigestsAfter = await prisma.$queryRawUnsafe<Array<{ id: number; raw_digest: string; raw_bytes: bigint }>>(
      `SELECT id, md5("rawPayload"::text) AS raw_digest,
         octet_length("rawPayload"::text)::bigint AS raw_bytes
       FROM public."HealthSyncSnapshot"
       WHERE date = $1
       ORDER BY id`,
      pagedInventoryFixtureDate,
    );
    expect(fixtureRawDigestsAfter).toEqual(fixtureRawDigestsBefore);
    expect(actual.tables.HealthSyncSnapshot).toMatch(/^[a-f0-9]{64}$/);
  }, 60_000);

  it("rebuilds 8- and 9-Health fence sets across matched and unmatched Training sessions without changing sources", async () => {
    const { inventoryV4RecoveryRawSourcesV1 } = await import("@/modules/model-episodes/unified-v4-derived-recovery.service");
    const { assertPersistedTrainingSessionRecoveryReadyV1 } = await import("@/modules/training/training.service");
    const before = await inventoryV4RecoveryRawSourcesV1(prisma);
    const preflightBinding = await captureRecoveryBinding();
    const firstDay = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: healthDates[0]! } });
    const lifecycleBeforeRawMutation = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    const stepperShadowBefore = await prisma.experimentalStepperActiveEnergyShadow.findUnique({ where: { workoutId } });
    await prisma.dailyHealthData.update({ where: { id: firstDay.id }, data: { caloriesKcal: { increment: 1 } } });
    await expect(recoverWithCurrentEvidence(preflightBinding)).rejects.toThrow(/changed after exact-image rehearsal/);
    expect(await prisma.experimentalStepperActiveEnergyShadow.findUnique({ where: { workoutId } })).toEqual(stepperShadowBefore);
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(11);
    await prisma.$executeRaw`UPDATE public."DailyHealthData" SET "caloriesKcal" = ${firstDay.caloriesKcal}, "updatedAt" = ${firstDay.updatedAt} WHERE id = ${firstDay.id}`;
    await prisma.$executeRaw`UPDATE public."PhysiologyV7Lifecycle" SET "invalidationGeneration" = ${lifecycleBeforeRawMutation.invalidationGeneration}, "staleFromDate" = ${lifecycleBeforeRawMutation.staleFromDate}, "currentThroughDate" = ${lifecycleBeforeRawMutation.currentThroughDate}, "updatedAt" = ${lifecycleBeforeRawMutation.updatedAt} WHERE "profileId" = ${profileId}`;
    const restoredAfterRawMutation = await inventoryV4RecoveryRawSourcesV1(prisma);
    expect(restoredAfterRawMutation.tables).toEqual(before.tables);
    expect(restoredAfterRawMutation.fingerprint).toBe(preflightBinding.rawFingerprint);
    expect((await captureRecoveryBinding()).bindingDigest).toBe(preflightBinding.bindingDigest);

    const selectedFence = await prisma.unifiedPublicationBlock.findFirstOrThrow({
      where: { profileId, source: "health" }, orderBy: { sourceKey: "asc" },
    });
    const fenceWhere = { profileId_source_sourceKey: { profileId, source: selectedFence.source, sourceKey: selectedFence.sourceKey } };
    await prisma.unifiedPublicationBlock.update({ where: fenceWhere, data: { revision: { increment: 1 } } });
    await expect(recoverWithCurrentEvidence(preflightBinding)).rejects.toThrow(/changed after exact-image rehearsal/);
    expect(await prisma.experimentalStepperActiveEnergyShadow.findUnique({ where: { workoutId } })).toEqual(stepperShadowBefore);
    await prisma.$executeRaw`UPDATE public."UnifiedPublicationBlock" SET "revision" = ${selectedFence.revision}, "fromDate" = ${selectedFence.fromDate}, "updatedAt" = ${selectedFence.updatedAt} WHERE "profileId" = ${profileId} AND "source" = ${selectedFence.source} AND "sourceKey" = ${selectedFence.sourceKey}`;

    await prisma.unifiedPublicationBlock.update({ where: fenceWhere, data: { fromDate: healthDates[8]! } });
    await expect(recoverWithCurrentEvidence(preflightBinding)).rejects.toThrow(/changed after exact-image rehearsal/);
    expect(await prisma.experimentalStepperActiveEnergyShadow.findUnique({ where: { workoutId } })).toEqual(stepperShadowBefore);
    await prisma.$executeRaw`UPDATE public."UnifiedPublicationBlock" SET "fromDate" = ${selectedFence.fromDate}, "updatedAt" = ${selectedFence.updatedAt} WHERE "profileId" = ${profileId} AND "source" = ${selectedFence.source} AND "sourceKey" = ${selectedFence.sourceKey}`;

    const changedIdentity = healthDates[8]!;
    await prisma.unifiedPublicationBlock.update({ where: fenceWhere, data: { sourceKey: changedIdentity } });
    await expect(recoverWithCurrentEvidence(preflightBinding)).rejects.toThrow(/changed after exact-image rehearsal/);
    expect(await prisma.experimentalStepperActiveEnergyShadow.findUnique({ where: { workoutId } })).toEqual(stepperShadowBefore);
    await prisma.$executeRaw`UPDATE public."UnifiedPublicationBlock" SET "sourceKey" = ${selectedFence.sourceKey}, "updatedAt" = ${selectedFence.updatedAt} WHERE "profileId" = ${profileId} AND "source" = ${selectedFence.source} AND "sourceKey" = ${changedIdentity}`;

    const preflightLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    await prisma.physiologyV7Lifecycle.update({ where: { profileId }, data: { invalidationGeneration: { increment: 1 } } });
    await expect(recoverWithCurrentEvidence(preflightBinding)).rejects.toThrow(/changed after exact-image rehearsal/);
    expect(await prisma.experimentalStepperActiveEnergyShadow.findUnique({ where: { workoutId } })).toEqual(stepperShadowBefore);
    await prisma.$executeRaw`UPDATE public."PhysiologyV7Lifecycle" SET "invalidationGeneration" = ${preflightLifecycle.invalidationGeneration} WHERE "profileId" = ${profileId}`;
    expect((await captureRecoveryBinding()).bindingDigest).toBe(preflightBinding.bindingDigest);

    await prisma.$executeRawUnsafe(`UPDATE public."StrengthDiarySession" SET "entryMode" = 'CORRUPT' WHERE id = 24`);
    await expect(assertPersistedTrainingSessionRecoveryReadyV1({ sessionId: 24, profileId }))
      .rejects.toThrow("unsupported persisted entry mode");
    await expect(recoverWithCurrentEvidence())
      .rejects.toThrow("unsupported persisted entry mode");
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(11);
    await prisma.$executeRawUnsafe(`UPDATE public."StrengthDiarySession" SET "entryMode" = 'LIVE' WHERE id = 24`);
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(before.fingerprint);
    const trainingFence = await prisma.unifiedPublicationBlock.findUniqueOrThrow({
      where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: "20" } },
    });
    const { refreshPersistedTrainingSessionDependenciesV1 } = await import("@/modules/training/training.service");
    await expect(refreshPersistedTrainingSessionDependenciesV1({
      sessionId: 20, profileId,
      expectedTrainingFence: { revision: trainingFence.revision + 1, fromDate: trainingFence.fromDate },
    })).rejects.toThrow();
    expect(await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: "20" } },
      select: { revision: true, fromDate: true },
    })).toMatchObject({ revision: trainingFence.revision, fromDate: trainingFence.fromDate });
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(before.fingerprint);

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION public.fixture_training_dependent_refresh_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."sessionId" = 24 THEN
          RAISE EXCEPTION 'injected isolated dependent refresh failure for second Training session' USING ERRCODE = 'XX000';
        END IF;
        RETURN NEW;
      END $$`);
    trainingFailureFunctionCreated = true;
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "fixture_training_dependent_refresh_failure"
      BEFORE INSERT OR UPDATE ON public."ExperimentalStrengthEnergyShadow"
      FOR EACH ROW EXECUTE FUNCTION public.fixture_training_dependent_refresh_failure()`);
    trainingFailureTriggerCreated = true;
    await prisma.experimentalStrengthEnergyShadow.deleteMany({ where: { sessionId: { in: [...trainingSessionIds] } } });
    let secondSessionFailure: unknown = null;
    try {
      await recoverWithCurrentEvidence();
    } catch (error) {
      secondSessionFailure = error;
    }
    expect(secondSessionFailure).toBeInstanceOf(Error);
    expect((secondSessionFailure as { stage?: string }).stage).toBe("strength-active-energy-shadow");
    expect(String((secondSessionFailure as { originalError?: unknown }).originalError)).toContain("second Training session");
    expect(await prisma.experimentalStrengthEnergyShadow.count({ where: { sessionId: 20 } })).toBe(1);
    expect(await prisma.experimentalStrengthEnergyShadow.count({ where: { sessionId: 24 } })).toBe(0);
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(11);
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(before.fingerprint);
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } })).unifiedPublishedRolloutEpoch).toBeNull();
    await prisma.$executeRawUnsafe('DROP TRIGGER "fixture_training_dependent_refresh_failure" ON public."ExperimentalStrengthEnergyShadow"');
    trainingFailureTriggerCreated = false;
    await prisma.$executeRawUnsafe('DROP FUNCTION public.fixture_training_dependent_refresh_failure()');
    trainingFailureFunctionCreated = false;

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION public.fixture_training_block_serialization_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."source" = 'training' AND OLD."sourceKey" = '24' THEN
          RAISE EXCEPTION 'injected isolated test serialization conflict' USING ERRCODE = '40001';
        END IF;
        RETURN OLD;
      END $$`);
    serializationFunctionCreated = true;
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "fixture_training_block_serialization_failure"
      BEFORE DELETE ON public."UnifiedPublicationBlock"
      FOR EACH ROW EXECUTE FUNCTION public.fixture_training_block_serialization_failure()`);
    serializationTriggerCreated = true;
    await expect(recoverWithCurrentEvidence()).rejects.toMatchObject({ code: "P2034" });
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(11);
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(before.fingerprint);
    await prisma.$executeRawUnsafe('DROP TRIGGER "fixture_training_block_serialization_failure" ON public."UnifiedPublicationBlock"');
    serializationTriggerCreated = false;
    await prisma.$executeRawUnsafe('DROP FUNCTION public.fixture_training_block_serialization_failure()');
    serializationFunctionCreated = false;

    const { PhysiologyV7PersistenceRepository } = await import("@/modules/model-episodes/physiology-v7-persistence.repository");
    const originalClear = PhysiologyV7PersistenceRepository.prototype.clearUnifiedPublicationBlocks;
    let racedTrainingClear = false;
    const clearSpy = vi.spyOn(PhysiologyV7PersistenceRepository.prototype, "clearUnifiedPublicationBlocks");
    clearSpy.mockImplementation(async function (this: InstanceType<typeof PhysiologyV7PersistenceRepository>, input) {
      if (input.blocks.some((block) => block.source === "training" && block.sourceKey === "20") && !racedTrainingClear) {
        racedTrainingClear = true;
        await prisma.unifiedPublicationBlock.update({
          where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: "20" } },
          data: { revision: { increment: 1 }, fromDate: "2026-10-08" },
        });
      }
      return originalClear.call(this, input);
    });
    try {
      await expect(recoverWithCurrentEvidence())
        .rejects.toThrow(/training source fence changed during dependent refresh/);
    } finally {
      clearSpy.mockRestore();
    }
    const racedTrainingFence = await prisma.unifiedPublicationBlock.findUniqueOrThrow({
      where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: "20" } },
      select: { revision: true, fromDate: true },
    });
    expect(racedTrainingFence).toMatchObject({ revision: trainingFence.revision + 1, fromDate: "2026-10-08" });
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(11);
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } })).unifiedPublishedRolloutEpoch).toBeNull();
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(before.fingerprint);
    const result = await recoverWithCurrentEvidence();
    const after = await inventoryV4RecoveryRawSourcesV1(prisma);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(result).toMatchObject({
      rolloutEpoch: 1,
      dayCount: 25,
      healthDatesRefreshed: healthDates.slice(0, 8),
      trainingSessionIdsRefreshed: [...trainingSessionIds],
    });
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(0);
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublicationBlockedFromDate: null,
    });
    expect(lifecycle.unifiedPublishedGeneration).toBe(lifecycle.invalidationGeneration);
    expect(lifecycle.productionPublishedGeneration).toBe(lifecycle.invalidationGeneration);
    const rows = await prisma.unifiedExperimentalPhysiologyStateV2.findMany({
      where: { profileId, modelRevision: lifecycle.unifiedTargetRevision },
    });
    expect(rows).toHaveLength(25);
    expect(await prisma.strengthDiarySession.count({ where: { id: { in: [...trainingSessionIds] }, profileId } })).toBe(3);
    expect(await prisma.workout.count({ where: { id: workoutId } })).toBe(1);
    expect(await prisma.workout.count({ where: { sourceIdentity: "recovery-fixture:training-workout-20" } })).toBe(1);
    expect(await prisma.strengthSet.count({ where: { sessionExercise: { sessionId: { in: [...trainingSessionIds] } } } })).toBe(3);
    const trainingSources = await prisma.strengthDiarySession.findMany({
      where: { id: { in: [...trainingSessionIds] }, profileId },
      orderBy: { id: "asc" },
      select: {
        id: true, status: true, entryMode: true, revision: true, accountingInputRevision: true,
        effectiveAccountingAt: true, accountingTimeZone: true, accountingTimeZoneProvenance: true,
        currentSnapshotRevision: true, matchedWorkoutId: true, matchStatus: true, matchMethod: true,
        matchedAt: true, webStartedAt: true, webEndedAt: true,
      },
    });
    expect(trainingSources).toHaveLength(3);
    expect(trainingSources[0]).toMatchObject({ id: 20, status: "COMPLETED", entryMode: "RETROSPECTIVE", matchStatus: "MATCHED", matchedWorkoutId: matchedTrainingWorkoutId });
    expect(trainingSources[1]).toMatchObject({ id: 24, status: "COMPLETED", entryMode: "LIVE", matchStatus: "PENDING", matchedWorkoutId: null });
    expect(trainingSources[2]).toMatchObject({ id: 25, status: "COMPLETED", entryMode: "RETROSPECTIVE", matchStatus: "UNMATCHED", matchedWorkoutId: null });
    expect(trainingSources.every((row) => row.currentSnapshotRevision !== null)).toBe(true);
    expect(await prisma.strengthSessionAccountingSnapshot.count({ where: { sessionId: { in: [...trainingSessionIds] } } })).toBe(3);
    expect(await prisma.strengthDiarySession.count({ where: { id: 24, matchedWorkoutId: { not: null } } })).toBe(0);
    expect(await prisma.workout.count({ where: { sourceIdentity: "recovery-fixture:pending-session-24" } })).toBe(0);

    const matchedEvent = await prisma.activeEnergyCanonicalEvent.findUnique({
      where: { profileId_logicalEventKey: { profileId, logicalEventKey: `workout:${matchedTrainingWorkoutId}` } },
      select: { id: true },
    });
    expect(matchedEvent).not.toBeNull();
    expect(await prisma.activeEnergyCanonicalEvent.count({ where: { profileId, logicalEventKey: `strength-session:20` } })).toBe(0);
    const pendingEvent = await prisma.activeEnergyCanonicalEvent.findUnique({
      where: { profileId_logicalEventKey: { profileId, logicalEventKey: "strength-session:24" } },
      select: { id: true },
    });
    expect(pendingEvent).not.toBeNull();
    const pendingAliases = await prisma.activeEnergyEventAlias.findMany({ where: { eventId: pendingEvent!.id } });
    expect(pendingAliases).toHaveLength(1);
    expect(pendingAliases[0]).toMatchObject({ sourceType: "strength-session", sourceId: "24", workoutId: null });
    const pendingCandidates = await prisma.activeEnergyCandidate.findMany({ where: { eventId: pendingEvent!.id } });
    expect(pendingCandidates.every((candidate) => !["device-kcal", "manual-kcal"].includes(candidate.source))).toBe(true);

    const derivedCountsBeforeRetry = {
      strengthEnergy: await prisma.experimentalStrengthEnergyShadow.count({ where: { sessionId: { in: [...trainingSessionIds] } } }),
      strengthGlycogen: await prisma.experimentalStrengthGlycogenDemandShadow.count({ where: { sessionId: { in: [...trainingSessionIds] } } }),
      ffm: await prisma.experimentalFfmRetentionShadow.count({ where: { profileId } }),
      unified: await prisma.unifiedExperimentalPhysiologyStateV2.count({ where: { profileId } }),
      energyEvents: await prisma.activeEnergyCanonicalEvent.count({ where: { profileId } }),
      energyAliases: await prisma.activeEnergyEventAlias.count({ where: { profileId } }),
      energyCandidates: await prisma.activeEnergyCandidate.count({ where: { event: { profileId } } }),
    };
    const retried = await recoverWithCurrentEvidence();
    expect(retried).toMatchObject({ rolloutEpoch: 1, dayCount: 25, healthDatesRefreshed: [], trainingSessionIdsRefreshed: [] });
    expect({
      strengthEnergy: await prisma.experimentalStrengthEnergyShadow.count({ where: { sessionId: { in: [...trainingSessionIds] } } }),
      strengthGlycogen: await prisma.experimentalStrengthGlycogenDemandShadow.count({ where: { sessionId: { in: [...trainingSessionIds] } } }),
      ffm: await prisma.experimentalFfmRetentionShadow.count({ where: { profileId } }),
      unified: await prisma.unifiedExperimentalPhysiologyStateV2.count({ where: { profileId } }),
      energyEvents: await prisma.activeEnergyCanonicalEvent.count({ where: { profileId } }),
      energyAliases: await prisma.activeEnergyEventAlias.count({ where: { profileId } }),
      energyCandidates: await prisma.activeEnergyCandidate.count({ where: { event: { profileId } } }),
    }).toEqual(derivedCountsBeforeRetry);
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(before.fingerprint);

    const fences = new (await import("@/modules/model-episodes/physiology-v7-persistence.repository")).PhysiologyV7PersistenceRepository(prisma);
    await fences.blockUnifiedPublication({ profileId, fromDate: healthDates[8]!, source: "health", sourceKey: healthDates[8]! });
    for (const [index, sessionId] of trainingSessionIds.entries()) {
      const fenceDates = ["2026-10-08", "2026-10-10", "2026-10-11"];
      await fences.blockUnifiedPublication({ profileId, fromDate: fenceDates[index]!, source: "training", sourceKey: String(sessionId) });
    }
    const nineHealthBefore = await inventoryV4RecoveryRawSourcesV1(prisma);
    const nineHealthResult = await recoverWithCurrentEvidence();
    expect(nineHealthResult).toMatchObject({
      rolloutEpoch: 1, dayCount: 25, healthDatesRefreshed: [healthDates[8]!], trainingSessionIdsRefreshed: [...trainingSessionIds],
    });
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(nineHealthBefore.fingerprint);
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(0);
    const derivedCountsAfterSecondRecovery = {
      strengthEnergy: await prisma.experimentalStrengthEnergyShadow.count({ where: { sessionId: { in: [...trainingSessionIds] } } }),
      strengthGlycogen: await prisma.experimentalStrengthGlycogenDemandShadow.count({ where: { sessionId: { in: [...trainingSessionIds] } } }),
      ffm: await prisma.experimentalFfmRetentionShadow.count({ where: { profileId } }),
      unified: await prisma.unifiedExperimentalPhysiologyStateV2.count({ where: { profileId } }),
      energyEvents: await prisma.activeEnergyCanonicalEvent.count({ where: { profileId } }),
      energyAliases: await prisma.activeEnergyEventAlias.count({ where: { profileId } }),
      energyCandidates: await prisma.activeEnergyCandidate.count({ where: { event: { profileId } } }),
    };
    expect(derivedCountsAfterSecondRecovery).toEqual(derivedCountsBeforeRetry);

    const recoveryFences = new PhysiologyV7PersistenceRepository(prisma);
    await prisma.strengthDiarySession.create({
      data: {
        id: 26, profileId, programId, programVersionId, status: "COMPLETED", entryMode: "LIVE",
        webStartedAt: new Date("2026-10-10T20:00:00.000Z"), webEndedAt: new Date("2026-10-10T21:00:00.000Z"),
        effectiveAccountingAt: new Date("2026-10-10T20:00:00.000Z"), accountingTimeZone: "Europe/Bratislava",
        accountingTimeZoneProvenance: "client-session", matchStatus: "PENDING",
      },
    });
    sessionCreated = true;
    await recoveryFences.blockUnifiedPublication({ profileId, fromDate: "2026-10-10", source: "training", sourceKey: "26" });
    await expect(recoverWithCurrentEvidence())
      .rejects.toThrow("current persisted accounting snapshot");
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(1);
    await prisma.unifiedPublicationBlock.delete({
      where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: "26" } },
    });
    await prisma.strengthDiarySession.delete({ where: { id: 26 } });

    await prisma.strengthDiarySession.create({
      data: {
        id: 27, profileId, programId, programVersionId, status: "COMPLETED", entryMode: "LIVE",
        webStartedAt: new Date("2026-10-11T20:00:00.000Z"), webEndedAt: new Date("2026-10-11T21:00:00.000Z"),
        effectiveAccountingAt: new Date("2026-10-11T20:00:00.000Z"), accountingTimeZone: "Europe/Bratislava",
        accountingTimeZoneProvenance: "client-session", matchStatus: "PENDING",
      },
    });
    await prisma.strengthSessionExercise.create({
      data: { sessionId: 27, snapshotExerciseName: "Stale snapshot fixture", sortOrder: 0, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT" },
    });
    const { TrainingRepository } = await import("@/modules/training/training.repository");
    await new TrainingRepository(prisma).materializeAccounting({ sessionId: 27, profileId, mode: "ordinary", idempotencyKey: "stale-snapshot-fixture" });
    await prisma.strengthDiarySession.update({ where: { id: 27 }, data: { accountingInputRevision: { increment: 1 } } });
    await recoveryFences.blockUnifiedPublication({ profileId, fromDate: "2026-10-11", source: "training", sourceKey: "27" });
    await expect(recoverWithCurrentEvidence())
      .rejects.toThrow("current persisted accounting snapshot");
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(1);
    await prisma.unifiedPublicationBlock.delete({
      where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: "27" } },
    });
    await prisma.strengthDiarySession.delete({ where: { id: 27 } });
  }, 120_000);
});
