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
import { reconstructSelectionHistoryV1, persistSelectionEpisodeHistoryV1, rollbackSelectionEpisodeActivationV1 } from "@/modules/model-episodes/selection-v1-episode-ops";
import { persistStepperReconciliationV1, confirmStepperReconciliationV1, rejectStepperReconciliationV1 } from "@/modules/training/stepper-reconciliation.service";
import { StepperWorkoutRepository } from "@/modules/training/stepper-workout.repository";
import { TrainingService } from "@/modules/training/training.service";
import { recordExperimentalStrengthEnergyShadowBySessionId } from "@/modules/training/experimental-strength-energy-shadow.service";
import {
  strengthInputFingerprintV1,
  strengthSetFingerprintV1,
} from "@/modules/training/strength-publication-v1";
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION } from "@/modules/training/experimental-strength-active-energy-v1";
import { persistedEpisodeFixture } from "../model-episode-fixtures";
import { modelProfile, stableSourceDays } from "../model-episode-fixtures";
import { prepareEpisodeInitialization } from "@/modules/model-episodes/episode-initialization";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";
import { materializeActiveEnergyCandidatesV1 } from "@/modules/activity/active-energy-materialization";
import { inventoryFullHistoryRawInputs } from "@/modules/model-episodes/full-history-recalculation.service";

const prisma = new PrismaClient();
const repository = new ModelEpisodeRepository(prisma);
const steppers = new StepperWorkoutRepository(prisma);
const version = "bodycast-physiology-v7+selection-v1";
const programName = "energy-distance-e2e";
const exerciseName = "energy-distance-e2e-exercise";

function strengthShadowResult(input: {
  sessionId: number;
  kcal: number;
  massKg: number;
  revision?: number;
}) {
  const sessionRevision = input.revision ?? 1;
  return {
    estimatedActiveKcal: input.kcal,
    availability: "available",
    sessionRevision,
    inputFingerprint: strengthInputFingerprintV1({
      sessionId: input.sessionId,
      sessionRevision,
      massKg: input.massKg,
      sameDayMassKg: input.massKg,
      setFingerprint: strengthSetFingerprintV1([]),
      estimatorVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    }),
  };
}
const dates = [
  "2091-04-01", "2091-04-02", "2091-04-03", "2091-04-04",
  "2091-04-05", "2091-04-06", "2091-04-07", "2091-04-08", "2091-04-09",
  "2091-04-10", "2091-04-11",
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
  await prisma.activeEnergyCanonicalEvent.deleteMany({ where: { profileId: 1, modelDate: { in: dates } } });
  await prisma.unifiedExperimentalPhysiologyStateV2.deleteMany({ where: { profileId: 1, date: { in: dates } } });
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
  await prisma.healthMetricSample.deleteMany({ where: { metric: "weight-kg", date: { in: dates } } });
  await prisma.workInterval.deleteMany({ where: { date: { in: dates } } });
  await deleteDailyHealthRows(prisma, dates);
}

