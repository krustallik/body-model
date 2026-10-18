import { PrismaClient } from "@prisma/client";
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
const trainingDate = "2026-10-09";
const healthDates = Array.from({ length: 8 }, (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`);
const localHypertrophyWeekStarts = ["2026-09-28", "2026-10-05"];
const recoveryDerivedDates = [...healthDates, trainingDate];
const episodeFixture = {
  profileId,
  startDate: fromDate,
  timezone: "UTC",
  modelVersion: "bodycast-physiology-v6",
  active: true,
  latestModeledDate: trainingDate,
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

describe("Unified V4 persisted-source recovery on isolated PostgreSQL", () => {
  let programId: number;
  let episodeId: number;
  let workoutId: number;
  let healthSnapshotId: number;
  let healthAuditId: number;
  let healthMetricSampleId: number;
  let sessionCreated = false;
  let profileCreated = false;
  let fixtureNamespaceReserved = false;
  let trainingFailureFunctionCreated = false;
  let trainingFailureTriggerCreated = false;
  let serializationFunctionCreated = false;
  let serializationTriggerCreated = false;
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
      prisma.strengthDiarySession.count({ where: { id: 20 } }),
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
    healthSnapshotId = healthSnapshot.id;
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
    healthMetricSampleId = healthMetricSample.id;
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
    await prisma.strengthDiarySession.create({
      data: {
        id: 20, profileId, programId, programVersionId: version.id, status: "COMPLETED",
        webStartedAt: new Date(`${trainingDate}T08:00:00.000Z`),
        webEndedAt: new Date(`${trainingDate}T09:00:00.000Z`),
        // Legacy persisted session: all derived accounting columns intentionally NULL.
      },
    });
    sessionCreated = true;
    const sessionExercise = await prisma.strengthSessionExercise.create({
      data: {
        sessionId: 20, snapshotExerciseName: "Fixture squat", sortOrder: 0,
        plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT",
      },
    });
    await prisma.strengthSet.create({
      data: { sessionExerciseId: sessionExercise.id, setNumber: 1, reps: 5, weightKg: 60 },
    });
    for (const [index, date] of healthDates.slice(1).entries()) {
      const healthDay = await prisma.dailyHealthData.create({
        data: {
          date, weightKg: 80 + (index + 1) / 10, bodyFatPercent: 20, caloriesKcal: 2_200, proteinG: 160,
          carbsG: 200, fatG: 70, steps: 7_000, workoutFeedObserved: true,
          rawPayload: { fixture: "persisted-source-recovery", index },
        },
      });
      dailyHealthDataIds.push(healthDay.id);
    }
    for (const date of [...healthDates, trainingDate]) {
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
    for (const date of healthDates) {
      await fences.blockUnifiedPublication({ profileId, fromDate: date, source: "health", sourceKey: date });
    }
    await fences.blockUnifiedPublication({ profileId, fromDate: trainingDate, source: "training", sourceKey: "20" });
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(9);
  }, 60_000);

  afterAll(async () => {
    try {
      if (fixtureNamespaceReserved && profileCreated) {
        if (serializationTriggerCreated) await prisma.$executeRawUnsafe('DROP TRIGGER "fixture_training_block_serialization_failure" ON public."UnifiedPublicationBlock"');
        if (serializationFunctionCreated) await prisma.$executeRawUnsafe('DROP FUNCTION public.fixture_training_block_serialization_failure()');
        if (trainingFailureTriggerCreated) await prisma.$executeRawUnsafe('DROP TRIGGER "fixture_training_dependent_refresh_failure" ON public."ExperimentalFfmRetentionShadow"');
        if (trainingFailureFunctionCreated) await prisma.$executeRawUnsafe('DROP FUNCTION public.fixture_training_dependent_refresh_failure()');
        await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId } });
        await prisma.unifiedExperimentalPhysiologyStateV2.deleteMany({ where: { profileId } });
        if (episodeId !== undefined) {
          await prisma.dailyModelState.deleteMany({ where: { episodeId } });
          await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({ where: { modelEpisodeId: episodeId } });
          await prisma.experimentalCessationDetrainingShadow.deleteMany({ where: { modelEpisodeId: episodeId } });
          await prisma.modelEpisode.delete({ where: { id: episodeId } });
        }
        if (sessionCreated) await prisma.strengthDiarySession.delete({ where: { id: 20 } });
        if (workoutId !== undefined) await prisma.workout.delete({ where: { id: workoutId } });
        if (programId !== undefined) await prisma.trainingProgram.delete({ where: { id: programId } });
        if (dailyHealthDataIds.length > 0) await prisma.dailyHealthData.deleteMany({ where: { id: { in: dailyHealthDataIds } } });
        if (healthSnapshotId !== undefined) await prisma.healthSyncSnapshot.delete({ where: { id: healthSnapshotId } });
        if (healthAuditId !== undefined) await prisma.healthSyncAudit.delete({ where: { id: healthAuditId } });
        if (healthMetricSampleId !== undefined) await prisma.healthMetricSample.delete({ where: { id: healthMetricSampleId } });
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

  it("rebuilds current V4 coverage from the nine durable fences without changing sources", async () => {
    const { inventoryV4RecoveryRawSourcesV1, recoverUnifiedV4FromPersistedSourcesV1 } = await import("@/modules/model-episodes/unified-v4-derived-recovery.service");
    const before = await inventoryV4RecoveryRawSourcesV1(prisma);
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
        IF NEW."date" = '${trainingDate}' THEN
          RAISE EXCEPTION 'injected isolated dependent refresh failure' USING ERRCODE = 'XX000';
        END IF;
        RETURN NEW;
      END $$`);
    trainingFailureFunctionCreated = true;
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "fixture_training_dependent_refresh_failure"
      BEFORE INSERT OR UPDATE ON public."ExperimentalFfmRetentionShadow"
      FOR EACH ROW EXECUTE FUNCTION public.fixture_training_dependent_refresh_failure()`);
    trainingFailureTriggerCreated = true;
    await expect(recoverUnifiedV4FromPersistedSourcesV1({ profileId, ownerAuthorized: true })).rejects.toThrow();
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(9);
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(before.fingerprint);
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } })).unifiedPublishedRolloutEpoch).toBeNull();
    await prisma.$executeRawUnsafe('DROP TRIGGER "fixture_training_dependent_refresh_failure" ON public."ExperimentalFfmRetentionShadow"');
    trainingFailureTriggerCreated = false;
    await prisma.$executeRawUnsafe('DROP FUNCTION public.fixture_training_dependent_refresh_failure()');
    trainingFailureFunctionCreated = false;

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION public.fixture_training_block_serialization_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."source" = 'training' THEN
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
    await expect(recoverUnifiedV4FromPersistedSourcesV1({ profileId, ownerAuthorized: true })).rejects.toMatchObject({ code: "P2034" });
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(9);
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(before.fingerprint);
    await prisma.$executeRawUnsafe('DROP TRIGGER "fixture_training_block_serialization_failure" ON public."UnifiedPublicationBlock"');
    serializationTriggerCreated = false;
    await prisma.$executeRawUnsafe('DROP FUNCTION public.fixture_training_block_serialization_failure()');
    serializationFunctionCreated = false;

    const { PhysiologyV7PersistenceRepository } = await import("@/modules/model-episodes/physiology-v7-persistence.repository");
    const originalClear = PhysiologyV7PersistenceRepository.prototype.clearUnifiedPublicationBlock;
    let racedTrainingClear = false;
    const clearSpy = vi.spyOn(PhysiologyV7PersistenceRepository.prototype, "clearUnifiedPublicationBlock");
    clearSpy.mockImplementation(async function (this: InstanceType<typeof PhysiologyV7PersistenceRepository>, input) {
      if (input.source === "training" && !racedTrainingClear) {
        racedTrainingClear = true;
        await prisma.unifiedPublicationBlock.update({
          where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: "20" } },
          data: { revision: { increment: 1 }, fromDate: "2026-10-08" },
        });
      }
      return originalClear.call(this, input);
    });
    try {
      await expect(recoverUnifiedV4FromPersistedSourcesV1({ profileId, ownerAuthorized: true }))
        .rejects.toThrow(/training source fence changed during dependent refresh/);
    } finally {
      clearSpy.mockRestore();
    }
    const racedTrainingFence = await prisma.unifiedPublicationBlock.findUniqueOrThrow({
      where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: "20" } },
      select: { revision: true, fromDate: true },
    });
    expect(racedTrainingFence).toMatchObject({ revision: trainingFence.revision + 1, fromDate: "2026-10-08" });
    expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(9);
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } })).unifiedPublishedRolloutEpoch).toBeNull();
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(before.fingerprint);
    await prisma.unifiedPublicationBlock.update({
      where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: "20" } },
      data: { fromDate: trainingDate },
    });

    const result = await recoverUnifiedV4FromPersistedSourcesV1({ profileId, ownerAuthorized: true });
    const after = await inventoryV4RecoveryRawSourcesV1(prisma);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(result).toMatchObject({
      rolloutEpoch: 1,
      dayCount: 9,
      healthDatesRefreshed: healthDates,
      trainingSessionIdsRefreshed: [20],
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
    expect(rows).toHaveLength(9);
    expect(await prisma.strengthDiarySession.count({ where: { id: 20, profileId } })).toBe(1);
    expect(await prisma.workout.count({ where: { id: workoutId } })).toBe(1);
    expect(await prisma.strengthSet.count({ where: { sessionExercise: { sessionId: 20 } } })).toBe(1);
    expect(await prisma.strengthDiarySession.findUniqueOrThrow({ where: { id: 20 } })).toMatchObject({
      effectiveAccountingAt: null,
      accountingTimeZone: null,
      accountingTimeZoneProvenance: null,
      currentSnapshotRevision: null,
    });

    const derivedCountsBeforeRetry = {
      strengthEnergy: await prisma.experimentalStrengthEnergyShadow.count({ where: { sessionId: 20 } }),
      strengthGlycogen: await prisma.experimentalStrengthGlycogenDemandShadow.count({ where: { sessionId: 20 } }),
      ffm: await prisma.experimentalFfmRetentionShadow.count({ where: { profileId } }),
      unified: await prisma.unifiedExperimentalPhysiologyStateV2.count({ where: { profileId } }),
    };
    const retried = await recoverUnifiedV4FromPersistedSourcesV1({ profileId, ownerAuthorized: true });
    expect(retried).toMatchObject({ rolloutEpoch: 1, dayCount: 9, healthDatesRefreshed: [], trainingSessionIdsRefreshed: [] });
    expect({
      strengthEnergy: await prisma.experimentalStrengthEnergyShadow.count({ where: { sessionId: 20 } }),
      strengthGlycogen: await prisma.experimentalStrengthGlycogenDemandShadow.count({ where: { sessionId: 20 } }),
      ffm: await prisma.experimentalFfmRetentionShadow.count({ where: { profileId } }),
      unified: await prisma.unifiedExperimentalPhysiologyStateV2.count({ where: { profileId } }),
    }).toEqual(derivedCountsBeforeRetry);
    expect((await inventoryV4RecoveryRawSourcesV1(prisma)).fingerprint).toBe(before.fingerprint);
  }, 120_000);
});
