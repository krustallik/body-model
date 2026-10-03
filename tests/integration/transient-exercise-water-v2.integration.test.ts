import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";
import {
  TransientExerciseWaterConcurrentSourceChangeError,
  rebuildExperimentalTransientExerciseWaterV2,
} from "@/modules/training/experimental-transient-exercise-water-shadow.service";
import { EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION } from "@/model/physiology-v7/experimental-transient-exercise-water-v2";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";

const profileId = 1;
const marker = "transient-water-v2-pg-test";
const dbUrl = process.env.DATABASE_URL;
const isolated = requireIsolatedStage01Database(dbUrl, process.env.BODYCAST_STAGE01_MODE, "test");
const client = new PrismaClient({ datasourceUrl: dbUrl });
const boundaryDate = "2073-01-03";
const boundaryInstant = new Date("2073-01-03T12:00:00.000Z");

async function cleanup(): Promise<void> {
  const programs = await client.trainingProgram.findMany({
    where: { profileId, name: { startsWith: marker } }, select: { id: true },
  });
  const sessions = programs.length === 0 ? [] : await client.strengthDiarySession.findMany({
    where: { profileId, programId: { in: programs.map(({ id }) => id) } }, select: { id: true },
  });
  const episodes = await client.modelEpisode.findMany({
    where: { profileId, baselineDerivationMethod: marker }, select: { id: true },
  });
  await client.experimentalTransientExerciseWaterShadow.deleteMany({
    where: { profileId, sessionId: { in: sessions.map(({ id }) => id) } },
  });
  await client.unifiedExperimentalPhysiologyStateV2.deleteMany({
    where: { modelEpisodeId: { in: episodes.map(({ id }) => id) } },
  });
  await client.strengthDiarySession.deleteMany({ where: { id: { in: sessions.map(({ id }) => id) } } });
  await client.workout.deleteMany({ where: { sourceIdentity: { startsWith: marker } } });
  await client.modelEpisode.deleteMany({ where: { id: { in: episodes.map(({ id }) => id) } } });
  await client.trainingProgram.deleteMany({ where: { id: { in: programs.map(({ id }) => id) } } });
  await client.dailyHealthData.deleteMany({ where: { date: { in: ["2073-01-03"] } } });
}

async function seed(): Promise<number[]> {
  await cleanup();
  await client.profile.upsert({
    where: { id: profileId },
    create: { id: profileId, sex: "male", dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), heightCm: 180 },
    update: {},
  });
  const episode = {
    profileId,
    modelVersion: "bodycast-physiology-v6",
    ecfPolicy: "hold-ecf",
    baselineEnergyIntakeKcalPerDay: 2_400,
    baselineCarbIntakeG: 220,
    baselineWindowStartDate: "2073-01-01",
    baselineWindowEndDate: "2073-01-01",
    baselineNutritionDayCount: 1,
    baselineWeightObservationCount: 1,
    baselineWeightTrendKgPerWeek: 0,
    baselineWeightTrendPercentPerWeek: 0,
    baselineDerivationMethod: marker,
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
  await client.modelEpisode.create({
    data: { ...episode, startDate: "2073-01-01", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: boundaryInstant },
  });
  await client.modelEpisode.create({
    data: { ...episode, startDate: boundaryDate, timezone: "Etc/GMT+12", active: true, deactivatedAt: null },
  });
  const program = await client.trainingProgram.create({ data: { profileId, name: `${marker}-program` } });
  const version = await client.trainingProgramVersion.create({ data: { programId: program.id, versionNumber: 1 } });
  await client.trainingProgram.update({ where: { id: program.id }, data: { currentVersionId: version.id } });
  const health = await client.dailyHealthData.create({
    data: { date: boundaryDate, rawPayload: {}, weightKg: 80, workoutFeedObserved: true },
  });
  const matchedWorkout = await client.workout.create({
    data: {
      dailyHealthDataId: health.id,
      sourceIdentity: `${marker}:matched-workout`,
      externalId: `${marker}-external`,
      type: "Traditional Strength Training",
      startAt: new Date(boundaryInstant.getTime() + 15 * 60_000),
      endAt: new Date(boundaryInstant.getTime() + 45 * 60_000),
      durationMinutes: 30,
      activeEnergyKcal: 123,
    },
  });
  const specs = [
    { eventAt: new Date(boundaryInstant.getTime() + 20 * 60_000), matchedWorkoutId: null, offsetMs: 0 },
    { eventAt: new Date(boundaryInstant.getTime() + 5 * 60_000), matchedWorkoutId: null, offsetMs: 0 },
    { eventAt: new Date(boundaryInstant.getTime() + 60 * 60_000), matchedWorkoutId: matchedWorkout.id, offsetMs: -86_400_000 },
  ];
  const ids: number[] = [];
  for (const spec of specs) {
    const session = await client.strengthDiarySession.create({
      data: {
        profileId,
        programId: program.id,
        programVersionId: version.id,
        status: "COMPLETED",
        entryMode: spec.matchedWorkoutId === null ? "LIVE" : "RETROSPECTIVE",
        webStartedAt: spec.matchedWorkoutId === null ? spec.eventAt : null,
        effectiveAccountingAt: new Date(spec.eventAt.getTime() + spec.offsetMs),
        accountingTimeZone: "UTC",
        accountingTimeZoneProvenance: "test",
        matchStatus: spec.matchedWorkoutId === null ? "UNMATCHED" : "MATCHED",
        matchMethod: spec.matchedWorkoutId === null ? null : "MANUAL",
        matchedAt: spec.matchedWorkoutId === null ? null : new Date(),
        matchedWorkoutId: spec.matchedWorkoutId,
      },
    });
    ids.push(session.id);
  }
  return ids;
}

