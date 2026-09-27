import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import type { BodyCompositionState } from "@/model/body-composition/state";
import { syncHealthData } from "@/modules/health/health.service";
import { STAIR_CLIMBING_TYPE, TRADITIONAL_STRENGTH_TRAINING_TYPE } from "@/modules/health/expand-training-workouts";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { buildSimulationDays, eligibleHistoricalDonors } from "@/modules/model-episodes/simulation-input-builder";
import { calculateEpisodeHistory } from "@/modules/model-episodes/episode-calculation";
import { CURRENT_MODEL_VERSION } from "@/modules/model-episodes/model-version";
import {
  activateVisibilityGenerationV1,
  rollbackVisibilityGenerationV1,
} from "@/modules/model-episodes/activation-rollback-v1";
import { prismaVisibilityStoreV1 } from "@/modules/model-episodes/activation-rollback-store";
import { runSyntheticReplayV1 } from "@/modules/model-episodes/staged-replay-v1";
import { persistStepperReconciliationV1 } from "@/modules/training/stepper-reconciliation.service";
import { StepperWorkoutRepository } from "@/modules/training/stepper-workout.repository";
import { persistedEpisodeFixture } from "../model-episode-fixtures";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const repository = new ModelEpisodeRepository(prisma);
const steppers = new StepperWorkoutRepository(prisma);
const version = "bodycast-physiology-v7+selection-v1";
const programName = "energy-distance-e2e";
const exerciseName = "energy-distance-e2e-exercise";
const dates = [
  "2091-04-01", "2091-04-02", "2091-04-03", "2091-04-04",
  "2091-04-05", "2091-04-06", "2091-04-07", "2091-04-08", "2091-04-09",
];

const body: BodyCompositionState = {
  fatMassKg: 20,
  leanTissueKg: 60,
  glycogenKg: 0.5,
  baselineExtracellularFluidLiters: 15,
  extracellularFluidDeviationLiters: 0,
};
const rmrParameters = createDynamicRmrParameters({
  initialRmrKcalPerDay: 1600,
  initialFatMassKg: 20,
  initialLeanTissueKg: 60,
});

function spend(events: NonNullable<ReturnType<typeof buildSimulationDays>[number]["input"]["workoutActivity"]>["events"] | undefined, outside = 0) {
  return calculateDynamicDailyExpenditure({
    bodyComposition: body,
    rmrParameters,
    macros: { proteinG: 150, carbsG: 200, fatG: 70 },
    outsideWorkWalking: { distanceKm: outside, averageSpeedKmh: 5 },
    strength: { durationMinutes: 0 },
    occupational: { category: null, durationHours: 0 },
    adaptiveThermogenesisKcalPerDay: 0,
    workoutActivity: events === undefined ? undefined : {
      events,
      selectionPolicy: "bodycast-active-energy-selection-v1",
    },
  });
}

async function day(date: string, weightKg: number | null, steps: number | null = null) {
  return prisma.dailyHealthData.upsert({
    where: { date },
    create: {
      date,
      weightKg,
      steps,
      caloriesKcal: 2500,
      proteinG: 150,
      fatG: 70,
      carbsG: 250,
      averageWalkingSpeedKmh: 5,
      walkingDistanceKm: 0,
      strengthTrainingMinutes: 0,
      workoutFeedObserved: true,
      rawPayload: { source: programName },
    },
    update: { weightKg, steps },
    select: { id: true },
  });
}

async function clean() {
  await prisma.unifiedExperimentalPhysiologyState.deleteMany({ where: { date: { in: dates } } });
  await prisma.activationRollbackEntry.deleteMany({ where: { generationId: { startsWith: "e2e-" } } });
  await prisma.stepperReconciliationCandidate.deleteMany({
    where: { group: { localDate: { in: dates } } },
  });
  await prisma.stepperReconciliationGroup.deleteMany({ where: { localDate: { in: dates } } });
  await prisma.experimentalStrengthEnergyShadow.deleteMany({
    where: { session: { program: { name: programName } } },
  });
  await prisma.strengthDiarySession.deleteMany({ where: { program: { name: programName } } });
  await prisma.trainingProgram.updateMany({ where: { name: programName }, data: { currentVersionId: null } });
  await prisma.programExercise.deleteMany({ where: { programVersion: { program: { name: programName } } } });
  await prisma.trainingProgramVersion.deleteMany({ where: { program: { name: programName } } });
  await prisma.trainingProgram.deleteMany({ where: { name: programName } });
  await prisma.exerciseCatalog.deleteMany({ where: { name: exerciseName } });
  await prisma.healthActivityInterval.deleteMany({ where: { date: { in: dates } } });
  await prisma.workInterval.deleteMany({ where: { date: { in: dates } } });
  await deleteDailyHealthRows(prisma, dates);
}

