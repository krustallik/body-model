import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION,
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
} from "@/model/unified-experimental-physiology-v1";
import { EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION } from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import { EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import {
  POSTCOMMIT_FRESH_TEST_DATABASE_NAME,
  FULL_INTEGRATION_CLEAN_DATABASE_NAME,
  FULL_INTEGRATION_REAUDIT_DATABASE_NAME,
  REAUDIT_TEST_DATABASE_NAME,
  requireIsolatedStage01Database,
} from "@/modules/training/testing/require-isolated-database";
import { currentPhysiologyV7Versions } from "@/modules/model-episodes/physiology-v7-persistence";
import { invalidateUnifiedRelativeMuscleSuffixV1, rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import * as unifiedStateService from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import { PhysiologyV7ConcurrentSourceChangeError, PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { isProductionGenerationCurrentV1, isUnifiedGenerationCurrentV1 } from "@/modules/model-episodes/publication-generation-v1";
import { healthSyncRepository } from "@/modules/health/health.repository";
import { syncHealthData } from "@/modules/health/health.service";
import { processNextHealthSyncRefreshJob } from "@/modules/health/health-sync-refresh-worker";
import * as glycogenStateShadowService from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import { recordExperimentalLocalHypertrophyResponseShadow } from "@/modules/model-episodes/experimental-local-hypertrophy-response-shadow.service";
import { rebuildRelativeMuscleEpisodeTrajectories } from "@/modules/model-episodes/relative-muscle-shadow-core.service";
import { utcMondayWeekStart } from "@/model/physiology-v7/resistance-training-exposure-history-v7";
import * as strengthGlycogenDemandShadowService from "@/modules/training/experimental-strength-glycogen-demand-shadow.service";
import * as stepperActiveEnergyShadowService from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import * as stepperGlycogenShadowService from "@/modules/profile/experimental-stepper-glycogen-demand-shadow.service";
import { publishActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";
import * as activeEnergyPublication from "@/modules/activity/active-energy-publication";
import * as activeEnergyMaterialization from "@/modules/activity/active-energy-materialization";
import { DailyMetricRepository } from "@/modules/days/day.repository";
import { trainingService } from "@/modules/training/training.service";
import { getModelStatus } from "@/modules/model-episodes/model-episode.service";
import { processNextTrainingRefreshJob } from "@/modules/training/training-refresh-worker";
import { enqueueTrainingSourceChangeInTransaction } from "@/modules/training/training-refresh-queue";
import { RESISTANCE } from "@/modules/training/training.constants";
import { trainingChildDeletionPublicationSourceKey, trainingRepository } from "@/modules/training/training.repository";
import { recordExperimentalStrengthEnergyShadow } from "@/modules/training/experimental-strength-energy-shadow.service";
import { StaleStrengthEnergySourceError } from "@/modules/training/training.errors";
import { StepperWorkoutRepository } from "@/modules/training/stepper-workout.repository";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import { readLatestUnifiedExperimentalPhysiologyV2ForEpisode } from "@/modules/experimental-forecast-v1/service";
import { activateAndReplayUnifiedV4, verifyAndPublishUnifiedV3Postflight, verifyUnifiedV4ReadyForTraffic } from "@/modules/model-episodes/unified-rollout-v4.service";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const databaseUrl = process.env.DATABASE_URL;
const isolatedDatabase = requireIsolatedStage01Database(databaseUrl, process.env.BODYCAST_STAGE01_MODE, "test");
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const profileId = 1;
const fixtureMethod = "unified-state-v1-verification";
const healthSnapshotFixtureTag = `${fixtureMethod}-snapshot`;
const dates = ["2027-01-01", "2027-01-02", "2027-01-03"];
const futureDate = "2027-01-04";
const dateLineDates = ["2028-01-01", "2028-01-02", "2028-01-03", "2028-01-04"];
let lifecycleBeforeSuite: Awaited<ReturnType<typeof prisma.physiologyV7Lifecycle.findUnique>> | null = null;
let lifecycleSnapshotCaptured = false;
let episodeId: number | null = null;
const deletedFixtureTrainingSourceKeys = new Set<string>();
const fixtureUnlinkedSessionIds = new Set<number>();
const deletedFixtureStepperSourceKeys = new Set<string>();
const fixtureHeartRateTimestamps = new Set<string>();

const episodeData = {
  profileId,
  startDate: dates[0],
  timezone: "Europe/Bratislava",
  modelVersion: "bodycast-physiology-v6",
  active: true,
  ecfPolicy: "hold-ecf",
  baselineEnergyIntakeKcalPerDay: 2_400,
  baselineCarbIntakeG: 220,
  baselineWindowStartDate: dates[0],
  baselineWindowEndDate: dates[0],
  baselineNutritionDayCount: 1,
  baselineWeightObservationCount: 1,
  baselineWeightTrendKgPerWeek: 0,
  baselineWeightTrendPercentPerWeek: 0,
  baselineDerivationMethod: fixtureMethod,
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

async function clean(): Promise<void> {
  const allDates = [...dates, futureDate, ...dateLineDates];
  if (fixtureHeartRateTimestamps.size > 0) {
    await prisma.heartRateSample.deleteMany({
      where: { profileId, timestamp: { in: [...fixtureHeartRateTimestamps].map((value) => new Date(value)) } },
    });
    fixtureHeartRateTimestamps.clear();
  }
  const fixtureEpisodes = await prisma.modelEpisode.findMany({
    where: { profileId, baselineDerivationMethod: fixtureMethod }, select: { id: true },
  });
  const fixturePrograms = await prisma.trainingProgram.findMany({
    where: { profileId, name: { startsWith: `${fixtureMethod}-` } }, select: { id: true },
  });
  const fixtureSessions = await prisma.strengthDiarySession.findMany({
    where: { profileId, OR: [
      { programId: { in: fixturePrograms.map(({ id }) => id) } },
      { id: { in: [...fixtureUnlinkedSessionIds] } },
    ] }, select: { id: true },
  });
  const fixtureTrainingSessionIds = [...new Set([
    ...fixtureSessions.map(({ id }) => String(id)),
    ...deletedFixtureTrainingSourceKeys,
  ])];
  const fixtureWorkouts = await prisma.workout.findMany({
    where: { dailyHealthData: { date: { in: allDates } } }, select: { id: true },
  });
  const fixtureAliases = await prisma.activeEnergyEventAlias.findMany({
    where: {
      profileId,
      OR: [
        { sourceType: "strength-session", sourceId: { in: fixtureSessions.map(({ id }) => String(id)) } },
        { workoutId: { in: fixtureWorkouts.map(({ id }) => id) } },
      ],
    },
    select: { eventId: true },
  });
  if (fixtureAliases.length > 0) {
    await prisma.activeEnergyCanonicalEvent.deleteMany({
      where: { id: { in: [...new Set(fixtureAliases.map(({ eventId }) => eventId))] } },
    });
  }
  const fixturePublicationBlocks = await prisma.unifiedPublicationBlock.findMany({
    where: {
      profileId,
      OR: [
        { source: { in: ["health", "day"] }, sourceKey: { in: allDates } },
        { source: "active_energy", sourceKey: "convergence" },
        { source: "training", sourceKey: { in: fixtureTrainingSessionIds } },
        ...fixtureTrainingSessionIds.flatMap((id) => [
          { source: "training", sourceKey: { startsWith: `training-delete-set:${id}:` } },
          { source: "training", sourceKey: { startsWith: `training-delete-exercise:${id}:` } },
        ]),
        { source: "stepper", sourceKey: { in: [...new Set([
          ...fixtureWorkouts.map(({ id }) => String(id)),
          ...deletedFixtureStepperSourceKeys,
        ])] } },
      ],
    },
    select: { source: true, sourceKey: true, fromDate: true, revision: true },
  });
  const persistence = new PhysiologyV7PersistenceRepository(prisma);
  for (const block of fixturePublicationBlocks) {
    if (!(["health", "training", "day", "stepper", "active_energy"] as const).includes(block.source as "health" | "training" | "day" | "stepper" | "active_energy")) {
      throw new Error(`Unexpected Unified publication block source in fixture cleanup: ${block.source}`);
    }
    const cleared = await persistence.clearUnifiedPublicationBlock({
      profileId,
      source: block.source as "health" | "training" | "day" | "stepper",
      sourceKey: block.sourceKey,
      expectedRevision: block.revision,
      expectedFromDate: block.fromDate,
    });
    if (!cleared) throw new Error("Unified publication fixture fence changed during cleanup.");
  }
  await prisma.experimentalTransientExerciseWaterShadow.deleteMany({
    where: { profileId, sessionId: { in: fixtureSessions.map(({ id }) => id) } },
  });
  const healthSnapshots = await prisma.healthSyncSnapshot.findMany({
    where: { date: { in: [...allDates] } }, select: { id: true, rawPayload: true },
  });
  const fixtureSnapshotIds = healthSnapshots
    .filter(({ rawPayload }) => rawPayload !== null && typeof rawPayload === "object" && !Array.isArray(rawPayload)
      && (rawPayload as Record<string, unknown>).__bodycastFixture === healthSnapshotFixtureTag)
    .map(({ id }) => id);
  if (fixtureSnapshotIds.length > 0) {
    await prisma.healthSyncSnapshot.deleteMany({ where: { id: { in: fixtureSnapshotIds } } });
  }
  await prisma.unifiedExperimentalPhysiologyStateV2.deleteMany({
    where: { OR: [{ profileId, date: { in: allDates } }, { modelEpisodeId: { in: fixtureEpisodes.map(({ id }) => id) } }] },
  });
  await prisma.unifiedExperimentalPhysiologyState.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalGlycogenStateShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalGlycogenAssociatedWaterShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalCessationDetrainingShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalFfmRetentionShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.fatWeightShadowV1Result.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.dailyModelState.deleteMany({ where: { date: { in: allDates }, episode: { baselineDerivationMethod: fixtureMethod } } });
  await prisma.strengthDiarySession.deleteMany({ where: { id: { in: fixtureSessions.map(({ id }) => id) } } });
  await prisma.trainingProgram.deleteMany({ where: { id: { in: fixturePrograms.map(({ id }) => id) } } });
  await prisma.modelEpisode.deleteMany({ where: { profileId, baselineDerivationMethod: fixtureMethod } });
  // Durable refresh metadata is fixture-owned in this dedicated integration DB.
  // A source mutation in one test must not make the next test's V4 publication
  // appear pending after the source fixture itself has been cleaned.
  await prisma.trainingSourceChange.deleteMany({ where: { profileId } });
  await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
  await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId } });
  deletedFixtureTrainingSourceKeys.clear();
  fixtureUnlinkedSessionIds.clear();
  deletedFixtureStepperSourceKeys.clear();
  episodeId = null;
  await deleteDailyHealthRows(prisma, allDates);
}

/** Mark the deliberately hand-seeded production rows as an explicit current fixture generation. */
async function publishSeededProductionFixture(): Promise<void> {
  const lifecycle = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId } });
  if (lifecycle === null) {
    await prisma.physiologyV7Lifecycle.create({
      data: {
        profileId,
        staleFromDate: null,
        currentThroughDate: dates[dates.length - 1],
        invalidationGeneration: 1,
        productionStaleFromDate: null,
        productionPublishedGeneration: 1,
        unifiedPublishedGeneration: null,
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
        unifiedRolloutEpoch: 0,
        unifiedPublishedRolloutEpoch: null,
        ...currentPhysiologyV7Versions,
      },
    });
    return;
  }
  await prisma.physiologyV7Lifecycle.update({
    where: { profileId },
    data: {
      productionStaleFromDate: null,
      productionPublishedGeneration: lifecycle.invalidationGeneration,
      unifiedPublishedGeneration: null,
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
      unifiedRolloutEpoch: 0,
      unifiedPublishedRolloutEpoch: null,
      currentThroughDate: dates[dates.length - 1],
      ...currentPhysiologyV7Versions,
    },
  });
}