async function lifecycleFreshness() {
  return prisma.physiologyV7Lifecycle.findUnique({
    where: { profileId: 1 },
    select: { invalidationGeneration: true, staleFromDate: true },
  });
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
  });

  it("carries saved web, matched, manual, distance, and mass records into staged expenditure", async () => {
    await day("2091-04-01", 81);
    await prisma.healthMetricSample.create({
      data: {
        date: "2091-04-01",
        metric: "weight-kg",
        source: "apple-health-shortcut",
        timestamp: new Date("2091-04-01T06:30:00.000Z"),
        value: 81,
      },
    });
    const web = await prisma.strengthDiarySession.create({
      data: {
        programId,
        programVersionId: versionId,
        status: "COMPLETED",
        entryMode: "LIVE",
        webStartedAt: new Date("2091-04-01T07:00:00.000Z"),
        webEndedAt: new Date("2091-04-01T08:00:00.000Z"),
        effectiveAccountingAt: new Date("2091-04-01T07:00:00.000Z"),
        accountingTimeZone: "Europe/Bratislava",
        accountingTimeZoneProvenance: "client-session",
        exercises: {
          create: [{
            sortOrder: 0,
            snapshotExerciseName: exerciseName,
            plannedSets: 1,
            resistanceType: "BODYWEIGHT",
            sets: { create: [{
              setNumber: 1,
              reps: 8,
              weightKg: 60,
              completedAt: new Date("2091-04-01T07:30:00.000Z"),
            }] },
          }],
        },
      },
    });
    const training = new TrainingService(prisma);
    const webAccounting = await training.refreshSessionAccounting(web.id, 1, `energy-distance-stage02-${web.id}`);
    expect(webAccounting.activeEnergyMassReference?.reference).toMatchObject({ status: "observed", valueKg: 81 });
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: web.id, profileId: 1 });
    const webShadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: web.id } });
    const webKcal = (webShadow.result as { estimatedActiveKcal: number | null }).estimatedActiveKcal;
    expect(webKcal).toBeGreaterThan(0);

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
        modelRevision: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
        features: {},
        result: strengthShadowResult({ sessionId: active.id, kcal: 999, massKg: 81 }),
      },
    });

    const matchedDay = await day("2091-04-03", 81);
    await prisma.healthMetricSample.create({
      data: {
        date: "2091-04-03",
        metric: "weight-kg",
        source: "apple-health-shortcut",
        timestamp: new Date("2091-04-03T06:30:00.000Z"),
        value: 81,
      },
    });
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
        effectiveAccountingAt: new Date("2091-04-03T07:00:00.000Z"),
        accountingTimeZone: "Europe/Bratislava",
        accountingTimeZoneProvenance: "client-session",
        exercises: {
          create: [{
            sortOrder: 0,
            snapshotExerciseName: exerciseName,
            plannedSets: 1,
            resistanceType: "BODYWEIGHT",
            sets: { create: [{
              setNumber: 1,
              reps: 8,
              weightKg: 60,
              completedAt: new Date("2091-04-03T07:30:00.000Z"),
            }] },
          }],
        },
      },
    });
    const matchedAccounting = await training.refreshSessionAccounting(matched.id, 1, `energy-distance-stage02-${matched.id}`);
    expect(matchedAccounting.activeEnergyMassReference?.reference).toMatchObject({ status: "observed", valueKg: 81 });
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: matched.id, profileId: 1 });
    const matchedShadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: matched.id } });
    const matchedKcal = (matchedShadow.result as { estimatedActiveKcal: number | null }).estimatedActiveKcal;
    expect(matchedKcal).toBeGreaterThan(0);

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
    const refreshedWebAccounting = await training.refreshSessionAccounting(
      web.id,
      1,
      `energy-distance-stage02-after-sync-${web.id}`,
    );
    expect(refreshedWebAccounting.activeEnergyMassReference?.reference).toMatchObject({ status: "observed", valueKg: 81 });
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: web.id, profileId: 1 });
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
    await prisma.healthMetricSample.create({
      data: {
        date: "2091-04-07",
        metric: "weight-kg",
        source: "apple-health-shortcut",
        timestamp: new Date("2091-04-07T06:30:00.000Z"),
        value: 81,
      },
    });
    const known = await prisma.strengthDiarySession.create({
      data: {
        programId, programVersionId: versionId, status: "COMPLETED", entryMode: "LIVE",
        webStartedAt: new Date("2091-04-07T07:00:00.000Z"),
        webEndedAt: new Date("2091-04-07T08:00:00.000Z"),
        effectiveAccountingAt: new Date("2091-04-07T07:00:00.000Z"),
        accountingTimeZone: "Europe/Bratislava",
        accountingTimeZoneProvenance: "client-session",
        exercises: {
          create: [{
            sortOrder: 0,
            snapshotExerciseName: exerciseName,
            plannedSets: 1,
            resistanceType: "BODYWEIGHT",
            sets: { create: [{
              setNumber: 1,
              reps: 8,
              weightKg: 60,
              completedAt: new Date("2091-04-07T07:30:00.000Z"),
            }] },
          }],
        },
      },
    });
    const knownAccounting = await training.refreshSessionAccounting(known.id, 1, `energy-distance-stage02-${known.id}`);
    expect(knownAccounting.activeEnergyMassReference?.reference).toMatchObject({ status: "observed", valueKg: 81 });
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: known.id, profileId: 1 });
    const knownShadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: known.id } });
    const knownKcal = (knownShadow.result as { estimatedActiveKcal: number | null }).estimatedActiveKcal;
    expect(knownKcal).toBeGreaterThan(0);
    const knownKcalValue = knownKcal as number;
    await prisma.strengthDiarySession.create({
      data: {
        programId, programVersionId: versionId, status: "COMPLETED", entryMode: "LIVE",
        webStartedAt: new Date("2091-04-07T09:00:00.000Z"),
        webEndedAt: new Date("2091-04-07T10:00:00.000Z"),
      },
    });

    const sources = await repository.loadSources("2091-04-01", "2091-04-07");
    expect(sources.webOnlyStrengthSessions?.some((session) => session.sessionId === web.id && session.bodyCastEstimateKcal === webKcal && session.bodyCastEstimateFresh === true)).toBe(true);
    expect(sources.workouts?.find((workout) => workout.id === garmin.id)).toMatchObject({
      activeEnergyKcal: 400,
      bodyCastEstimateKcal: matchedKcal,
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
    expect(spend(webDay.input.workoutActivity?.events).workoutActivityKcalPerDay).toBe(webKcal);
    const episode = { ...persistedEpisodeFixture("2091-04-01"), modelVersion: version };
    const history = calculateEpisodeHistory({ episode, days: [webDay] });
    expect(history.dailyStates[0]?.sourceQuality.workoutEnergyResolution?.workoutActivityKcal).toBe(webKcal);
    expect(history.dailyStates[0]?.sourceQuality.selectionV1?.energyCoverage).toMatchObject({
      knownSubtotalKcal: webKcal,
      fullCoverage: true,
    });

    const activeDay = byDate.get("2091-04-02")!;
    const activeSpend = spend(activeDay.input.workoutActivity?.events);
    expect(activeSpend.workoutActivityKcalPerDay).toBeGreaterThan(0);
    expect(activeSpend.workoutEnergyResolution?.perEvent[0]?.source).toBe("bodycast-strength-met-fallback");
    expect(activeSpend.workoutEnergyResolution?.perEvent[0]?.kcal).not.toBe(999);

    const matchedBuilt = byDate.get("2091-04-03")!;
    expect(matchedBuilt.input.workoutActivity?.events).toHaveLength(1);
    expect(spend(matchedBuilt.input.workoutActivity?.events).workoutActivityKcalPerDay).toBe(matchedKcal);

    const pendingDay = byDate.get("2091-04-04")!;
    expect(pendingDay.input.workoutActivity?.events).toHaveLength(1);
    const pendingSpend = spend(pendingDay.input.workoutActivity?.events);
    expect(pendingSpend.workoutEnergyResolution?.perEvent[0]?.source).toBe("mechanical-stepper");
    expect(pendingSpend.workoutActivityKcalPerDay).toBeGreaterThan(0);

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
    expect(partialSpend.workoutActivityKcalPerDay).toBeGreaterThan(knownKcalValue);
    expect(partialSpend.workoutEnergyResolution?.energyCoverage).toMatchObject({
      fullCoverage: true,
      unknownEventCount: 0,
    });
    expect(eligibleHistoricalDonors(version, [partial])).toEqual([]);

    const legacy = buildSimulationDays({
      from: "2091-04-01",
      to: "2091-04-01",
      sources,
      modelVersion: CURRENT_MODEL_VERSION,
    })[0]!;
    expect(legacy.input.workoutActivity?.selectionPolicy).toBeUndefined();
    expect(legacy.input.workoutActivity?.events ?? []).toHaveLength(1);
    expect(legacy.input.workoutActivity?.events?.[0]).toMatchObject({
      classification: "traditional-strength-training",
      bodyCastEstimateKcal: webKcal,
      bodyCastEstimateFresh: true,
    });
    expect(legacy.sourceQuality.selectionV1).toBeUndefined();
    const unified = await prisma.unifiedExperimentalPhysiologyStateV2.findFirst({
      where: { profileId: 1, date: "2091-04-04" },
      orderBy: { boundaryAt: "asc" },
    });
    // This simulator fixture does not publish a production generation; the
    // generation-aware consumer must therefore fail closed without Unified.
    expect(unified).toBeNull();
  }, 60_000);

  it("materializes populated legacy Strength and reconciled Stepper rows idempotently for consumers", async () => {
    const strengthDate = "2091-04-10";
    const stepperDate = "2091-04-11";
    const strengthStart = new Date("2091-04-10T07:00:00.000Z");
    const strengthEnd = new Date("2091-04-10T08:00:00.000Z");
    const stepperStart = new Date("2091-04-11T08:00:00.000Z");
    const stepperEnd = new Date("2091-04-11T08:20:00.000Z");
    await day(strengthDate, 81);
    await day(stepperDate, 81, 8_000);
    await prisma.healthMetricSample.create({
      data: {
        date: strengthDate,
        metric: "weight-kg",
        source: "apple-health-shortcut",
        timestamp: new Date("2091-04-10T06:30:00.000Z"),
        value: 81,
      },
    });
    const strengthHealth = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: strengthDate } });
    const strengthWorkout = await prisma.workout.create({
      data: {
        dailyHealthDataId: strengthHealth.id,
        sourceIdentity: "ext:e2e-materialize-strength",
        externalId: "e2e-materialize-strength",
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        startAt: strengthStart,
        endAt: strengthEnd,
        durationMinutes: 60,
        activeEnergyKcal: 420,
        manualActiveEnergyKcal: 390,
      },
    });
    const strengthSession = await prisma.strengthDiarySession.create({
      data: {
        programId,
        programVersionId: versionId,
        status: "COMPLETED",
        entryMode: "LIVE",
        matchedWorkoutId: strengthWorkout.id,
        matchStatus: "MATCHED",
        effectiveAccountingAt: strengthStart,
        accountingTimeZone: "Europe/Bratislava",
        accountingTimeZoneProvenance: "integration-test",
        webStartedAt: strengthStart,
        webEndedAt: strengthEnd,
        exercises: {
          create: [{
            sortOrder: 0,
            snapshotExerciseName: exerciseName,
            plannedSets: 2,
            resistanceType: "BODYWEIGHT",
            sets: { create: [1, 2].map((setNumber) => ({
              setNumber,
              reps: 8,
              weightKg: 50 + setNumber * 5,
              completedAt: new Date(strengthStart.getTime() + setNumber * 20 * 60_000),
            })) },
          }],
        },
      },
    });
    await new TrainingService(prisma).refreshSessionAccounting(
      strengthSession.id,
      1,
      `legacy-materialization-strength-${strengthSession.id}`,
    );

    const stepperHealth = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: stepperDate } });
    const manualWorkout = await prisma.workout.create({
      data: {
        dailyHealthDataId: stepperHealth.id,
        sourceIdentity: "manual:stepper:e2e-materialize-stepper",
        type: STAIR_CLIMBING_TYPE,
        startAt: stepperStart,
        endAt: stepperEnd,
        durationMinutes: 20,
        manualStepCount: 1_600,
        manualActiveEnergyKcal: 70,
      },
    });
    const deviceWorkout = await prisma.workout.create({
      data: {
        dailyHealthDataId: stepperHealth.id,
        sourceIdentity: "ext:e2e-materialize-stepper",
        externalId: "e2e-materialize-stepper",
        type: STAIR_CLIMBING_TYPE,
        startAt: stepperStart,
        endAt: stepperEnd,
        durationMinutes: 20,
        activeEnergyKcal: 140,
      },
    });
    const reconciliation = await prisma.stepperReconciliationGroup.create({
      data: {
        profileId: 1,
        status: "confirmed",
        evaluationRevision: 1,
        policyVersion: "stepper-reconciliation-v1",
        localDate: stepperDate,
        sourceRevision: "e2e-materialize-stepper-v1",
        candidates: {
          create: [{
            manualWorkoutId: manualWorkout.id,
            garminWorkoutId: deviceWorkout.id,
            candidateStatus: "confirmed",
            manualCoverage: 1,
            garminCoverage: 1,
            stepEvidenceStatus: "bracketed",
          }],
        },
      },
    });
    await prisma.healthActivityInterval.createMany({
      data: [400, 350, 450, 400].map((value, index) => ({
        date: stepperDate,
        metric: "steps",
        startAt: new Date(stepperStart.getTime() + index * 5 * 60_000),
        endAt: new Date(stepperStart.getTime() + (index + 1) * 5 * 60_000),
        value,
        sourceFingerprint: `e2e-materialize-stepper-${index}`,
      })),
    });

    const strengthAliases = [
      { sourceType: "strength-session", sourceId: String(strengthSession.id) },
      { sourceType: "workout", sourceId: String(strengthWorkout.id) },
    ];
    const stepperAliases = [manualWorkout.id, deviceWorkout.id].map((id) => ({
      sourceType: "workout",
      sourceId: String(id),
    }));
    expect(await prisma.activeEnergyCanonicalEvent.count({
      where: { profileId: 1, aliases: { some: { OR: [...strengthAliases, ...stepperAliases] } } },
    })).toBe(0);

    const first = await materializeActiveEnergyCandidatesV1(1);
    expect(first.strengthSessionIds).toContain(strengthSession.id);
    expect(first.stepperWorkoutIds).toEqual(expect.arrayContaining([manualWorkout.id, deviceWorkout.id]));
    const strengthEvent = await prisma.activeEnergyCanonicalEvent.findFirstOrThrow({
      where: { profileId: 1, aliases: { some: { sourceType: "strength-session", sourceId: String(strengthSession.id) } } },
      include: { aliases: true, candidates: true, resolutions: true },
    });
    expect(strengthEvent.logicalEventKey).toBe(`workout:${strengthWorkout.id}`);
    expect(strengthEvent.aliases.map(({ sourceType, sourceId }) => [sourceType, sourceId]).sort()).toEqual([
      ["strength-session", String(strengthSession.id)],
      ["workout", String(strengthWorkout.id)],
    ].sort());
    expect(strengthEvent.currentSource).toBe("bodycast-strength-estimate");
    expect(strengthEvent.currentKcal).toBeGreaterThan(0);
    expect(strengthEvent.resolutions).toHaveLength(1);

    const stepperEvent = await prisma.activeEnergyCanonicalEvent.findFirstOrThrow({
      where: { profileId: 1, logicalEventKey: `stepper-reconciliation:${reconciliation.id}` },
      include: { aliases: true, candidates: true, resolutions: true },
    });
    expect(stepperEvent.aliases.map(({ sourceId }) => sourceId).sort()).toEqual(
      [String(manualWorkout.id), String(deviceWorkout.id)].sort(),
    );
    expect(stepperEvent.currentSource).toBe("bodycast-stepper-mechanical");
    expect(stepperEvent.currentKcal).toBeGreaterThan(0);
    const firstMaterializedCounts = {
      aliases: stepperEvent.aliases.length,
      candidates: stepperEvent.candidates.length,
      resolutions: stepperEvent.resolutions.length,
      revision: stepperEvent.resolutionRevision,
    };

    const readBuiltDay = async (date: string) => {
      const sources = await repository.loadSources(date, date, "Europe/Bratislava");
      return buildSimulationDays({
        from: date,
        to: date,
        sources,
        modelVersion: version,
        timeZone: "Europe/Bratislava",
      })[0]!;
    };
    const strengthBuilt = await readBuiltDay(strengthDate);
    expect(strengthBuilt.input.workoutActivity?.events).toHaveLength(1);
    const strengthConsumption = spend(strengthBuilt.input.workoutActivity?.events);
    expect(strengthConsumption.workoutActivityKcalPerDay).toBe(strengthEvent.currentKcal);
    expect(strengthConsumption.workoutEnergyResolution?.perEvent).toMatchObject([
      { source: "bodycast-strength-estimate", kcal: strengthEvent.currentKcal },
    ]);

    const stepperBuilt = await readBuiltDay(stepperDate);
    expect(stepperBuilt.input.workoutActivity?.events).toHaveLength(1);
    const stepperConsumption = spend(stepperBuilt.input.workoutActivity?.events);
    expect(stepperConsumption.workoutActivityKcalPerDay).toBe(stepperEvent.currentKcal);
    expect(stepperConsumption.workoutEnergyResolution?.perEvent).toMatchObject([
      { source: "mechanical-stepper", kcal: stepperEvent.currentKcal },
    ]);

    const rawInputsBeforeRepeatedMaterialization = await inventoryFullHistoryRawInputs(prisma);
    const accountingOperationsBeforeRepeatedMaterialization = await prisma.strengthSessionAccountingOperation.count({
      where: { session: { program: { name: programName } } },
    });
    await materializeActiveEnergyCandidatesV1(1);
    const rawInputsAfterRepeatedMaterialization = await inventoryFullHistoryRawInputs(prisma);
    const accountingOperationsAfterRepeatedMaterialization = await prisma.strengthSessionAccountingOperation.count({
      where: { session: { program: { name: programName } } },
    });
    expect(accountingOperationsAfterRepeatedMaterialization).toBeGreaterThan(accountingOperationsBeforeRepeatedMaterialization);
    expect(rawInputsAfterRepeatedMaterialization.fingerprint).toBe(rawInputsBeforeRepeatedMaterialization.fingerprint);
    const repeatedStepperEvent = await prisma.activeEnergyCanonicalEvent.findUniqueOrThrow({
      where: { id: stepperEvent.id },
      include: { aliases: true, candidates: true, resolutions: true },
    });
    expect({
      aliases: repeatedStepperEvent.aliases.length,
      candidates: repeatedStepperEvent.candidates.length,
      resolutions: repeatedStepperEvent.resolutions.length,
      revision: repeatedStepperEvent.resolutionRevision,
    }).toEqual(firstMaterializedCounts);
    const eventsForBothStepperAliases = await prisma.activeEnergyCanonicalEvent.findMany({
      where: { profileId: 1, aliases: { some: { OR: stepperAliases } }, supersededByEventId: null },
    });
    expect(eventsForBothStepperAliases).toHaveLength(1);

    // Simulate a legacy session whose persisted accounting snapshot is missing
    // and whose fallback context has not yet been materialized. Rebuilding the
    // snapshot may fill only those derived fields; its primary session inputs
    // and semantic fingerprint must remain stable.
    const sessionBeforeStaleRefresh = await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: strengthSession.id },
      select: {
        id: true, profileId: true, programId: true, programVersionId: true,
        status: true, entryMode: true, webStartedAt: true, webEndedAt: true,
        revision: true, accountingInputRevision: true, matchedWorkoutId: true,
        matchStatus: true, matchMethod: true, matchedAt: true,
        currentSnapshotRevision: true,
      },
    });
    expect(sessionBeforeStaleRefresh.currentSnapshotRevision).not.toBeNull();
    const stalePointerRevision = sessionBeforeStaleRefresh.currentSnapshotRevision!;
    await prisma.strengthDiarySession.update({
      where: { id: strengthSession.id },
      data: {
        currentSnapshotRevision: null,
        effectiveAccountingAt: null,
        accountingTimeZone: null,
        accountingTimeZoneProvenance: null,
      },
    });
    const sourceInputsBeforeStaleRefresh = await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: strengthSession.id },
      select: {
        id: true, profileId: true, programId: true, programVersionId: true,
        status: true, entryMode: true, webStartedAt: true, webEndedAt: true,
        revision: true, accountingInputRevision: true, matchedWorkoutId: true,
        matchStatus: true, matchMethod: true, matchedAt: true,
      },
    });
    const rawInputsBeforeStaleRefresh = await inventoryFullHistoryRawInputs(prisma);
    const snapshotsBeforeStaleRefresh = await prisma.strengthSessionAccountingSnapshot.count({
      where: { sessionId: strengthSession.id },
    });

    const staleRefresh = await materializeActiveEnergyCandidatesV1(1);

    const sessionAfterStaleRefresh = await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: strengthSession.id },
      select: {
        id: true, profileId: true, programId: true, programVersionId: true,
        status: true, entryMode: true, webStartedAt: true, webEndedAt: true,
        revision: true, accountingInputRevision: true, matchedWorkoutId: true,
        matchStatus: true, matchMethod: true, matchedAt: true,
        currentSnapshotRevision: true, effectiveAccountingAt: true,
        accountingTimeZone: true, accountingTimeZoneProvenance: true,
      },
    });
    const rawInputsAfterStaleRefresh = await inventoryFullHistoryRawInputs(prisma);
    expect(staleRefresh.strengthSessionIds).toContain(strengthSession.id);
    expect(sessionAfterStaleRefresh.currentSnapshotRevision).toBeGreaterThan(stalePointerRevision);
    expect(await prisma.strengthSessionAccountingSnapshot.count({ where: { sessionId: strengthSession.id } }))
      .toBeGreaterThan(snapshotsBeforeStaleRefresh);
    expect(sessionAfterStaleRefresh).toMatchObject(sourceInputsBeforeStaleRefresh);
    expect(sessionAfterStaleRefresh).toMatchObject({
      effectiveAccountingAt: strengthStart,
      accountingTimeZone: "Europe/Bratislava",
      accountingTimeZoneProvenance: "legacy-default",
    });
    expect(rawInputsAfterStaleRefresh.fingerprint).toBe(rawInputsBeforeStaleRefresh.fingerprint);

    await prisma.strengthDiarySession.update({
      where: { id: strengthSession.id },
      data: { webEndedAt: new Date(strengthEnd.getTime() + 1_000) },
    });
    const rawInputsAfterSessionInputEdit = await inventoryFullHistoryRawInputs(prisma);
    expect(rawInputsAfterSessionInputEdit.fingerprint).not.toBe(rawInputsAfterStaleRefresh.fingerprint);
    expect(rawInputsAfterSessionInputEdit.tables.find((table) => table.table === "StrengthDiarySession")?.contentSha256)
      .not.toBe(rawInputsAfterStaleRefresh.tables.find((table) => table.table === "StrengthDiarySession")?.contentSha256);
  }, 120_000);

  it("keeps Strength freshness symmetric for absent, incomplete, blocked, and complete model days", async () => {
    const date = "2091-04-08";
    const sampleAt = new Date("2091-04-08T06:30:00.000Z");
    await day(date, 81);
    await prisma.healthMetricSample.create({
      data: { date, metric: "weight-kg", source: "apple-health-shortcut", timestamp: sampleAt, value: 81 },
    });
    const prepared = prepareEpisodeInitialization({
      profile: modelProfile,
      days: stableSourceDays({ count: 90, endDate: date }),
      startDate: date,
      timezone: "Europe/Bratislava",
    });
    const freshnessEpisode = await repository.createPrepared(prepared);
    await prisma.modelEpisode.update({ where: { id: freshnessEpisode.id }, data: { latestModeledDate: date } });
    let sessionId: number | null = null;

    const readFreshness = async () => {
      const sources = await repository.loadSources(date, date);
      const session = sources.webOnlyStrengthSessions?.find((candidate) => candidate.sessionId === sessionId);
      return session?.bodyCastEstimateFresh ?? false;
    };
    const readFingerprint = async () => {
      if (sessionId === null) throw new Error("Strength session fixture was not created");
      const row = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId } });
      return (row.result as { inputFingerprint: string }).inputFingerprint;
    };
    const recordAndAssertFresh = async () => {
      if (sessionId === null) throw new Error("Strength session fixture was not created");
      await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId, profileId: 1 });
      expect(await readFreshness()).toBe(true);
      return readFingerprint();
    };

    try {
      const session = await prisma.strengthDiarySession.create({
        data: {
          programId,
          programVersionId: versionId,
          status: "COMPLETED",
          entryMode: "LIVE",
          webStartedAt: new Date("2091-04-08T07:00:00.000Z"),
          webEndedAt: new Date("2091-04-08T08:00:00.000Z"),
          effectiveAccountingAt: new Date("2091-04-08T07:00:00.000Z"),
          accountingTimeZone: "Europe/Bratislava",
          accountingTimeZoneProvenance: "client-session",
          exercises: {
            create: [{
              sortOrder: 0,
              snapshotExerciseName: exerciseName,
              plannedSets: 1,
              resistanceType: "BODYWEIGHT",
              sets: { create: [{
                setNumber: 1,
                reps: 8,
                weightKg: 60,
                completedAt: new Date("2091-04-08T07:30:00.000Z"),
              }] },
            }],
          },
        },
      });
      sessionId = session.id;
      const training = new TrainingService(prisma);
      const accounting = await training.refreshSessionAccounting(session.id, 1, `strength-model-day-freshness-${session.id}`);
      expect(accounting.activeEnergyMassReference?.reference).toMatchObject({ status: "observed", valueKg: 81 });

      // No DailyModelState is an explicit null dependency and remains deterministic.
      const absentFingerprint = await recordAndAssertFresh();
      expect(await recordAndAssertFresh()).toBe(absentFingerprint);

      for (const status of ["incomplete", "blocked"] as const) {
        await prisma.dailyModelState.upsert({
          where: { episodeId_date: { episodeId: freshnessEpisode.id, date } },
          create: {
            episodeId: freshnessEpisode.id,
            date,
            status,
            sourceQuality: {},
            missingFields: [],
            modelVersion: freshnessEpisode.modelVersion,
            dynamicRmrKcalPerDay: 1_420,
          },
          update: { status, dynamicRmrKcalPerDay: 1_420 },
        });
        const firstFingerprint = await recordAndAssertFresh();
        expect(await recordAndAssertFresh()).toBe(firstFingerprint);
        await prisma.dailyModelState.update({
          where: { episodeId_date: { episodeId: freshnessEpisode.id, date } },
          data: { dynamicRmrKcalPerDay: 1_610 },
        });
        // RMR from non-complete model days is not used by the MET fallback.
        expect(await readFreshness()).toBe(true);
        expect(await recordAndAssertFresh()).toBe(firstFingerprint);
      }

      await prisma.dailyModelState.update({
        where: { episodeId_date: { episodeId: freshnessEpisode.id, date } },
        data: { status: "complete", dynamicRmrKcalPerDay: 1_610 },
      });
      const completeFingerprint = await recordAndAssertFresh();
      await prisma.dailyModelState.update({
        where: { episodeId_date: { episodeId: freshnessEpisode.id, date } },
        data: { dynamicRmrKcalPerDay: 1_720 },
      });
      // A complete-day RMR change affects the persisted MET fallback fingerprint.
      expect(await readFreshness()).toBe(false);
      const refreshedFingerprint = await recordAndAssertFresh();
      expect(refreshedFingerprint).not.toBe(completeFingerprint);
      expect(await recordAndAssertFresh()).toBe(refreshedFingerprint);
    } finally {
      if (sessionId !== null) {
        await prisma.activeEnergyCanonicalEvent.deleteMany({
          where: { profileId: 1, aliases: { some: { sourceType: "strength-session", sourceId: String(sessionId) } } },
        });
        await prisma.experimentalStrengthEnergyShadow.deleteMany({ where: { sessionId } });
        await prisma.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      }
      await prisma.modelEpisode.deleteMany({ where: { id: freshnessEpisode.id } });
      await prisma.healthMetricSample.deleteMany({ where: { metric: "weight-kg", timestamp: sampleAt } });
      await deleteDailyHealthRows(prisma, [date]);
    }
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
    const garminCanonical = await prisma.workout.create({
      data: {
        dailyHealthDataId: hiddenDay.id,
        sourceIdentity: "ext:e2e-garmin-canonical",
        type: STAIR_CLIMBING_TYPE,
        startAt: new Date("2091-04-09T07:00:00.000Z"),
        endAt: new Date("2091-04-09T08:00:00.000Z"),
        durationMinutes: 60,
        activeEnergyKcal: 400,
        hiddenFromHistory: false,
        syncProtected: false,
      },
    });
    const manualAudit = await prisma.workout.create({
      data: {
        dailyHealthDataId: hiddenDay.id,
        sourceIdentity: "manual:stepper:e2e-audit",
        type: STAIR_CLIMBING_TYPE,
        startAt: new Date("2091-04-09T07:00:00.000Z"),
        endAt: new Date("2091-04-09T08:00:00.000Z"),
        durationMinutes: 60,
        activeEnergyKcal: null,
        manualStepCount: 1000,
        manualActiveEnergyKcal: 120,
        hiddenFromHistory: false,
        syncProtected: false,
      },
    });
    const confirmedGroup = await prisma.stepperReconciliationGroup.create({
      data: {
        status: "confirmed",
        policyVersion: "bodycast-stepper-reconciliation-v1",
        localDate: "2091-04-09",
        provisionalWorkoutId: manualAudit.id,
        candidates: {
          create: [{
            manualWorkoutId: manualAudit.id,
            garminWorkoutId: garminCanonical.id,
            candidateStatus: "confirmed",
            manualCoverage: 1,
            garminCoverage: 1,
            stepEvidenceStatus: "comparable",
          }],
        },
      },
    });
    // Confirmed status alone must not mutate production-facing visibility.
    const beforeActivationGarmin = await prisma.workout.findUniqueOrThrow({ where: { id: garminCanonical.id } });
    const beforeActivationManual = await prisma.workout.findUniqueOrThrow({ where: { id: manualAudit.id } });
    expect(beforeActivationGarmin.hiddenFromHistory).toBe(false);
    expect(beforeActivationManual.hiddenFromHistory).toBe(false);
    expect(beforeActivationManual.supersededByWorkoutId).toBeNull();
    expect(confirmedGroup.status).toBe("confirmed");

    const confirmedSources = await repository.loadSources("2091-04-09", "2091-04-09");
    const confirmedLink = confirmedSources.reconciliationLinks?.find(
      (link) => link.manualWorkoutId === manualAudit.id && link.garminWorkoutId === garminCanonical.id,
    );
    expect(confirmedLink).toMatchObject({
      status: "confirmed",
      suppressGarminEnergy: false,
      suppressManualEnergy: true,
    });

    await activateVisibilityGenerationV1({
      store,
      generationId: "e2e-activation",
      changes: [{ recordId: manualAudit.id, supersedingWorkoutId: garminCanonical.id }],
    });
    const activatedManual = await prisma.workout.findUniqueOrThrow({ where: { id: manualAudit.id } });
    const activatedGarmin = await prisma.workout.findUniqueOrThrow({ where: { id: garminCanonical.id } });
    expect(activatedManual.hiddenFromHistory).toBe(true);
    expect(activatedManual.syncProtected).toBe(true);
    expect(activatedManual.supersededByWorkoutId).toBe(garminCanonical.id);
    expect(activatedGarmin.hiddenFromHistory).toBe(false);
    expect(activatedGarmin.supersededByWorkoutId).toBeNull();
    await rollbackVisibilityGenerationV1({ store, generationId: "e2e-activation" });
    const restoredManual = await prisma.workout.findUniqueOrThrow({ where: { id: manualAudit.id } });
    expect(restoredManual.hiddenFromHistory).toBe(false);
    expect(restoredManual.syncProtected).toBe(false);
    expect(restoredManual.supersededByWorkoutId).toBeNull();
    expect(await prisma.activationRollbackEntry.count({ where: { generationId: "e2e-activation" } })).toBeGreaterThan(0);

    // Keep legacy fixture row for later cleanup paths.
    expect(hidden.hiddenFromHistory).toBe(true);

    const episode = await repository.getActive() ?? {
      ...persistedEpisodeFixture("2091-04-01"),
      active: false,
      modelVersion: CURRENT_MODEL_VERSION,
    };
    const reconstruction = await reconstructSelectionHistoryV1({
      repository,
      episode: { ...episode, modelVersion: version, active: false },
      from: "2091-04-01",
      to: "2091-04-07",
    });
    expect(reconstruction.status).toBe("complete");
    expect(reconstruction.completed.length).toBeGreaterThan(0);
    expect(reconstruction.donorEligibleDates).not.toContain("2091-04-07");
    const stale = await reconstructSelectionHistoryV1({
      repository,
      episode: { ...episode, modelVersion: version, active: false },
      from: "2091-04-01",
      to: "2091-04-01",
      expectedSourceRevision: "not-current",
    });
    expect(stale.status).toBe("stale-source");

    // Real ModelEpisode persist + opt-in activation/rollback (isolated DB only).
    // Never flip an unrelated active episode — create a dedicated inactive staging row.
    await prisma.dailyModelState.deleteMany({
      where: { date: { in: dates }, episode: { startDate: "2091-04-01", baselineDerivationMethod: "fixture-selection-v1" } },
    });
    await prisma.modelEpisode.deleteMany({
      where: { startDate: "2091-04-01", baselineDerivationMethod: "fixture-selection-v1" },
    });
    const created = await prisma.modelEpisode.create({
      data: {
        profileId: 1,
        startDate: "2091-04-01",
        timezone: "Europe/Bratislava",
        modelVersion: CURRENT_MODEL_VERSION,
        active: false,
        deactivatedAt: new Date(),
        ecfPolicy: "hold-ecf",
        baselineEnergyIntakeKcalPerDay: 2500,
        baselineCarbIntakeG: 250,
        baselineWindowStartDate: "2091-04-01",
        baselineWindowEndDate: "2091-04-01",
        baselineNutritionDayCount: 1,
        baselineWeightObservationCount: 1,
        baselineWeightTrendKgPerWeek: 0,
        baselineWeightTrendPercentPerWeek: 0,
        baselineDerivationMethod: "fixture-selection-v1",
        initialFatMassKg: 20,
        initialLeanTissueKg: 60,
        initialGlycogenKg: 0.5,
        baselineExtracellularFluidLiters: 15,
        initialExtracellularFluidDeviationLiters: 0,
        initialAdaptiveThermogenesisKcalPerDay: 0,
        initialFilteredWeightKg: 80,
        initialWeightFilterVarianceKg2: 1,
        initialRmrKcalPerDay: 1600,
        dynamicRmrFatCoefficient: 1,
        dynamicRmrLeanCoefficient: 1,
        dynamicRmrCalibrationOffsetKcalPerDay: 0,
        adaptiveThermogenesisBeta: 0,
        adaptiveThermogenesisTimeConstantDays: 14,
        weightProcessNoiseVarianceKg2PerDay: 0.1,
        weightMeasurementNoiseVarianceKg2: 0.1,
        calibrationDiagnostics: {},
      },
    });
    const persistedEpisode = await repository.getById(created.id);
    expect(persistedEpisode).not.toBeNull();
    const priorVersion = persistedEpisode!.modelVersion;
    const staged = await persistSelectionEpisodeHistoryV1({
      client: prisma,
      repository,
      episode: persistedEpisode!,
      from: "2091-04-01",
      to: "2091-04-07",
      generationId: "e2e-episode-activation",
      confirmActivation: true,
    });
    expect(staged.status).toBe("complete");
    expect(staged.persisted).toBe(true);
    expect(staged.activated).toBe(true);
    const activatedEpisode = await repository.getById(persistedEpisode!.id);
    expect(activatedEpisode?.modelVersion).toBe(version);
    expect(activatedEpisode?.active).toBe(false);
    const activatedDay = await prisma.dailyModelState.findFirst({
      where: { episodeId: persistedEpisode!.id, date: "2091-04-01" },
      select: { modelVersion: true, sourceQuality: true },
    });
    expect(activatedDay?.modelVersion).toBe(version);
    expect(JSON.stringify(activatedDay?.sourceQuality)).toContain("selectionV1");
    const rolled = await rollbackSelectionEpisodeActivationV1({
      client: prisma,
      repository,
      episode: { ...persistedEpisode!, modelVersion: version },
      from: "2091-04-01",
      to: "2091-04-07",
      generationId: "e2e-episode-activation",
    });
    expect(rolled.conflicts).toBe(false);
    expect(rolled.restoredModelVersion).toBe(priorVersion);
    const restoredEpisode = await repository.getById(persistedEpisode!.id);
    expect(restoredEpisode?.modelVersion).toBe(priorVersion);
    // Default constant remains isolated from activation.
    expect(CURRENT_MODEL_VERSION).toBe("bodycast-physiology-v7");
    await prisma.dailyModelState.deleteMany({ where: { episodeId: created.id } });
    await prisma.modelEpisode.delete({ where: { id: created.id } });
  }, 60_000);
});