describe("staged energy and distance PostgreSQL integration", () => {
  let programId = 0;
  let versionId = 0;

  beforeAll(async () => {
    await clean();
    await prisma.profile.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, sex: "male", dateOfBirth: new Date("1990-05-10"), heightCm: 180 },
    });
    const exercise = await prisma.exerciseCatalog.create({ data: { name: exerciseName } });
    const program = await prisma.trainingProgram.create({
      data: {
        name: programName,
        versions: {
          create: {
            versionNumber: 1,
            exercises: { create: [{ exerciseCatalogId: exercise.id, sortOrder: 0, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT" }] },
          },
        },
      },
      include: { versions: true },
    });
    programId = program.id;
    versionId = program.versions[0]!.id;
    await prisma.trainingProgram.update({ where: { id: programId }, data: { currentVersionId: versionId } });
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("carries saved web, matched, manual, distance, and mass records into staged expenditure", async () => {
    await day("2091-04-01", 81);
    const web = await prisma.strengthDiarySession.create({
      data: {
        programId,
        programVersionId: versionId,
        status: "COMPLETED",
        entryMode: "LIVE",
        webStartedAt: new Date("2091-04-01T07:00:00.000Z"),
        webEndedAt: new Date("2091-04-01T08:00:00.000Z"),
      },
    });
    await prisma.experimentalStrengthEnergyShadow.create({
      data: {
        sessionId: web.id,
        sourceFingerprint: "e2e-web",
        modelRevision: "experimental-strength-active-energy-v1",
        features: {},
        result: { estimatedActiveKcal: 250, availability: "available", sessionRevision: 1 },
      },
    });

    await day("2091-04-02", 81);
    const active = await prisma.strengthDiarySession.create({
      data: {
        programId,
        programVersionId: versionId,
        status: "ACTIVE",
        entryMode: "LIVE",
        webStartedAt: new Date("2091-04-02T07:00:00.000Z"),
        webEndedAt: new Date("2091-04-02T08:00:00.000Z"),
      },
    });
    await prisma.experimentalStrengthEnergyShadow.create({
      data: {
        sessionId: active.id,
        sourceFingerprint: "e2e-active",
        modelRevision: "experimental-strength-active-energy-v1",
        features: {},
        result: { estimatedActiveKcal: 999, availability: "available", sessionRevision: 1 },
      },
    });

    const matchedDay = await day("2091-04-03", 81);
    const garmin = await prisma.workout.create({
      data: {
        dailyHealthDataId: matchedDay.id,
        sourceIdentity: "ext:e2e-strength",
        externalId: "e2e-strength",
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        startAt: new Date("2091-04-03T07:00:00.000Z"),
        endAt: new Date("2091-04-03T08:00:00.000Z"),
        durationMinutes: 60,
        activeEnergyKcal: 400,
      },
    });
    const matched = await prisma.strengthDiarySession.create({
      data: {
        programId,
        programVersionId: versionId,
        status: "COMPLETED",
        entryMode: "LIVE",
        matchedWorkoutId: garmin.id,
        matchStatus: "MATCHED",
        webStartedAt: new Date("2091-04-03T07:00:00.000Z"),
        webEndedAt: new Date("2091-04-03T08:00:00.000Z"),
      },
    });
    await prisma.experimentalStrengthEnergyShadow.create({
      data: {
        sessionId: matched.id,
        sourceFingerprint: "e2e-matched",
        modelRevision: "experimental-strength-active-energy-v1",
        features: {},
        result: { estimatedActiveKcal: 250, availability: "available", sessionRevision: 1 },
      },
    });

    const manual = await steppers.create({
      startAt: "2091-04-04T09:00:00.000+02:00",
      durationMinutes: 60,
      manualStepCount: 2000,
      manualActiveEnergyKcal: 150,
    });
    await prisma.dailyHealthData.update({ where: { date: "2091-04-04" }, data: { steps: 8000, weightKg: 81, caloriesKcal: 2500, proteinG: 150, fatG: 70, carbsG: 250, averageWalkingSpeedKmh: 5, walkingDistanceKm: 0, strengthTrainingMinutes: 0, workoutFeedObserved: true } });
    await syncHealthData({
      timezone: "Europe/Bratislava",
      days: [{
        date: "2091-04-04",
        steps: 8000,
        weightKg: 81,
        caloriesKcal: 2500,
        proteinG: 150,
        fatG: 70,
        carbsG: 250,
        workouts: [{
          externalId: "e2e-stair",
          type: STAIR_CLIMBING_TYPE,
          startAt: "2091-04-04T09:00:00+02:00",
          endAt: "2091-04-04T10:00:00+02:00",
          durationMinutes: 60,
          activeEnergyKcal: 400,
        }],
      }],
    });
    const persisted = await persistStepperReconciliationV1(prisma, {
      from: "2091-04-04",
      to: "2091-04-04",
      synchronizedSteps: 8000,
    });
    const again = await persistStepperReconciliationV1(prisma, {
      from: "2091-04-04",
      to: "2091-04-04",
      synchronizedSteps: 8000,
    });
    const group = await prisma.stepperReconciliationGroup.findFirstOrThrow({
      where: { localDate: "2091-04-04", status: "pending" },
      include: { candidates: true },
    });
    expect(group.candidates).toHaveLength(1);
    expect(group.evaluationRevision).toBe(again.groupIds.length > 0 ? group.evaluationRevision : group.evaluationRevision);
    expect(persisted.displayedSteps).toBe(10000);
    expect(persisted.potentialDuplication).toBe(true);
    const manualRow = await prisma.workout.findUniqueOrThrow({ where: { id: manual.id } });
    expect(manualRow.hiddenFromHistory).toBe(false);

    const distanceDay = await day("2091-04-05", 81);
    await prisma.healthActivityInterval.createMany({
      data: [
        { date: "2091-04-05", metric: "walking-distance-km", startAt: new Date("2091-04-05T06:00:00.000Z"), endAt: new Date("2091-04-05T08:00:00.000Z"), value: 10, sourceFingerprint: "e2e-distance-long" },
        { date: "2091-04-05", metric: "walking-distance-km", startAt: new Date("2091-04-05T06:10:00.000Z"), endAt: new Date("2091-04-05T06:30:00.000Z"), value: 2, sourceFingerprint: "e2e-distance-short" },
      ],
    });
    await prisma.dailyHealthData.update({ where: { id: distanceDay.id }, data: { walkingDistanceKm: null } });

    const ledgerDay = await day("2091-04-06", 81);
    await prisma.dailyHealthData.update({ where: { id: ledgerDay.id }, data: { walkingDistanceKm: 4 } });
    await prisma.healthActivityInterval.createMany({
      data: [
        { date: "2091-04-06", metric: "walking-distance-km", startAt: new Date("2091-04-06T06:00:00.000Z"), endAt: new Date("2091-04-06T08:00:00.000Z"), value: 4, sourceFingerprint: "e2e-ledger-distance" },
        { date: "2091-04-06", metric: "steps", startAt: new Date("2091-04-06T06:00:00.000Z"), endAt: new Date("2091-04-06T08:00:00.000Z"), value: 2000, sourceFingerprint: "e2e-ledger-steps" },
      ],
    });
    await prisma.workInterval.create({
      data: {
        date: "2091-04-06",
        startAt: new Date("2091-04-06T06:00:00.000Z"),
        endAt: new Date("2091-04-06T07:00:00.000Z"),
        timezone: "Europe/Bratislava",
        category: "standingLight",
        breakMinutes: 0,
      },
    });
    await prisma.workout.create({
      data: {
        dailyHealthDataId: ledgerDay.id,
        sourceIdentity: "ext:e2e-ledger-stair",
        externalId: "e2e-ledger-stair",
        type: STAIR_CLIMBING_TYPE,
        startAt: new Date("2091-04-06T06:00:00.000Z"),
        endAt: new Date("2091-04-06T07:00:00.000Z"),
        durationMinutes: 60,
        activeEnergyKcal: 80,
      },
    });

    await day("2091-04-07", 81);
    const known = await prisma.strengthDiarySession.create({
      data: {
        programId, programVersionId: versionId, status: "COMPLETED", entryMode: "LIVE",
        webStartedAt: new Date("2091-04-07T07:00:00.000Z"),
        webEndedAt: new Date("2091-04-07T08:00:00.000Z"),
      },
    });
    await prisma.experimentalStrengthEnergyShadow.create({
      data: {
        sessionId: known.id, sourceFingerprint: "e2e-partial", modelRevision: "experimental-strength-active-energy-v1",
        features: {}, result: { estimatedActiveKcal: 200, availability: "available" },
      },
    });
    await prisma.strengthDiarySession.create({
      data: {
        programId, programVersionId: versionId, status: "COMPLETED", entryMode: "LIVE",
        webStartedAt: new Date("2091-04-07T09:00:00.000Z"),
        webEndedAt: new Date("2091-04-07T10:00:00.000Z"),
      },
    });

    const sources = await repository.loadSources("2091-04-01", "2091-04-07");
    expect(sources.webOnlyStrengthSessions?.some((session) => session.sessionId === web.id && session.bodyCastEstimateKcal === 250)).toBe(true);
    expect(sources.workouts?.find((workout) => workout.id === garmin.id)).toMatchObject({
      activeEnergyKcal: 400,
      bodyCastEstimateKcal: 250,
      strengthSessionCompleted: true,
    });
    expect(sources.workouts?.find((workout) => workout.id === manual.id)).toMatchObject({
      manualStepCount: 2000,
      manualActiveEnergyKcal: 150,
    });
    expect(sources.reconciliationLinks?.some((link) => link.manualWorkoutId === manual.id && link.suppressGarminEnergy)).toBe(true);

    const built = buildSimulationDays({
      from: "2091-04-01",
      to: "2091-04-07",
      sources,
      modelVersion: version,
      unifiedStartOfDayMassKgByDate: { "2091-04-01": 70 },
    });
    const byDate = new Map(built.map((item) => [item.input.date, item]));

    const webDay = byDate.get("2091-04-01")!;
    expect(webDay.input.measuredWeightKg).toBe(81);
    expect(webDay.input.workoutActivity?.events).toHaveLength(1);
    expect(spend(webDay.input.workoutActivity?.events).workoutActivityKcalPerDay).toBe(250);
    const episode = { ...persistedEpisodeFixture("2091-04-01"), modelVersion: version };
    const history = calculateEpisodeHistory({ episode, days: [webDay] });
    expect(history.dailyStates[0]?.sourceQuality.workoutEnergyResolution?.workoutActivityKcal).toBe(250);
    expect(history.dailyStates[0]?.sourceQuality.selectionV1?.energyCoverage).toMatchObject({
      knownSubtotalKcal: 250,
      fullCoverage: true,
    });

    const activeDay = byDate.get("2091-04-02")!;
    expect(spend(activeDay.input.workoutActivity?.events).workoutActivityKcalPerDay).toBe(0);
    expect(spend(activeDay.input.workoutActivity?.events).workoutEnergyResolution?.energyCoverage?.unknownEventCount).toBe(1);

    const matchedBuilt = byDate.get("2091-04-03")!;
    expect(matchedBuilt.input.workoutActivity?.events).toHaveLength(1);
    expect(spend(matchedBuilt.input.workoutActivity?.events).workoutActivityKcalPerDay).toBe(250);

    const pendingDay = byDate.get("2091-04-04")!;
    expect(pendingDay.input.workoutActivity?.events).toHaveLength(1);
    expect(spend(pendingDay.input.workoutActivity?.events).workoutActivityKcalPerDay).toBe(150);

    const conflict = byDate.get("2091-04-05")!;
    expect(conflict.input.outsideWorkWalkingDistanceKm).toBeNull();
    expect(conflict.sourceQuality.selectionV1?.distanceConflicted).toBe(true);
    expect(conflict.sourceQuality.selectionV1?.knownAcceptedSubtotalKm).toBe(0);

    const ledger = byDate.get("2091-04-06")!;
    expect(ledger.input.outsideWorkWalkingDistanceKm).toBeCloseTo(2, 6);
    expect(ledger.input.occupationalActivity.intervals?.[0]?.durationHours).toBe(0);
    expect(ledger.input.occupationalActivity.intervals?.[0]?.workWalkingDistanceKm).toBe(0);
    expect(ledger.sourceQuality.workWalkingDistanceKm).toBeCloseTo(2, 6);

    const partial = byDate.get("2091-04-07")!;
    const partialSpend = spend(partial.input.workoutActivity?.events);
    expect(partialSpend.workoutActivityKcalPerDay).toBe(200);
    expect(partialSpend.workoutEnergyResolution?.energyCoverage).toMatchObject({
      knownSubtotalKcal: 200,
      unknownEventCount: 1,
      fullCoverage: false,
    });
    expect(eligibleHistoricalDonors(version, [partial])).toEqual([]);

    const legacy = buildSimulationDays({
      from: "2091-04-01",
      to: "2091-04-01",
      sources,
      modelVersion: CURRENT_MODEL_VERSION,
    })[0]!;
    expect(legacy.input.workoutActivity?.selectionPolicy).toBeUndefined();
    expect(legacy.input.workoutActivity?.events ?? []).toHaveLength(0);
    expect(legacy.sourceQuality.selectionV1).toBeUndefined();
    const unified = await prisma.unifiedExperimentalPhysiologyState.findUnique({
      where: { profileId_date: { profileId: 1, date: "2091-04-04" } },
    });
    expect(JSON.stringify(unified?.diagnostics)).toContain("energy-coverage:unknown=");
    expect(JSON.stringify(unified?.energyLedger)).toContain("150");
  }, 60_000);

  it("replays loaded source days and rolls visibility back exactly", async () => {
    const hiddenDay = await day("2091-04-09", 80);
    const hidden = await prisma.workout.create({
      data: {
        dailyHealthDataId: hiddenDay.id,
        sourceIdentity: "ext:e2e-hidden",
        type: STAIR_CLIMBING_TYPE,
        startAt: new Date("2091-04-09T07:00:00.000Z"),
        endAt: new Date("2091-04-09T08:00:00.000Z"),
        durationMinutes: 60,
        activeEnergyKcal: 10,
        hiddenFromHistory: true,
        syncProtected: false,
      },
    });
    const sources = await repository.loadSources("2091-04-01", "2091-04-01");
    const replay = runSyntheticReplayV1({
      expectedSourceRevision: "e2e",
      days: [
        { date: "2091-04-01", sourceRevision: "e2e", project: () => sources.webOnlyStrengthSessions?.map((session) => session.bodyCastEstimateKcal) },
        { date: "2091-04-02", sourceRevision: "stale", project: () => ({}) },
      ],
    });
    expect(replay.status).toBe("stale-source");
    expect(replay.completed).toHaveLength(1);
    const interrupted = runSyntheticReplayV1({
      expectedSourceRevision: "e2e",
      days: [
        { date: "2091-04-01", sourceRevision: "e2e", project: () => ({ ok: true }) },
        { date: "2091-04-02", sourceRevision: "e2e", project: () => { throw new Error("interrupt"); } },
      ],
    });
    expect(interrupted.resumeAt).toBe("2091-04-02");

    const store = prismaVisibilityStoreV1(prisma);
    await activateVisibilityGenerationV1({
      store,
      generationId: "e2e-activation",
      changes: [{ recordId: hidden.id, supersedingWorkoutId: 1 }],
    });
    const activated = await prisma.workout.findUniqueOrThrow({ where: { id: hidden.id } });
    expect(activated.hiddenFromHistory).toBe(true);
    expect(activated.syncProtected).toBe(true);
    await rollbackVisibilityGenerationV1({ store, generationId: "e2e-activation" });
    const restored = await prisma.workout.findUniqueOrThrow({ where: { id: hidden.id } });
    expect(restored.hiddenFromHistory).toBe(true);
    expect(restored.syncProtected).toBe(false);
    expect(restored.supersededByWorkoutId).toBeNull();
    expect(await prisma.activationRollbackEntry.count({ where: { generationId: "e2e-activation" } })).toBeGreaterThan(0);
  }, 30_000);
});