async function seed(input: {
  order?: readonly string[];
  withWorkouts?: boolean;
  productionGlycogenKg?: readonly (number | null)[];
  timezone?: string;
} = {}): Promise<void> {
  await prisma.profile.upsert({
    where: { id: profileId },
    create: { id: profileId, sex: "male", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"), heightCm: 180 },
    update: {},
  });
  const episode = await prisma.modelEpisode.create({ data: { ...episodeData, timezone: input.timezone ?? episodeData.timezone } });
  episodeId = episode.id;
  const order = input.order ?? dates;
  for (const [index, date] of order.entries()) {
    const health = await prisma.dailyHealthData.create({
      data: {
        date,
        weightKg: 80 - index * 0.1,
        bodyFatPercent: 20,
        caloriesKcal: 2_200,
        proteinG: 160,
        fatG: 70,
        carbsG: 200 + index * 10,
        steps: 7_000,
        walkingDistanceKm: 5,
        workoutFeedObserved: true,
        rawPayload: {},
      },
    });
    await prisma.dailyModelState.create({
      data: {
        episodeId: episode.id,
        date,
        status: "complete",
        sourceQuality: {},
        missingFields: [],
        modelVersion: "bodycast-physiology-v6",
        dynamicRmrKcalPerDay: 1_700,
        tefKcalPerDay: 200,
        activityKcalPerDay: 800,
        adaptiveThermogenesisKcalPerDay: 0,
        energyIntakeKcal: 2_200,
        energyExpenditureKcal: 2_700,
        energyBalanceKcal: -500,
        ...(input.productionGlycogenKg === undefined ? {} : {
          glycogenKg: input.productionGlycogenKg[index] ?? null,
          deltaGlycogenKg: index === 0
            ? input.productionGlycogenKg[index] ?? null
            : input.productionGlycogenKg[index] === null || input.productionGlycogenKg[index - 1] === null
              ? null
              : (input.productionGlycogenKg[index] ?? 0) - (input.productionGlycogenKg[index - 1] ?? 0),
        }),
      },
    });
    if (input.withWorkouts && index === 0) {
      await prisma.workout.createMany({
        data: [
          {
            dailyHealthDataId: health.id,
            externalId: "unified-strength-1",
            sourceIdentity: "ext:unified-strength-1",
            type: "Traditional Strength Training",
            startAt: new Date(`${date}T16:00:00.000Z`),
            endAt: new Date(`${date}T17:00:00.000Z`),
            durationMinutes: 60,
            activeEnergyKcal: 500,
          },
          {
            dailyHealthDataId: health.id,
            externalId: "unified-stepper-1",
            sourceIdentity: "ext:unified-stepper-1",
            type: "Stair Climbing",
            startAt: new Date(`${date}T18:00:00.000Z`),
            endAt: new Date(`${date}T18:30:00.000Z`),
            durationMinutes: 30,
            activeEnergyKcal: 300,
          },
        ],
      });
    }
  }
  await publishSeededProductionFixture();
}

async function addFutureDay(): Promise<void> {
  const episode = await prisma.modelEpisode.findFirstOrThrow({ where: { profileId, baselineDerivationMethod: fixtureMethod } });
  const health = await prisma.dailyHealthData.create({
    data: {
      date: futureDate,
      weightKg: 79.7,
      bodyFatPercent: 20,
      caloriesKcal: 2_200,
      proteinG: 160,
      fatG: 70,
      carbsG: 230,
      steps: 7_000,
      walkingDistanceKm: 5,
      workoutFeedObserved: true,
      rawPayload: {},
    },
  });
  await prisma.dailyModelState.create({
    data: {
      episodeId: episode.id,
      date: futureDate,
      status: "complete",
      sourceQuality: {},
      missingFields: [],
      modelVersion: "bodycast-physiology-v6",
      filteredWeightKg: 79.7,
      dynamicRmrKcalPerDay: 1_700,
      tefKcalPerDay: 200,
      activityKcalPerDay: 800,
      energyIntakeKcal: 2_200,
      energyExpenditureKcal: 2_700,
      energyBalanceKcal: -500,
    },
  });
  await publishSeededProductionFixture();
  expect(health.id).toBeTypeOf("number");
}

function trajectory(rows: ReadonlyArray<Awaited<ReturnType<typeof prisma.unifiedExperimentalPhysiologyStateV2.findMany>>[number]>): unknown[] {
  return rows.map((row) => {
    const state = row.state as { transientWater?: Record<string, unknown> };
    return {
      modelEpisodeId: "episode-identity-normalized-for-replay-comparison",
      date: row.date,
      boundaryAt: row.boundaryAt,
      state: {
        ...state,
        transientWater: state.transientWater ? {
          ...state.transientWater,
          episodeId: "episode-identity-normalized-for-replay-comparison",
        } : null,
      },
      deltas: row.deltas,
      qualityStatus: row.qualityStatus,
      gapSeverity: row.gapSeverity,
      energyLedger: row.energyLedger,
    };
  });
}

async function rows(fromDate = dates[0], toDate = dates[dates.length - 1]) {
  return prisma.unifiedExperimentalPhysiologyStateV2.findMany({
    where: { profileId, modelEpisodeId: episodeId ?? -1, date: { gte: fromDate, lte: toDate } },
    orderBy: { boundaryAt: "asc" },
  });
}

async function syncHealthWeightThroughService(
  date: string,
  weightKg: number,
  receivedAt: string,
  publicationNow: Date = fixtureNow,
  deferDependentRefresh = false,
): ReturnType<typeof syncHealthData> {
  const day = { date, weightKg, caloriesKcal: 2_200, proteinG: 160, fatG: 70, carbsG: 220 };
  const rawDay = { ...day, __bodycastFixture: healthSnapshotFixtureTag };
  return syncHealthData(
    { timezone: "Europe/Bratislava", days: [day] },
    healthSyncRepository,
    [rawDay],
    new Date(receivedAt),
    undefined,
    { publicationNow, deferDependentRefresh },
  );
}

async function readFixtureHealthSnapshotId(date: string, receivedAt: string): Promise<number> {
  const rows = await prisma.healthSyncSnapshot.findMany({
    where: { date, receivedAt: new Date(receivedAt) }, select: { id: true, rawPayload: true },
  });
  const fixture = rows.find(({ rawPayload }) => rawPayload !== null && typeof rawPayload === "object"
    && !Array.isArray(rawPayload)
    && (rawPayload as Record<string, unknown>).__bodycastFixture === healthSnapshotFixtureTag);
  if (!fixture) throw new Error("Expected the exact Health fixture snapshot to be persisted");
  return fixture.id;
}

const fixtureNow = new Date(`${futureDate}T12:00:00.000Z`);

async function makeTrainingRefreshDue(profileId: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "TrainingRefreshJob"
    SET "dueAt" = clock_timestamp(), "nextAttemptAt" = clock_timestamp()
    WHERE "profileId" = ${profileId}
      AND "completedGeneration" < "requestedGeneration"
  `;
}

async function runOneTrainingRefreshAttempt(
  profileId: number,
  hooks?: Parameters<typeof processNextTrainingRefreshJob>[0],
): Promise<boolean> {
  await makeTrainingRefreshDue(profileId);
  return processNextTrainingRefreshJob(hooks);
}

async function runTrainingRefreshToCompletion(profileId: number, maxAttempts = 5): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const state = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
    if (!state || state.completedGeneration >= state.requestedGeneration) return;
    const claimed = await runOneTrainingRefreshAttempt(profileId);
    if (!claimed) break;
  }
  const remaining = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
  if (remaining && remaining.completedGeneration < remaining.requestedGeneration) {
    throw new Error(`Training refresh fixture did not complete generation ${remaining.requestedGeneration}`);
  }
}

async function seedUnmodeledHealthWeightRefresh(withDayBlock: boolean): Promise<void> {
  await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
  await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
  await verifyAndPublishUnifiedV3Postflight({ profileId });
  await activateAndReplayUnifiedV4({ profileId });
      // Jan 4 is still in progress at fixtureNow: persist its source and
      // publish only the existing partial-quality Unified source-day state,
      // never a production DailyModelState for an incomplete local day.
  await prisma.dailyHealthData.create({ data: {
    date: futureDate, weightKg: 79.7, caloriesKcal: 2_200,
    proteinG: 160, fatG: 70, carbsG: 230, steps: 7_000,
    walkingDistanceKm: 5, workoutFeedObserved: true, rawPayload: {},
  } });
  await prisma.$transaction(async (tx) => {
    const lifecycle = new PhysiologyV7PersistenceRepository(tx);
    await lifecycle.lockProfile(profileId);
    await lifecycle.invalidate(profileId, futureDate);
    if (withDayBlock) {
      await lifecycle.blockUnifiedPublication({ profileId, source: "day", sourceKey: futureDate, fromDate: futureDate });
    }
    await enqueueTrainingSourceChangeInTransaction(tx, {
      profileId, operationKind: "health_weight_accounting_refresh",
      affectedSessionIds: [], oldModelDates: [futureDate], newModelDates: [futureDate],
      deadlineMode: "health-fast",
    });
  });
}

async function runHealthRefreshToCompletion(profileId: number, maxAttempts = 5): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const state = await prisma.healthSyncRefreshJob.findUnique({ where: { profileId } });
    if (!state || state.completedGeneration >= state.requestedGeneration) return;
    await prisma.$executeRaw`
      UPDATE "HealthSyncRefreshJob"
      SET "nextAttemptAt" = clock_timestamp()
      WHERE "profileId" = ${profileId}
        AND "completedGeneration" < "requestedGeneration"
    `;
    const claimed = await processNextHealthSyncRefreshJob();
    if (!claimed) break;
  }
  const remaining = await prisma.healthSyncRefreshJob.findUnique({ where: { profileId } });
  if (remaining && remaining.completedGeneration < remaining.requestedGeneration) {
    throw new Error(`Health refresh fixture did not complete generation ${remaining.requestedGeneration}`);
  }
}

describe("UnifiedExperimentalPhysiologyStateV1 PostgreSQL lifecycle", () => {
  beforeAll(() => {
    expect(["bodycast_training_history_stage01_test", "bodycast_training_postcommit_test", POSTCOMMIT_FRESH_TEST_DATABASE_NAME, REAUDIT_TEST_DATABASE_NAME, FULL_INTEGRATION_REAUDIT_DATABASE_NAME, FULL_INTEGRATION_CLEAN_DATABASE_NAME])
      .toContain(isolatedDatabase.databaseName);
  });

  beforeEach(async () => {
    if (!lifecycleSnapshotCaptured) {
      lifecycleBeforeSuite = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId } });
      lifecycleSnapshotCaptured = true;
    }
    await clean();
  });

  it("cleans only fixture-owned publication blocks and preserves unrelated lifecycle summary", async () => {
    await prisma.profile.upsert({
      where: { id: profileId },
      create: { id: profileId, sex: "male", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"), heightCm: 180 },
      update: {},
    });
    const persistence = new PhysiologyV7PersistenceRepository(prisma);
    await persistence.ensureLifecycle(profileId, dates[0]!);
    await persistence.blockUnifiedPublication({
      profileId, fromDate: dates[0]!, source: "day", sourceKey: dates[0]!,
    });
    await persistence.blockUnifiedPublication({
      profileId, fromDate: "2069-01-01", source: "health", sourceKey: "unrelated-fixture-cleanup-sentinel",
    });

    try {
      await clean();
      expect(await prisma.unifiedPublicationBlock.findMany({
        where: { profileId }, select: { source: true, sourceKey: true, fromDate: true },
      })).toEqual([{ source: "health", sourceKey: "unrelated-fixture-cleanup-sentinel", fromDate: "2069-01-01" }]);
      expect(await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } }))
        .toMatchObject({ unifiedPublicationBlockedFromDate: "2069-01-01", unifiedPublicationBlockedSource: "health" });
    } finally {
      const token = await persistence.readUnifiedPublicationBlockToken({
        profileId, source: "health", sourceKey: "unrelated-fixture-cleanup-sentinel",
      });
      if (token) {
        await persistence.clearUnifiedPublicationBlock({
          profileId,
          source: "health",
          sourceKey: "unrelated-fixture-cleanup-sentinel",
          expectedRevision: token.revision,
          expectedFromDate: token.fromDate,
        });
      }
    }
  });

  afterAll(async () => {
    await clean();
    if (lifecycleBeforeSuite === null) {
      await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId } });
    } else {
      await prisma.physiologyV7Lifecycle.update({
        where: { profileId },
        data: {
          staleFromDate: lifecycleBeforeSuite.staleFromDate,
          invalidationGeneration: lifecycleBeforeSuite.invalidationGeneration,
          currentThroughDate: lifecycleBeforeSuite.currentThroughDate,
          productionStaleFromDate: lifecycleBeforeSuite.productionStaleFromDate,
          productionPublishedGeneration: lifecycleBeforeSuite.productionPublishedGeneration,
          unifiedPublishedGeneration: lifecycleBeforeSuite.unifiedPublishedGeneration,
          unifiedTargetRevision: lifecycleBeforeSuite.unifiedTargetRevision,
          unifiedRolloutEpoch: lifecycleBeforeSuite.unifiedRolloutEpoch,
          unifiedPublishedRolloutEpoch: lifecycleBeforeSuite.unifiedPublishedRolloutEpoch,
          stateVersion: lifecycleBeforeSuite.stateVersion,
          sourceNormalizationVersion: lifecycleBeforeSuite.sourceNormalizationVersion,
          dailyRuntimeVersion: lifecycleBeforeSuite.dailyRuntimeVersion,
          rangeRebuildVersion: lifecycleBeforeSuite.rangeRebuildVersion,
          rebuildServiceVersion: lifecycleBeforeSuite.rebuildServiceVersion,
        },
      });
    }
    await prisma.$disconnect();
  });

  it("persists one row per episode model day with lineage and non-overlapping energy accounting", async () => {
    await seed({ withWorkouts: true });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const stored = await rows();

    expect(stored).toHaveLength(3);
    expect(new Set(stored.map((row) => row.date)).size).toBe(3);
    expect(stored.every((row) => row.modelEpisodeId === episodeId && row.boundaryAt instanceof Date)).toBe(true);
    expect(stored.every((row) => row.modelRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION)).toBe(true);
    expect(stored.every((row) => row.sourceFingerprint.length > 0 && row.resultFingerprint.length > 0)).toBe(true);
    expect(stored.every((row) => (row.sourceLineage as { sourceDate?: string }).sourceDate === row.date)).toBe(true);
    expect(stored.every((row) => row.qualityStatus === "partial" && row.gapSeverity === "none")).toBe(true);

    const ledger = stored[0]!.energyLedger as { entries: Array<{ kind: string; status: string; valueKcal: number | null }>; selectedDoseKeys: string[] };
    expect(ledger.selectedDoseKeys).toHaveLength(2);
    expect(ledger.selectedDoseKeys.every((key) => /^workout:\d+$/.test(key))).toBe(true);
    expect(ledger.entries.filter((entry) => entry.kind === "workout")).toHaveLength(1);
    expect(ledger.entries.filter((entry) => entry.kind === "stepper")).toHaveLength(1);
    expect(ledger.entries.filter((entry) => entry.kind === "garmin-device")).toHaveLength(2);
    expect(ledger.entries.filter((entry) => entry.kind === "strength-shadow" || entry.kind === "stepper-shadow")).toHaveLength(0);

    const state = stored[0]!.state as { relativeMuscle?: { authoritativeUse?: string } };
    expect(state.relativeMuscle?.authoritativeUse).toBe("forbidden");
    expect(JSON.stringify(stored[0])).not.toContain("skeletalMuscleKg");
    const deltas = stored[0]!.deltas as { slowTissueKg?: { slowNonFat?: number | null }; glycogenWaterKg?: unknown; transientWaterKg?: unknown };
    expect(deltas.slowTissueKg?.slowNonFat).toBeNull();
    expect("glycogenWaterKg" in deltas).toBe(true);
    expect("transientWaterKg" in deltas).toBe(true);
  });

  it("publishes exact V3 postflight epoch 0 before explicitly replaying current V4", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const v3 = await verifyAndPublishUnifiedV3Postflight({ profileId });
    expect(v3.dayCount).toBe(3);
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } })).unifiedPublishedRolloutEpoch).toBe(0);

    const v4 = await activateAndReplayUnifiedV4({ profileId });
    expect(v4).toMatchObject({ profileId, rolloutEpoch: 1, dayCount: 3 });
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      productionPublishedGeneration: lifecycle.invalidationGeneration,
      productionStaleFromDate: null,
    });
    const stored = await rows();
    const glycogen = stored.map((row) => (row.state as { glycogen: { physicalKg: number } }).glycogen.physicalKg);
    const water = stored.map((row) => (row.state as { glycogenWater: { physicalKg: number } }).glycogenWater.physicalKg);
    expect(stored.every((row) => row.modelRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION)).toBe(true);
    expect(glycogen).toEqual([0.5, 0.6, 0]);
    expect(water).toEqual([1.35, 1.62, 0]);
    const updatedAt = stored.map((row) => row.updatedAt.toISOString());
    await expect(activateAndReplayUnifiedV4({ profileId })).resolves.toMatchObject(v4);
    expect((await rows()).map((row) => row.updatedAt.toISOString())).toEqual(updatedAt);
  });

  it("keeps the ordinary V3 publication current after a source invalidation", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });

    const result = await syncHealthWeightThroughService(
      dates[1]!,
      79.7,
      `${dates[1]}T14:00:00.000Z`,
    );

    expect(result).toMatchObject({ status: "ok", modelPublicationStatus: "current" });
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
      unifiedRolloutEpoch: 0,
      unifiedPublishedRolloutEpoch: 0,
      unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      productionPublishedGeneration: lifecycle.invalidationGeneration,
      productionStaleFromDate: null,
    });
    expect((await rows()).every((row) => row.modelRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION)).toBe(true);
  });

  it("includes an unchanged later unmatched session day when republishing after an older training edit", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
      const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
      });
      const program = await trainingService.createProgram({
        name: `${fixtureMethod}-v4-range-session`,
        exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
      }, profileId);

      vi.setSystemTime(new Date(`${dates[1]}T10:00:00.000Z`));
      const olderSession = await trainingService.startSession(program.id, profileId, "Europe/Bratislava");
      const olderSet = await trainingService.createSet(olderSession.id, olderSession.exercises[0]!.id, {
        reps: 8, weightKg: 24, bandNominalResistanceKg: null, rir: 3,
        completedAt: `${dates[1]}T10:30:00.000Z`,
      }, profileId);
      await trainingService.finishSession(olderSession.id, profileId);

      vi.setSystemTime(new Date(`${futureDate}T10:00:00.000Z`));
      const laterSession = await trainingService.startSession(program.id, profileId, "Europe/Bratislava");
      await trainingService.createSet(laterSession.id, laterSession.exercises[0]!.id, {
        reps: 6, weightKg: 18, bandNominalResistanceKg: null, rir: 2,
        completedAt: `${futureDate}T10:30:00.000Z`,
      }, profileId);
      await trainingService.finishSession(laterSession.id, profileId);
      await runTrainingRefreshToCompletion(profileId);
      const relativeMuscleBeforeEdit = await prisma.experimentalSkeletalMuscleDeltaShadow.findUnique({
        where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[1]! } },
        select: { sourceFingerprint: true, isStale: true },
      });
      expect(relativeMuscleBeforeEdit).not.toBeNull();
      expect(relativeMuscleBeforeEdit?.isStale).toBe(false);
      const laterSource = await prisma.strengthDiarySession.findUniqueOrThrow({
        where: { id: laterSession.id }, select: { matchedWorkoutId: true },
      });
      expect(laterSource.matchedWorkoutId).toBeNull();
      expect(await prisma.dailyHealthData.findFirst({ where: { date: futureDate }, select: { id: true } })).toBeNull();
      const laterTransientBefore = await prisma.experimentalTransientExerciseWaterShadow.findUniqueOrThrow({
        where: { sessionId: laterSession.id }, select: { sourceFingerprint: true, result: true },
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 4 });

      await trainingService.updateSet(olderSession.id, olderSet.id, { reps: 9 }, profileId);
      await runTrainingRefreshToCompletion(profileId);

      const relativeMuscleAfterEdit = await prisma.experimentalSkeletalMuscleDeltaShadow.findUniqueOrThrow({
        where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[1]! } },
        select: { sourceFingerprint: true, isStale: true },
      });
      expect(relativeMuscleAfterEdit.sourceFingerprint).not.toBe(relativeMuscleBeforeEdit?.sourceFingerprint);
      expect(relativeMuscleAfterEdit.isStale).toBe(false);

      const laterTransientAfter = await prisma.experimentalTransientExerciseWaterShadow.findUniqueOrThrow({
        where: { sessionId: laterSession.id }, select: { sourceFingerprint: true, result: true },
      });
      expect(laterTransientAfter.sourceFingerprint).not.toBe(laterTransientBefore.sourceFingerprint);
      const laterImpulseBefore = (laterTransientBefore.result as {
        impulse: {
          canonicalEventInstant: string;
          modelDate: string;
          exposureClass: string;
          exposureDependencies: Array<{ strengthDiarySessionId: number; sourceFingerprint: string }>;
        };
      }).impulse;
      const laterImpulseAfter = (laterTransientAfter.result as {
        impulse: {
          canonicalEventInstant: string;
          modelDate: string;
          exposureClass: string;
          exposureDependencies: Array<{ strengthDiarySessionId: number; sourceFingerprint: string }>;
        };
      }).impulse;
      const currentTrainingSources = await trainingRepository.listCompletedTransientWaterSourcesV2(profileId);
      const olderSourceAfter = currentTrainingSources.find(({ session }) => session.id === olderSession.id);
      expect(olderSourceAfter).toBeDefined();
      const olderDependencyBefore = laterImpulseBefore.exposureDependencies.find(
        ({ strengthDiarySessionId }) => strengthDiarySessionId === olderSession.id,
      );
      const olderDependencyAfter = laterImpulseAfter.exposureDependencies.find(
        ({ strengthDiarySessionId }) => strengthDiarySessionId === olderSession.id,
      );
      expect(olderDependencyBefore).toBeDefined();
      expect(olderDependencyAfter?.sourceFingerprint).not.toBe(olderDependencyBefore?.sourceFingerprint);
      expect(olderDependencyAfter?.sourceFingerprint).toBe(olderSourceAfter?.sourceDependencyFingerprint);
      expect(laterImpulseAfter).toMatchObject({
        canonicalEventInstant: laterImpulseBefore.canonicalEventInstant,
        modelDate: futureDate,
        exposureClass: laterImpulseBefore.exposureClass,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 4 });
      const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(lifecycle).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("repairs a committed completed-session deletion after a dependent refresh failure", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${dates[1]}T18:00:00.000Z`));
    try {
      await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
      const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
      });
      const program = await trainingService.createProgram({
        name: `${fixtureMethod}-delete-retry`,
        exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
      }, profileId);
      const session = await trainingService.startSession(program.id, profileId, "Europe/Bratislava");
      deletedFixtureTrainingSourceKeys.add(String(session.id));
      await trainingService.createSet(session.id, session.exercises[0]!.id, {
        reps: 8,
        weightKg: 24,
        bandNominalResistanceKg: null,
        rir: 3,
        completedAt: `${dates[1]}T17:00:00.000Z`,
      }, profileId);
      await trainingService.finishSession(session.id, profileId);

      const firstDelete = await trainingService.deleteDiarySession(session.id, profileId);
      expect(firstDelete).toEqual({ matchedWorkoutId: null });
      expect(await prisma.strengthDiarySession.findUnique({ where: { id: session.id }, select: { id: true } })).toBeNull();
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(session.id) } },
      })).not.toBeNull();
      const blockedLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(blockedLifecycle.unifiedRolloutEpoch).toBe(1);
      expect(blockedLifecycle.unifiedPublicationBlockedFromDate).not.toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

      const failFirstGlycogenRefresh = vi.spyOn(glycogenStateShadowService, "recordExperimentalGlycogenStateShadow")
        .mockRejectedValueOnce(new Error("injected completed-session deletion shadow failure"));
      try {
        await runOneTrainingRefreshAttempt(profileId);
      } finally {
        failFirstGlycogenRefresh.mockRestore();
      }
      const failedJob = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
      expect(failedJob.completedGeneration).toBeLessThan(failedJob.requestedGeneration);
      await runTrainingRefreshToCompletion(profileId);
      expect(await prisma.strengthDiarySession.findUnique({ where: { id: session.id }, select: { id: true } })).toBeNull();
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(session.id) } },
      })).toBeNull();
      const repairedLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(repairedLifecycle.unifiedRolloutEpoch).toBe(1);
      expect(repairedLifecycle.unifiedPublishedRolloutEpoch).toBe(1);
      expect(repairedLifecycle.unifiedPublishedGeneration).toBe(repairedLifecycle.invalidationGeneration);
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });

      const retrySession = await trainingService.startSession(program.id, profileId, "Europe/Bratislava");
      deletedFixtureTrainingSourceKeys.add(String(retrySession.id));
      await trainingService.createSet(retrySession.id, retrySession.exercises[0]!.id, {
        reps: 7,
        weightKg: 22,
        bandNominalResistanceKg: null,
        rir: 2,
        completedAt: `${dates[2]}T17:00:00.000Z`,
      }, profileId);
      await trainingService.finishSession(retrySession.id, profileId);

      await expect(trainingService.deleteDiarySession(retrySession.id, profileId)).resolves.toMatchObject({
        matchedWorkoutId: null,
      });
      expect(await prisma.strengthDiarySession.findUnique({ where: { id: retrySession.id }, select: { id: true } })).toBeNull();
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(retrySession.id) } },
      })).not.toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

      const failFinalUnified = vi.spyOn(unifiedStateService, "rebuildUnifiedExperimentalPhysiologyStateV1")
        .mockRejectedValueOnce(new Error("injected final session-delete Unified failure"));
      try {
        await runOneTrainingRefreshAttempt(profileId);
      } finally {
        failFinalUnified.mockRestore();
      }
      await runTrainingRefreshToCompletion(profileId);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(retrySession.id) } },
      })).toBeNull();
      expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } })).unifiedRolloutEpoch).toBe(1);
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("surfaces completed child deletion failures and retries only the exact blocked delete", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${dates[1]}T18:00:00.000Z`));
    try {
      await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
      const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
      });
      const program = await trainingService.createProgram({
        name: `${fixtureMethod}-set-delete-retry`,
        exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
      }, profileId);
      const session = await trainingService.startSession(program.id, profileId, "Europe/Bratislava");
      deletedFixtureTrainingSourceKeys.add(String(session.id));
      const set = await trainingService.createSet(session.id, session.exercises[0]!.id, {
        reps: 8,
        weightKg: 24,
        bandNominalResistanceKg: null,
        rir: 3,
        completedAt: `${dates[1]}T17:00:00.000Z`,
      }, profileId);
      await trainingService.finishSession(session.id, profileId);

      await expect(trainingService.deleteSet(session.id, set.id, profileId))
        .resolves.toEqual({ deleted: true });

      expect(await prisma.strengthSet.findUnique({ where: { id: set.id }, select: { id: true } })).toBeNull();
      const setDeleteBlockKey = trainingChildDeletionPublicationSourceKey("set", session.id, set.id);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: setDeleteBlockKey } },
      })).not.toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

      // A session's pending block does not prove a different missing child was
      // deleted. Only the exact operation key is valid retry evidence.
      await expect(trainingService.deleteSet(session.id, set.id + 1_000_000, profileId)).rejects.toThrow();
      const failFirstGlycogenRefresh = vi.spyOn(glycogenStateShadowService, "recordExperimentalGlycogenStateShadow")
        .mockRejectedValueOnce(new Error("injected completed-set deletion shadow failure"));
      try {
        await runOneTrainingRefreshAttempt(profileId);
      } finally {
        failFirstGlycogenRefresh.mockRestore();
      }
      await runTrainingRefreshToCompletion(profileId);
      expect(await prisma.strengthSet.findUnique({ where: { id: set.id }, select: { id: true } })).toBeNull();
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: setDeleteBlockKey } },
      })).toBeNull();
      expect(await prisma.strengthSet.findUnique({ where: { id: set.id }, select: { id: true } })).toBeNull();
      const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(lifecycle).toMatchObject({
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });

      // A failure after the exact operation token is cleared but during the
      // final Unified rebuild must restore that token so the same DELETE can
      // safely retry the completed dependency chain.
      const secondSet = await trainingService.createSet(session.id, session.exercises[0]!.id, {
        reps: 7,
        weightKg: 22,
        bandNominalResistanceKg: null,
        rir: 2,
        completedAt: `${dates[1]}T17:30:00.000Z`,
      }, profileId);
      const secondSetDeleteBlockKey = trainingChildDeletionPublicationSourceKey("set", session.id, secondSet.id);
      await expect(trainingService.deleteSet(session.id, secondSet.id, profileId))
        .resolves.toEqual({ deleted: true });
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: secondSetDeleteBlockKey } },
      })).not.toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();
      await runOneTrainingRefreshAttempt(profileId, {
        afterProgressStage: async (_job, stage) => {
          if (stage === "unified-publication") throw new Error("injected final Unified publication failure");
        },
      });
      expect(await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } }))
        .toMatchObject({ leaseToken: null });
      await runTrainingRefreshToCompletion(profileId);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: secondSetDeleteBlockKey } },
      })).toBeNull();

      const sessionExerciseId = session.exercises[0]!.id;
      await expect(trainingService.deleteSessionExercise(session.id, sessionExerciseId, {}, profileId))
        .resolves.toMatchObject({ id: session.id, status: "COMPLETED" });
      expect(await prisma.strengthSessionExercise.findUnique({
        where: { id: sessionExerciseId }, select: { id: true },
      })).toBeNull();
      const exerciseDeleteBlockKey = trainingChildDeletionPublicationSourceKey("exercise", session.id, sessionExerciseId);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: exerciseDeleteBlockKey } },
      })).not.toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

      await expect(trainingService.deleteSessionExercise(session.id, sessionExerciseId + 1_000_000, {}, profileId)).rejects.toThrow();
      const failFirstExerciseRefresh = vi.spyOn(glycogenStateShadowService, "recordExperimentalGlycogenStateShadow")
        .mockRejectedValueOnce(new Error("injected completed-exercise deletion shadow failure"));
      try {
        await runOneTrainingRefreshAttempt(profileId);
      } finally {
        failFirstExerciseRefresh.mockRestore();
      }
      await runTrainingRefreshToCompletion(profileId);
      expect(await prisma.strengthSessionExercise.findUnique({
        where: { id: sessionExerciseId }, select: { id: true },
      })).toBeNull();
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: exerciseDeleteBlockKey } },
      })).toBeNull();
      expect(await prisma.strengthSessionExercise.findUnique({
        where: { id: sessionExerciseId }, select: { id: true },
      })).toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it.each([false, true])("completes an unmodeled Health weight day with existing day fence=%s", async (withDayBlock) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      await seedUnmodeledHealthWeightRefresh(withDayBlock);
      const rawBefore = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: futureDate } });
      await runOneTrainingRefreshAttempt(profileId);
      const job = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
      expect(job.completedGeneration).toBe(job.requestedGeneration);
      expect(job.lastProgressStage).toBe("completed");
      expect(await prisma.trainingSourceChange.count({ where: { profileId, acknowledgedAt: null } })).toBe(0);
      expect(await prisma.unifiedPublicationBlock.count({ where: { profileId } })).toBe(0);
      expect(await prisma.dailyModelState.count({ where: { episodeId: episodeId!, date: futureDate } })).toBe(0);
      await expect(getModelStatus(episodeId!, prisma)).resolves.toMatchObject({
        productionCurrent: true, latestModeledDate: dates[2],
      });
      await expect(prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
        where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: futureDate } },
      })).resolves.toMatchObject({ date: futureDate, qualityStatus: "partial" });
      await expect(prisma.experimentalFfmRetentionShadow.findUniqueOrThrow({
        where: { profileId_date: { profileId, date: futureDate } },
      })).resolves.toMatchObject({ date: futureDate });
      await expect(prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
        where: { profileId_date: { profileId, date: futureDate } },
      })).resolves.toMatchObject({ date: futureDate });
      expect(await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: futureDate } })).toEqual(rawBefore);
      // A duplicate poll is a no-op, without another journal/event revision.
      await expect(processNextTrainingRefreshJob()).resolves.toBe(false);
      expect(await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } })).toEqual(job);
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 4 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("retains an unmodeled Health day dependency and journal when its dependent refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      await seedUnmodeledHealthWeightRefresh(true);
      const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
      const token = await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "day", sourceKey: futureDate });
      await runOneTrainingRefreshAttempt(profileId, {
        afterProgressStage: async (_job, stage) => {
          if (stage === "ffm-hypertrophy-suffix") throw new Error("fixture failed source-date dependency");
        },
      });
      const failed = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
      expect(failed.completedGeneration).toBeLessThan(failed.requestedGeneration);
      expect(failed.lastProgressStage).toBe("retry-wait");
      expect(await prisma.trainingSourceChange.count({ where: { profileId, acknowledgedAt: null } })).toBe(1);
      expect(await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "day", sourceKey: futureDate })).toEqual(token);
      await runTrainingRefreshToCompletion(profileId);
      expect(await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "day", sourceKey: futureDate })).toBeNull();
      expect(await prisma.trainingSourceChange.count({ where: { profileId, acknowledgedAt: null } })).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it.each([false, true])("preserves a newer unmodeled Health day fence when initial fence=%s", async (withDayBlock) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      await seedUnmodeledHealthWeightRefresh(withDayBlock);
      const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
      let newerToken: { revision: number; fromDate: string } | null = null;
      await runOneTrainingRefreshAttempt(profileId, {
        afterProgressStage: async (_job, stage) => {
          if (stage !== "clear-exact-training-blocks") return;
          await lifecycle.blockUnifiedPublication({ profileId, source: "day", sourceKey: futureDate, fromDate: futureDate });
          newerToken = await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "day", sourceKey: futureDate });
        },
      });
      expect(newerToken).not.toBeNull();
      expect(await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "day", sourceKey: futureDate })).toEqual(newerToken);
      const failed = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
      expect(failed.completedGeneration).toBeLessThan(failed.requestedGeneration);
      expect(await prisma.trainingSourceChange.count({ where: { profileId, acknowledgedAt: null } })).toBe(1);
      await runTrainingRefreshToCompletion(profileId);
      expect(await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "day", sourceKey: futureDate })).toBeNull();
      expect(await prisma.trainingSourceChange.count({ where: { profileId, acknowledgedAt: null } })).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("leaves a newer Health source generation unacknowledged when it revokes the replay lease", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      await seedUnmodeledHealthWeightRefresh(true);
      const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
      await runOneTrainingRefreshAttempt(profileId, {
        afterProgressStage: async (_job, stage) => {
          if (stage !== "clear-exact-training-blocks") return;
          await prisma.$transaction(async (tx) => {
            await new PhysiologyV7PersistenceRepository(tx).blockUnifiedPublication({
              profileId, source: "day", sourceKey: futureDate, fromDate: futureDate,
            });
            await enqueueTrainingSourceChangeInTransaction(tx, {
              profileId, operationKind: "health_weight_accounting_refresh", affectedSessionIds: [],
              oldModelDates: [futureDate], newModelDates: [futureDate], deadlineMode: "health-fast",
            });
          });
        },
      });
      const job = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
      expect(job.requestedGeneration).toBe(2);
      expect(job.completedGeneration).toBe(0);
      expect(await prisma.trainingSourceChange.count({ where: { profileId, acknowledgedAt: null } })).toBe(2);
      expect(await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "day", sourceKey: futureDate }))
        .toMatchObject({ revision: 2 });
      await runTrainingRefreshToCompletion(profileId);
      expect(await prisma.trainingSourceChange.count({ where: { profileId, acknowledgedAt: null } })).toBe(0);
      expect(await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "day", sourceKey: futureDate })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("automatically republishes V4 after repeated ordinary Health weight syncs without changing rollout epoch", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    expect((await activateAndReplayUnifiedV4({ profileId })).rolloutEpoch).toBe(1);

    const firstReceivedAt = `${dates[1]}T12:00:00.000Z`;
    await syncHealthWeightThroughService(dates[1]!, 79.8, firstReceivedAt);
    const firstSnapshotId = await readFixtureHealthSnapshotId(dates[1]!, firstReceivedAt);
    const firstSnapshot = await prisma.healthSyncSnapshot.findUniqueOrThrow({
      where: { id: firstSnapshotId }, select: { weightKg: true, rawPayload: true },
    });
    const firstLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(firstLifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 1,
      unifiedPublishedGeneration: firstLifecycle.invalidationGeneration,
      unifiedPublishedRolloutEpoch: 1,
      productionPublishedGeneration: firstLifecycle.invalidationGeneration,
      productionStaleFromDate: null,
    });
    expect(isUnifiedGenerationCurrentV1(firstLifecycle)).toBe(true);

    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ profileId, rolloutEpoch: 1, dayCount: 3 });

    const secondReceivedAt = `${dates[1]}T13:00:00.001Z`;
    await syncHealthWeightThroughService(dates[1]!, 79.6, secondReceivedAt);
    const preservedSnapshot = await prisma.healthSyncSnapshot.findUniqueOrThrow({ where: { id: firstSnapshotId } });
    expect({ weightKg: preservedSnapshot.weightKg?.toString() ?? null, rawPayload: preservedSnapshot.rawPayload })
      .toEqual({ weightKg: firstSnapshot.weightKg?.toString() ?? null, rawPayload: firstSnapshot.rawPayload });

    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      productionPublishedGeneration: lifecycle.invalidationGeneration,
      productionStaleFromDate: null,
    });
    expect((await rows()).every((row) => row.modelRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION)).toBe(true);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ profileId, rolloutEpoch: 1, dayCount: 3 });
  });

  it("arms a durable Health fence before the first sync bootstraps lifecycle", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId } });

    await healthSyncRepository.syncDay(
      { date: dates[1]!, weightKg: 79.4, caloriesKcal: 2_200, proteinG: 160, fatG: 70, carbsG: 220 },
      { date: dates[1]!, __bodycastFixture: healthSnapshotFixtureTag },
      { timezone: "Europe/Bratislava", receivedAt: new Date(`${dates[1]}T15:00:00.000Z`), syncedAt: null },
    );

    expect(await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId } })).not.toBeNull();
    expect(await prisma.unifiedPublicationBlock.findMany({
      where: { profileId, source: "health", sourceKey: dates[1] },
      select: { fromDate: true },
    })).toEqual([{ fromDate: dates[1] }]);
  });

  it("restarts the full glycogen suffix after repeated competing Health syncs and converges without starvation", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    const attempts: Array<{ date: string; attempt: number }> = [];
    const competingSyncStatuses: string[] = [];
    const beforeSnapshotCount = await prisma.healthSyncSnapshot.count({ where: { date: dates[1] } });
    await glycogenStateShadowService.rebuildExperimentalGlycogenStateShadows({
      profileId,
      fromDate: dates[0]!,
      toDate: dates[2]!,
      onCandidateComputed: async ({ date, attempt }) => {
        attempts.push({ date, attempt });
        if (attempt <= 2 && date === dates[0]) {
          const sync = await syncHealthWeightThroughService(
            dates[1]!,
            79.3 + attempt / 10,
            `${dates[1]}T${15 + attempt}:00:00.000Z`,
          );
          competingSyncStatuses.push(sync.modelPublicationStatus);
        }
      },
    });

    expect(competingSyncStatuses).toEqual(["current", "current"]);
    expect(attempts).toEqual([
      { date: dates[0], attempt: 1 },
      { date: dates[0], attempt: 2 },
      { date: dates[0], attempt: 3 },
      { date: dates[1], attempt: 3 },
      { date: dates[2], attempt: 3 },
    ]);
    expect(await prisma.healthSyncSnapshot.count({ where: { date: dates[1] } })).toBe(beforeSnapshotCount + 2);
    expect(Number((await prisma.dailyHealthData.findUniqueOrThrow({
      where: { date: dates[1] }, select: { weightKg: true },
    })).weightKg)).toBe(79.5);
    const persistedHealth = await prisma.dailyHealthData.findUniqueOrThrow({
      where: { date: dates[1] }, select: { id: true, updatedAt: true },
    });
    const glycogen = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: dates[1]! } }, select: { result: true },
    });
    expect((glycogen.result as { sourceLineage: { dailyHealthData: { id: number; updatedAt: string } } })
      .sourceLineage.dailyHealthData).toEqual({ id: persistedHealth.id, updatedAt: persistedHealth.updatedAt.toISOString() });
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId } })).toEqual([]);
    // The shadow rebuild invalidates Unified when its child result changes;
    // finish the ordinary publication step before asserting Forecast readiness.
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      productionPublishedGeneration: lifecycle.invalidationGeneration,
      productionStaleFromDate: null,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  }, 60_000);

  it("restarts a committed glycogen suffix when an earlier day changes before the next day commits", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    const snapshotCountBefore = await prisma.healthSyncSnapshot.count({ where: { date: dates[0] } });
    const attempts: Array<{ date: string; attempt: number }> = [];
    let committedRowsAfterNewerSync: Array<{ date: string; sourceFingerprint: string }> = [];
    let syncStatus: string | null = null;

    await glycogenStateShadowService.rebuildExperimentalGlycogenStateShadows({
      profileId,
      fromDate: dates[0]!,
      toDate: dates[2]!,
      onCandidateComputed: async ({ date, attempt }) => {
        attempts.push({ date, attempt });
      },
      onCandidateCommitted: async ({ date, attempt }) => {
        if (attempt !== 1 || date !== dates[0]) return;

        const oldPredecessor = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
          where: { profileId_date: { profileId, date: dates[0]! } },
          select: { sourceFingerprint: true },
        });
        const newerSync = await syncHealthWeightThroughService(
          dates[0]!, 79.2, `${dates[0]}T20:00:00.000Z`,
        );
        syncStatus = newerSync.modelPublicationStatus;
        const refreshedPredecessor = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
          where: { profileId_date: { profileId, date: dates[0]! } },
          select: { sourceFingerprint: true },
        });
        expect(refreshedPredecessor.sourceFingerprint).not.toBe(oldPredecessor.sourceFingerprint);
        committedRowsAfterNewerSync = await prisma.experimentalGlycogenStateShadow.findMany({
          where: { profileId, date: { in: dates } },
          orderBy: { date: "asc" },
          select: { date: true, sourceFingerprint: true },
        });
      },
    });

    expect(syncStatus).toBe("current");
    expect(attempts).toEqual([
      { date: dates[0], attempt: 1 },
      { date: dates[1], attempt: 1 },
      { date: dates[0], attempt: 2 },
      { date: dates[1], attempt: 2 },
      { date: dates[2], attempt: 2 },
    ]);
    expect(await prisma.healthSyncSnapshot.count({ where: { date: dates[0] } })).toBe(snapshotCountBefore + 1);
    expect(await prisma.experimentalGlycogenStateShadow.findMany({
      where: { profileId, date: { in: dates } },
      orderBy: { date: "asc" },
      select: { date: true, sourceFingerprint: true },
    })).toEqual(committedRowsAfterNewerSync);
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId } })).toEqual([]);

    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle.unifiedPublishedGeneration).toBe(lifecycle.invalidationGeneration);
    expect(lifecycle.unifiedPublishedRolloutEpoch).toBe(lifecycle.unifiedRolloutEpoch);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  }, 60_000);

  it("does not pair a loaded predecessor with a fence captured after a successful earlier-day sync", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });
    await glycogenStateShadowService.rebuildExperimentalGlycogenStateShadows({
      profileId, fromDate: dates[0]!, toDate: dates[0]!,
    });

    const snapshotCountBefore = await prisma.healthSyncSnapshot.count({ where: { date: dates[0] } });
    const attempts: Array<{ date: string; attempt: number }> = [];
    let committedRowsAfterNewerSync: Array<{ date: string; sourceFingerprint: string }> = [];
    let syncStatus: string | null = null;
    let syncCompleted = false;

    await glycogenStateShadowService.rebuildExperimentalGlycogenStateShadows({
      profileId,
      fromDate: dates[1]!,
      toDate: dates[2]!,
      onPriorLoaded: async ({ attempt }) => {
        if (attempt !== 1 || syncCompleted) return;
        const oldPredecessor = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
          where: { profileId_date: { profileId, date: dates[0]! } },
          select: { sourceFingerprint: true },
        });
        const newerSync = await syncHealthWeightThroughService(
          dates[0]!, 79.2, `${dates[0]}T21:00:00.000Z`,
        );
        syncStatus = newerSync.modelPublicationStatus;
        const refreshedPredecessor = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
          where: { profileId_date: { profileId, date: dates[0]! } },
          select: { sourceFingerprint: true },
        });
        expect(refreshedPredecessor.sourceFingerprint).not.toBe(oldPredecessor.sourceFingerprint);
        committedRowsAfterNewerSync = await prisma.experimentalGlycogenStateShadow.findMany({
          where: { profileId, date: { in: dates } },
          orderBy: { date: "asc" },
          select: { date: true, sourceFingerprint: true },
        });
        syncCompleted = true;
      },
      onCandidateComputed: async ({ date, attempt }) => {
        attempts.push({ date, attempt });
      },
    });

    expect(syncStatus).toBe("current");
    expect(attempts).toEqual([
      { date: dates[1], attempt: 1 },
      { date: dates[1], attempt: 2 },
      { date: dates[2], attempt: 2 },
    ]);
    expect(await prisma.healthSyncSnapshot.count({ where: { date: dates[0] } })).toBe(snapshotCountBefore + 1);
    expect(await prisma.experimentalGlycogenStateShadow.findMany({
      where: { profileId, date: { in: dates } },
      orderBy: { date: "asc" },
      select: { date: true, sourceFingerprint: true },
    })).toEqual(committedRowsAfterNewerSync);
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId } })).toEqual([]);

    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle.unifiedPublishedGeneration).toBe(lifecycle.invalidationGeneration);
    expect(lifecycle.unifiedPublishedRolloutEpoch).toBe(lifecycle.unifiedRolloutEpoch);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  }, 60_000);

  it("retries a glycogen candidate when Unified publication updates lifecycle metadata without changing sources", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    const beforeHealth = await prisma.dailyHealthData.findMany({
      where: { date: { in: dates } }, orderBy: { date: "asc" },
      select: { date: true, id: true, updatedAt: true, weightKg: true, caloriesKcal: true, carbsG: true },
    });
    const attempts: Array<{ date: string; attempt: number }> = [];
    await glycogenStateShadowService.rebuildExperimentalGlycogenStateShadows({
      profileId,
      fromDate: dates[0]!,
      toDate: dates[2]!,
      onCandidateComputed: async ({ date, attempt }) => {
        attempts.push({ date, attempt });
        if (attempt === 1 && date === dates[0]) {
          const beforeLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({
            where: { profileId }, select: { invalidationGeneration: true, updatedAt: true },
          });
          await new Promise((resolve) => setTimeout(resolve, 5));
          await rebuildUnifiedExperimentalPhysiologyStateV1({
            profileId, fromDate: dates[0], toDate: dates[2],
            targetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
          });
          const afterLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({
            where: { profileId }, select: { invalidationGeneration: true, updatedAt: true },
          });
          expect(afterLifecycle.invalidationGeneration).toBe(beforeLifecycle.invalidationGeneration);
          expect(afterLifecycle.updatedAt.getTime()).toBeGreaterThan(beforeLifecycle.updatedAt.getTime());
          expect(await prisma.dailyHealthData.findMany({
            where: { date: { in: dates } }, orderBy: { date: "asc" },
            select: { date: true, id: true, updatedAt: true, weightKg: true, caloriesKcal: true, carbsG: true },
          })).toEqual(beforeHealth);
        }
      },
    });

    expect(attempts).toEqual([
      { date: dates[0], attempt: 1 },
      { date: dates[0], attempt: 2 },
      { date: dates[1], attempt: 2 },
      { date: dates[2], attempt: 2 },
    ]);
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId } })).toEqual([]);
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle.unifiedPublishedGeneration).toBe(lifecycle.invalidationGeneration);
    expect(lifecycle.unifiedPublishedRolloutEpoch).toBe(lifecycle.unifiedRolloutEpoch);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  }, 60_000);

  it("does not let an older failed Health refresh re-arm a fence cleared by a newer successful sync", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    const newerSnapshotAt = `${dates[1]}T16:00:00.000Z`;
    const failOlderRefreshAfterNewerSync = vi.spyOn(glycogenStateShadowService, "recordExperimentalGlycogenStateShadow")
      .mockImplementationOnce(async () => {
        const newer = await syncHealthWeightThroughService(dates[1]!, 79.4, newerSnapshotAt);
        expect(newer.modelPublicationStatus).toBe("current");
        throw new PhysiologyV7ConcurrentSourceChangeError();
      });
    let olderStatus: string | null = null;
    try {
      const older = await syncHealthWeightThroughService(
        dates[1]!,
        79.3,
        `${dates[1]}T15:00:00.000Z`,
      );
      olderStatus = older.modelPublicationStatus;
    } finally {
      failOlderRefreshAfterNewerSync.mockRestore();
    }

    expect(olderStatus).toBe("stale");
    // The newer sync cleared the exact Health fence; the older failed request
    // must not recreate it. Its later dependent work can still leave Unified
    // stale, so a subsequent successful sync exercises the normal recovery path.
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId, source: "health" } })).toEqual([]);
    const recovery = await syncHealthWeightThroughService(
      dates[1]!,
      79.4,
      `${dates[1]}T17:00:00.000Z`,
    );
    expect(recovery.modelPublicationStatus).toBe("current");
    const snapshots = await prisma.healthSyncSnapshot.findMany({
      where: { date: dates[1] }, orderBy: { receivedAt: "asc" }, select: { id: true, rawPayload: true },
    });
    expect(snapshots).toHaveLength(3);
    expect(snapshots.every(({ rawPayload }) => rawPayload !== null && typeof rawPayload === "object"
      && !Array.isArray(rawPayload)
      && (rawPayload as Record<string, unknown>).__bodycastFixture === healthSnapshotFixtureTag)).toBe(true);
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId, source: "health" } })).toEqual([]);
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      productionPublishedGeneration: lifecycle.invalidationGeneration,
      unifiedPublicationBlockedFromDate: null,
      productionStaleFromDate: null,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  }, 60_000);

  it("does not restore an old Health fence after a newer sync publishes during an older failed publication", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    const beforeSnapshots = await prisma.healthSyncSnapshot.count({ where: { date: dates[1] } });
    const olderPublicationFailsAfterNewerSuccess = vi.spyOn(activeEnergyPublication, "publishActiveEnergyChangesV1")
      .mockImplementationOnce(async () => {
        const newer = await syncHealthWeightThroughService(
          dates[1]!, 79.5, `${dates[1]}T17:00:00.000Z`,
        );
        expect(newer.modelPublicationStatus).toBe("current");
        return false;
      });
    let olderStatus: string | null = null;
    try {
      const older = await syncHealthWeightThroughService(
        dates[1]!, 79.3, `${dates[1]}T16:00:00.000Z`,
      );
      olderStatus = older.modelPublicationStatus;
    } finally {
      olderPublicationFailsAfterNewerSuccess.mockRestore();
    }

    expect(olderStatus).toBe("stale");
    expect(await prisma.healthSyncSnapshot.count({ where: { date: dates[1] } })).toBe(beforeSnapshots + 2);
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId } })).toEqual([]);
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      productionPublishedGeneration: lifecycle.invalidationGeneration,
      unifiedPublicationBlockedFromDate: null,
      productionStaleFromDate: null,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  }, 60_000);

  it("does not restore a Health fence after a same-generation Unified invalidation races publication", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    const olderPublicationFailsAfterUnifiedInvalidation = vi.spyOn(activeEnergyPublication, "publishActiveEnergyChangesV1")
      .mockImplementationOnce(async () => {
        await prisma.$transaction(async (tx) => {
          await new PhysiologyV7PersistenceRepository(tx).invalidateUnifiedPublication(profileId);
        });
        return false;
      });
    let status: string | null = null;
    try {
      const sync = await syncHealthWeightThroughService(
        dates[1]!, 79.3, `${dates[1]}T16:00:00.000Z`,
      );
      status = sync.modelPublicationStatus;
    } finally {
      olderPublicationFailsAfterUnifiedInvalidation.mockRestore();
    }

    expect(status).toBe("stale");
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId } })).toEqual([]);
    const staleLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(staleLifecycle.unifiedPublishedGeneration).toBeNull();
    expect(staleLifecycle.unifiedPublishedRolloutEpoch).toBeNull();
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

    const recovery = await syncHealthWeightThroughService(
      dates[1]!, 79.4, `${dates[1]}T17:00:00.000Z`,
    );
    expect(recovery.modelPublicationStatus).toBe("current");
    const recoveredLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(recoveredLifecycle).toMatchObject({
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: recoveredLifecycle.invalidationGeneration,
      productionPublishedGeneration: recoveredLifecycle.invalidationGeneration,
      unifiedPublicationBlockedFromDate: null,
      productionStaleFromDate: null,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  }, 60_000);

  it("restores the retry fence when this publication's production pass advances the lifecycle before Unified fails", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    const originalPublication = activeEnergyPublication.publishActiveEnergyChangesV1;
    const productionFence: { value: { invalidationGeneration: number; updatedAt: string } | null } = { value: null };
    const publicationCall = vi.spyOn(activeEnergyPublication, "publishActiveEnergyChangesV1")
      .mockImplementationOnce(async (input = {}) => originalPublication({
        ...input,
        onLifecycleFenceChanged: (fence) => {
          productionFence.value = fence;
          input.onLifecycleFenceChanged?.(fence);
        },
      }));
    const unifiedFailure = vi.spyOn(unifiedStateService, "rebuildUnifiedExperimentalPhysiologyStateV1")
      .mockRejectedValueOnce(new Error("injected Unified publication failure after production publish"));
    let status: string | null = null;
    let unifiedFailureCalls = 0;
    try {
      const sync = await syncHealthWeightThroughService(
        dates[1]!, 79.3, `${dates[1]}T16:00:00.000Z`,
      );
      status = sync.modelPublicationStatus;
      unifiedFailureCalls = unifiedFailure.mock.calls.length;
    } finally {
      unifiedFailure.mockRestore();
      publicationCall.mockRestore();
    }

    expect(status).toBe("stale");
    expect(unifiedFailureCalls).toBe(1);
    expect(productionFence.value).not.toBeNull();
    const fencedLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    const blocks = await prisma.unifiedPublicationBlock.findMany({ where: { profileId, source: "health" } });
    expect(blocks.length).toBeGreaterThan(0);
    expect(fencedLifecycle.productionPublishedGeneration).toBe(fencedLifecycle.invalidationGeneration);
    expect(fencedLifecycle.unifiedPublishedGeneration).toBeNull();
    expect(fencedLifecycle.unifiedPublicationBlockedFromDate).not.toBeNull();
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

    const recovery = await syncHealthWeightThroughService(
      dates[1]!, 79.4, `${dates[1]}T17:00:00.000Z`,
    );
    expect(recovery.modelPublicationStatus).toBe("current");
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId } })).toEqual([]);
    const recoveredLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(recoveredLifecycle).toMatchObject({
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: recoveredLifecycle.invalidationGeneration,
      productionPublishedGeneration: recoveredLifecycle.invalidationGeneration,
      unifiedPublicationBlockedFromDate: null,
      productionStaleFromDate: null,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  }, 60_000);

  it("keeps the convergence retry fence after candidate self-invalidation and recovers it with the worker", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });
    await prisma.modelEpisode.update({
      where: { id: episodeId! },
      data: { latestModeledDate: dates[2] },
    });

    const day = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: dates[2] }, select: { id: true } });
    const workout = await prisma.workout.create({
      data: {
        dailyHealthDataId: day.id,
        sourceIdentity: `${fixtureMethod}-candidate-self-invalidation`,
        type: "Stair Climbing",
        startAt: new Date(`${dates[2]}T08:00:00.000Z`),
        endAt: new Date(`${dates[2]}T08:20:00.000Z`),
        durationMinutes: 20,
        activeEnergyKcal: 140,
      },
    });
    const refreshFailure = vi.spyOn(activeEnergyMaterialization, "refreshCandidatesAfterProductionV1")
      .mockImplementationOnce(async (candidateProfileId, _replayFromDate, options) => {
        // Simulate a later dependent candidate changing after production replay.
        // Recreate only its derived shadow, then fail the next refresh stage.
        // The writer must report the exact committed fence before this error.
        await prisma.experimentalStepperActiveEnergyShadow.deleteMany({ where: { workoutId: workout.id } });
        await stepperActiveEnergyShadowService.recordExperimentalStepperActiveEnergyShadow({
          workoutId: workout.id,
          profileId: candidateProfileId,
          ...(options?.onLifecycleFenceChanged === undefined
            ? {}
            : { onLifecycleFenceChanged: options.onLifecycleFenceChanged }),
        });
        throw new Error("injected later candidate refresh failure after committed shadow self-invalidation");
      });
    let status: string | null = null;
    try {
      const sync = await syncHealthWeightThroughService(
        dates[1]!, 79.3, `${dates[1]}T18:00:00.000Z`,
      );
      status = sync.modelPublicationStatus;
    } finally {
      refreshFailure.mockRestore();
    }

    expect(status).toBe("stale");
    const fencedLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    const convergenceBlock = await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "active_energy", sourceKey: "convergence" } },
      select: { fromDate: true, ownerLeaseUntil: true },
    });
    expect(convergenceBlock).toMatchObject({ fromDate: dates[0] });
    expect(convergenceBlock?.ownerLeaseUntil).toBeInstanceOf(Date);
    expect(fencedLifecycle.productionPublishedGeneration).toBe(fencedLifecycle.invalidationGeneration);
    expect(fencedLifecycle.unifiedPublishedGeneration).toBeNull();
    expect(fencedLifecycle.unifiedPublicationBlockedFromDate).not.toBeNull();
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

    await prisma.$executeRaw`
      UPDATE "UnifiedPublicationBlock"
      SET "ownerLeaseUntil" = TIMESTAMPTZ '2000-01-01 00:00:00+00'
      WHERE "profileId" = ${profileId}
        AND "source" = 'active_energy'
        AND "sourceKey" = 'convergence'
    `;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      await expect(processNextTrainingRefreshJob()).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId } })).toEqual([]);
    const recoveredLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(recoveredLifecycle).toMatchObject({
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: recoveredLifecycle.invalidationGeneration,
      productionPublishedGeneration: recoveredLifecycle.invalidationGeneration,
      unifiedPublicationBlockedFromDate: null,
      productionStaleFromDate: null,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  }, 60_000);

  it("bounds repeated glycogen fence conflicts and leaves publication fail-closed", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });
    const attempts: number[] = [];

    await expect(glycogenStateShadowService.rebuildExperimentalGlycogenStateShadows({
      profileId,
      fromDate: dates[0]!,
      toDate: dates[2]!,
      onCandidateComputed: async ({ attempt, date }) => {
        if (date !== dates[0]) return;
        attempts.push(attempt);
        await prisma.$transaction(async (tx) => {
          const lifecycle = new PhysiologyV7PersistenceRepository(tx);
          await lifecycle.lockProfile(profileId);
          await lifecycle.invalidateUnifiedPublication(profileId);
        });
      },
    })).rejects.toBeInstanceOf(PhysiologyV7ConcurrentSourceChangeError);

    expect(attempts).toEqual([1, 2, 3]);
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle.unifiedPublishedGeneration).toBeNull();
    expect(lifecycle.unifiedPublishedRolloutEpoch).toBeNull();
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

    // Once contention stops, ordinary shadow refresh plus publication recovers
    // the same epoch without clearing or rewriting source data.
    await glycogenStateShadowService.rebuildExperimentalGlycogenStateShadows({
      profileId,
      fromDate: dates[0]!,
      toDate: dates[2]!,
    });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const recovered = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(recovered.unifiedPublishedGeneration).toBe(recovered.invalidationGeneration);
    expect(recovered.unifiedPublishedRolloutEpoch).toBe(recovered.unifiedRolloutEpoch);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  }, 60_000);

  it("surfaces failed retrospective publication and retries an existing linked session without duplicating raw input", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
    const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
      where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
    });
    const program = await trainingService.createProgram({
      name: `${fixtureMethod}-retrospective-retry`,
      exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
    }, profileId);
    const day = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: dates[1] }, select: { id: true } });
    const workout = await prisma.workout.create({
      data: {
        dailyHealthDataId: day.id,
        sourceIdentity: `${fixtureMethod}-retrospective-retry`,
        type: "Traditional Strength Training",
        startAt: new Date(`${dates[1]}T09:30:00.000Z`),
        endAt: new Date(`${dates[1]}T10:00:00.000Z`),
        durationMinutes: 30,
        energyKcal: null,
        activeEnergyKcal: null,
      },
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      const first = await trainingService.createSessionFromWorkout({ workoutId: workout.id, programId: program.id }, profileId);
      expect(first).toMatchObject({ status: "COMPLETED", matchedWorkoutId: workout.id });
      expect(await prisma.strengthDiarySession.count({ where: { matchedWorkoutId: workout.id } })).toBe(1);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(first.id) } },
      })).not.toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

      const failFirstGlycogenRefresh = vi.spyOn(glycogenStateShadowService, "recordExperimentalGlycogenStateShadow")
        .mockRejectedValueOnce(new Error("injected retrospective creation shadow failure"));
      try {
        await runOneTrainingRefreshAttempt(profileId);
      } finally {
        failFirstGlycogenRefresh.mockRestore();
      }
      await runTrainingRefreshToCompletion(profileId);
      expect(await prisma.strengthDiarySession.count({ where: { matchedWorkoutId: workout.id } })).toBe(1);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(first.id) } },
      })).toBeNull();
      const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(lifecycle).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("rejects a strength candidate when its set changes before the PostgreSQL source CAS, then retries V4", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${dates[1]}T18:00:00.000Z`));
    try {
      await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
      const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
      });
      const program = await trainingService.createProgram({
        name: `${fixtureMethod}-strength-cas-retry`,
        exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
      }, profileId);
      const session = await trainingService.startSession(program.id, profileId, "Europe/Bratislava");
      deletedFixtureTrainingSourceKeys.add(String(session.id));
      const set = await trainingService.createSet(session.id, session.exercises[0]!.id, {
        reps: 8,
        weightKg: 24,
        bandNominalResistanceKg: null,
        rir: 3,
        completedAt: `${dates[1]}T17:00:00.000Z`,
      }, profileId);
      await trainingService.finishSession(session.id, profileId);

      await runTrainingRefreshToCompletion(profileId);

      const originalShadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({
        where: { sessionId: session.id }, select: { sourceFingerprint: true, modelRevision: true },
      });
      const staleCandidate = await trainingRepository.getSession(session.id, profileId);
      expect(staleCandidate).not.toBeNull();

      await expect(recordExperimentalStrengthEnergyShadow({
        session: staleCandidate!,
        profileId,
        onCandidateComputed: async () => {
          const changed = await trainingRepository.updateSet({
            sessionId: session.id, setId: set.id, profileId, reps: 9,
          });
          expect(changed?.reps).toBe(9);
        },
      })).rejects.toBeInstanceOf(StaleStrengthEnergySourceError);

      const currentSource = await trainingRepository.getSession(session.id, profileId);
      expect(currentSource?.exercises[0]?.sets[0]?.reps).toBe(9);
      expect(await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({
        where: { sessionId: session.id }, select: { sourceFingerprint: true, modelRevision: true },
      })).toEqual(originalShadow);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(session.id) } },
      })).not.toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

      await expect(trainingService.updateSet(session.id, set.id, { reps: 10 }, profileId))
        .resolves.toMatchObject({ reps: 10 });
      await runTrainingRefreshToCompletion(profileId);
      const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(lifecycle).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      });
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(session.id) } },
      })).toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("rejects an old strength candidate when a real Health sync adds session HR evidence", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${dates[1]}T17:00:00.000Z`));
    try {
      await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
      const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
      });
      const program = await trainingService.createProgram({
        name: `${fixtureMethod}-heart-rate-source-cas`,
        exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
      }, profileId);
      const session = await trainingService.startSession(program.id, profileId, "Europe/Bratislava");
      deletedFixtureTrainingSourceKeys.add(String(session.id));
      await trainingService.createSet(session.id, session.exercises[0]!.id, {
        reps: 8,
        weightKg: 24,
        bandNominalResistanceKg: null,
        rir: 3,
        completedAt: `${dates[1]}T17:30:00.000Z`,
      }, profileId);
      vi.setSystemTime(new Date(`${dates[1]}T18:00:00.000Z`));
      await trainingService.finishSession(session.id, profileId);
      await runTrainingRefreshToCompletion(profileId);

      const beforeShadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({
        where: { sessionId: session.id }, select: { sourceFingerprint: true, result: true },
      });
      expect((beforeShadow.result as { features: { hrSampleCount: number } }).features.hrSampleCount).toBe(0);
      const staleSession = await trainingRepository.getSession(session.id, profileId);
      expect(staleSession).not.toBeNull();

      const heartRateTimestamp = `${dates[1]}T17:45:00.000Z`;
      fixtureHeartRateTimestamps.add(heartRateTimestamp);
      await expect(recordExperimentalStrengthEnergyShadow({
        session: staleSession!,
        profileId,
        onCandidateComputed: async () => {
          const day = {
            date: dates[1]!,
            bpm: { timestamps: [heartRateTimestamp], bpm: [142] },
          };
          const result = await syncHealthData(
            { timezone: "Europe/Bratislava", days: [day] },
            healthSyncRepository,
            [{ ...day, __bodycastFixture: healthSnapshotFixtureTag }],
            new Date(`${dates[1]}T18:01:00.000Z`),
            undefined,
            { publicationNow: fixtureNow },
          );
          expect(result).toMatchObject({ status: "ok", modelPublicationStatus: "current", received: 1 });
          expect(await prisma.heartRateSample.count({
            where: { profileId, timestamp: new Date(heartRateTimestamp), bpm: 142 },
          })).toBe(1);
        },
      })).rejects.toBeInstanceOf(StaleStrengthEnergySourceError);

      await runTrainingRefreshToCompletion(profileId);

      const refreshedShadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({
        where: { sessionId: session.id }, select: { sourceFingerprint: true, result: true },
      });
      expect(refreshedShadow.sourceFingerprint).not.toBe(beforeShadow.sourceFingerprint);
      expect(refreshedShadow.result).toMatchObject({
        features: { hrSampleCount: 1, averageHrBpm: 142 },
      });
      expect((refreshedShadow.result as { inputFingerprint: string }).inputFingerprint)
        .not.toBe((beforeShadow.result as { inputFingerprint: string }).inputFingerprint);

      // The stale outer candidate did not overwrite the Health sync's newer shadow
      // or invalidate its successfully published V4 trajectory.
      const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(lifecycle).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });

      const currentSession = await trainingRepository.getSession(session.id, profileId);
      await expect(recordExperimentalStrengthEnergyShadow({ session: currentSession!, profileId })).resolves.toBeUndefined();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("does not adopt a newer training fence during strength refresh; current source retry republishes V4", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${dates[1]}T18:00:00.000Z`));
    try {
      await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
      const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
      });
      const program = await trainingService.createProgram({
        name: `${fixtureMethod}-training-fence-race`,
        exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
      }, profileId);
      const session = await trainingService.startSession(program.id, profileId, "Europe/Bratislava");
      deletedFixtureTrainingSourceKeys.add(String(session.id));
      const set = await trainingService.createSet(session.id, session.exercises[0]!.id, {
        reps: 8,
        weightKg: 24,
        bandNominalResistanceKg: null,
        rir: 3,
        completedAt: `${dates[1]}T17:00:00.000Z`,
      }, profileId);
      await trainingService.finishSession(session.id, profileId);

      let fenceBeforeConcurrentChange: { revision: number; fromDate: string } | null = null;
      let fenceAfterConcurrentChange: { revision: number; fromDate: string } | null = null;
      const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
      await expect(trainingService.updateSet(session.id, set.id, { reps: 10 }, profileId))
        .resolves.toMatchObject({ reps: 10 });
      let mutationInjected = false;
      await runOneTrainingRefreshAttempt(profileId, {
        afterClaim: async () => {
          if (mutationInjected) return;
          mutationInjected = true;
          fenceBeforeConcurrentChange = await lifecycle.readUnifiedPublicationBlockToken({
            profileId, source: "training", sourceKey: String(session.id),
          });
          const changed = await trainingRepository.updateSet({
            sessionId: session.id, setId: set.id, profileId, reps: 9,
          });
          expect(changed?.reps).toBe(9);
          fenceAfterConcurrentChange = await lifecycle.readUnifiedPublicationBlockToken({
            profileId, source: "training", sourceKey: String(session.id),
          });
        },
      });

      expect(fenceBeforeConcurrentChange).not.toBeNull();
      expect(fenceAfterConcurrentChange).not.toBeNull();
      expect(fenceAfterConcurrentChange!.revision).toBeGreaterThan(fenceBeforeConcurrentChange!.revision);
      expect((await trainingRepository.getSession(session.id, profileId))?.exercises[0]?.sets[0]?.reps).toBe(9);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(session.id) } },
      })).toMatchObject({ revision: fenceAfterConcurrentChange!.revision, fromDate: fenceAfterConcurrentChange!.fromDate });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

      await runTrainingRefreshToCompletion(profileId);
      expect((await trainingRepository.getSession(session.id, profileId))?.exercises[0]?.sets[0]?.reps).toBe(9);
      const currentLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(currentLifecycle).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: currentLifecycle.invalidationGeneration,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("keeps linked strength energy unavailable without Stage 02 mass and republishes V4 after a weight update", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0], timezone: "America/Los_Angeles" });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await expect(activateAndReplayUnifiedV4({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // At this instant the America/Los_Angeles episode's Jan 3 model day is
      // complete; the local Jan 4 day remains incomplete and is not used.
      vi.setSystemTime(new Date(`${futureDate}T12:00:00.000Z`));
      await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
      const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
      });
      const program = await trainingService.createProgram({
        name: `${fixtureMethod}-met-fallback-freshness`,
        exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
      }, profileId);
      const day = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: dates[2] }, select: { id: true } });
      const workout = await prisma.workout.create({
        data: {
          dailyHealthDataId: day.id,
          sourceIdentity: `${fixtureMethod}-linked-strength-met-fallback`,
          type: "Traditional Strength Training",
          startAt: new Date(`${dates[2]}T09:30:00.000Z`),
          endAt: new Date(`${dates[2]}T10:00:00.000Z`),
          durationMinutes: 30,
          energyKcal: null,
          activeEnergyKcal: null,
        },
      });
      vi.setSystemTime(new Date(`${futureDate}T12:30:00.000Z`));
      const completed = await trainingService.createSessionFromWorkout({ workoutId: workout.id, programId: program.id }, profileId);
      expect(completed.status).toBe("COMPLETED");
      expect(completed.matchedWorkoutId).toBe(workout.id);
      expect(completed.status).toBe("COMPLETED");
      await runTrainingRefreshToCompletion(profileId);

      const strengthShadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({
        where: { sessionId: completed.id }, select: { result: true },
      });
      expect(strengthShadow.result).toMatchObject({
        availability: "unavailable",
        unavailableReason: "missing-body-mass",
        features: { completedSetCount: 0 },
      });
      // The accounting snapshot is current even though its independent
      // Active Energy candidate remains unavailable without Stage 02 mass.
      expect(completed.materializationState).toBe("current");
      const alias = await prisma.activeEnergyEventAlias.findUniqueOrThrow({
        where: { profileId_sourceType_sourceId: {
          profileId,
          sourceType: "strength-session",
          sourceId: String(completed.id),
        } },
        select: { eventId: true },
      });
      const beforeWeightEvent = await prisma.activeEnergyCanonicalEvent.findUniqueOrThrow({
        where: { id: alias.eventId },
        select: { currentSource: true, currentProvenance: true },
      });
      expect(beforeWeightEvent.currentSource).toBe("unavailable");

      vi.setSystemTime(new Date(`${futureDate}T14:00:00.000Z`));
      const healthResult = await syncHealthWeightThroughService(
        dates[2]!,
        70,
        `${dates[2]}T13:00:00.000Z`,
        new Date(`${futureDate}T14:00:00.000Z`),
        true,
      );
      expect(healthResult).toMatchObject({ status: "ok", modelPublicationStatus: "stale" });

      expect(Number((await prisma.dailyHealthData.findUniqueOrThrow({
        where: { date: dates[2] }, select: { weightKg: true },
      })).weightKg)).toBe(70);
      const pendingHealth = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId } });
      expect(pendingHealth.completedGeneration).toBeLessThan(pendingHealth.requestedGeneration);
      await runHealthRefreshToCompletion(profileId);
      await runTrainingRefreshToCompletion(profileId);
      const afterWeightEvent = await prisma.activeEnergyCanonicalEvent.findUniqueOrThrow({
        where: { id: alias.eventId },
        select: { currentSource: true, currentProvenance: true },
      });
      expect(afterWeightEvent.currentSource).toBe("unavailable");
      const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(lifecycle).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: lifecycle.invalidationGeneration,
        productionPublishedGeneration: lifecycle.invalidationGeneration,
        productionStaleFromDate: null,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });

      const resolutionBeforeEquivalentReplay = await prisma.activeEnergyCanonicalEvent.findUniqueOrThrow({
        where: { id: alias.eventId }, select: { resolutionRevision: true },
      });
      await expect(publishActiveEnergyChangesV1({ now: new Date(`${futureDate}T14:00:00.000Z`) })).resolves.toBe(true);
      const resolutionAfterEquivalentReplay = await prisma.activeEnergyCanonicalEvent.findUniqueOrThrow({
        where: { id: alias.eventId }, select: { resolutionRevision: true },
      });
      expect(resolutionAfterEquivalentReplay.resolutionRevision).toBe(resolutionBeforeEquivalentReplay.resolutionRevision);
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("rejects a V4 candidate raced by a real Health source write and republishes at the same epoch", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    let candidateReady!: () => void;
    let releaseCandidate!: () => void;
    const ready = new Promise<void>((resolve) => { candidateReady = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseCandidate = resolve; });
    let fingerprintsBeforeRejectedCandidate: Array<{ date: string; resultFingerprint: string; sourceFingerprint: string }> | null = null;
    const staleCandidate = rebuildUnifiedExperimentalPhysiologyStateV1({
      profileId,
      fromDate: dates[0],
      toDate: dates[2],
      onCandidateComputed: async () => { candidateReady(); await blocked; },
    });
    try {
      await ready;
      await syncHealthWeightThroughService(dates[1]!, 79.7, `${dates[1]}T14:00:00.000Z`);
      const rowsBeforeRejectedCandidate = await rows();
      fingerprintsBeforeRejectedCandidate = rowsBeforeRejectedCandidate.map(({ date, resultFingerprint, sourceFingerprint }) => ({ date, resultFingerprint, sourceFingerprint }));
      const invalidated = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(invalidated.unifiedTargetRevision).toBe(UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION);
      expect(invalidated.unifiedRolloutEpoch).toBe(1);
      expect(isUnifiedGenerationCurrentV1(invalidated)).toBe(true);
    } finally {
      releaseCandidate();
      await staleCandidate.catch(() => undefined);
    }
    await expect(staleCandidate).rejects.toBeInstanceOf(PhysiologyV7ConcurrentSourceChangeError);
    const rowsBeforeCandidateCommit = await rows();
    const fingerprintsBeforeCandidateCommit = rowsBeforeCandidateCommit.map(({ date, resultFingerprint, sourceFingerprint }) => ({ date, resultFingerprint, sourceFingerprint }));
    expect(fingerprintsBeforeRejectedCandidate).not.toBeNull();
    expect(fingerprintsBeforeCandidateCommit).toEqual(fingerprintsBeforeRejectedCandidate);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      productionPublishedGeneration: lifecycle.invalidationGeneration,
      productionStaleFromDate: null,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  });

  it("republishes the active V4 target after ordinary day, stepper workout, and completed training writes", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      const dayRepository = new DailyMetricRepository();
      await dayRepository.update(dates[1]!, { weightKg: 79.4, caloriesKcal: 2_150, proteinG: 155, fatG: 68, carbsG: 205 });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });

      const importedStepperDay = {
        date: dates[2]!,
        workouts: [{
          externalId: `${fixtureMethod}-health-stepper`,
          type: "Stair Climbing",
          startAt: `${dates[2]}T08:00:00.000Z`,
          endAt: `${dates[2]}T08:20:00.000Z`,
          durationMinutes: 20,
          activeEnergyKcal: 140,
        }],
      };
      const importedStepperSync = await syncHealthData(
        { timezone: "Europe/Bratislava", days: [importedStepperDay] },
        healthSyncRepository,
        [{ ...importedStepperDay, __bodycastFixture: healthSnapshotFixtureTag }],
        new Date(`${dates[2]}T09:00:00.000Z`),
        undefined,
        { publicationNow: fixtureNow },
      );
      expect(importedStepperSync.modelPublicationStatus).toBe("current");
      const stepper = await prisma.workout.findFirstOrThrow({
        where: { sourceIdentity: `ext:${fixtureMethod}-health-stepper` }, select: { id: true },
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
      expect(await prisma.experimentalStepperGlycogenDemandShadow.findUnique({ where: { workoutId: stepper.id } }))
        .not.toBeNull();
      const stepperRepository = new StepperWorkoutRepository();
      await expect(stepperRepository.delete(stepper.id)).resolves.toMatchObject({ deleted: true });
      await runTrainingRefreshToCompletion(profileId);
      expect(await prisma.experimentalStepperGlycogenDemandShadow.findUnique({ where: { workoutId: stepper.id } }))
        .toBeNull();
      expect(await prisma.workout.findUniqueOrThrow({ where: { id: stepper.id }, select: { hiddenFromHistory: true } }))
        .toEqual({ hiddenFromHistory: true });
      const afterHiddenStepper = await prisma.unifiedExperimentalPhysiologyStateV2.findFirstOrThrow({
        where: { profileId, modelEpisodeId: episodeId!, date: dates[2] }, select: { sourceLineage: true },
      });
      expect((afterHiddenStepper.sourceLineage as { workouts: Array<{ id: number }> }).workouts.map(({ id }) => id))
        .not.toContain(stepper.id);
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });

      // Episode days use Europe/Bratislava boundaries. This event belongs to
      // Jan 4 model day although its UTC date and Health parent date are Jan 3.
      const boundaryWorkout = {
        externalId: `${fixtureMethod}-episode-boundary-workout`,
        type: "running",
        startAt: `${dates[2]}T23:30:00.000Z`,
        endAt: `${dates[2]}T23:50:00.000Z`,
        durationMinutes: 20,
        activeEnergyKcal: 170,
      };
      // The source event is Jan 3 23:30Z but belongs to Jan 4 in the
      // episode timezone. Health sync filters rows by the local parent day.
      const boundaryDay = { date: futureDate, workouts: [boundaryWorkout] };
      await syncHealthData(
        { timezone: "Europe/Bratislava", days: [boundaryDay] },
        healthSyncRepository,
        [{ ...boundaryDay, __bodycastFixture: healthSnapshotFixtureTag }],
        new Date(`${dates[2]}T23:35:00.000Z`),
        undefined,
        { publicationNow: fixtureNow },
      );
      const boundaryWorkoutRow = await prisma.workout.findFirstOrThrow({
        where: { startAt: new Date(boundaryWorkout.startAt) },
        select: { id: true },
      });
      const priorModelDay = await prisma.unifiedExperimentalPhysiologyStateV2.findFirstOrThrow({
        where: { profileId, modelEpisodeId: episodeId!, date: dates[2] },
        select: { sourceLineage: true },
      });
      const nextModelDay = await prisma.unifiedExperimentalPhysiologyStateV2.findFirstOrThrow({
        where: { profileId, modelEpisodeId: episodeId!, date: futureDate },
        select: { sourceLineage: true },
      });
      const priorWorkoutIds = (priorModelDay.sourceLineage as { workouts: Array<{ id: number }> }).workouts.map(({ id }) => id);
      const nextWorkoutIds = (nextModelDay.sourceLineage as { workouts: Array<{ id: number }> }).workouts.map(({ id }) => id);
      expect(priorWorkoutIds).not.toContain(boundaryWorkoutRow.id);
      expect(nextWorkoutIds).toContain(boundaryWorkoutRow.id);
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 4 });

      await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
      const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
      });
      const program = await trainingService.createProgram({
        name: `${fixtureMethod}-v4-publication-training`,
        exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
      }, profileId);
      const session = await trainingRepository.createSessionSnapshot({
        profileId,
        programId: program.id,
        programVersionId: program.currentVersionId!,
        // Keep the UI start outside the source window. The canonical
        // accounting instant below is what must place this completed event.
        webStartedAt: new Date("2070-12-28T12:00:00.000Z"),
        accountingTimeZone: "Pacific/Kiritimati",
        accountingTimeZoneProvenance: "client-session",
        exercises: program.exercises.map((item) => ({
          sourceExerciseCatalogId: item.catalogId,
          snapshotExerciseName: item.catalogName,
          sortOrder: item.order,
          plannedSets: item.plannedSets,
          resistanceType: item.resistanceType,
          muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7(exercise.stableKey),
          loadAccountingConfigSnapshot: item.loadAccountingConfigSnapshot as Prisma.InputJsonValue,
        })),
      });
      const beforeActiveAccountingContext = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      await trainingService.updateSessionAccountingContext(session.id, {
        effectiveAccountingAt: `${dates[0]}T14:00:00.000Z`,
        timeZone: "Pacific/Kiritimati",
      }, profileId);
      const afterActiveAccountingContext = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(afterActiveAccountingContext).toMatchObject({
        invalidationGeneration: beforeActiveAccountingContext.invalidationGeneration,
        productionPublishedGeneration: beforeActiveAccountingContext.productionPublishedGeneration,
        unifiedPublishedGeneration: beforeActiveAccountingContext.unifiedPublishedGeneration,
        unifiedPublishedRolloutEpoch: 1,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
      const activeSessionDay = await prisma.unifiedExperimentalPhysiologyStateV2.findFirstOrThrow({
        where: { profileId, modelEpisodeId: episodeId!, date: futureDate }, select: { sourceLineage: true },
      });
      expect((activeSessionDay.sourceLineage as { diarySessions: Array<{ id: number }> }).diarySessions)
        .not.toContainEqual(expect.objectContaining({ id: session.id }));
      const activeSet = await trainingService.createSet(session.id, session.exercises[0]!.id, {
        reps: 8,
        weightKg: 24,
        bandNominalResistanceKg: null,
        rir: 3,
        completedAt: `${dates[0]}T15:30:00.000Z`,
      }, profileId);
      const afterActiveSetEdit = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(afterActiveSetEdit).toMatchObject({
        invalidationGeneration: beforeActiveAccountingContext.invalidationGeneration,
        productionPublishedGeneration: beforeActiveAccountingContext.productionPublishedGeneration,
        unifiedPublishedGeneration: beforeActiveAccountingContext.unifiedPublishedGeneration,
        unifiedPublishedRolloutEpoch: 1,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
      await trainingService.materializeSessionAccounting(session.id, profileId);
      const afterActiveAccountingMaterialization = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(afterActiveAccountingMaterialization).toMatchObject({
        invalidationGeneration: beforeActiveAccountingContext.invalidationGeneration,
        productionPublishedGeneration: beforeActiveAccountingContext.productionPublishedGeneration,
        unifiedPublishedGeneration: beforeActiveAccountingContext.unifiedPublishedGeneration,
        unifiedPublishedRolloutEpoch: 1,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });

      // The service initially reads this as ACTIVE. Let completion win the
      // profile lock immediately before the row mutation; the post-write
      // lifecycle read must then notice the terminal source and republish it.
      const updateSet = trainingRepository.updateSet.bind(trainingRepository);
      const updateSetSpy = vi.spyOn(trainingRepository, "updateSet").mockImplementationOnce(async (input) => {
        await trainingService.finishSession(session.id, profileId);
        return updateSet(input);
      });
      try {
        await trainingService.updateSet(session.id, activeSet.id, { reps: 9 }, profileId);
      } finally {
        updateSetSpy.mockRestore();
      }
      await runTrainingRefreshToCompletion(profileId);
      const afterCompletionRace = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(afterCompletionRace).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: afterCompletionRace.invalidationGeneration,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
      const completedSessionDay = await prisma.unifiedExperimentalPhysiologyStateV2.findFirstOrThrow({
        where: { profileId, modelEpisodeId: episodeId!, date: dates[0] }, select: { sourceLineage: true },
      });
      expect((completedSessionDay.sourceLineage as { diarySessions: Array<{ id: number }> }).diarySessions)
        .toContainEqual(expect.objectContaining({ id: session.id }));
      const uiStartDay = await prisma.unifiedExperimentalPhysiologyStateV2.findFirstOrThrow({
        where: { profileId, modelEpisodeId: episodeId!, date: futureDate }, select: { sourceLineage: true },
      });
      expect((uiStartDay.sourceLineage as { diarySessions: Array<{ id: number }> }).diarySessions)
        .not.toContainEqual(expect.objectContaining({ id: session.id }));
      const completedSnapshotRefreshKey = `v4-completed-accounting-refresh-${session.id}`;
      await trainingService.refreshSessionAccounting(session.id, profileId, completedSnapshotRefreshKey);
      await runOneTrainingRefreshAttempt(profileId, {
        afterProgressStage: async (_job, stage) => {
          if (stage === "training-glycogen-demand") {
            throw new Error("injected completed-session demand-shadow failure");
          }
        },
      });
      const failedSnapshotRefresh = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
      expect(failedSnapshotRefresh).toMatchObject({
        lastErrorType: "Error",
        leaseToken: null,
      });
      const afterFailedCompletedAccountingRefresh = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(afterFailedCompletedAccountingRefresh).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedGeneration: null,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();
      const committedSnapshotRevision = (await prisma.strengthDiarySession.findUniqueOrThrow({
        where: { id: session.id }, select: { currentSnapshotRevision: true },
      })).currentSnapshotRevision;
      expect(committedSnapshotRevision).toEqual(expect.any(Number));
      expect(await prisma.strengthSessionAccountingSnapshot.findUnique({
        where: { sessionId_snapshotRevision: { sessionId: session.id, snapshotRevision: committedSnapshotRevision! } },
        select: { sessionId: true },
      })).toEqual({ sessionId: session.id });

      // The snapshot write committed before dependent publication failed. A
      // retry with the same idempotency key must repair publication even
      // though it returns the already-materialized snapshot revision.
      const completedSnapshotRefresh = await trainingService.refreshSessionAccounting(
        session.id,
        profileId,
        completedSnapshotRefreshKey,
      );
      expect(completedSnapshotRefresh.status).toBe("COMPLETED");
      expect(completedSnapshotRefresh.snapshotRevision).toBe(committedSnapshotRevision);
      await runTrainingRefreshToCompletion(profileId);
      const afterCompletedAccountingRefresh = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(afterCompletedAccountingRefresh).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: afterCompletedAccountingRefresh.invalidationGeneration,
        productionPublishedGeneration: afterCompletedAccountingRefresh.invalidationGeneration,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });

      // The session accounting timezone maps this old occurrence to Jan 2,
      // while its episode model date is Jan 1. Moving it to Jan 3 must replay
      // glycogen from the old episode date, not the later accounting date.
      await trainingService.updateSessionAccountingContext(session.id, {
        effectiveAccountingAt: `${dates[2]}T14:00:00.000Z`,
        timeZone: "Pacific/Kiritimati",
      }, profileId);
      const relocationChange = await prisma.trainingSourceChange.findFirstOrThrow({
        where: { profileId, operationKind: "accounting_context_relocated", affectedSessionIds: { has: session.id } },
        orderBy: { generation: "desc" },
        select: { oldModelDates: true, newModelDates: true },
      });
      expect(relocationChange.oldModelDates).toContain(dates[0]);
      expect(relocationChange.newModelDates).toContain(dates[2]);
      await runOneTrainingRefreshAttempt(profileId, {
        afterProgressStage: async (_job, stage) => {
          if (stage === "unified-publication") throw new Error("injected final training-relocation Unified failure");
        },
      });

      const relocationBlock = await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(session.id) } },
      });
      expect(relocationBlock).not.toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();
      await runTrainingRefreshToCompletion(profileId);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: String(session.id) } },
      })).toBeNull();

      const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(lifecycle).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: lifecycle.invalidationGeneration,
        productionPublishedGeneration: lifecycle.invalidationGeneration,
        productionStaleFromDate: null,
      });
      await expect(prisma.experimentalStrengthGlycogenDemandShadow.findUniqueOrThrow({ where: { sessionId: session.id } }))
        .resolves.toMatchObject({ sessionId: session.id });
      const sessionTransientWater = await prisma.experimentalTransientExerciseWaterShadow.findUniqueOrThrow({ where: { sessionId: session.id } });
      const dailyGlycogen = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
        where: { profileId_date: { profileId, date: dates[2]! } },
      });
      const unifiedRows = await rows();
      expect(unifiedRows.every((row) => row.modelRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION)).toBe(true);
      const sessionDateUnified = await prisma.unifiedExperimentalPhysiologyStateV2.findFirstOrThrow({
        // The completed session was relocated to Jan 3 above; child evidence
        // must follow its canonical episode model date, not webStartedAt.
        where: { profileId, modelEpisodeId: episodeId!, date: dates[2] },
      });
      const childOutputs = (sessionDateUnified.sourceLineage as {
        childOutputs: Array<{ kind: string; id: number; sourceFingerprint: string }>;
      }).childOutputs;
      expect((sessionDateUnified.sourceLineage as { diarySessions: Array<{ id: number }> }).diarySessions)
        .toContainEqual(expect.objectContaining({ id: session.id }));
      const oldAccountingDay = await prisma.unifiedExperimentalPhysiologyStateV2.findFirstOrThrow({
        where: { profileId, modelEpisodeId: episodeId!, date: dates[0] }, select: { sourceLineage: true },
      });
      expect((oldAccountingDay.sourceLineage as { diarySessions: Array<{ id: number }> }).diarySessions)
        .not.toContainEqual(expect.objectContaining({ id: session.id }));
      expect(childOutputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "glycogen", id: dailyGlycogen.id, sourceFingerprint: dailyGlycogen.sourceFingerprint }),
        expect.objectContaining({ kind: "transientWater", id: sessionTransientWater.id, sourceFingerprint: sessionTransientWater.sourceFingerprint }),
      ]));
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });

      // Moving a child away from a completed source changes that old source
      // too. The SQL trigger must invalidate the completed parent even when
      // the new parent is an ACTIVE session that is not a model input.
      const activeDestination = await trainingRepository.createSessionSnapshot({
        profileId,
        programId: program.id,
        programVersionId: program.currentVersionId!,
        status: "ACTIVE",
        entryMode: "LIVE",
        webStartedAt: new Date(`${futureDate}T15:00:00.000Z`),
        exercises: program.exercises.map((item) => ({
          sourceExerciseCatalogId: item.catalogId,
          snapshotExerciseName: item.catalogName,
          sortOrder: item.order,
          plannedSets: item.plannedSets,
          resistanceType: item.resistanceType,
          muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7(exercise.stableKey),
          loadAccountingConfigSnapshot: item.loadAccountingConfigSnapshot as Prisma.InputJsonValue,
        })),
      });
      const activeDestinationExercise = await prisma.strengthSessionExercise.findFirstOrThrow({
        where: { sessionId: activeDestination.id },
        select: { id: true },
      });
      const beforeSetMove = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      await prisma.strengthSet.update({
        where: { id: activeSet.id },
        data: { sessionExerciseId: activeDestinationExercise.id, setNumber: 1 },
      });
      const afterSetMove = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(afterSetMove).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        invalidationGeneration: beforeSetMove.invalidationGeneration + 1,
        unifiedPublishedGeneration: beforeSetMove.unifiedPublishedGeneration,
        unifiedPublishedRolloutEpoch: 1,
      });
      expect(isUnifiedGenerationCurrentV1(afterSetMove)).toBe(false);
      await expect(prisma.strengthSet.findUniqueOrThrow({ where: { id: activeSet.id } }))
        .resolves.toMatchObject({
          sessionExerciseId: activeDestinationExercise.id,
          setNumber: 1,
          reps: 9,
          weightKg: new Prisma.Decimal(24),
          rir: 3,
          completedAt: new Date(`${dates[0]}T15:30:00.000Z`),
        });

      const beforeChildMove = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      await prisma.strengthSessionExercise.update({
        where: { id: session.exercises[0]!.id },
        data: { sessionId: activeDestination.id, sortOrder: 10 },
      });
      const afterChildMove = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(afterChildMove).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        invalidationGeneration: beforeChildMove.invalidationGeneration + 1,
        unifiedPublishedGeneration: beforeChildMove.unifiedPublishedGeneration,
        unifiedPublishedRolloutEpoch: 1,
      });
      expect(isUnifiedGenerationCurrentV1(afterChildMove)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes stale stair glycogen demand after Health corrects the same workout to a non-stair type", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    const workout = {
      externalId: `${fixtureMethod}-stair-type-correction`,
      type: "Stair Climbing",
      startAt: `${dates[1]}T08:00:00.000Z`,
      endAt: `${dates[1]}T08:20:00.000Z`,
      durationMinutes: 20,
      activeEnergyKcal: 140,
    };
    const firstDay = { date: dates[1]!, steps: 1_000, carbsG: 0, workouts: [workout] };
    await syncHealthData(
      { timezone: "Europe/Bratislava", days: [firstDay] },
      healthSyncRepository,
      [{ ...firstDay, __bodycastFixture: healthSnapshotFixtureTag }],
      new Date(`${dates[1]}T07:50:00.000Z`),
      undefined,
      { publicationNow: fixtureNow },
    );
    const secondDay = { date: dates[1]!, steps: 3_000, carbsG: 0, workouts: [workout] };
    await syncHealthData(
      { timezone: "Europe/Bratislava", days: [secondDay] },
      healthSyncRepository,
      [{ ...secondDay, __bodycastFixture: healthSnapshotFixtureTag }],
      new Date(`${dates[1]}T08:30:00.000Z`),
      undefined,
      { publicationNow: fixtureNow },
    );

    const sourceIdentity = `ext:${workout.externalId}`;
    const stairRow = await prisma.workout.findFirstOrThrow({ where: { sourceIdentity } });
    const stairShadow = await prisma.experimentalStepperGlycogenDemandShadow.findUniqueOrThrow({
      where: { workoutId: stairRow.id },
    });
    expect((stairShadow.result as { availability?: string }).availability).toBe("available");
    expect((stairShadow.result as { estimatedGlycogenDeltaKg?: number }).estimatedGlycogenDeltaKg).toBeLessThan(0);
    const beforeGlycogen = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: dates[1]! } },
    });
    const beforeGlycogenResult = beforeGlycogen.result as {
      state: { relativeDeviationKg: number | null };
      sourceLineage: { stepperDemandShadows: Array<{ workoutId: number }> };
    };
    expect(beforeGlycogenResult.sourceLineage.stepperDemandShadows.map(({ workoutId }) => workoutId)).toContain(stairRow.id);
    expect(beforeGlycogenResult.state.relativeDeviationKg).not.toBeNull();
    expect(beforeGlycogenResult.state.relativeDeviationKg).toBeLessThan(0);

    const correctedDay = { ...secondDay, workouts: [{ ...workout, type: "Running" }] };
    const corrected = await syncHealthData(
      { timezone: "Europe/Bratislava", days: [correctedDay] },
      healthSyncRepository,
      [{ ...correctedDay, __bodycastFixture: healthSnapshotFixtureTag }],
      new Date(`${dates[1]}T08:40:00.000Z`),
      undefined,
      { publicationNow: fixtureNow },
    );

    expect(corrected.modelPublicationStatus).toBe("current");
    const correctedRow = await prisma.workout.findFirstOrThrow({ where: { sourceIdentity } });
    expect(correctedRow).toMatchObject({ id: stairRow.id, type: "Running", hiddenFromHistory: false });
    expect(await prisma.experimentalStepperGlycogenDemandShadow.findUnique({ where: { workoutId: stairRow.id } }))
      .toBeNull();
    const afterGlycogen = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: dates[1]! } },
    });
    const afterGlycogenResult = afterGlycogen.result as {
      state: { relativeDeviationKg: number | null };
      sourceLineage: { stepperDemandShadows: Array<{ workoutId: number }> };
    };
    expect(afterGlycogenResult.sourceLineage.stepperDemandShadows.map(({ workoutId }) => workoutId)).not.toContain(stairRow.id);
    expect(afterGlycogenResult.state.relativeDeviationKg).toBe(0);
    expect(afterGlycogenResult.state.relativeDeviationKg).toBeGreaterThan(beforeGlycogenResult.state.relativeDeviationKg!);
    expect(afterGlycogen.sourceFingerprint).not.toBe(beforeGlycogen.sourceFingerprint);
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: lifecycle.invalidationGeneration,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
  }, 60_000);

  it("keeps V4 unpublished when a required Health child-shadow refresh fails", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });
    const before = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });

    const failRefresh = vi.spyOn(glycogenStateShadowService, "recordExperimentalGlycogenStateShadow")
      .mockRejectedValueOnce(new Error("fixture child shadow failure"));
    try {
      const firstDay = { date: dates[1]!, weightKg: 79.3, caloriesKcal: 2_200, proteinG: 160, fatG: 70, carbsG: 220 };
      const secondDay = { date: dates[2]!, weightKg: 79.25, caloriesKcal: 2_190, proteinG: 159, fatG: 69, carbsG: 219 };
      const syncResult = await syncHealthData(
        { timezone: "Europe/Bratislava", days: [firstDay, secondDay] },
        healthSyncRepository,
        [
          { ...firstDay, __bodycastFixture: healthSnapshotFixtureTag },
          { ...secondDay, __bodycastFixture: healthSnapshotFixtureTag },
        ],
        new Date(`${dates[1]}T16:00:00.000Z`),
        undefined,
        { publicationNow: fixtureNow },
      );
      expect(syncResult).toMatchObject({ status: "ok", modelPublicationStatus: "stale", received: 2 });
    } finally {
      failRefresh.mockRestore();
    }

    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle.invalidationGeneration).toBeGreaterThan(before.invalidationGeneration);
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: before.unifiedRolloutEpoch,
      unifiedPublishedGeneration: null,
      unifiedPublishedRolloutEpoch: null,
    });
    expect(isUnifiedGenerationCurrentV1(lifecycle)).toBe(false);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow("Unified V4 is current");

    // A later unrelated day write must not erase the failed Health refresh
    // fence or publish over the stale child dependency.
    const dayRepository = new DailyMetricRepository();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      await expect(dayRepository.update(dates[2]!, { weightKg: 79.2, caloriesKcal: 2_175, proteinG: 158, fatG: 69, carbsG: 215 }))
        .resolves.toMatchObject({ modelPublicationStatus: "stale" });
    } finally {
      vi.useRealTimers();
    }
    const blocked = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(blocked).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: before.unifiedRolloutEpoch,
      unifiedPublishedGeneration: null,
      unifiedPublishedRolloutEpoch: null,
      unifiedPublicationBlockedFromDate: dates[1],
      unifiedPublicationBlockedSource: "health",
    });
    expect(await prisma.unifiedPublicationBlock.findMany({
      where: { profileId, source: "health" },
      orderBy: { sourceKey: "asc" },
      select: { sourceKey: true },
    })).toEqual([{ sourceKey: dates[1] }]);
    expect(Number((await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: dates[2] }, select: { weightKg: true } })).weightKg))
      .toBe(79.2);
    expect(isUnifiedGenerationCurrentV1(blocked)).toBe(false);

    await syncHealthWeightThroughService(dates[1]!, 79.1, `${dates[1]}T18:00:00.000Z`);
    expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId } })).toEqual([]);
    const repaired = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(repaired).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: before.unifiedRolloutEpoch,
      unifiedPublishedRolloutEpoch: before.unifiedRolloutEpoch,
      unifiedPublishedGeneration: repaired.invalidationGeneration,
      productionPublishedGeneration: repaired.invalidationGeneration,
      unifiedPublicationBlockedFromDate: null,
      unifiedPublicationBlockedSource: null,
      productionStaleFromDate: null,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });

      const failFinalHealthPublication = vi.spyOn(activeEnergyPublication, "publishActiveEnergyChangesV1")
        .mockRejectedValueOnce(new Error("fixture final Health publication failure"));
      try {
        await syncHealthWeightThroughService(dates[2]!, 79.05, `${dates[2]}T19:00:00.000Z`);
      } finally {
        failFinalHealthPublication.mockRestore();
      }
      expect(await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: dates[2] }, select: { weightKg: true } }))
        .toMatchObject({ weightKg: 79.05 });
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "health", sourceKey: dates[2]! } },
      })).not.toBeNull();
      const failedHealthPublish = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(failedHealthPublish).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: before.unifiedRolloutEpoch,
        unifiedPublishedGeneration: null,
        unifiedPublishedRolloutEpoch: null,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

      await syncHealthWeightThroughService(dates[2]!, 79.0, `${dates[2]}T20:00:00.000Z`);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "health", sourceKey: dates[2]! } },
      })).toBeNull();
      const retriedHealthPublish = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(retriedHealthPublish).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: before.unifiedRolloutEpoch,
        unifiedPublishedRolloutEpoch: before.unifiedRolloutEpoch,
        unifiedPublishedGeneration: retriedHealthPublish.invalidationGeneration,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      const failFinalPublish = vi.spyOn(activeEnergyPublication, "publishActiveEnergyChangesV1")
        .mockRejectedValueOnce(new Error("fixture final day-delete publication failure"));
      try {
        await expect(dayRepository.delete(dates[2]!)).resolves.toMatchObject({
          deleted: true,
          modelPublicationStatus: "stale",
        });
      } finally {
        failFinalPublish.mockRestore();
      }
      const dayDeleteBlock = await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "day", sourceKey: dates[2]! } },
      });
      expect(dayDeleteBlock).not.toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();
      await expect(dayRepository.delete(dates[2]!)).resolves.toMatchObject({
        deleted: true,
        modelPublicationStatus: "current",
      });
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "day", sourceKey: dates[2]! } },
      })).toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("restores the durable day-delete retry fence when the post-clear block read fails", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0]!, toDate: dates[2]! });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });
    const before = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    const dayRepository = new DailyMetricRepository();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      const failAfterFenceClear = vi.spyOn(
        PhysiologyV7PersistenceRepository.prototype,
        "hasUnifiedPublicationBlocks",
      ).mockImplementationOnce(async (checkedProfileId) => {
        expect(checkedProfileId).toBe(profileId);
        // This is the first aggregate read after dependent refresh and exact
        // fence clear. Prove the injected read failure lands at that boundary.
        expect(await prisma.unifiedPublicationBlock.findUnique({
          where: { profileId_source_sourceKey: { profileId, source: "day", sourceKey: dates[2]! } },
        })).toBeNull();
        throw new Error("fixture post-clear publication-block read failure");
      });
      try {
        await expect(dayRepository.delete(dates[2]!)).resolves.toMatchObject({
          deleted: true,
          modelPublicationStatus: "stale",
        });
        expect(failAfterFenceClear).toHaveBeenCalledTimes(1);
      } finally {
        failAfterFenceClear.mockRestore();
      }

      expect(await prisma.dailyHealthData.findUnique({ where: { date: dates[2]! } })).toBeNull();
      const restoredFence = await prisma.unifiedPublicationBlock.findUniqueOrThrow({
        where: { profileId_source_sourceKey: { profileId, source: "day", sourceKey: dates[2]! } },
      });
      expect(restoredFence).toMatchObject({ profileId, source: "day", sourceKey: dates[2]!, fromDate: dates[2]! });
      const blocked = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(blocked).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: before.unifiedRolloutEpoch,
        unifiedPublishedGeneration: null,
        unifiedPublishedRolloutEpoch: null,
      });
      expect(isUnifiedGenerationCurrentV1(blocked)).toBe(false);
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();

      await expect(dayRepository.delete(dates[2]!)).resolves.toMatchObject({
        deleted: true,
        modelPublicationStatus: "current",
      });
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "day", sourceKey: dates[2]! } },
      })).toBeNull();
      const repaired = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(repaired).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: before.unifiedRolloutEpoch,
        unifiedPublishedRolloutEpoch: before.unifiedRolloutEpoch,
        unifiedPublishedGeneration: repaired.invalidationGeneration,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("retries a failed stepper move from its durable earliest source date before clearing the block", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0], timezone: "America/Los_Angeles" });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
    const stepperRepository = new StepperWorkoutRepository();
    const stepper = await stepperRepository.create({
      startAt: `${dates[1]}T00:30:00.000Z`, durationMinutes: 20, manualStepCount: 1_500,
    });
    const createChange = await prisma.trainingSourceChange.findFirstOrThrow({
      where: { profileId, affectedWorkoutIds: { has: stepper.id }, operationKind: "stepper_workout_create" },
    });
    // The fixture's raw sync-day date is Jan 2, while the active episode's
    // America/Los_Angeles model date is Jan 1. Recovery must retain both.
    expect(createChange.newModelDates).toEqual([dates[0], dates[1]]);
    await runTrainingRefreshToCompletion(profileId);
    expect(await prisma.experimentalStepperGlycogenDemandShadow.findUnique({
      where: { workoutId: stepper.id }, select: { workoutId: true },
    })).toEqual({ workoutId: stepper.id });
    await expect(stepperRepository.update(stepper.id, {
      startAt: `${dates[2]}T00:30:00.000Z`, durationMinutes: 20, manualStepCount: 1_500,
    })).resolves.toMatchObject({ id: stepper.id, modelPublicationStatus: "stale" });
    const failFirstStateReplay = vi.spyOn(glycogenStateShadowService, "recordExperimentalGlycogenStateShadow")
      .mockRejectedValueOnce(new Error("fixture stepper state replay failure"));
    try {
      await runOneTrainingRefreshAttempt(profileId);
    } finally {
      failFirstStateReplay.mockRestore();
    }

    const blocked = await prisma.unifiedPublicationBlock.findUniqueOrThrow({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey: String(stepper.id) } },
    });
    // The source's local date is Jan 2 in the default timezone while its
    // episode/model date is Jan 1 in America/Los_Angeles. Retry must start at
    // the earlier durable boundary even though the event has already moved.
    expect(blocked.fromDate).toBe(dates[0]);

    const refreshDates: string[] = [];
    const recordDemand = stepperGlycogenShadowService.recordExperimentalStepperGlycogenDemandShadowsForLocalDate;
    const demandSpy = vi.spyOn(stepperGlycogenShadowService, "recordExperimentalStepperGlycogenDemandShadowsForLocalDate")
      .mockImplementation(async (input) => { refreshDates.push(input.date); await recordDemand(input); });
    try {
      await runTrainingRefreshToCompletion(profileId);
      expect(refreshDates).toContain(dates[0]);
      expect(demandSpy).toHaveBeenCalledWith({ date: dates[0], profileId });
    } finally {
      demandSpy.mockRestore();
    }

    expect(await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey: String(stepper.id) } },
    })).toBeNull();
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 1,
      unifiedPublishedGeneration: lifecycle.invalidationGeneration,
      unifiedPublishedRolloutEpoch: 1,
      productionStaleFromDate: null,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("retries a committed stepper deletion through its durable source fence", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
    const stepperRepository = new StepperWorkoutRepository();
    const stepper = await stepperRepository.create({
      startAt: `${dates[1]}T08:00:00.000Z`, durationMinutes: 20, manualStepCount: 1_500,
    });
    deletedFixtureStepperSourceKeys.add(String(stepper.id));
    await runTrainingRefreshToCompletion(profileId);
    await expect(stepperRepository.delete(stepper.id)).resolves.toMatchObject({ deleted: true });
    const failFirstStateReplay = vi.spyOn(glycogenStateShadowService, "recordExperimentalGlycogenStateShadow")
      .mockRejectedValueOnce(new Error("fixture stepper delete shadow failure"));
    try {
      await runOneTrainingRefreshAttempt(profileId);
    } finally {
      failFirstStateReplay.mockRestore();
    }
    expect(await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey: String(stepper.id) } },
    })).not.toBeNull();
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow("Unified V4 is current");

    await runTrainingRefreshToCompletion(profileId);
    expect(await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey: String(stepper.id) } },
    })).toBeNull();
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });

    const secondStepper = await stepperRepository.create({
      startAt: `${dates[2]}T09:00:00.000Z`, durationMinutes: 15, manualStepCount: 900,
    });
    deletedFixtureStepperSourceKeys.add(String(secondStepper.id));
    await expect(stepperRepository.delete(secondStepper.id)).resolves.toMatchObject({ deleted: true });
    await runOneTrainingRefreshAttempt(profileId, {
      afterProgressStage: async (_job, stage) => {
        if (stage === "unified-publication") throw new Error("fixture final stepper-delete publication failure");
      },
    });
    const secondDeleteJob = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
    expect(secondDeleteJob.leaseToken).toBeNull();
      expect(await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey: String(secondStepper.id) } },
      })).toBeNull();
      const failedLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(isUnifiedGenerationCurrentV1(failedLifecycle)).toBe(false);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();
    await runTrainingRefreshToCompletion(profileId);
    expect(await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey: String(secondStepper.id) } },
    })).toBeNull();
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("keeps a stepper generation recoverable when publication succeeds but worker acknowledgement fails", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0]!, toDate: dates[2]! });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    const stepperRepository = new StepperWorkoutRepository();
    const created = await stepperRepository.create({
      startAt: `${dates[1]}T09:30:00.000Z`, durationMinutes: 20, manualStepCount: 1_300,
    });
    deletedFixtureStepperSourceKeys.add(String(created.id));
    try {
      await runOneTrainingRefreshAttempt(profileId, {
        afterPublicationBeforeAcknowledge: async () => {
          throw new Error("fixture crash after atomic publication before queue acknowledgement");
        },
      });
    } finally {
      // Keep deterministic fixture time until the recovery attempt has run.
    }

    expect(created.modelPublicationStatus).toBe("stale");
    const retainedSourceFence = await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey: String(created.id) } },
    });
    expect(retainedSourceFence).toBeNull();
    const failed = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
    expect(failed.leaseToken).toBeNull();
    expect(failed.completedGeneration).toBeLessThanOrEqual(failed.requestedGeneration);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow();
    await runTrainingRefreshToCompletion(profileId);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    vi.useRealTimers();
  }, 60_000);

  it("retries a committed stepper create with the same numeric-id publication fence", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    const startAt = `${dates[1]}T09:15:00.000Z`;
    const input = { startAt, durationMinutes: 25, manualStepCount: 1_600 };
    const stepperRepository = new StepperWorkoutRepository();
    const created = await stepperRepository.create(input);
    const failFirstReplay = vi.spyOn(glycogenStateShadowService, "recordExperimentalGlycogenStateShadow")
      .mockRejectedValueOnce(new Error("fixture stepper create shadow failure"));
    try {
      await runOneTrainingRefreshAttempt(profileId);
    } finally {
      failFirstReplay.mockRestore();
    }

    const committed = await prisma.workout.findFirstOrThrow({
      where: { type: "Stair Climbing", startAt: new Date(startAt), sourceIdentity: { startsWith: "manual:stepper:" } },
      select: { id: true, sourceIdentity: true },
    });
    expect(committed.id).toBe(created.id);
    expect(await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey: String(committed.id) } },
      select: { sourceKey: true },
    })).toEqual({ sourceKey: String(committed.id) });
    expect(await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey: committed.sourceIdentity } },
    })).toBeNull();
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow("Unified V4 is current");

    try {
      await expect(stepperRepository.update(committed.id, input)).resolves.toMatchObject({ id: committed.id });
      await runTrainingRefreshToCompletion(profileId);
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey: String(committed.id) } },
      })).toBeNull();
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("defers nested matching publication until the Health batch finishes production recalculation", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await addFutureDay();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: futureDate });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixtureNow);
    try {
      await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
      const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
      });
      const program = await trainingService.createProgram({
        name: `${fixtureMethod}-pending-health-match`,
        exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
      }, profileId);
      const session = await trainingService.startSession(program.id, profileId, "Europe/Bratislava");
      await trainingService.createSet(session.id, session.exercises[0]!.id, {
        reps: 8,
        weightKg: 24,
        bandNominalResistanceKg: null,
        rir: 3,
        completedAt: `${futureDate}T12:30:00.000Z`,
      }, profileId);
      const completed = await trainingService.finishSession(session.id, profileId);
      expect(completed.matchStatus).toBe("PENDING");

      const day = { date: futureDate, weightKg: 79.5, caloriesKcal: 2_180, proteinG: 158, fatG: 68, carbsG: 218 };
      const result = await syncHealthData(
        { timezone: "Europe/Bratislava", days: [day] },
        healthSyncRepository,
        [{ ...day, __bodycastFixture: healthSnapshotFixtureTag }],
        new Date(`${futureDate}T18:00:00.000Z`),
        undefined,
        { publicationNow: fixtureNow },
      );
      expect(result).toMatchObject({ status: "ok", modelPublicationStatus: "stale" });
      await runTrainingRefreshToCompletion(profileId);
      const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(lifecycle).toMatchObject({
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: lifecycle.invalidationGeneration,
        productionPublishedGeneration: lifecycle.invalidationGeneration,
      });
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("does not recreate completed-training or stepper fences while another source blocks shared publication", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });

    const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
    await lifecycle.blockUnifiedPublication({ profileId, fromDate: dates[1]!, source: "health", sourceKey: dates[2]! });
    const healthFence = await lifecycle.readUnifiedPublicationBlockToken({
      profileId, source: "health", sourceKey: dates[2]!,
    });
    expect(healthFence).not.toBeNull();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${dates[1]}T12:00:00.000Z`));
    try {
      await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
      const exercise = await prisma.exerciseCatalog.findUniqueOrThrow({
        where: { profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" } },
      });
      const program = await trainingService.createProgram({
        name: `${fixtureMethod}-shared-health-fence`,
        exercises: [{ catalogId: exercise.id, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
      }, profileId);
      const session = await trainingService.startSession(program.id, profileId, "Europe/Bratislava");
      deletedFixtureTrainingSourceKeys.add(String(session.id));
      await trainingService.createSet(session.id, session.exercises[0]!.id, {
        reps: 8, weightKg: 24, bandNominalResistanceKg: null, rir: 3,
        completedAt: `${dates[1]}T11:00:00.000Z`,
      }, profileId);
      await expect(trainingService.finishSession(session.id, profileId))
        .resolves.toMatchObject({ status: "COMPLETED" });
      const trainingFence = await lifecycle.readUnifiedPublicationBlockToken({
        profileId, source: "training", sourceKey: String(session.id),
      });
      expect(trainingFence).not.toBeNull();
      expect(await lifecycle.readUnifiedPublicationBlockToken({
        profileId, source: "health", sourceKey: dates[2]!,
      })).toEqual(healthFence);

      const stepperRepository = new StepperWorkoutRepository();
      const stepper = await stepperRepository.create({
        startAt: `${dates[2]}T08:00:00.000Z`, durationMinutes: 20, manualStepCount: 1_200,
      });
      deletedFixtureStepperSourceKeys.add(String(stepper.id));
      expect(stepper.modelPublicationStatus).toBe("stale");
      const stepperFence = await lifecycle.readUnifiedPublicationBlockToken({
        profileId, source: "stepper", sourceKey: String(stepper.id),
      });
      expect(stepperFence).not.toBeNull();
      expect(await lifecycle.readUnifiedPublicationBlockToken({
        profileId, source: "health", sourceKey: dates[2]!,
      })).toEqual(healthFence);
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow("Unified V4 is current");

      expect(await lifecycle.clearUnifiedPublicationBlock({
        profileId,
        source: "health",
        sourceKey: dates[2]!,
        expectedRevision: healthFence!.revision,
        expectedFromDate: healthFence!.fromDate,
      })).toBe(true);
      await runTrainingRefreshToCompletion(profileId);
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1 });
      const finalLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
      expect(finalLifecycle.unifiedRolloutEpoch).toBe(1);
      expect(await prisma.unifiedPublicationBlock.findMany({ where: { profileId } })).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("keeps V4 stale after failed candidate computation and surfaces the failure until retry succeeds", async () => {
    await seed({ productionGlycogenKg: [0.5, 0.6, 0] });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await verifyAndPublishUnifiedV3Postflight({ profileId });
    await activateAndReplayUnifiedV4({ profileId });
    const failUnifiedCandidate = vi.spyOn(unifiedStateService, "rebuildUnifiedExperimentalPhysiologyStateV1")
      .mockRejectedValueOnce(new Error("fixture candidate failure"));
    try {
      await expect(syncHealthWeightThroughService(dates[1]!, 79.5, `${dates[1]}T15:00:00.000Z`))
        .resolves.toMatchObject({ status: "ok", modelPublicationStatus: "stale" });
    } finally {
      failUnifiedCandidate.mockRestore();
    }
    const failed = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(failed).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 1,
      unifiedPublishedGeneration: null,
      unifiedPublishedRolloutEpoch: null,
      productionPublishedGeneration: failed.invalidationGeneration,
      productionStaleFromDate: null,
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).rejects.toThrow("Unified V4 is current");

    await syncHealthWeightThroughService(dates[1]!, 79.4, `${dates[1]}T16:00:00.000Z`);
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId })).resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 3 });
  });

  it("keeps daily and cumulative Relative Muscle diagnostics separate, invalidates the episode suffix, and rebuilds without numeric effects", async () => {
    await seed();
    const deltaFingerprint = "a".repeat(64);
    const cumulativeFingerprint = "b".repeat(64);
    await prisma.experimentalSkeletalMuscleDeltaShadow.create({
      data: {
        profileId, modelEpisodeId: episodeId!, date: dates[0]!,
        sourceFingerprint: deltaFingerprint,
        modelRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
        features: {},
        result: {
          contractVersion: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
          availability: "available", estimatedSkeletalMuscleDeltaKg: 0.021,
          support: { status: "outside-supported-domain" },
          state: { absoluteSkeletalMuscleKg: null, relativeCumulativeDeltaKg: 19.9 },
        },
      },
    });
    await prisma.experimentalCessationDetrainingShadow.create({
      data: {
        profileId, modelEpisodeId: episodeId!, date: dates[0]!,
        sourceFingerprint: cumulativeFingerprint,
        modelRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
        features: {},
        result: {
          contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
          availability: "available", estimatedSkeletalMuscleDeltaKg: -0.002,
          state: { absoluteSkeletalMuscleKg: null, relativeCumulativeDeltaKg: 0.71 },
        },
      },
    });

    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const first = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[0]! } },
    });
    const firstState = first.state as { relativeMuscle: Record<string, unknown>; slowTissue: unknown; glycogen: unknown; glycogenWater: unknown; transientWater: unknown };
    expect(firstState.relativeMuscle).toEqual({
      availability: "available",
      dailyTrainingSignalKg: 0.021,
      cumulativeDiagnosticKg: 0.71,
      supportStatus: "outside-supported-domain",
      authoritativeUse: "forbidden",
      reason: "relative diagnostic only; never added to body mass",
      dailySignalProvenance: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
      cumulativeProvenance: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
    });
    expect(JSON.stringify(firstState.relativeMuscle)).not.toMatch(/lower|upper|point/);
    expect((first.sourceLineage as { childOutputs: Array<{ kind: string; sourceFingerprint: string }> }).childOutputs)
      .toEqual(expect.arrayContaining([
        { kind: "relativeMuscleDaily", id: expect.any(Number), updatedAt: expect.any(String), sourceFingerprint: deltaFingerprint },
        { kind: "relativeMuscleCumulative", id: expect.any(Number), updatedAt: expect.any(String), sourceFingerprint: cumulativeFingerprint },
      ]));
    const firstProduction = await prisma.dailyModelState.findFirstOrThrow({
      where: { episodeId: episodeId!, date: dates[0]! }, select: { energyExpenditureKcal: true, energyBalanceKcal: true, dynamicRmrKcalPerDay: true, activityKcalPerDay: true },
    });
    const beforeSuffix = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[1]! } },
    });
    const beforeSuffixState = beforeSuffix.state as { slowTissue: unknown; glycogen: unknown; glycogenWater: unknown; transientWater: unknown };

    const dirty = await invalidateUnifiedRelativeMuscleSuffixV1({
      profileId,
      fromInstant: new Date(`${dates[1]}T12:00:00.000Z`),
    });
    expect(dirty).toEqual({ modelEpisodeId: episodeId, modelDate: dates[1] });
    const invalidatedLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(isProductionGenerationCurrentV1(invalidatedLifecycle)).toBe(true);
    expect(isUnifiedGenerationCurrentV1(invalidatedLifecycle)).toBe(false);

    const changedResult = {
      contractVersion: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
      availability: "available", estimatedSkeletalMuscleDeltaKg: 0.034,
      state: { absoluteSkeletalMuscleKg: null, relativeCumulativeDeltaKg: 88 },
    };
    await prisma.experimentalSkeletalMuscleDeltaShadow.create({
      data: {
        profileId, modelEpisodeId: episodeId!, date: dates[1]!, sourceFingerprint: "c".repeat(64),
        modelRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION, features: {}, result: changedResult,
      },
    });
    await prisma.experimentalCessationDetrainingShadow.create({
      data: {
        profileId, modelEpisodeId: episodeId!, date: dates[1]!, sourceFingerprint: "d".repeat(64),
        modelRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, features: {},
        result: {
          contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, availability: "available",
          estimatedSkeletalMuscleDeltaKg: 0.034,
          state: { absoluteSkeletalMuscleKg: null, relativeCumulativeDeltaKg: 0.744 },
        },
      },
    });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const suffix = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[1]! } },
    });
    const suffixState = suffix.state as { relativeMuscle: Record<string, unknown>; slowTissue: unknown; glycogen: unknown; glycogenWater: unknown; transientWater: unknown };
    expect(suffixState.relativeMuscle).toMatchObject({ dailyTrainingSignalKg: 0.034, cumulativeDiagnosticKg: 0.744 });
    expect(suffixState.relativeMuscle).not.toHaveProperty("absoluteSkeletalMuscleKg");
    expect(suffixState.slowTissue).toEqual(beforeSuffixState.slowTissue);
    expect(suffixState.glycogen).toEqual(beforeSuffixState.glycogen);
    expect(suffixState.glycogenWater).toEqual(beforeSuffixState.glycogenWater);
    expect(suffixState.transientWater).toEqual(beforeSuffixState.transientWater);
    expect(suffix.energyLedger).toEqual(beforeSuffix.energyLedger);
    expect(suffix.deltas).toEqual(beforeSuffix.deltas);
    expect(await prisma.dailyModelState.findFirstOrThrow({
      where: { episodeId: episodeId!, date: dates[0]! }, select: { energyExpenditureKcal: true, energyBalanceKcal: true, dynamicRmrKcalPerDay: true, activityKcalPerDay: true },
    })).toEqual(firstProduction);
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } }).then(isUnifiedGenerationCurrentV1))).toBe(true);

    await prisma.unifiedExperimentalPhysiologyStateV2.updateMany({
      where: { profileId, modelEpisodeId: episodeId! }, data: { modelRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION },
    });
    expect(await readLatestUnifiedExperimentalPhysiologyV2ForEpisode(prisma, {
      profileId, modelEpisodeId: episodeId!, throughDate: dates[2]!,
    })).toBeNull();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    expect((await rows()).every((row) => row.modelRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION)).toBe(true);
  }, 60_000);

  it("keeps the old V1 profile/date upsert usable beside separate V2 rows", async () => {
    const legacy = {
      profileId,
      date: dates[0],
      modelRevision: "legacy-unified-v1",
      sourceFingerprint: "legacy-before-v2",
      priorStateFingerprint: null,
      resultFingerprint: "legacy-result",
      qualityStatus: "partial",
      gapSeverity: "none",
      state: { legacy: true },
      deltas: {},
      uncertainty: {},
      reconciliation: {},
      energyLedger: {},
      sourceLineage: { source: "pre-v2" },
      diagnostics: {},
    };
    await prisma.unifiedExperimentalPhysiologyState.upsert({
      where: { profileId_date: { profileId, date: dates[0] } },
      create: legacy,
      update: legacy,
    });
    await seed();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    expect(await prisma.unifiedExperimentalPhysiologyState.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: dates[0] } },
    })).toMatchObject({ modelRevision: "legacy-unified-v1", sourceFingerprint: "legacy-before-v2", state: { legacy: true } });

    await prisma.unifiedExperimentalPhysiologyState.upsert({
      where: { profileId_date: { profileId, date: dates[0] } },
      create: { ...legacy, sourceFingerprint: "old-app-updated" },
      update: { sourceFingerprint: "old-app-updated" },
    });
    await prisma.unifiedExperimentalPhysiologyState.upsert({
      where: { profileId_date: { profileId, date: dates[1] } },
      create: { ...legacy, date: dates[1], sourceFingerprint: "old-app-created" },
      update: { sourceFingerprint: "old-app-created" },
    });
    expect(await prisma.unifiedExperimentalPhysiologyState.findMany({
      where: { profileId, date: { in: dates.slice(0, 2) } }, orderBy: { date: "asc" },
      select: { date: true, sourceFingerprint: true },
    })).toEqual([
      { date: dates[0], sourceFingerprint: "old-app-updated" },
      { date: dates[1], sourceFingerprint: "old-app-created" },
    ]);
    expect(await rows()).toHaveLength(3);
  });

  it("persists date-line episode days independently and gives Forecast the chronological episode-local donor", async () => {
    await prisma.profile.upsert({
      where: { id: profileId },
      create: { id: profileId, sex: "male", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"), heightCm: 180 },
      update: {},
    });
    const episodeBaseline = {
      ...episodeData,
      baselineWindowStartDate: dateLineDates[0]!,
      baselineWindowEndDate: dateLineDates[0]!,
    };
    const episodeOne = await prisma.modelEpisode.create({ data: {
      ...episodeBaseline,
      startDate: dateLineDates[0]!,
      timezone: "Pacific/Kiritimati",
      active: false,
      deactivatedAt: new Date(`${dateLineDates[2]}T12:00:00.000Z`),
    } });
    const episodeTwo = await prisma.modelEpisode.create({ data: {
      ...episodeBaseline,
      startDate: dateLineDates[2]!,
      timezone: "Etc/GMT+12",
      active: true,
      deactivatedAt: null,
    } });
    const dailyDataByDate = new Map<string, number>();
    for (const [index, date] of dateLineDates.entries()) {
      const health = await prisma.dailyHealthData.create({ data: {
        date,
        weightKg: 80 - index * 0.1,
        bodyFatPercent: 20,
        caloriesKcal: 2_200,
        proteinG: 160,
        fatG: 70,
        carbsG: 200 + index * 10,
        steps: 7_000,
        walkingDistanceKm: 5,
        workoutFeedObserved: true,
        rawPayload: {},
      } });
      dailyDataByDate.set(date, health.id);
    }
    for (const [episode, episodeDates] of [
      [episodeOne, dateLineDates],
      [episodeTwo, [dateLineDates[2]!, dateLineDates[3]!]],
    ] as const) {
      for (const date of episodeDates) {
        await prisma.dailyModelState.create({ data: {
          episodeId: episode.id,
          date,
          status: "complete",
          sourceQuality: {},
          missingFields: [],
          modelVersion: "bodycast-physiology-v6",
          dynamicRmrKcalPerDay: 1_700,
          tefKcalPerDay: 200,
          activityKcalPerDay: 800,
          adaptiveThermogenesisKcalPerDay: 0,
          energyIntakeKcal: 2_200,
          energyExpenditureKcal: 2_700,
          energyBalanceKcal: -500,
        } });
      }
    }
    const program = await prisma.trainingProgram.create({ data: { profileId, name: `${fixtureMethod}-date-line-program` } });
    const programVersion = await prisma.trainingProgramVersion.create({ data: { programId: program.id, versionNumber: 1 } });
    await prisma.trainingProgram.update({ where: { id: program.id }, data: { currentVersionId: programVersion.id } });
    const eventAt = new Date(`${dateLineDates[2]}T11:00:00.000Z`);
    const session = await prisma.strengthDiarySession.create({ data: {
      profileId,
      programId: program.id,
      programVersionId: programVersion.id,
      status: "COMPLETED",
      entryMode: "LIVE",
      webStartedAt: eventAt,
      effectiveAccountingAt: eventAt,
      accountingTimeZone: "Pacific/Kiritimati",
      accountingTimeZoneProvenance: "test",
      matchStatus: "UNMATCHED",
      exercises: { create: [{
        snapshotExerciseName: "Hyperextension",
        sortOrder: 1,
        plannedSets: 1,
        resistanceType: "EXTERNAL_WEIGHT",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
        sets: { create: [{ setNumber: 1, reps: 10, weightKg: 20, rir: 1, completedAt: eventAt }] },
      }] },
    } });
    const unlinkedModelDate = dateLineDates[2]!;
    await rebuildRelativeMuscleEpisodeTrajectories({ profileId, fromDate: unlinkedModelDate });
    const relativeBeforeUnlinked = await prisma.experimentalSkeletalMuscleDeltaShadow.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeTwo.id, date: unlinkedModelDate } },
      select: { sourceFingerprint: true },
    });
    await recordExperimentalLocalHypertrophyResponseShadow({ date: unlinkedModelDate, profileId });
    const weekStartDate = utcMondayWeekStart(unlinkedModelDate);
    const hypertrophyBeforeUnlinked = await prisma.experimentalLocalHypertrophyResponseShadow.findUniqueOrThrow({
      where: { profileId_weekStartDate: { profileId, weekStartDate } }, select: { result: true },
    });
    const unlinkedSessionAt = new Date(`${dateLineDates[2]}T13:00:00.000Z`);
    const unlinkedSession = await prisma.strengthDiarySession.create({ data: {
      profileId,
      status: "COMPLETED",
      entryMode: "RETROSPECTIVE",
      effectiveAccountingAt: unlinkedSessionAt,
      // Deliberately different from the episode timezone. Model routing must
      // use the episode-local date, matching Unified's chronological reader.
      accountingTimeZone: "Pacific/Kiritimati",
      accountingTimeZoneProvenance: "integration-fixture",
      matchStatus: "UNMATCHED",
      exercises: { create: [{
        snapshotExerciseName: "Programless historical extension",
        sortOrder: 0,
        plannedSets: 1,
        resistanceType: "EXTERNAL_WEIGHT",
        origin: "EXTRA",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
        sets: { create: [{ setNumber: 1, reps: 10, weightKg: 20, rir: 1, completedAt: unlinkedSessionAt }] },
      }] },
    } });
    fixtureUnlinkedSessionIds.add(unlinkedSession.id);
    await strengthGlycogenDemandShadowService.recordExperimentalStrengthGlycogenDemandShadowBySessionId({
      sessionId: unlinkedSession.id, profileId,
    });
    await glycogenStateShadowService.rebuildExperimentalGlycogenStateShadows({
      profileId, fromDate: unlinkedModelDate, toDate: unlinkedModelDate,
    });
    const unlinkedDayGlycogen = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: unlinkedModelDate } }, select: { result: true },
    });
    expect((unlinkedDayGlycogen.result as { sourceLineage: { strengthDemandShadows: Array<{ sessionId: number }> } })
      .sourceLineage.strengthDemandShadows).toContainEqual(expect.objectContaining({ sessionId: unlinkedSession.id }));
    await recordExperimentalLocalHypertrophyResponseShadow({ date: unlinkedModelDate, profileId });
    const hypertrophyAfterUnlinked = await prisma.experimentalLocalHypertrophyResponseShadow.findUniqueOrThrow({
      where: { profileId_weekStartDate: { profileId, weekStartDate } }, select: { result: true },
    });
    expect((hypertrophyAfterUnlinked.result as { features: { sessionCount: number } }).features.sessionCount)
      .toBe((hypertrophyBeforeUnlinked.result as { features: { sessionCount: number } }).features.sessionCount + 1);
    await rebuildRelativeMuscleEpisodeTrajectories({ profileId, fromDate: unlinkedModelDate });
    const relativeAfterUnlinked = await prisma.experimentalSkeletalMuscleDeltaShadow.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeTwo.id, date: unlinkedModelDate } },
      select: { sourceFingerprint: true, features: true },
    });
    expect(relativeAfterUnlinked.sourceFingerprint).not.toBe(relativeBeforeUnlinked.sourceFingerprint);
    expect(relativeAfterUnlinked.features).toMatchObject({ lineage: { episodeId: episodeTwo.id, modelDate: unlinkedModelDate } });
    expect(dailyDataByDate.size).toBe(4);
    // Publish the deliberately hand-seeded production fixture after source
    // writes so database invalidation triggers are reflected in its generation.
    const existingLifecycle = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId } });
    if (existingLifecycle === null) {
      await prisma.physiologyV7Lifecycle.create({
        data: {
          profileId,
          staleFromDate: null,
          currentThroughDate: dateLineDates[3]!,
          invalidationGeneration: 1,
          productionStaleFromDate: null,
          productionPublishedGeneration: 1,
          unifiedPublishedGeneration: null,
          ...currentPhysiologyV7Versions,
        },
      });
    } else {
      await prisma.physiologyV7Lifecycle.update({
        where: { profileId },
        data: {
          productionStaleFromDate: null,
          productionPublishedGeneration: existingLifecycle.invalidationGeneration,
          unifiedPublishedGeneration: null,
          currentThroughDate: dateLineDates[3]!,
          ...currentPhysiologyV7Versions,
        },
      });
    }
    expect(isProductionGenerationCurrentV1(await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } }))).toBe(true);
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dateLineDates[0], toDate: dateLineDates[3] });

    const allEpisodeRows = await prisma.unifiedExperimentalPhysiologyStateV2.findMany({
      where: { profileId, modelEpisodeId: { in: [episodeOne.id, episodeTwo.id] }, date: { in: [dateLineDates[2]!, dateLineDates[3]!] } },
      orderBy: { boundaryAt: "asc" },
    });
    const requestedSequence = allEpisodeRows.filter((row) => (
      (row.modelEpisodeId === episodeOne.id && row.date === dateLineDates[2])
      || (row.modelEpisodeId === episodeOne.id && row.date === dateLineDates[3])
      || (row.modelEpisodeId === episodeTwo.id && row.date === dateLineDates[2])
    ));
    expect(requestedSequence.map(({ modelEpisodeId, date, boundaryAt }) => [modelEpisodeId, date, boundaryAt.toISOString()])).toEqual([
      [episodeOne.id, dateLineDates[2], `${dateLineDates[1]}T10:00:00.000Z`],
      [episodeOne.id, dateLineDates[3], `${dateLineDates[2]}T10:00:00.000Z`],
      [episodeTwo.id, dateLineDates[2], `${dateLineDates[2]}T12:00:00.000Z`],
    ]);
    expect(new Set(allEpisodeRows.map((row) => `${row.modelEpisodeId}|${row.date}`)).size).toBe(allEpisodeRows.length);

    const episodeOneNextDay = requestedSequence[1]!.state as { transientWater: { activeImpulses: Array<{ impulse: { strengthDiarySessionId: number }; ageModelDays: number }> } };
    const episodeTwoFirstDay = requestedSequence[2]!.state as { transientWater: { activeImpulses: Array<{ impulse: { strengthDiarySessionId: number }; ageModelDays: number }> } };
    expect(episodeOneNextDay.transientWater.activeImpulses).toMatchObject([{ impulse: { strengthDiarySessionId: session.id }, ageModelDays: 0 }]);
    expect(episodeTwoFirstDay.transientWater.activeImpulses).toEqual(expect.arrayContaining([
      expect.objectContaining({ impulse: expect.objectContaining({ strengthDiarySessionId: session.id }), ageModelDays: 1 }),
      expect.objectContaining({ impulse: expect.objectContaining({ strengthDiarySessionId: unlinkedSession.id }), ageModelDays: 0 }),
    ]));
    const unlinkedUnifiedDay = allEpisodeRows.find((row) => row.modelEpisodeId === episodeTwo.id && row.date === unlinkedModelDate);
    expect((unlinkedUnifiedDay?.sourceLineage as { diarySessions: Array<{ id: number }> }).diarySessions)
      .toContainEqual(expect.objectContaining({ id: unlinkedSession.id }));

    const forecastDonor = await readLatestUnifiedExperimentalPhysiologyV2ForEpisode(prisma, {
      profileId, modelEpisodeId: episodeTwo.id, throughDate: dateLineDates[2]!,
    });
    expect(forecastDonor).toMatchObject({ modelEpisodeId: episodeTwo.id, date: dateLineDates[2]!, boundaryAt: new Date(`${dateLineDates[2]}T12:00:00.000Z`) });

    const duplicate = Object.fromEntries(Object.entries(requestedSequence[0]!).filter(([key]) => key !== "id"));
    await expect(prisma.unifiedExperimentalPhysiologyStateV2.create({
      data: duplicate as unknown as Prisma.UnifiedExperimentalPhysiologyStateV2UncheckedCreateInput,
    })).rejects.toMatchObject({ code: "P2002" });
    await prisma.unifiedExperimentalPhysiologyState.upsert({
      where: { profileId_date: { profileId, date: dateLineDates[2]! } },
      create: {
        profileId,
        date: dateLineDates[2]!,
        modelRevision: "legacy-unified-v1",
        sourceFingerprint: "date-line-v1",
        priorStateFingerprint: null,
        resultFingerprint: "date-line-v1-result",
        qualityStatus: "partial",
        gapSeverity: "none",
        state: { legacy: true },
        deltas: {},
        uncertainty: {},
        reconciliation: {},
        energyLedger: {},
        sourceLineage: {},
        diagnostics: {},
      },
      update: { sourceFingerprint: "date-line-v1-updated" },
    });
    expect(await prisma.unifiedExperimentalPhysiologyState.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: dateLineDates[2]! } }, select: { sourceFingerprint: true },
    })).toEqual({ sourceFingerprint: "date-line-v1" });
  });

  it("matches a clean full rebuild after a historical mutation and chronological suffix rebuild", async () => {
    await seed();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const prefixBefore = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[0] } },
      select: { updatedAt: true, resultFingerprint: true },
    });
    await prisma.dailyHealthData.update({ where: { date: dates[1] }, data: { carbsG: 310 } });
    await publishSeededProductionFixture();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const prefixAfter = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[0] } },
      select: { updatedAt: true, resultFingerprint: true },
    });
    expect(prefixAfter).toEqual(prefixBefore);
    const suffix = trajectory(await rows(dates[1], dates[2]));

    await clean();
    await seed();
    await prisma.dailyHealthData.update({ where: { date: dates[1] }, data: { carbsG: 310 } });
    await publishSeededProductionFixture();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    expect(trajectory(await rows(dates[1], dates[2]))).toEqual(suffix);
  });

  it("matches a clean full rebuild after a historical source delete and suffix rebuild", async () => {
    await seed();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const prefixBefore = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[0] } },
      select: { updatedAt: true, resultFingerprint: true },
    });
    await prisma.dailyHealthData.delete({ where: { date: dates[1] } });
    await publishSeededProductionFixture();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const prefixAfter = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[0] } },
      select: { updatedAt: true, resultFingerprint: true },
    });
    expect(prefixAfter).toEqual(prefixBefore);
    const suffix = trajectory(await rows(dates[1], dates[2]));

    await clean();
    await seed();
    await prisma.dailyHealthData.delete({ where: { date: dates[1] } });
    await publishSeededProductionFixture();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    expect(trajectory(await rows(dates[1], dates[2]))).toEqual(suffix);
  });

  it("is deterministic on repeated rebuild and shuffled durable ingestion", async () => {
    await seed();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const ordered = trajectory(await rows());
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    expect(trajectory(await rows())).toEqual(ordered);

    await clean();
    await seed({ order: [...dates].reverse() });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    expect(trajectory(await rows())).toEqual(ordered);
  });

  it("keeps historical Unified rows unchanged when a future source day is added", async () => {
    await seed();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const before = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({ where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[0] } } });
    await addFutureDay();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: futureDate });
    const after = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({ where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[0] } } });
    expect({ state: after.state, deltas: after.deltas, sourceFingerprint: after.sourceFingerprint, resultFingerprint: after.resultFingerprint, updatedAt: after.updatedAt })
      .toEqual({ state: before.state, deltas: before.deltas, sourceFingerprint: before.sourceFingerprint, resultFingerprint: before.resultFingerprint, updatedAt: before.updatedAt });
  });

  it("does not use an incompatible predecessor and invalidates suffix on child fingerprint change", async () => {
    await seed();
    await prisma.experimentalGlycogenStateShadow.create({
      data: {
        profileId,
        date: dates[1],
        sourceFingerprint: "child-fingerprint-a",
        modelRevision: "experimental-glycogen-state-v2",
        features: {},
        result: {
          availability: "available",
          state: { availability: "available", relativeDeviationKg: -0.1, relativeDeviationLowerKg: -0.1, relativeDeviationUpperKg: -0.1 },
          netGlycogenDeltaKg: -0.05,
          netGlycogenDeltaLowerKg: -0.05,
          netGlycogenDeltaUpperKg: -0.05,
        },
      },
    });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const first = await rows();
    await prisma.unifiedExperimentalPhysiologyStateV2.update({ where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[0] } }, data: { modelRevision: "old-unified-revision" } });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const afterOldRevision = await rows();
    expect(afterOldRevision[0]!.modelRevision).toBe(UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION);
    expect(afterOldRevision[1]!.priorStateFingerprint).toBe(afterOldRevision[0]!.resultFingerprint);

    await prisma.experimentalGlycogenStateShadow.update({ where: { profileId_date: { profileId, date: dates[1] } }, data: { sourceFingerprint: "child-fingerprint-b" } });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const afterChildChange = await rows();
    expect(afterChildChange[0]!.resultFingerprint).toBe(first[0]!.resultFingerprint);
    expect(afterChildChange[1]!.sourceFingerprint).not.toBe(first[1]!.sourceFingerprint);
    expect(afterChildChange[1]!.resultFingerprint).not.toBe(first[1]!.resultFingerprint);
    expect(afterChildChange[2]!.priorStateFingerprint).toBe(afterChildChange[1]!.resultFingerprint);
    expect(afterChildChange[0]!.modelRevision).toBe(UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION);
  });

  it("invalidates only Unified currentness atomically without staling production TDEE", async () => {
    await seed();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const beforeLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    const beforeRow = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[0] } },
      select: { updatedAt: true },
    });
    expect(isUnifiedGenerationCurrentV1(beforeLifecycle)).toBe(true);

    await expect(prisma.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).invalidateUnifiedPublication(profileId);
      throw new Error("intentional rollback");
    })).rejects.toThrow("intentional rollback");
    const rolledBackLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(rolledBackLifecycle.unifiedPublishedGeneration).toBe(beforeLifecycle.unifiedPublishedGeneration);
    expect(rolledBackLifecycle.updatedAt).toEqual(beforeLifecycle.updatedAt);

    await prisma.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).invalidateUnifiedPublication(profileId);
    });

    const afterLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    const afterRow = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episodeId!, date: dates[0] } },
      select: { updatedAt: true },
    });
    expect(afterLifecycle.unifiedPublishedGeneration).toBeNull();
    expect(afterLifecycle.invalidationGeneration).toBe(beforeLifecycle.invalidationGeneration);
    expect(afterLifecycle.productionStaleFromDate).toBeNull();
    expect(afterLifecycle.productionPublishedGeneration).toBe(beforeLifecycle.productionPublishedGeneration);
    expect(afterLifecycle.updatedAt.getTime()).toBeGreaterThan(beforeLifecycle.updatedAt.getTime());
    expect(isUnifiedGenerationCurrentV1(afterLifecycle)).toBe(false);
    expect(afterRow.updatedAt).toEqual(beforeRow.updatedAt);
  });

  it("rejects a late Unified candidate after a concurrent source mutation and newer publication", async () => {
    await seed();
    await prisma.experimentalGlycogenAssociatedWaterShadow.create({
      data: {
        profileId,
        date: dates[1],
        sourceFingerprint: "water-shadow-before-race",
        modelRevision: "experimental-glycogen-associated-water-v1",
        features: {},
        result: { estimatedGlycogenWaterDeltaKg: 0.1, lowerBoundKg: 0.05, upperBoundKg: 0.15 },
      },
    });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    let candidateReady!: () => void;
    let releaseCandidate!: () => void;
    const ready = new Promise<void>((resolve) => { candidateReady = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseCandidate = resolve; });
    const staleWriter = rebuildUnifiedExperimentalPhysiologyStateV1({
      profileId,
      fromDate: dates[1],
      toDate: dates[2],
      onCandidateComputed: async () => { candidateReady(); await blocked; },
    });
    await ready;

    const beforeMutation = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(isProductionGenerationCurrentV1(beforeMutation)).toBe(true);

    await prisma.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      await tx.experimentalGlycogenAssociatedWaterShadow.update({
        where: { profileId_date: { profileId, date: dates[1] } },
        data: {
          sourceFingerprint: "water-shadow-after-race",
          result: { estimatedGlycogenWaterDeltaKg: 0.2, lowerBoundKg: 0.1, upperBoundKg: 0.3 },
        },
      });
      await new PhysiologyV7PersistenceRepository(tx).invalidateUnifiedPublication(profileId);
    });
    const invalidated = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(isUnifiedGenerationCurrentV1(invalidated)).toBe(false);
    expect(isProductionGenerationCurrentV1(invalidated)).toBe(true);
    expect({
      productionStaleFromDate: invalidated.productionStaleFromDate,
      invalidationGeneration: invalidated.invalidationGeneration,
      productionPublishedGeneration: invalidated.productionPublishedGeneration,
    }).toEqual({
      productionStaleFromDate: null,
      invalidationGeneration: beforeMutation.invalidationGeneration,
      productionPublishedGeneration: beforeMutation.productionPublishedGeneration,
    });

    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const published = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(isUnifiedGenerationCurrentV1(published)).toBe(true);
    releaseCandidate();
    await expect(staleWriter).rejects.toBeInstanceOf(PhysiologyV7ConcurrentSourceChangeError);
    expect(isUnifiedGenerationCurrentV1(await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } }))).toBe(true);
  });
});
