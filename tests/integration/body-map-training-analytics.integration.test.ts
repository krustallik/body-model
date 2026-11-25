import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";

const isolatedDatabase = requireIsolatedStage01Database(
  process.env.DATABASE_URL,
  process.env.BODYCAST_STAGE01_MODE,
  "test",
);
const { prisma } = await import("@/lib/db/prisma");
const { currentPhysiologyV7Versions } = await import("@/modules/model-episodes/physiology-v7-persistence");
const { readBodyMapTrainingAnalyticsV1 } = await import("@/modules/training/body-map-training-analytics.repository");
const { TrainingService } = await import("@/modules/training/training.service");
const { recordRefactorObservation } = await import("../refactor-comparator/capture");

const ENERGY_PROFILE_ID = 991_399;
const ASSESSMENT_PROFILE_ID = 991_398;
const FOREIGN_PROFILE_ID = 991_400;
const FIXED_TIME = new Date("2026-03-30T12:00:00.000Z");
const FIXED_TIMESTAMP = new Date("2026-03-30T12:00:00.000Z");
const EARLY_DATES = Array.from({ length: 28 }, (_, index) => {
  const date = new Date("2025-09-30T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});
const LATE_DATES = Array.from({ length: 28 }, (_, index) => {
  const date = new Date("2026-03-03T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});
let episodeId: number | null = null;
const assessmentSessionIds: number[] = [];
const fixtureProfileIds: number[] = [];

async function createReservedProfile(id: number): Promise<void> {
  if (await prisma.profile.findUnique({ where: { id }, select: { id: true } })) {
    throw new Error(`Comparator analytics fixture profile ${id} already exists; refusing to reuse it.`);
  }
  await prisma.profile.create({
    data: { id, createdAt: FIXED_TIMESTAMP, updatedAt: FIXED_TIMESTAMP },
  });
    fixtureProfileIds.push(id);
}

async function createSession(input: {
  profileId: number;
  status: "ACTIVE" | "COMPLETED";
  sessionIntent?: string | null;
}) {
  const instant = new Date("2026-03-28T10:00:00.000Z");
  const session = await prisma.strengthDiarySession.create({
    data: {
      profileId: input.profileId,
      status: input.status,
      entryMode: "LIVE",
      sessionIntent: input.sessionIntent ?? null,
      sessionLoadAssessment: null,
      webStartedAt: instant,
      webEndedAt: input.status === "COMPLETED" ? new Date("2026-03-28T10:45:00.000Z") : null,
      effectiveAccountingAt: instant,
      accountingTimeZone: "UTC",
      accountingTimeZoneProvenance: "explicit",
      createdAt: instant,
      updatedAt: instant,
    },
  });
  assessmentSessionIds.push(session.id);
  return session;
}

describe("Body Map and Training persistence contracts on exact isolated PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const identity = await prisma.$queryRaw<Array<{ databaseName: string; databaseUser: string }>>`
      SELECT current_database() AS "databaseName", current_user AS "databaseUser"
    `;
    if (identity[0]?.databaseName !== isolatedDatabase.databaseName || identity[0]?.databaseUser !== isolatedDatabase.role) {
      throw new Error("Body Map analytics fixture connected outside the exact Stage 01 comparator database identity.");
    }
    const existing = await prisma.profile.findMany({
      where: { id: { in: [ENERGY_PROFILE_ID, ASSESSMENT_PROFILE_ID, FOREIGN_PROFILE_ID] } },
      select: { id: true },
    });
    if (existing.length > 0) throw new Error("Comparator analytics fixture profile IDs are not clean; refusing to mutate them.");
    for (const id of [ENERGY_PROFILE_ID, ASSESSMENT_PROFILE_ID, FOREIGN_PROFILE_ID]) await createReservedProfile(id);
  }, 30_000);

  afterAll(async () => {
    try {
      if (fixtureProfileIds.includes(ASSESSMENT_PROFILE_ID) && assessmentSessionIds.length > 0) {
        await prisma.strengthDiarySession.deleteMany({ where: { id: { in: assessmentSessionIds } } });
      }
      if (fixtureProfileIds.includes(ENERGY_PROFILE_ID) && episodeId !== null) {
        await prisma.dailyModelState.deleteMany({ where: { episodeId } });
        await prisma.modelEpisode.deleteMany({ where: { id: episodeId, profileId: ENERGY_PROFILE_ID } });
      }
      if (fixtureProfileIds.includes(ENERGY_PROFILE_ID)) {
        await prisma.dailyHealthData.deleteMany({ where: { profileId: ENERGY_PROFILE_ID, date: { in: [...EARLY_DATES, ...LATE_DATES] } } });
      }
      // Source and completed-session triggers invalidate V7; clear those rows after all fixture cleanup.
      if (fixtureProfileIds.length > 0) {
        await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId: { in: fixtureProfileIds } } });
      }
      if (fixtureProfileIds.length > 0) await prisma.profile.deleteMany({ where: { id: { in: fixtureProfileIds } } });
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  it("projects observed model energy through the authenticated profile's isolated PostgreSQL rows", async () => {
    const episode = await prisma.modelEpisode.create({
      data: {
        profileId: ENERGY_PROFILE_ID,
        startDate: EARLY_DATES[0]!,
        latestModeledDate: LATE_DATES.at(-1)!,
        timezone: "UTC",
        modelVersion: "bodycast-physiology-v6",
        active: true,
        ecfPolicy: "hold-ecf",
        baselineEnergyIntakeKcalPerDay: 2_400,
        baselineCarbIntakeG: 220,
        baselineWindowStartDate: EARLY_DATES[0]!,
        baselineWindowEndDate: EARLY_DATES.at(-1)!,
        baselineNutritionDayCount: 56,
        baselineWeightObservationCount: 1,
        baselineWeightTrendKgPerWeek: 0,
        baselineWeightTrendPercentPerWeek: 0,
        baselineDerivationMethod: "body-map-comparator-observed-windows",
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
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
      },
    });
    episodeId = episode.id;
    await prisma.physiologyV7Lifecycle.create({
      data: {
        profileId: ENERGY_PROFILE_ID,
        invalidationGeneration: 1,
        currentThroughDate: LATE_DATES.at(-1)!,
        productionStaleFromDate: null,
        productionPublishedGeneration: 1,
        ...currentPhysiologyV7Versions,
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
      },
    });

    const dates = [...EARLY_DATES, ...LATE_DATES];
    await prisma.dailyHealthData.createMany({
      data: dates.map((date) => ({
        profileId: ENERGY_PROFILE_ID,
        date,
        caloriesKcal: 2_400,
        proteinG: 150,
        rawPayload: { fixture: "body-map-comparator-observed-energy-v1" },
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
      })),
    });
    await prisma.dailyModelState.createMany({
      data: dates.map((date) => ({
        episodeId: episode.id,
        date,
        status: "complete",
        dataQuality: "observed",
        nutritionSource: "observed",
        nutritionImputationMethod: null,
        nutritionGapLength: 0,
        sourceQuality: {},
        missingFields: [],
        modelVersion: "bodycast-physiology-v6",
        energyIntakeKcal: 2_400,
        energyExpenditureKcal: 2_500,
        energyBalanceKcal: -100,
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
      })),
    });

    const analytics = await readBodyMapTrainingAnalyticsV1(ENERGY_PROFILE_ID, 24, FIXED_TIME, 6);
    expect(analytics.sessions).toEqual([]);
    expect(analytics.energyBalanceContext).toMatchObject({
      status: "available",
      reason: null,
      sourceEpisodeId: episode.id,
      modelVersion: "bodycast-physiology-v6",
      windowDays: 28,
      early: { fromDate: "2025-09-30", toDate: "2025-10-27", medianKcalPerDay: -100, validDays: 28 },
      late: { fromDate: "2026-03-03", toDate: "2026-03-30", medianKcalPerDay: -100, validDays: 28 },
    });
    recordRefactorObservation("BODYMAP-ANALYTICS-01/postgres-projection", analytics);
  });

  it("persists the first completed-session load answer and keeps retries idempotent", async () => {
    const training = new TrainingService(prisma);
    const session = await createSession({ profileId: ASSESSMENT_PROFILE_ID, status: "COMPLETED", sessionIntent: "easy-deload" });
    const notLighterSession = await createSession({ profileId: ASSESSMENT_PROFILE_ID, status: "COMPLETED" });
    const active = await createSession({ profileId: ASSESSMENT_PROFILE_ID, status: "ACTIVE" });

    const first = await training.recordCompletedSessionLoadAssessment(session.id, ASSESSMENT_PROFILE_ID, "LIGHTER");
    const retry = await training.recordCompletedSessionLoadAssessment(session.id, ASSESSMENT_PROFILE_ID, "NOT_LIGHTER");
    const notLighterFirst = await training.recordCompletedSessionLoadAssessment(notLighterSession.id, ASSESSMENT_PROFILE_ID, "NOT_LIGHTER");
    const wrongProfile = await training.recordCompletedSessionLoadAssessment(session.id, FOREIGN_PROFILE_ID, "NOT_LIGHTER");
    const activeSessionResult = await training.recordCompletedSessionLoadAssessment(active.id, ASSESSMENT_PROFILE_ID, "LIGHTER");
    const persisted = await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: session.id },
      select: { profileId: true, status: true, sessionIntent: true, sessionLoadAssessment: true },
    });
    const persistedNotLighter = await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: notLighterSession.id },
      select: { profileId: true, status: true, sessionIntent: true, sessionLoadAssessment: true },
    });
    const persistedActive = await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: active.id },
      select: { status: true, sessionLoadAssessment: true },
    });
    const analytics = await readBodyMapTrainingAnalyticsV1(ASSESSMENT_PROFILE_ID, 4, FIXED_TIME);

    expect(first).toEqual({ saved: true, assessment: "LIGHTER" });
    expect(retry).toEqual({ saved: false, assessment: "LIGHTER" });
    expect(notLighterFirst).toEqual({ saved: true, assessment: "NOT_LIGHTER" });
    expect(wrongProfile).toBeNull();
    expect(activeSessionResult).toBeNull();
    expect(persisted).toEqual({
      profileId: ASSESSMENT_PROFILE_ID,
      status: "COMPLETED",
      sessionIntent: "easy-deload",
      sessionLoadAssessment: "LIGHTER",
    });
    expect(persistedNotLighter).toEqual({
      profileId: ASSESSMENT_PROFILE_ID,
      status: "COMPLETED",
      sessionIntent: null,
      sessionLoadAssessment: "NOT_LIGHTER",
    });
    expect(persistedActive).toEqual({ status: "ACTIVE", sessionLoadAssessment: null });
    expect(analytics.sessions).toHaveLength(2);
    expect(analytics.sessions.find(({ id }) => id === session.id)?.loadAssessment)
      .toMatchObject({ status: "lighter", source: "manual", reason: "manual-response" });
    expect(analytics.sessions.find(({ id }) => id === notLighterSession.id)?.loadAssessment)
      .toMatchObject({ status: "not-lighter", source: "manual", reason: "manual-response" });
    recordRefactorObservation("TRAIN-LOAD-ASSESS-01/first-write-persistence", {
      first, retry, notLighterFirst, wrongProfile, activeSessionResult, persisted, persistedNotLighter, persistedActive,
      analytics: analytics.sessions.map(({ id, sessionDate, sessionIntent, loadAssessment }) => ({ id, sessionDate, sessionIntent, loadAssessment })),
    });
  });
});