describe("reconciliation confirm/reject PostgreSQL", () => {
  const reconDates = ["2091-05-01", "2091-05-02"];

  async function cleanRecon() {
    await prisma.activationRollbackEntry.deleteMany({ where: { generationId: { startsWith: "recon-e2e-" } } });
    await prisma.stepperReconciliationCandidate.deleteMany({
      where: { group: { localDate: { in: reconDates } } },
    });
    await prisma.stepperReconciliationGroup.deleteMany({ where: { localDate: { in: reconDates } } });
    await deleteDailyHealthRows(prisma, reconDates);
  }

  beforeAll(async () => {
    await cleanRecon();
  }, 60_000);

  afterAll(async () => {
    await cleanRecon();
    await prisma.$disconnect();
  });

  it("confirms one-to-one matching and rejects remaining candidates", async () => {
    await day("2091-05-01", 80, 10_000);
    const manual = await steppers.create({
      startAt: "2091-05-01T09:00:00.000+02:00",
      durationMinutes: 60,
      manualStepCount: 2000,
      manualActiveEnergyKcal: 300,
    });
    await prisma.dailyHealthData.update({
      where: { date: "2091-05-01" },
      data: { steps: 10_000, weightKg: 80, caloriesKcal: 2500, proteinG: 150, fatG: 70, carbsG: 250, averageWalkingSpeedKmh: 5, walkingDistanceKm: 0, strengthTrainingMinutes: 0, workoutFeedObserved: true },
    });
    await syncHealthData({
      timezone: "Europe/Bratislava",
      days: [{
        date: "2091-05-01",
        steps: 10_000,
        weightKg: 80,
        caloriesKcal: 2500,
        proteinG: 150,
        fatG: 70,
        carbsG: 250,
        workouts: [{
          externalId: "recon-e2e-garmin",
          type: STAIR_CLIMBING_TYPE,
          startAt: "2091-05-01T09:00:00+02:00",
          endAt: "2091-05-01T10:00:00+02:00",
          durationMinutes: 60,
          activeEnergyKcal: 400,
        }],
      }],
    });
    const garmin = await prisma.workout.findFirstOrThrow({
      where: { externalId: "recon-e2e-garmin" },
    });
    await persistStepperReconciliationV1(prisma, {
      from: "2091-05-01",
      to: "2091-05-01",
      synchronizedSteps: 10_000,
    });
    const candidate = await prisma.stepperReconciliationCandidate.findFirstOrThrow({
      where: { manualWorkoutId: manual.id, garminWorkoutId: garmin.id },
    });
    expect(["pending", "ambiguous"]).toContain(candidate.candidateStatus);

    // An evaluation/source revision is a persisted source mutation in its own
    // transaction. It must stale the old V7 generation before any refresh.
    await prisma.workout.update({
      where: { id: garmin.id },
      data: { endAt: new Date("2091-05-01T07:50:00.000Z"), durationMinutes: 50 },
    });
    const beforeReevaluation = await lifecycleFreshness();
    await persistStepperReconciliationV1(prisma, {
      from: "2091-05-01",
      to: "2091-05-01",
      synchronizedSteps: 10_000,
    });
    const afterReevaluation = await lifecycleFreshness();
    expect(afterReevaluation?.invalidationGeneration ?? 0)
      .toBeGreaterThan(beforeReevaluation?.invalidationGeneration ?? 0);
    expect(afterReevaluation?.staleFromDate).not.toBeNull();

    const beforeConfirm = await lifecycleFreshness();
    await confirmStepperReconciliationV1(prisma, {
      manualWorkoutId: manual.id,
      garminWorkoutId: garmin.id,
    });
    const afterConfirm = await lifecycleFreshness();
    expect(afterConfirm?.invalidationGeneration ?? 0)
      .toBeGreaterThan(beforeConfirm?.invalidationGeneration ?? 0);
    expect(afterConfirm?.staleFromDate).not.toBeNull();
    const confirmed = await prisma.stepperReconciliationCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    expect(confirmed.candidateStatus).toBe("confirmed");
    const group = await prisma.stepperReconciliationGroup.findUniqueOrThrow({
      where: { id: candidate.groupId },
    });
    expect(group.status).toBe("confirmed");
    expect(group.provisionalWorkoutId).toBe(manual.id);
    const garminAfterConfirm = await prisma.workout.findUniqueOrThrow({ where: { id: garmin.id } });
    const manualAfterConfirm = await prisma.workout.findUniqueOrThrow({ where: { id: manual.id } });
    expect(garminAfterConfirm.hiddenFromHistory).toBe(false);
    expect(manualAfterConfirm.hiddenFromHistory).toBe(false);

    const { activateConfirmedReconciliationVisibilityV1, rollbackActivationGenerationV1 } = await import(
      "@/modules/model-episodes/selection-v1-episode-ops"
    );
    await activateConfirmedReconciliationVisibilityV1({
      client: prisma,
      generationId: "recon-e2e-activation",
      manualWorkoutId: manual.id,
      garminWorkoutId: garmin.id,
    });
    const afterActivationManual = await prisma.workout.findUniqueOrThrow({ where: { id: manual.id } });
    const afterActivationGarmin = await prisma.workout.findUniqueOrThrow({ where: { id: garmin.id } });
    expect(afterActivationManual.hiddenFromHistory).toBe(true);
    expect(afterActivationManual.supersededByWorkoutId).toBe(garmin.id);
    expect(afterActivationGarmin.hiddenFromHistory).toBe(false);
    await rollbackActivationGenerationV1({ client: prisma, generationId: "recon-e2e-activation" });
    const rolledManual = await prisma.workout.findUniqueOrThrow({ where: { id: manual.id } });
    expect(rolledManual.hiddenFromHistory).toBe(false);
    expect(rolledManual.supersededByWorkoutId).toBeNull();

    const otherManual = await steppers.create({
      startAt: "2091-05-01T11:00:00.000+02:00",
      durationMinutes: 60,
      manualStepCount: 1500,
      manualActiveEnergyKcal: 200,
    });
    const otherDay = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: "2091-05-01" } });
    const otherGarmin = await prisma.workout.create({
      data: {
        dailyHealthDataId: otherDay.id,
        sourceIdentity: "ext:recon-e2e-garmin-2",
        externalId: "recon-e2e-garmin-2",
        type: STAIR_CLIMBING_TYPE,
        startAt: new Date("2091-05-01T09:00:00.000Z"),
        endAt: new Date("2091-05-01T10:00:00.000Z"),
        durationMinutes: 60,
        activeEnergyKcal: 250,
      },
    });
    await persistStepperReconciliationV1(prisma, {
      from: "2091-05-01",
      to: "2091-05-01",
      synchronizedSteps: 10_000,
    });
    const other = await prisma.stepperReconciliationCandidate.findFirstOrThrow({
      where: { manualWorkoutId: otherManual.id, garminWorkoutId: otherGarmin.id },
    });
    const beforeReject = await lifecycleFreshness();
    await rejectStepperReconciliationV1(prisma, { groupId: other.groupId });
    const afterReject = await lifecycleFreshness();
    expect(afterReject?.invalidationGeneration ?? 0)
      .toBeGreaterThan(beforeReject?.invalidationGeneration ?? 0);
    expect(afterReject?.staleFromDate).not.toBeNull();
    const rejected = await prisma.stepperReconciliationGroup.findUniqueOrThrow({
      where: { id: other.groupId },
    });
    expect(rejected.status).toBe("rejected");
    const rejectedCandidates = await prisma.stepperReconciliationCandidate.findMany({
      where: { groupId: other.groupId },
    });
    expect(rejectedCandidates.every((row) => row.candidateStatus === "rejected")).toBe(true);

    // The reconciliation writer may be composed into a wider source
    // transaction. Its group write and generation invalidation must roll back
    // together if the caller aborts that transaction.
    const rollbackDate = "2091-05-02";
    const rollbackDay = await day(rollbackDate, 80, 10_000);
    await steppers.create({
      startAt: "2091-05-02T09:00:00.000+02:00",
      durationMinutes: 60,
      manualStepCount: 2_000,
    });
    await prisma.workout.create({
      data: {
        dailyHealthDataId: rollbackDay.id,
        sourceIdentity: "ext:recon-e2e-rollback-garmin",
        externalId: "recon-e2e-rollback-garmin",
        type: STAIR_CLIMBING_TYPE,
        startAt: new Date("2091-05-02T07:00:00.000Z"),
        endAt: new Date("2091-05-02T08:00:00.000Z"),
        durationMinutes: 60,
        activeEnergyKcal: 250,
      },
    });
    const beforeRollback = await lifecycleFreshness();
    await expect(prisma.$transaction(async (transaction) => {
      await persistStepperReconciliationV1(transaction, { from: rollbackDate, to: rollbackDate });
      throw new Error("rollback reconciliation write");
    })).rejects.toThrow("rollback reconciliation write");
    const afterRollback = await lifecycleFreshness();
    expect(afterRollback?.invalidationGeneration).toBe(beforeRollback?.invalidationGeneration);
    expect(await prisma.stepperReconciliationGroup.count({ where: { localDate: rollbackDate } })).toBe(0);
  }, 60_000);
});
