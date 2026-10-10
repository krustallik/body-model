import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FULL_HISTORY_REBUILT_DERIVED_TABLES,
  FULL_HISTORY_RAW_INPUT_TABLES,
  inventoryFullHistoryRawInputs,
} from "@/modules/model-episodes/full-history-recalculation.service";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.BODYCAST_RECOVERY_TEST_DATABASE_URL);

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const metricPrefix = `full-history-${process.pid}-${Math.floor(Math.random() * 1_000_000)}-`;
const episodeProfileId = 1;
const fixtureMethod = `full-history-raw-input-inventory-${process.pid}-${Math.floor(Math.random() * 1_000_000)}`;
const sampleTimestamp = new Date("2098-01-01T00:00:00.000Z");
const sampleCount = 251;
let profileCreated = false;

describe("full-history raw-input inventory PostgreSQL", () => {
  beforeAll(async () => {
    const existingProfile = await prisma.profile.findUnique({ where: { id: episodeProfileId } });
    if (!existingProfile) {
      await prisma.profile.create({
        data: {
          id: episodeProfileId,
          sex: "male",
          dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
          heightCm: new Prisma.Decimal("180.00"),
        },
      });
      profileCreated = true;
    }
    await prisma.modelEpisode.create({
      data: {
        profileId: episodeProfileId,
        startDate: "2098-01-01",
        timezone: "UTC",
        modelVersion: "bodycast-physiology-v6",
        active: false,
        deactivatedAt: new Date("2098-01-02T00:00:00.000Z"),
        ecfPolicy: "hold-ecf",
        baselineEnergyIntakeKcalPerDay: 2_400,
        baselineCarbIntakeG: 220,
        baselineWindowStartDate: "2097-12-25",
        baselineWindowEndDate: "2097-12-31",
        baselineNutritionDayCount: 7,
        baselineWeightObservationCount: 3,
        baselineWeightTrendKgPerWeek: 0,
        baselineWeightTrendPercentPerWeek: 0,
        baselineDerivationMethod: fixtureMethod,
        baselineNutritionFallback: { caloriesKcal: 2_400, carbsG: 220 },
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
      },
    });
    await prisma.healthMetricSample.createMany({
      data: Array.from({ length: sampleCount }, (_, index) => ({
        date: "2098-01-01",
        metric: `${metricPrefix}${index}`,
        source: "isolated-preservation-fixture",
        timestamp: new Date(sampleTimestamp.getTime() + index),
        value: new Prisma.Decimal("71.2500000000"),
      })),
    });
  });

  afterAll(async () => {
    await prisma.healthMetricSample.deleteMany({ where: { metric: { startsWith: metricPrefix } } });
    await prisma.modelEpisode.deleteMany({
      where: { profileId: episodeProfileId, baselineDerivationMethod: fixtureMethod },
    });
    if (profileCreated) {
      await prisma.profile.delete({ where: { id: episodeProfileId } });
    }
    await prisma.$disconnect();
  });

  it("covers primary health, nutrition, workout, strength, and provenance tables", () => {
    expect(FULL_HISTORY_RAW_INPUT_TABLES).toEqual(expect.arrayContaining([
      "DailyHealthData",
      "ModelEpisode",
      "HealthMetricSample",
      "HeartRateSample",
      "RestingHeartRateSample",
      "SleepSegment",
      "HealthSyncSnapshot",
      "HealthSyncAudit",
      "HealthActivityInterval",
      "Workout",
      "StrengthDiarySession",
      "StrengthSessionExercise",
      "StrengthSet",
      "WorkInterval",
      "StepperReconciliationGroup",
      "StepperReconciliationCandidate",
    ]));
    expect(FULL_HISTORY_REBUILT_DERIVED_TABLES).toEqual(expect.arrayContaining([
      "StrengthSessionAccountingOperation",
      "ActiveEnergyCanonicalEvent",
      "ActiveEnergyEventAlias",
      "ActiveEnergyCandidate",
      "ActiveEnergyResolutionRevision",
    ]));
    for (const derivedTable of FULL_HISTORY_REBUILT_DERIVED_TABLES) {
      expect(FULL_HISTORY_RAW_INPUT_TABLES).not.toContain(derivedTable);
    }
  });

  it("pages through more than 250 PostgreSQL rows and detects a second-page value change", async () => {
    const before = await inventoryFullHistoryRawInputs(prisma);
    const beforeTable = before.tables.find((table) => table.table === "HealthMetricSample");
    const databaseRowCount = await prisma.healthMetricSample.count();
    expect(await prisma.healthMetricSample.count({ where: { metric: { startsWith: metricPrefix } } }))
      .toBe(sampleCount);
    expect(beforeTable?.rowCount).toBeGreaterThanOrEqual(sampleCount);
    expect(beforeTable?.rowCount).toBe(databaseRowCount);

    const lastFixtureRow = await prisma.healthMetricSample.findFirstOrThrow({
      where: { metric: { startsWith: metricPrefix } },
      orderBy: { id: "desc" },
      select: { id: true, timestamp: true, value: true },
    });
    expect(lastFixtureRow.id).toBeGreaterThanOrEqual(250);

    await prisma.healthMetricSample.update({
      where: { id: lastFixtureRow.id },
      data: { value: new Prisma.Decimal("71.2500000001") },
    });

    const after = await inventoryFullHistoryRawInputs(prisma);
    const afterTable = after.tables.find((table) => table.table === "HealthMetricSample");
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(afterTable?.contentSha256).not.toBe(beforeTable?.contentSha256);
    expect(await prisma.healthMetricSample.findUniqueOrThrow({ where: { id: lastFixtureRow.id } }))
      .toMatchObject({ id: lastFixtureRow.id, timestamp: lastFixtureRow.timestamp });
  });

  it("fingerprints frozen ModelEpisode initialization inputs but excludes recalculated outputs", async () => {
    const fixtureEpisodes = await prisma.modelEpisode.findMany({
      where: { profileId: episodeProfileId, baselineDerivationMethod: fixtureMethod },
    });
    expect(fixtureEpisodes).toHaveLength(1);
    const episode = fixtureEpisodes[0]!;
    const before = await inventoryFullHistoryRawInputs(prisma);

    await prisma.modelEpisode.update({
      where: { id: episode.id },
      data: { initialGlycogenKg: 0.6 },
    });
    const sourceChanged = await inventoryFullHistoryRawInputs(prisma);
    const sourceChangedTable = sourceChanged.tables.find((table) => table.table === "ModelEpisode");
    const beforeTable = before.tables.find((table) => table.table === "ModelEpisode");
    expect(sourceChanged.fingerprint).not.toBe(before.fingerprint);
    expect(sourceChangedTable?.contentSha256).not.toBe(beforeTable?.contentSha256);

    await prisma.modelEpisode.update({
      where: { id: episode.id },
      data: {
        personalOffsetKcalPerDay: 125,
        activityCalibration: 1.1,
        calibrationStatus: "offset-only",
        calibrationDiagnostics: { recalculated: true },
        latestModeledDate: "2098-01-02",
      },
    });
    const derivedChanged = await inventoryFullHistoryRawInputs(prisma);
    expect(derivedChanged.fingerprint).toBe(sourceChanged.fingerprint);
  });
});
