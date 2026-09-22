import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V1_REVISION } from "@/model/unified-experimental-physiology-v1";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const profileId = 1;
const fixtureMethod = "unified-state-v1-verification";
const dates = ["2071-01-01", "2071-01-02", "2071-01-03"];
const futureDate = "2071-01-04";

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
  const allDates = [...dates, futureDate];
  await prisma.unifiedExperimentalPhysiologyState.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalGlycogenStateShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalGlycogenAssociatedWaterShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.experimentalFfmRetentionShadow.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.fatWeightShadowV1Result.deleteMany({ where: { profileId, date: { in: allDates } } });
  await prisma.dailyModelState.deleteMany({ where: { date: { in: allDates }, episode: { baselineDerivationMethod: fixtureMethod } } });
  await prisma.modelEpisode.deleteMany({ where: { profileId, baselineDerivationMethod: fixtureMethod } });
  await deleteDailyHealthRows(prisma, allDates);
}

async function seed(input: { order?: readonly string[]; withWorkouts?: boolean } = {}): Promise<void> {
  await prisma.profile.upsert({
    where: { id: profileId },
    create: { id: profileId, sex: "male", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"), heightCm: 180 },
    update: {},
  });
  const episode = await prisma.modelEpisode.create({ data: episodeData });
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
  expect(health.id).toBeTypeOf("number");
}

function trajectory(rows: ReadonlyArray<Awaited<ReturnType<typeof prisma.unifiedExperimentalPhysiologyState.findMany>>[number]>): unknown[] {
  return rows.map((row) => ({ date: row.date, state: row.state, deltas: row.deltas, qualityStatus: row.qualityStatus, gapSeverity: row.gapSeverity, energyLedger: row.energyLedger }));
}

async function rows(fromDate = dates[0], toDate = dates[dates.length - 1]) {
  return prisma.unifiedExperimentalPhysiologyState.findMany({
    where: { profileId, date: { gte: fromDate, lte: toDate } },
    orderBy: { date: "asc" },
  });
}

describe("UnifiedExperimentalPhysiologyStateV1 PostgreSQL lifecycle", () => {
  beforeEach(async () => {
    await clean();
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("persists one row per date with lineage and non-overlapping energy accounting", async () => {
    await seed({ withWorkouts: true });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    const stored = await rows();

    expect(stored).toHaveLength(3);
    expect(new Set(stored.map((row) => row.date)).size).toBe(3);
    expect(stored.every((row) => row.modelRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V1_REVISION)).toBe(true);
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

  it("matches a clean full rebuild after a historical mutation and suffix rebuild", async () => {
    await seed();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await prisma.dailyHealthData.update({ where: { date: dates[1] }, data: { carbsG: 310 } });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const suffix = trajectory(await rows(dates[1], dates[2]));

    await clean();
    await seed();
    await prisma.dailyHealthData.update({ where: { date: dates[1] }, data: { carbsG: 310 } });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    expect(trajectory(await rows(dates[1], dates[2]))).toEqual(suffix);
  });

  it("matches a clean full rebuild after a historical source delete and suffix rebuild", async () => {
    await seed();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: dates[2] });
    await prisma.dailyHealthData.delete({ where: { date: dates[1] } });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const suffix = trajectory(await rows(dates[1], dates[2]));

    await clean();
    await seed();
    await prisma.dailyHealthData.delete({ where: { date: dates[1] } });
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
    const before = await prisma.unifiedExperimentalPhysiologyState.findUniqueOrThrow({ where: { profileId_date: { profileId, date: dates[0] } } });
    await addFutureDay();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[0], toDate: futureDate });
    const after = await prisma.unifiedExperimentalPhysiologyState.findUniqueOrThrow({ where: { profileId_date: { profileId, date: dates[0] } } });
    expect({ state: after.state, deltas: after.deltas, sourceFingerprint: after.sourceFingerprint, resultFingerprint: after.resultFingerprint }).toEqual({ state: before.state, deltas: before.deltas, sourceFingerprint: before.sourceFingerprint, resultFingerprint: before.resultFingerprint });
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
    await prisma.unifiedExperimentalPhysiologyState.update({ where: { profileId_date: { profileId, date: dates[0] } }, data: { modelRevision: "old-unified-revision" } });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const afterOldRevision = await rows();
    expect(afterOldRevision[1]!.priorStateFingerprint).not.toBe(first[0]!.resultFingerprint);

    await prisma.experimentalGlycogenStateShadow.update({ where: { profileId_date: { profileId, date: dates[1] } }, data: { sourceFingerprint: "child-fingerprint-b" } });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate: dates[1], toDate: dates[2] });
    const afterChildChange = await rows();
    expect(afterChildChange[0]!.resultFingerprint).toBe(first[0]!.resultFingerprint);
    expect(afterChildChange[1]!.sourceFingerprint).not.toBe(first[1]!.sourceFingerprint);
    expect(afterChildChange[1]!.resultFingerprint).not.toBe(first[1]!.resultFingerprint);
    expect(afterChildChange[2]!.priorStateFingerprint).toBe(afterChildChange[1]!.resultFingerprint);
    expect(afterChildChange[0]!.modelRevision).toBe("old-unified-revision");
  });
});
