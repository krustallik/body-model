import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION } from "@/model/unified-experimental-physiology-v1";
import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";
import { currentPhysiologyV7Versions } from "@/modules/model-episodes/physiology-v7-persistence";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import { PhysiologyV7ConcurrentSourceChangeError, PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { isProductionGenerationCurrentV1, isUnifiedGenerationCurrentV1 } from "@/modules/model-episodes/publication-generation-v1";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import { readLatestUnifiedExperimentalPhysiologyV2ForEpisode } from "@/modules/experimental-forecast-v1/service";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const databaseUrl = process.env.DATABASE_URL;
const isolatedDatabase = requireIsolatedStage01Database(databaseUrl, process.env.BODYCAST_STAGE01_MODE, "test");
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const profileId = 1;
const fixtureMethod = "unified-state-v1-verification";
const dates = ["2071-01-01", "2071-01-02", "2071-01-03"];
const futureDate = "2071-01-04";
const dateLineDates = ["2100-01-01", "2100-01-02", "2100-01-03", "2100-01-04"];
let lifecycleBeforeSuite: Awaited<ReturnType<typeof prisma.physiologyV7Lifecycle.findUnique>> | null = null;
let lifecycleSnapshotCaptured = false;
let episodeId: number | null = null;

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
  const fixtureEpisodes = await prisma.modelEpisode.findMany({
    where: { profileId, baselineDerivationMethod: fixtureMethod }, select: { id: true },
  });
  const fixturePrograms = await prisma.trainingProgram.findMany({
    where: { profileId, name: { startsWith: `${fixtureMethod}-date-line` } }, select: { id: true },
  });
  const fixtureSessions = fixturePrograms.length === 0 ? [] : await prisma.strengthDiarySession.findMany({
    where: { profileId, programId: { in: fixturePrograms.map(({ id }) => id) } }, select: { id: true },
  });
  await prisma.experimentalTransientExerciseWaterShadow.deleteMany({
    where: { profileId, sessionId: { in: fixtureSessions.map(({ id }) => id) } },
  });
  await prisma.unifiedExperimentalPhysiologyStateV2.deleteMany({
    where: { OR: [{ profileId, date: { in: allDates } }, { modelEpisodeId: { in: fixtureEpisodes.map(({ id }) => id) } }] },
  });
  await prisma.unifiedExperimentalPhysiologyState.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalGlycogenStateShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalGlycogenAssociatedWaterShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalFfmRetentionShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.fatWeightShadowV1Result.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.dailyModelState.deleteMany({ where: { date: { in: allDates }, episode: { baselineDerivationMethod: fixtureMethod } } });
  await prisma.strengthDiarySession.deleteMany({ where: { id: { in: fixtureSessions.map(({ id }) => id) } } });
  await prisma.trainingProgram.deleteMany({ where: { id: { in: fixturePrograms.map(({ id }) => id) } } });
  await prisma.modelEpisode.deleteMany({ where: { profileId, baselineDerivationMethod: fixtureMethod } });
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
      currentThroughDate: dates[dates.length - 1],
      ...currentPhysiologyV7Versions,
    },
  });
}

async function seed(input: { order?: readonly string[]; withWorkouts?: boolean } = {}): Promise<void> {
  await prisma.profile.upsert({
    where: { id: profileId },
    create: { id: profileId, sex: "male", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"), heightCm: 180 },
    update: {},
  });
  const episode = await prisma.modelEpisode.create({ data: episodeData });
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

describe("UnifiedExperimentalPhysiologyStateV1 PostgreSQL lifecycle", () => {
  beforeAll(() => {
    expect(isolatedDatabase.databaseName).toBe("bodycast_training_history_stage01_test");
  });

  beforeEach(async () => {
    if (!lifecycleSnapshotCaptured) {
      lifecycleBeforeSuite = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId } });
      lifecycleSnapshotCaptured = true;
    }
    await clean();
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
    expect(stored.every((row) => row.modelRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION)).toBe(true);
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
      deactivatedAt: new Date("2100-01-03T12:00:00.000Z"),
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
    const eventAt = new Date("2100-01-03T11:00:00.000Z");
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
      [episodeOne.id, dateLineDates[2], "2100-01-02T10:00:00.000Z"],
      [episodeOne.id, dateLineDates[3], "2100-01-03T10:00:00.000Z"],
      [episodeTwo.id, dateLineDates[2], "2100-01-03T12:00:00.000Z"],
    ]);
    expect(new Set(allEpisodeRows.map((row) => `${row.modelEpisodeId}|${row.date}`)).size).toBe(allEpisodeRows.length);

    const episodeOneNextDay = requestedSequence[1]!.state as { transientWater: { activeImpulses: Array<{ impulse: { strengthDiarySessionId: number }; ageModelDays: number }> } };
    const episodeTwoFirstDay = requestedSequence[2]!.state as { transientWater: { activeImpulses: Array<{ impulse: { strengthDiarySessionId: number }; ageModelDays: number }> } };
    expect(episodeOneNextDay.transientWater.activeImpulses).toMatchObject([{ impulse: { strengthDiarySessionId: session.id }, ageModelDays: 0 }]);
    expect(episodeTwoFirstDay.transientWater.activeImpulses).toMatchObject([{ impulse: { strengthDiarySessionId: session.id }, ageModelDays: 1 }]);

    const forecastDonor = await readLatestUnifiedExperimentalPhysiologyV2ForEpisode(prisma, {
      profileId, modelEpisodeId: episodeTwo.id, throughDate: dateLineDates[2]!,
    });
    expect(forecastDonor).toMatchObject({ modelEpisodeId: episodeTwo.id, date: dateLineDates[2]!, boundaryAt: new Date("2100-01-03T12:00:00.000Z") });

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
    expect(afterOldRevision[0]!.modelRevision).toBe(UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION);
    expect(afterOldRevision[1]!.priorStateFingerprint).toBe(afterOldRevision[0]!.resultFingerprint);

    await prisma.experimentalGlycogenStateShadow.update({ where: { profileId_date: { profileId, date: dates[1] } }, data: { sourceFingerprint: "child-fingerprint-b" } });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const afterChildChange = await rows();
    expect(afterChildChange[0]!.resultFingerprint).toBe(first[0]!.resultFingerprint);
    expect(afterChildChange[1]!.sourceFingerprint).not.toBe(first[1]!.sourceFingerprint);
    expect(afterChildChange[1]!.resultFingerprint).not.toBe(first[1]!.resultFingerprint);
    expect(afterChildChange[2]!.priorStateFingerprint).toBe(afterChildChange[1]!.resultFingerprint);
    expect(afterChildChange[0]!.modelRevision).toBe(UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION);
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