describe("Transient Exercise Water V2 PostgreSQL persistence and concurrency", () => {
  beforeAll(() => {
    expect(isolated.databaseName).toBe("bodycast_training_history_stage01_test");
  });

  afterAll(async () => {
    await cleanup();
    await client.$disconnect();
  });

  it("persists one V2 impulse per Strength session and uses matched Workout.startAt as event time", async () => {
    const sessionIds = await seed();
    const first = await rebuildExperimentalTransientExerciseWaterV2({ profileId, client });
    const rows = await client.experimentalTransientExerciseWaterShadow.findMany({
      where: { profileId, modelRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION },
      orderBy: { sessionId: "asc" },
    });
    expect(first.impulseCount).toBe(3);
    expect(first.earliestModelDate).toBe(boundaryDate);
    expect(rows.map((row) => row.sessionId).sort((a, b) => a - b)).toEqual([...sessionIds].sort((a, b) => a - b));
    expect(new Set(rows.map((row) => row.sessionId)).size).toBe(3);
    const matched = rows.find((row) => row.sessionId === sessionIds[2])!;
    const result = matched.result as { impulse: { canonicalEventInstant: string; modelEpisodeId: number; modelDate: string; branches: { point: { amplitudeKg: number } } } };
    expect(result.impulse.canonicalEventInstant).toBe(new Date(boundaryInstant.getTime() + 15 * 60_000).toISOString());
    expect(result.impulse.modelDate).toBe(boundaryDate);
    expect(result.impulse.modelEpisodeId).toBeGreaterThan(0);
    expect(result.impulse.branches.point.amplitudeKg).toBe(0);
    const timestamps = rows.map((row) => row.updatedAt.toISOString());
    const repeatedResult = await rebuildExperimentalTransientExerciseWaterV2({ profileId, client });
    expect(repeatedResult.earliestModelDate).toBeNull();
    const repeated = await client.experimentalTransientExerciseWaterShadow.findMany({
      where: { profileId, modelRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION },
      orderBy: { sessionId: "asc" },
    });
    expect(repeated.map((row) => row.updatedAt.toISOString())).toEqual(timestamps);

    await client.strengthDiarySession.update({
      where: { id: sessionIds[0] },
      data: {
        effectiveAccountingAt: new Date(boundaryInstant.getTime() + 24 * 60 * 60_000 + 20 * 60_000),
        webStartedAt: new Date(boundaryInstant.getTime() + 24 * 60 * 60_000 + 20 * 60_000),
        revision: { increment: 1 },
      },
    });
    const moved = await rebuildExperimentalTransientExerciseWaterV2({ profileId, client });
    expect(moved.earliestModelDate).toBe(boundaryDate);
    const movedRow = await client.experimentalTransientExerciseWaterShadow.findUniqueOrThrow({
      where: { sessionId: sessionIds[0] },
    });
    expect((movedRow.result as { impulse: { modelDate: string } }).impulse.modelDate)
      .toBe("2073-01-04");
  });

  it("rejects a stale candidate after a concurrent source revision, and a rolled-back edit leaves it current", async () => {
    const sessionIds = await seed();
    await rebuildExperimentalTransientExerciseWaterV2({ profileId, client });
    const original = await client.strengthDiarySession.findUniqueOrThrow({ where: { id: sessionIds[0] }, select: { revision: true } });
    await expect(client.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      await tx.strengthDiarySession.update({ where: { id: sessionIds[0] }, data: { revision: { increment: 1 } } });
      throw new Error("intentional rollback");
    })).rejects.toThrow("intentional rollback");
    const rolledBack = await client.strengthDiarySession.findUniqueOrThrow({ where: { id: sessionIds[0] }, select: { revision: true } });
    expect(rolledBack.revision).toBe(original.revision);

    let candidateReady!: () => void;
    let releaseCandidate!: () => void;
    const ready = new Promise<void>((resolve) => { candidateReady = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseCandidate = resolve; });
    const staleWriter = rebuildExperimentalTransientExerciseWaterV2({
      profileId,
      client,
      onCandidateComputed: async () => { candidateReady(); await blocked; },
    });
    await ready;
    await client.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      await tx.strengthDiarySession.update({ where: { id: sessionIds[0] }, data: { revision: { increment: 1 } } });
    });
    const newer = await rebuildExperimentalTransientExerciseWaterV2({ profileId, client });
    releaseCandidate();
    await expect(staleWriter).rejects.toBeInstanceOf(TransientExerciseWaterConcurrentSourceChangeError);
    const row = await client.experimentalTransientExerciseWaterShadow.findUniqueOrThrow({ where: { sessionId: sessionIds[0] } });
    expect(row.sourceFingerprint).not.toBe("never-published");
    expect(newer.sourceToken).not.toBe("");
    const currentSession = await client.strengthDiarySession.findUniqueOrThrow({ where: { id: sessionIds[0] }, select: { revision: true } });
    expect(currentSession.revision).toBe(original.revision + 1);
  });
});
