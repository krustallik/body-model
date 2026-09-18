import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import { createUnavailablePhysiologyRuntimeStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import { STAIR_CLIMBING_TYPE, TRADITIONAL_STRENGTH_TRAINING_TYPE } from "@/modules/health/expand-training-workouts";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";
import { PhysiologyV7RuntimeRepository } from "@/modules/model-episodes/physiology-v7-runtime.repository";
import { PhysiologyV7RuntimeService } from "@/modules/model-episodes/physiology-v7-runtime.service";
import { RESISTANCE } from "@/modules/training/training.constants";
import { TrainingRepository } from "@/modules/training/training.repository";
import { TrainingService } from "@/modules/training/training.service";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const profileId = 1;
const dates = ["2049-06-01", "2049-06-02", "2049-06-03"] as const;
const repository = new PhysiologyV7RuntimeRepository(prisma);
const runtime = new PhysiologyV7RuntimeService(repository);
const trainingRepository = new TrainingRepository(prisma);
const trainingService = new TrainingService(prisma, trainingRepository);
let originalProfile: Awaited<ReturnType<typeof prisma.profile.findFirst>>;

async function clean(): Promise<void> {
  const fixtureProgram = { profileId, name: "Stage 9A" };
  await prisma.strengthSet.deleteMany({
    where: { sessionExercise: { session: { programVersion: { program: fixtureProgram } } } },
  });
  await prisma.strengthSessionExercise.deleteMany({
    where: { session: { programVersion: { program: fixtureProgram } } },
  });
  await prisma.strengthDiarySession.deleteMany({
    where: { programVersion: { program: fixtureProgram } },
  });
  await prisma.programExercise.deleteMany({ where: { programVersion: { program: fixtureProgram } } });
  await prisma.trainingProgramVersion.deleteMany({ where: { program: fixtureProgram } });
  await prisma.trainingProgram.deleteMany({ where: fixtureProgram });
  await prisma.heartRateSample.deleteMany({ where: { profileId, date: { in: [...dates] } } });
  await prisma.restingHeartRateSample.deleteMany({ where: { profileId, date: { in: [...dates] } } });
  await prisma.sleepSegment.deleteMany({
    where: {
      profileId,
      startAt: { gte: new Date("2049-06-01T00:00:00.000Z") },
      endAt: { lte: new Date("2049-06-04T00:00:00.000Z") },
    },
  });
  await prisma.healthSyncSnapshot.deleteMany({ where: { date: { in: [...dates] } } });
  await deleteDailyHealthRows(prisma, dates);
}

describe("v7 production rebuild from durable PostgreSQL sources", () => {
  beforeAll(async () => {
    originalProfile = await prisma.profile.findUnique({ where: { id: profileId } });
  });

  afterAll(async () => {
    await clean();
    if (originalProfile) {
      await prisma.profile.upsert({
        where: { id: profileId },
        create: originalProfile,
        update: originalProfile,
      });
    } else {
      await prisma.profile.deleteMany({ where: { id: profileId } });
    }
    await prisma.$disconnect();
  });

  it("assembles local days and runs Stage 7 plus 8B→8C→8D deterministically", async () => {
    await clean();
    await prisma.profile.upsert({
      where: { id: profileId },
      create: {
        id: profileId,
        sex: "male",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        heightCm: 180,
      },
      update: {
        sex: "male",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        heightCm: 180,
      },
    });
    for (const [index, date] of dates.entries()) {
      await prisma.dailyHealthData.create({
        data: {
          date,
          weightKg: 80 - index * 0.1,
          bodyFatPercent: 20,
          caloriesKcal: 2_300,
          proteinG: 150,
          fatG: 75,
          carbsG: 250,
          steps: 7_000 + index * 500,
          walkingDistanceKm: 5 + index * 0.2,
          workoutFeedObserved: true,
          rawPayload: {},
        },
      });
    }

    const legacyStart = new Date("2049-06-01T16:00:00.000Z");
    const legacyEnd = new Date("2049-06-01T17:00:00.000Z");
    await prisma.workout.create({
      data: {
        dailyHealthData: { connect: { date: dates[0] } },
        externalId: "v7-legacy",
        sourceIdentity: workoutSourceIdentity({
          externalId: "v7-legacy",
          type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
          startAt: legacyStart,
          endAt: legacyEnd,
        }),
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        startAt: legacyStart,
        endAt: legacyEnd,
        durationMinutes: 60,
        activeEnergyKcal: 400,
      },
    });

    await trainingRepository.ensureCanonicalExerciseCatalog(profileId);
    const press = await prisma.exerciseCatalog.findUniqueOrThrow({
      where: {
        profileId_stableKey: { profileId, stableKey: "seated_dumbbell_press" },
      },
    });
    const program = await trainingService.createProgram({
      name: "Stage 9A",
      exercises: [{
        catalogId: press.id,
        plannedSets: 1,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      }],
    }, profileId);
    // UTC date is June 1, but the durable DailyHealthData relation and local
    // Europe/Bratislava date are June 2. The runtime must use that local date.
    const strengthStart = new Date("2049-06-01T22:30:00.000Z");
    const strengthEnd = new Date("2049-06-01T23:15:00.000Z");
    const strengthWorkout = await prisma.workout.create({
      data: {
        dailyHealthData: { connect: { date: dates[1] } },
        externalId: "v7-midnight-strength",
        sourceIdentity: workoutSourceIdentity({
          externalId: "v7-midnight-strength",
          type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
          startAt: strengthStart,
          endAt: strengthEnd,
        }),
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        startAt: strengthStart,
        endAt: strengthEnd,
        durationMinutes: 45,
        activeEnergyKcal: 350,
      },
    });
    const session = await trainingService.createSessionFromWorkout({
      workoutId: strengthWorkout.id,
      programId: program.id,
    }, profileId);
    await trainingService.createSet(session.id, session.exercises[0]!.id, {
      reps: 8,
      weightKg: 24,
      bandNominalResistanceKg: null,
      rir: 3,
    }, profileId);
    expect(buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press")).not.toBeNull();
    await prisma.heartRateSample.create({
      data: {
        profileId,
        date: dates[1],
        timestamp: new Date("2049-06-01T22:45:00.000Z"),
        bpm: 135,
        source: "garmin",
      },
    });

    const stairStart = new Date("2049-06-03T06:00:00.000Z");
    const stairEnd = new Date("2049-06-03T06:10:00.000Z");
    await prisma.workout.create({
      data: {
        dailyHealthData: { connect: { date: dates[2] } },
        externalId: "v7-stepper",
        sourceIdentity: workoutSourceIdentity({
          externalId: "v7-stepper",
          type: STAIR_CLIMBING_TYPE,
          startAt: stairStart,
          endAt: stairEnd,
        }),
        type: STAIR_CLIMBING_TYPE,
        startAt: stairStart,
        endAt: stairEnd,
        durationMinutes: 10,
        activeEnergyKcal: 120,
      },
    });
    await prisma.healthSyncSnapshot.createMany({
      data: [
        {
          dailyHealthDataId: (await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: dates[2] } })).id,
          date: dates[2],
          receivedAt: new Date("2049-06-03T05:55:00.000Z"),
          syncedAt: new Date("2049-06-03T05:55:00.000Z"),
          timezone: "Europe/Bratislava",
          steps: 5_000,
          rawPayload: {},
        },
        {
          dailyHealthDataId: (await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: dates[2] } })).id,
          date: dates[2],
          receivedAt: new Date("2049-06-03T06:15:00.000Z"),
          syncedAt: new Date("2049-06-03T06:15:00.000Z"),
          timezone: "Europe/Bratislava",
          steps: 5_800,
          rawPayload: {},
        },
      ],
    });
    await prisma.restingHeartRateSample.create({
      data: {
        profileId,
        date: dates[2],
        timestamp: new Date("2049-06-03T05:00:00.000Z"),
        bpm: 55,
        source: "garmin",
      },
    });
    await prisma.sleepSegment.create({
      data: {
        profileId,
        startAt: new Date("2049-06-02T21:00:00.000Z"),
        endAt: new Date("2049-06-03T05:00:00.000Z"),
        state: "asleep",
        rawState: "asleepCore",
        source: "garmin",
      },
    });

    const request = {
      profileId,
      fromDate: dates[0],
      toDate: dates[2],
      timeZone: "Europe/Bratislava",
      initialState: createUnavailablePhysiologyRuntimeStateV7(),
    };
    const first = await runtime.rebuildProfileRange(request);
    const repeat = await runtime.rebuildProfileRange(request);
    expect(repeat.fingerprint).toBe(first.fingerprint);
    expect(repeat.days).toEqual(first.days);
    expect(first.days).toHaveLength(3);

    expect(first.days[0]!.trainingAdaptation.response.trainingStimulus)
      .toMatchObject({ status: "unresolved-training-dose" });
    expect(first.days[1]!.trainingAdaptation.response.trainingStimulus)
      .toMatchObject({ status: "unresolved-training-dose" });
    expect(first.days[1]!.trainingAdaptation.response.trainingStimulus)
      .toHaveProperty("setEffortEvidence.0.status", "observed-rir-qualification-unresolved");
    expect(first.days[1]!.fluidWater.glycogen.provenance.resistance?.date).toBe(dates[1]);
    expect(first.days[2]!.fluidWater.glycogen.exerciseEvidence.stepper)
      .toBe("endurance-depletion-pressure");
    expect(first.days[2]!.fluidWater.glycogen.provenance.stepper[0]?.bracketedStepAvailability)
      .toBe("available");
    expect(first.days[0]!.observations.observedWeightKg).toMatchObject({ valueKg: 80 });
    expect(first.days[0]!.massReconstruction.availability).toBe("unavailable");
    expect(first.days.every((day) => day.resultingState.compartments.glycogenKg.valueKg === null))
      .toBe(true);

    await prisma.dailyHealthData.update({
      where: { date: dates[1] },
      data: { carbsG: 275 },
    });
    const corrected = await runtime.rebuildProfileRange(request);
    expect(corrected.days[0]!.fingerprint).toBe(first.days[0]!.fingerprint);
    expect(corrected.days[1]!.fingerprint).not.toBe(first.days[1]!.fingerprint);
    expect(corrected.days[2]!.priorStateFingerprint)
      .not.toBe(first.days[2]!.priorStateFingerprint);
  });
});
