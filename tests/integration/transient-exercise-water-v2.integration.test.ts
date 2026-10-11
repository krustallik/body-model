import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";
import {
  TransientExerciseWaterConcurrentSourceChangeError,
  rebuildExperimentalTransientExerciseWaterV2,
} from "@/modules/training/experimental-transient-exercise-water-shadow.service";
import { EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION } from "@/model/physiology-v7/experimental-transient-exercise-water-v2";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { UnifiedExperimentalPhysiologySourceLoaderV1 } from "@/model/unified-experimental-physiology-v1/source-loader";

const profileId = 1;
const marker = "transient-water-v2-pg-test";
const dbUrl = process.env.DATABASE_URL;
const isolated = requireIsolatedStage01Database(dbUrl, process.env.BODYCAST_STAGE01_MODE, "test");
const client = new PrismaClient({ datasourceUrl: dbUrl });
const boundaryDate = "2073-01-03";
const boundaryInstant = new Date("2073-01-03T12:00:00.000Z");
const equalStartInstant = new Date("2073-01-02T10:00:00.000Z");

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

async function seed(options: { equalAbsoluteStart?: boolean; staleInactiveAfterActive?: boolean } = {}): Promise<number[]> {
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
  const episodeStarts = options.staleInactiveAfterActive
    ? [
      { startDate: "2073-01-01", timezone: "UTC", active: true, deactivatedAt: null },
      { startDate: "2073-01-03", timezone: "UTC", active: false, deactivatedAt: new Date("2073-01-04T00:00:00.000Z") },
    ]
    : options.equalAbsoluteStart
    ? [
      { startDate: "2073-01-03", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: equalStartInstant },
      { startDate: "2073-01-02", timezone: "Etc/GMT+10", active: true, deactivatedAt: null },
    ]
    : [
      { startDate: "2073-01-01", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: boundaryInstant },
      { startDate: boundaryDate, timezone: "Etc/GMT+12", active: true, deactivatedAt: null },
    ];
  for (const episodeStart of episodeStarts) await client.modelEpisode.create({ data: { ...episode, ...episodeStart } });
  const eventBoundary = options.equalAbsoluteStart ? equalStartInstant : boundaryInstant;
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
      startAt: new Date(eventBoundary.getTime() + 15 * 60_000),
      endAt: new Date(eventBoundary.getTime() + 45 * 60_000),
      durationMinutes: 30,
      activeEnergyKcal: 123,
    },
  });
  const specs = [
    { eventAt: options.equalAbsoluteStart ? eventBoundary : new Date(eventBoundary.getTime() + 20 * 60_000), matchedWorkoutId: null, offsetMs: 0 },
    { eventAt: new Date(eventBoundary.getTime() + 5 * 60_000), matchedWorkoutId: null, offsetMs: 0 },
    { eventAt: new Date(eventBoundary.getTime() + 60 * 60_000), matchedWorkoutId: matchedWorkout.id, offsetMs: -86_400_000 },
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

  it("keeps PostgreSQL transient shadow and Unified loader aligned for equal absolute episode starts", async () => {
    const sessionIds = await seed({ equalAbsoluteStart: true });
    const episodes = await client.modelEpisode.findMany({
      where: { profileId, baselineDerivationMethod: marker },
      orderBy: { id: "asc" },
      select: { id: true, startDate: true, timezone: true, active: true, deactivatedAt: true },
    });
    expect(episodes).toHaveLength(2);
    expect(episodes[0]?.id).toBeLessThan(episodes[1]!.id);
    expect(episodes[0]?.startDate).toBe("2073-01-03");
    expect(episodes[1]?.startDate).toBe("2073-01-02");

    await rebuildExperimentalTransientExerciseWaterV2({ profileId, client });
    const shadow = await client.experimentalTransientExerciseWaterShadow.findUniqueOrThrow({
      where: { sessionId: sessionIds[0] },
    });
    const impulse = (shadow.result as { impulse: { canonicalEventInstant: string; modelEpisodeId: number; modelDate: string } }).impulse;
    expect(impulse.canonicalEventInstant).toBe(equalStartInstant.toISOString());
    expect(impulse.modelEpisodeId).toBe(episodes[1]!.id);
    expect(impulse.modelDate).toBe("2073-01-02");

    const range = await new UnifiedExperimentalPhysiologySourceLoaderV1(client as never).loadRange({
      profileId,
      fromInstant: equalStartInstant,
      throughInstant: new Date("2073-01-03T10:00:00.000Z"),
    });
    const winningDay = range.days.find(({ modelEpisodeId, date }) => (
      modelEpisodeId === episodes[1]!.id && date === "2073-01-02"
    ));
    expect(winningDay?.childOutputs.transientWater.map(({ sessionId: id }) => id)).toContain(sessionIds[0]);
    expect(range.days.some(({ modelEpisodeId }) => modelEpisodeId === episodes[0]!.id)).toBe(false);
  });

  it("keeps stale later inactive rows from stealing active PostgreSQL shadow or Unified events", async () => {
    const sessionIds = await seed({ staleInactiveAfterActive: true });
    const episodes = await client.modelEpisode.findMany({
      where: { profileId, baselineDerivationMethod: marker },
      orderBy: { id: "asc" },
      select: { id: true, active: true },
    });
    const activeEpisode = episodes.find(({ active }) => active)!;
    const staleInactiveEpisode = episodes.find(({ active }) => !active)!;
    await client.experimentalTransientExerciseWaterShadow.create({
      data: {
        profileId,
        sessionId: sessionIds[0]!,
        sourceFingerprint: "pre-partition-contract-same-assignment",
        modelRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
        features: { episodePartition: "previous-contract" },
        result: { impulse: { modelDate: boundaryDate, modelEpisodeId: activeEpisode.id } },
      },
    });

    await rebuildExperimentalTransientExerciseWaterV2({ profileId, client });
    const shadows = await client.experimentalTransientExerciseWaterShadow.findMany({
      where: { sessionId: { in: sessionIds } },
    });
    expect(shadows).toHaveLength(3);
    expect(shadows.find(({ sessionId }) => sessionId === sessionIds[0])?.sourceFingerprint)
      .not.toBe("pre-partition-contract-same-assignment");
    expect(shadows.find(({ sessionId }) => sessionId === sessionIds[0])?.modelRevision)
      .toBe(EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION);
    expect(shadows.every((row) => (
      (row.result as { impulse: { modelEpisodeId: number } }).impulse.modelEpisodeId === activeEpisode.id
    ))).toBe(true);
    expect(shadows.some((row) => (
      (row.result as { impulse: { modelEpisodeId: number } }).impulse.modelEpisodeId === staleInactiveEpisode.id
    ))).toBe(false);

    const range = await new UnifiedExperimentalPhysiologySourceLoaderV1(client as never).loadRange({
      profileId,
      fromInstant: new Date("2073-01-03T00:00:00.000Z"),
      throughInstant: new Date("2073-01-04T00:00:00.000Z"),
    });
    expect(range.days.some(({ modelEpisodeId }) => modelEpisodeId === staleInactiveEpisode.id)).toBe(false);
    expect(range.days
      .filter(({ modelEpisodeId }) => modelEpisodeId === activeEpisode.id)
      .flatMap(({ childOutputs }) => childOutputs.transientWater.map(({ sessionId: id }) => id)))
      .toEqual(expect.arrayContaining(sessionIds));
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
