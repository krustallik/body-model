/**
 * PostgreSQL fixture matrix A–I for shadow historical as-of / rebuild contracts.
 * Exercises real Prisma persistence + shadow services (not pure-function doubles).
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { estimateExperimentalBodyRecompositionV1 } from "@/model/physiology-v7/experimental-body-recomposition-v1";
import { rebuildExperimentalGlycogenStateShadows } from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import {
  rebuildAuthoritativeRelativeMuscleTrajectory,
  recordExperimentalCessationDetrainingShadow,
} from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import { recordExperimentalSkeletalMuscleDeltaShadow } from "@/modules/model-episodes/experimental-skeletal-muscle-delta-shadow.service";
import { rebuildExperimentalFatWeightUncertaintyV1 } from "@/modules/model-episodes/experimental-fat-weight-uncertainty-shadow.service";
import { rebuildFatWeightShadowV1 } from "@/modules/model-episodes/fat-weight-shadow-v1.service";
import { recordExperimentalStrengthEnergyShadow } from "@/modules/training/experimental-strength-energy-shadow.service";
import { RESISTANCE } from "@/modules/training/training.constants";
import { TrainingService } from "@/modules/training/training.service";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const training = new TrainingService(prisma);
const profileId = 1;
const PROGRAM = "gap-matrix-ai-program";
const DATES = [
  "2061-03-01",
  "2061-03-02",
  "2061-03-03",
  "2061-03-04",
  "2061-03-05",
] as const;
const D1 = DATES[0];
const D2 = DATES[1];
const D3 = DATES[2];
const D4 = DATES[3];
const D5 = DATES[4];

type CessationRow = {
  date: string;
  sourceFingerprint: string;
  result: {
    estimatedSkeletalMuscleDeltaKg?: number | null;
    detrainingContributionKg?: number | null;
    state?: { relativeCumulativeDeltaKg?: number | null };
    gapContext?: { gapLengthDays?: number; fingerprint?: string };
    features?: { trainingExposureKind?: string; coverageState?: string };
  };
};

type SmRow = {
  date: string;
  sourceFingerprint: string;
  result: {
    estimatedSkeletalMuscleDeltaKg?: number | null;
    features?: { trainingExposureKind?: string };
    state?: { relativeCumulativeDeltaKg?: number | null };
  };
};

async function cleanShadows(): Promise<void> {
  const dates = [...DATES];
  await prisma.experimentalStrengthEnergyShadow.deleteMany({
    where: { profileId, session: { OR: [
      { webStartedAt: { gte: new Date(`${D1}T00:00:00.000Z`), lt: new Date("2061-03-06T00:00:00.000Z") } },
      { matchedWorkout: { dailyHealthData: { date: { in: dates } } } },
    ] } },
  });
  await prisma.experimentalStrengthGlycogenDemandShadow.deleteMany({
    where: { profileId, session: { OR: [
      { webStartedAt: { gte: new Date(`${D1}T00:00:00.000Z`), lt: new Date("2061-03-06T00:00:00.000Z") } },
      { matchedWorkout: { dailyHealthData: { date: { in: dates } } } },
    ] } },
  });
  await prisma.experimentalTransientExerciseWaterShadow.deleteMany({
    where: { profileId, session: { OR: [
      { webStartedAt: { gte: new Date(`${D1}T00:00:00.000Z`), lt: new Date("2061-03-06T00:00:00.000Z") } },
      { matchedWorkout: { dailyHealthData: { date: { in: dates } } } },
    ] } },
  });
  await prisma.experimentalGlycogenStateShadow.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.experimentalGlycogenAssociatedWaterShadow.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.experimentalGlycogenRepletionShadow.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.experimentalCessationDetrainingShadow.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.experimentalFfmRetentionShadow.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.experimentalLocalHypertrophyResponseShadow.deleteMany({
    where: { profileId, weekStartDate: { in: dates } },
  });
  await prisma.experimentalFatWeightUncertaintyShadow.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.fatWeightShadowV1Result.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.physiologyV7ShadowDiagnostic.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.heartRateSample.deleteMany({
    where: { profileId, timestamp: { gte: new Date(`${D1}T00:00:00.000Z`), lt: new Date("2061-03-06T00:00:00.000Z") } },
  });
  await prisma.sleepSegment.deleteMany({
    where: { profileId, startAt: { gte: new Date(`${D1}T00:00:00.000Z`), lt: new Date("2061-03-06T00:00:00.000Z") } },
  });
}

async function cleanTraining(): Promise<void> {
  await prisma.strengthSet.deleteMany({
    where: { sessionExercise: { session: { program: { name: PROGRAM } } } },
  });
  await prisma.strengthSessionExercise.deleteMany({
    where: { session: { program: { name: PROGRAM } } },
  });
  await prisma.strengthDiarySession.deleteMany({ where: { program: { name: PROGRAM } } });
  await prisma.programExercise.deleteMany({
    where: { programVersion: { program: { name: PROGRAM } } },
  });
  await prisma.trainingProgram.updateMany({
    where: { name: PROGRAM },
    data: { currentVersionId: null },
  });
  await prisma.trainingProgramVersion.deleteMany({ where: { program: { name: PROGRAM } } });
  await prisma.trainingProgram.deleteMany({ where: { name: PROGRAM } });
  // Do not delete shared seated_dumbbell_press catalog rows owned by other fixtures.
}

async function cleanHealth(): Promise<void> {
  await prisma.healthSyncSnapshot.deleteMany({ where: { date: { in: [...DATES] } } });
  await prisma.dailyModelState.deleteMany({
    where: { date: { in: [...DATES] }, episode: { profileId, baselineDerivationMethod: "gap-matrix-ai" } },
  });
  await prisma.modelEpisode.deleteMany({
    where: { profileId, baselineDerivationMethod: "gap-matrix-ai" },
  });
  await deleteDailyHealthRows(prisma, [...DATES, "2061-02-28"]);
}

async function cleanAll(): Promise<void> {
  await cleanShadows();
  await cleanTraining();
  await cleanHealth();
}

async function ensureHealth(date: string, overrides: {
  weightKg?: number | null;
  bodyFatPercent?: number | null;
  carbsG?: number | null;
  proteinG?: number | null;
  activeEnergyKcal?: number | null;
  workoutFeedObserved?: boolean | null;
} = {}): Promise<void> {
  await prisma.dailyHealthData.upsert({
    where: { date },
    create: {
      date,
      weightKg: overrides.weightKg === undefined ? null : overrides.weightKg,
      bodyFatPercent: overrides.bodyFatPercent === undefined ? null : overrides.bodyFatPercent,
      carbsG: overrides.carbsG === undefined ? 200 : overrides.carbsG,
      proteinG: overrides.proteinG === undefined ? 150 : overrides.proteinG,
      activeEnergyKcal: overrides.activeEnergyKcal === undefined ? 400 : overrides.activeEnergyKcal,
      workoutFeedObserved: overrides.workoutFeedObserved === undefined ? true : overrides.workoutFeedObserved,
      rawPayload: {},
    },
    update: {
      weightKg: overrides.weightKg === undefined ? undefined : overrides.weightKg,
      bodyFatPercent: overrides.bodyFatPercent === undefined ? undefined : overrides.bodyFatPercent,
      carbsG: overrides.carbsG === undefined ? undefined : overrides.carbsG,
      proteinG: overrides.proteinG === undefined ? undefined : overrides.proteinG,
      activeEnergyKcal: overrides.activeEnergyKcal === undefined ? undefined : overrides.activeEnergyKcal,
      workoutFeedObserved: overrides.workoutFeedObserved === undefined ? undefined : overrides.workoutFeedObserved,
    },
  });
}

async function ensureProgram() {
  const catalog = await prisma.exerciseCatalog.findFirst({
    where: { profileId, stableKey: "seated_dumbbell_press", isActive: true },
  }) ?? await prisma.exerciseCatalog.create({
    data: {
      profileId,
      name: "gap-matrix-ai-press",
      stableKey: "seated_dumbbell_press",
      isActive: true,
    },
  });
  const existing = await prisma.trainingProgram.findFirst({ where: { name: PROGRAM, profileId } });
  if (existing) {
    return { programId: existing.id, catalogId: catalog.id };
  }
  const program = await training.createProgram({
    name: PROGRAM,
    exercises: [{
      catalogId: catalog.id,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
    }],
  }, profileId);
  return { programId: program.id, catalogId: catalog.id };
}

async function createFinishedTrainingDay(date: string, setCount = 3, health: {
  weightKg?: number | null;
} = { weightKg: 80 }): Promise<number> {
  await ensureHealth(date, {
    workoutFeedObserved: true,
    weightKg: health.weightKg === undefined ? 80 : health.weightKg,
    proteinG: 150,
    carbsG: 200,
    activeEnergyKcal: 400,
  });
  const { programId } = await ensureProgram();
  // Force session timestamps onto the target calendar day via webStartedAt.
  const session = await training.startSession(programId, profileId);
  await prisma.strengthDiarySession.update({
    where: { id: session.id },
    data: {
      webStartedAt: new Date(`${date}T17:00:00.000Z`),
      webEndedAt: new Date(`${date}T18:00:00.000Z`),
    },
  });
  const refreshed = await training.getSession(session.id, profileId);
  const exerciseId = refreshed!.exercises[0]!.id;
  for (let index = 0; index < setCount; index += 1) {
    await training.createSet(session.id, exerciseId, {
      reps: 8 + index,
      weightKg: 40 + index,
    }, profileId);
  }
  await training.finishSession(session.id, profileId);
  const completed = await training.getSession(session.id, profileId);
  // finishSession isolates shadow failures; fixtures assert persistence explicitly.
  await recordExperimentalStrengthEnergyShadow({ session: completed!, profileId });
  return session.id;
}

async function createRestDay(date: string): Promise<void> {
  await ensureHealth(date, { workoutFeedObserved: true, weightKg: 80 });
  await recordExperimentalSkeletalMuscleDeltaShadow({ date, profileId });
  await recordExperimentalCessationDetrainingShadow({ date, profileId });
}

async function createMissingCoverageDay(date: string): Promise<void> {
  await ensureHealth(date, { workoutFeedObserved: null, weightKg: null, carbsG: null, proteinG: null, activeEnergyKcal: null });
  await recordExperimentalSkeletalMuscleDeltaShadow({ date, profileId });
  await recordExperimentalCessationDetrainingShadow({ date, profileId });
}

async function cessationRows(from: string = D1, to: string = D5): Promise<CessationRow[]> {
  const rows = await prisma.experimentalCessationDetrainingShadow.findMany({
    where: { profileId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
  return rows.map((row) => ({
    date: row.date,
    sourceFingerprint: row.sourceFingerprint,
    result: row.result as CessationRow["result"],
  }));
}

async function smRows(from: string = D1, to: string = D5): Promise<SmRow[]> {
  const rows = await prisma.experimentalSkeletalMuscleDeltaShadow.findMany({
    where: { profileId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
  return rows.map((row) => ({
    date: row.date,
    sourceFingerprint: row.sourceFingerprint,
    result: row.result as SmRow["result"],
  }));
}

function expectTrajectoryEqual(left: CessationRow[], right: CessationRow[]) {
  expect(left.map((row) => row.date)).toEqual(right.map((row) => row.date));
  for (let index = 0; index < left.length; index += 1) {
    expect(left[index]!.sourceFingerprint).toBe(right[index]!.sourceFingerprint);
    expect(left[index]!.result.state?.relativeCumulativeDeltaKg)
      .toBe(right[index]!.result.state?.relativeCumulativeDeltaKg);
    expect(left[index]!.result.gapContext?.fingerprint)
      .toBe(right[index]!.result.gapContext?.fingerprint);
  }
}

async function seedEnergyBalance(dates: readonly string[]): Promise<void> {
  await prisma.modelEpisode.updateMany({
    where: { profileId, active: true },
    data: { active: false, deactivatedAt: new Date() },
  });
  const episode = await prisma.modelEpisode.create({
    data: {
      profileId,
      startDate: dates[0]!,
      timezone: "Europe/Bratislava",
      modelVersion: "bodycast-physiology-v6",
      active: true,
      ecfPolicy: "hold-ecf",
      baselineEnergyIntakeKcalPerDay: 2_500,
      baselineCarbIntakeG: 250,
      baselineWindowStartDate: dates[0]!,
      baselineWindowEndDate: dates[0]!,
      baselineNutritionDayCount: 1,
      baselineWeightObservationCount: 1,
      baselineWeightTrendKgPerWeek: 0,
      baselineWeightTrendPercentPerWeek: 0,
      baselineDerivationMethod: "gap-matrix-ai",
      initialFatMassKg: 16,
      initialLeanTissueKg: 55,
      initialGlycogenKg: 0.5,
      baselineExtracellularFluidLiters: 18,
      initialExtracellularFluidDeviationLiters: 0,
      initialAdaptiveThermogenesisKcalPerDay: 0,
      initialFilteredWeightKg: 80,
      initialWeightFilterVarianceKg2: 1,
      initialRmrKcalPerDay: 1_261.2,
      dynamicRmrFatCoefficient: 3.2,
      dynamicRmrLeanCoefficient: 22,
      dynamicRmrCalibrationOffsetKcalPerDay: 0,
      adaptiveThermogenesisBeta: 0.14,
      adaptiveThermogenesisTimeConstantDays: 14,
      weightProcessNoiseVarianceKg2PerDay: 0.01,
      weightMeasurementNoiseVarianceKg2: 0.25,
      calibrationDiagnostics: {},
    },
  });
  for (const date of dates) {
    await prisma.dailyModelState.upsert({
      where: { episodeId_date: { episodeId: episode.id, date } },
      create: {
        episodeId: episode.id,
        date,
        status: "complete",
        sourceQuality: {},
        missingFields: [],
        modelVersion: "bodycast-physiology-v6",
        energyBalanceKcal: -100,
        energyIntakeKcal: 2_400,
        energyExpenditureKcal: 2_500,
        fatMassKg: 16,
        leanTissueKg: 55,
      },
      update: {
        status: "complete",
        energyBalanceKcal: -100,
      },
    });
  }
}

async function seedEpisodeForFat(dates: readonly string[]) {
  await prisma.modelEpisode.updateMany({
    where: { profileId, active: true },
    data: { active: false, deactivatedAt: new Date() },
  });
  const episode = await prisma.modelEpisode.create({
    data: {
      profileId,
      startDate: dates[0]!,
      timezone: "Europe/Bratislava",
      modelVersion: "bodycast-physiology-v6",
      active: true,
      ecfPolicy: "hold-ecf",
      baselineEnergyIntakeKcalPerDay: 2_500,
      baselineCarbIntakeG: 250,
      baselineWindowStartDate: dates[0]!,
      baselineWindowEndDate: dates[0]!,
      baselineNutritionDayCount: 1,
      baselineWeightObservationCount: 1,
      baselineWeightTrendKgPerWeek: 0,
      baselineWeightTrendPercentPerWeek: 0,
      baselineDerivationMethod: "gap-matrix-ai",
      initialFatMassKg: 16,
      initialLeanTissueKg: 55,
      initialGlycogenKg: 0.5,
      baselineExtracellularFluidLiters: 18,
      initialExtracellularFluidDeviationLiters: 0,
      initialAdaptiveThermogenesisKcalPerDay: 0,
      initialFilteredWeightKg: 80,
      initialWeightFilterVarianceKg2: 1,
      initialRmrKcalPerDay: 1_261.2,
      dynamicRmrFatCoefficient: 3.2,
      dynamicRmrLeanCoefficient: 22,
      dynamicRmrCalibrationOffsetKcalPerDay: 0,
      adaptiveThermogenesisBeta: 0.14,
      adaptiveThermogenesisTimeConstantDays: 14,
      weightProcessNoiseVarianceKg2PerDay: 0.01,
      weightMeasurementNoiseVarianceKg2: 0.25,
      calibrationDiagnostics: {},
    },
  });
  for (const date of dates) {
    await prisma.dailyModelState.create({
      data: {
        episodeId: episode.id,
        date,
        status: "complete",
        sourceQuality: {},
        missingFields: [],
        modelVersion: "bodycast-physiology-v6",
        energyBalanceKcal: -200,
        energyIntakeKcal: 2_300,
        energyExpenditureKcal: 2_500,
        fatMassKg: 16,
        leanTissueKg: 55,
      },
    });
  }
  return episode.id;
}

describe("PostgreSQL shadow gap future-asof matrix A–I", () => {
  beforeAll(async () => {
    await cleanAll();
  });
  afterAll(async () => {
    await cleanAll();
    await prisma.$disconnect();
  });

  it("A — future weight does not alter historical strength active-energy", async () => {
    await cleanAll();
    // Historical as-of mass fallback must come from a prior day, never D5.
    await prisma.dailyHealthData.upsert({
      where: { date: "2061-02-28" },
      create: { date: "2061-02-28", weightKg: 78, rawPayload: {}, workoutFeedObserved: true },
      update: { weightKg: 78 },
    });
    const sessionId = await createFinishedTrainingDay(D1, 3, { weightKg: null });
    const before = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({
      where: { sessionId },
    });
    const beforeResult = before.result as {
      estimatedActiveKcal?: number | null;
      lowerBoundKcal?: number | null;
      upperBoundKcal?: number | null;
      features?: { bodyMassKg?: number | null };
      activeEnergyResolution?: { provenance?: string };
    };
    expect(beforeResult.features?.bodyMassKg).toBe(78);

    await ensureHealth(D5, { weightKg: 120, workoutFeedObserved: true });
    const session = await training.getSession(sessionId, profileId);
    await recordExperimentalStrengthEnergyShadow({ session: session!, profileId });
    const after = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({
      where: { sessionId },
    });
    const afterResult = after.result as typeof beforeResult;
    expect(after.sourceFingerprint).toBe(before.sourceFingerprint);
    expect(afterResult.estimatedActiveKcal).toBe(beforeResult.estimatedActiveKcal);
    expect(afterResult.lowerBoundKcal).toBe(beforeResult.lowerBoundKcal);
    expect(afterResult.upperBoundKcal).toBe(beforeResult.upperBoundKcal);
    expect(afterResult.features?.bodyMassKg).toBe(78);
    expect(afterResult.features?.bodyMassKg).not.toBe(120);
  });

  it("B — future V7/glycogen state does not leak into historical D1 glycogen", async () => {
    await cleanAll();
    await ensureHealth(D1, {
      carbsG: 180,
      proteinG: 140,
      activeEnergyKcal: 500,
      workoutFeedObserved: true,
    });
    await rebuildExperimentalGlycogenStateShadows({ profileId, fromDate: D1, toDate: D1 });
    const before = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: D1 } },
    });

    await ensureHealth(D5, {
      carbsG: 400,
      proteinG: 200,
      activeEnergyKcal: 900,
      workoutFeedObserved: true,
    });
    await prisma.physiologyV7DailyResult.upsert({
      where: { profileId_date: { profileId, date: D5 } },
      create: {
        profileId,
        date: D5,
        sourceFingerprint: "future-v7-fixture-source",
        priorStateFingerprint: "future-v7-fixture-prior",
        resultFingerprint: "future-v7-fixture-result",
        stateVersion: "gap-matrix-future-v7",
        dailyRuntimeVersion: "gap-matrix-future-v7",
        rangeRebuildVersion: "gap-matrix-future-v7",
        rebuildServiceVersion: "gap-matrix-future-v7",
        sourceNormalizationVersion: "gap-matrix-future-v7",
        result: {
          resultingState: {
            compartments: {
              glycogenWaterKg: { availability: "available", valueKg: 9.9 },
            },
          },
        },
      },
      update: {
        result: {
          resultingState: {
            compartments: {
              glycogenWaterKg: { availability: "available", valueKg: 9.9 },
            },
          },
        },
      },
    });
    await rebuildExperimentalGlycogenStateShadows({ profileId, fromDate: D5, toDate: D5 });
    await rebuildExperimentalGlycogenStateShadows({ profileId, fromDate: D1, toDate: D1 });
    const after = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: D1 } },
    });
    expect(after.sourceFingerprint).toBe(before.sourceFingerprint);
    expect(after.result).toEqual(before.result);
  });

  it("C — future body-composition observation does not rewrite D1 fat-uncertainty", async () => {
    await cleanAll();
    await ensureHealth(D1, { weightKg: 80, bodyFatPercent: 18, workoutFeedObserved: true });
    await seedEpisodeForFat([D1, D5]);
    await rebuildFatWeightShadowV1({ profileId, fromDate: D1, toDate: D1 });
    await rebuildExperimentalFatWeightUncertaintyV1({ profileId, fromDate: D1, toDate: D1 });
    const before = await prisma.experimentalFatWeightUncertaintyShadow.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: D1 } },
    });

    await ensureHealth(D5, { weightKg: 79, bodyFatPercent: 12, workoutFeedObserved: true });
    await rebuildFatWeightShadowV1({ profileId, fromDate: D5, toDate: D5 });
    await rebuildExperimentalFatWeightUncertaintyV1({ profileId, fromDate: D5, toDate: D5 });
    await rebuildExperimentalFatWeightUncertaintyV1({ profileId, fromDate: D1, toDate: D1 });
    const after = await prisma.experimentalFatWeightUncertaintyShadow.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: D1 } },
    });
    expect(after.sourceFingerprint).toBe(before.sourceFingerprint);
    expect(after.result).toEqual(before.result);
  });

  it("D — future activity/workout does not alter D1 glycogen state", async () => {
    await cleanAll();
    await ensureHealth(D1, {
      carbsG: 200,
      proteinG: 150,
      activeEnergyKcal: 450,
      workoutFeedObserved: true,
    });
    await rebuildExperimentalGlycogenStateShadows({ profileId, fromDate: D1, toDate: D1 });
    const before = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: D1 } },
    });

    await ensureHealth(D5, { workoutFeedObserved: true, carbsG: 220, activeEnergyKcal: 700 });
    await prisma.workout.create({
      data: {
        dailyHealthDataId: (await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: D5 } })).id,
        type: "Traditional Strength Training",
        startAt: new Date(`${D5}T17:00:00.000Z`),
        endAt: new Date(`${D5}T18:00:00.000Z`),
        durationMinutes: 60,
        activeEnergyKcal: 300,
        externalId: "gap-matrix-future-activity",
        sourceIdentity: "ext:gap-matrix-future-activity",
      },
    });
    await rebuildExperimentalGlycogenStateShadows({ profileId, fromDate: D1, toDate: D1 });
    const after = await prisma.experimentalGlycogenStateShadow.findUniqueOrThrow({
      where: { profileId_date: { profileId, date: D1 } },
    });
    expect(after.sourceFingerprint).toBe(before.sourceFingerprint);
    expect(after.result).toEqual(before.result);
  });

  it("E — future HR does not alter D1 energy; sleep/context DB consumers N/A where pure-only", async () => {
    await cleanAll();
    await ensureHealth(D1, { weightKg: 80, workoutFeedObserved: true });
    const sessionId = await createFinishedTrainingDay(D1);
    const before = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({
      where: { sessionId },
    });

    await ensureHealth(D5, { workoutFeedObserved: true });
    const d5Health = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: D5 } });
    await prisma.heartRateSample.create({
      data: {
        profileId,
        date: D5,
        timestamp: new Date(`${D5}T12:00:00.000Z`),
        bpm: 180,
        source: "gap-matrix-future-hr",
        dailyHealthDataId: d5Health.id,
      },
    });
    const session = await training.getSession(sessionId, profileId);
    await recordExperimentalStrengthEnergyShadow({ session: session!, profileId });
    const after = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({
      where: { sessionId },
    });
    expect(after.sourceFingerprint).toBe(before.sourceFingerprint);
    expect(after.result).toEqual(before.result);

    // Evidence: chronic sleep / personal-energy calibration / measurement-validation
    // remain pure contracts with no experimental_* persistence tables or shadow
    // services under src/modules. Mark those exact subcases N/A rather than inventing
    // meaningless DB round-trips.
    const { readdirSync } = await import("node:fs");
    const moduleFiles = readdirSync("src/modules", { recursive: true }).map(String);
    expect(moduleFiles.some((path) => /chronic-sleep.*shadow/i.test(path))).toBe(false);
    expect(moduleFiles.some((path) => /personal-energy-calibration.*shadow/i.test(path))).toBe(false);
    expect(moduleFiles.some((path) => /measurement-validation.*shadow/i.test(path))).toBe(false);
  });

  it("F — authoritative muscle suffix rebuild matches clean full rebuild for D3–D5", async () => {
    await cleanAll();
    await seedEnergyBalance(DATES);
    await createFinishedTrainingDay(D1, 3);
    await createRestDay(D2);
    const d3SessionId = await createFinishedTrainingDay(D3, 2);
    await createRestDay(D4);
    await createFinishedTrainingDay(D5, 3);
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: D1, profileId });

    // Correct D3 source: add another qualifying set, then suffix-rebuild from D3.
    const d3 = await training.getSession(d3SessionId, profileId);
    await training.createSet(d3SessionId, d3!.exercises[0]!.id, {
      reps: 10,
      weightKg: 50,
    }, profileId);
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: D3, profileId });
    const suffix = await cessationRows(D3, D5);
    const suffixSm = await smRows(D3, D5);

    await prisma.experimentalCessationDetrainingShadow.deleteMany({
      where: { profileId, date: { in: [...DATES] } },
    });
    await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({
      where: { profileId, date: { in: [...DATES] } },
    });
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: D1, profileId });
    const full = await cessationRows(D3, D5);
    const fullSm = await smRows(D3, D5);

    expectTrajectoryEqual(suffix, full);
    expect(suffixSm.map((row) => row.sourceFingerprint))
      .toEqual(fullSm.map((row) => row.sourceFingerprint));
    expect(suffixSm.map((row) => row.result.estimatedSkeletalMuscleDeltaKg))
      .toEqual(fullSm.map((row) => row.result.estimatedSkeletalMuscleDeltaKg));
  });

  it("G — shuffled durable history yields identical chronological authoritative muscle state", async () => {
    await cleanAll();
    await seedEnergyBalance(DATES);
    // Seed the same logical history regardless of creation order.
    const orderA = [D1, D2, D3, D4, D5] as const;
    for (const date of orderA) {
      if (date === D1 || date === D3 || date === D5) await createFinishedTrainingDay(date, 3);
      else await createRestDay(date);
    }
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: D1, profileId });
    const chronological = await cessationRows();

    await prisma.experimentalCessationDetrainingShadow.deleteMany({
      where: { profileId, date: { in: [...DATES] } },
    });
    await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({
      where: { profileId, date: { in: [...DATES] } },
    });
    // Same durable sources; rebuild from shuffled day visitation still ends chronological.
    for (const date of [D5, D2, D4, D1, D3] as const) {
      await recordExperimentalSkeletalMuscleDeltaShadow({ date, profileId });
      await recordExperimentalCessationDetrainingShadow({ date, profileId });
    }
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: D1, profileId });
    const shuffled = await cessationRows();
    expectTrajectoryEqual(shuffled, chronological);
  });

  it("H — repeated rebuild is deterministic and does not accumulate", async () => {
    await cleanAll();
    await seedEnergyBalance(DATES);
    await createFinishedTrainingDay(D1, 3);
    await createRestDay(D2);
    await createFinishedTrainingDay(D3, 3);
    await createRestDay(D4);
    await createFinishedTrainingDay(D5, 3);
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: D1, profileId });
    const first = await cessationRows();
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: D1, profileId });
    const second = await cessationRows();
    expectTrajectoryEqual(first, second);
    expect(await prisma.experimentalCessationDetrainingShadow.count({
      where: { profileId, date: { in: [...DATES] } },
    })).toBe(5);
  });

  it("I — historical D2 diary backfill rebuilds D2–D5 once and matches clean full rebuild", async () => {
    await cleanAll();
    await seedEnergyBalance(DATES);
    await createFinishedTrainingDay(D1, 3);
    await createMissingCoverageDay(D2);
    await createRestDay(D3);
    await createFinishedTrainingDay(D4, 3);
    await createRestDay(D5);
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: D1, profileId });
    const beforeD2 = (await smRows(D2, D2))[0]!;
    expect(beforeD2.result.features?.trainingExposureKind).toBe("unresolved-missing-training");
    const beforeCumulative = (await cessationRows(D5, D5))[0]!.result.state?.relativeCumulativeDeltaKg;

    // Enter real BodyCast diary training for the previously missing D2.
    await createFinishedTrainingDay(D2, 3);
    // Suffix rebuild from D2 (mirrors completion/health-sync post-batch behavior).
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: D2, profileId });
    const suffix = await cessationRows(D2, D5);
    const suffixSm = await smRows(D2, D5);
    expect(suffixSm[0]!.result.features?.trainingExposureKind).toBe("qualified-mapped-training");
    expect(suffixSm[0]!.result.estimatedSkeletalMuscleDeltaKg).not.toBeNull();
    expect(suffix.at(-1)!.result.state?.relativeCumulativeDeltaKg).not.toBe(beforeCumulative);

    const d1Cessation = (await cessationRows(D1, D1))[0]!;
    const recomposition = estimateExperimentalBodyRecompositionV1({
      fatStart: {
        fatMassKg: 16,
        slowNonFatKg: 55,
        availability: "available",
        provenance: "episode-bia-derived-estimate",
        uncertainty: "personal-unavailable",
      },
      fatEnd: {
        fatMassKg: 15.5,
        slowNonFatKg: 55.2,
        availability: "available",
        provenance: "episode-bia-derived-estimate",
        uncertainty: "personal-unavailable",
      },
      skeletalMuscleStart: {
        availability: "available",
        state: { relativeCumulativeDeltaKg: d1Cessation.result.state?.relativeCumulativeDeltaKg ?? null },
      },
      skeletalMuscleEnd: {
        availability: "available",
        state: {
          relativeCumulativeDeltaKg: suffix.at(-1)!.result.state?.relativeCumulativeDeltaKg ?? null,
        },
      },
    });
    expect(recomposition.relativeSkeletalMuscleDeltaKg).not.toBeNull();
    expect(recomposition.absoluteSkeletalMuscleKg).toBeNull();

    await prisma.experimentalCessationDetrainingShadow.deleteMany({
      where: { profileId, date: { in: [...DATES] } },
    });
    await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({
      where: { profileId, date: { in: [...DATES] } },
    });
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: D1, profileId });
    const full = await cessationRows(D2, D5);
    expectTrajectoryEqual(suffix, full);

    // Stale previous D2 unresolved row is replaced; only one current row per date.
    expect(await prisma.experimentalSkeletalMuscleDeltaShadow.count({
      where: { profileId, date: D2 },
    })).toBe(1);
  });
});
