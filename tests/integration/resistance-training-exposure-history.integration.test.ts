import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  buildQualifiedResistanceTrainingDoseV7,
} from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import {
  buildResistanceTrainingExposureHistoryFromSourcesV7,
} from "@/model/physiology-v7/resistance-training-exposure-history-sources-v7";
import { TRADITIONAL_STRENGTH_TRAINING_TYPE } from "@/modules/health/expand-training-workouts";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { RESISTANCE } from "@/modules/training/training.constants";
import { TrainingRepository } from "@/modules/training/training.repository";
import { TrainingService } from "@/modules/training/training.service";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const repo = new TrainingRepository(prisma);
const service = new TrainingService(prisma, repo);
const profileId = 991204;
const dateLegacy = "2048-03-10";
const dateLinked = "2048-03-11";
const dateUnobserved = "2048-03-12";

async function clean(): Promise<void> {
  await prisma.strengthSet.deleteMany({
    where: { sessionExercise: { session: { profileId } } },
  });
  await prisma.strengthSessionExercise.deleteMany({
    where: { session: { profileId } },
  });
  await prisma.strengthDiarySession.deleteMany({ where: { profileId } });
  await prisma.programExercise.deleteMany({
    where: { programVersion: { program: { profileId } } },
  });
  await prisma.trainingProgramVersion.deleteMany({
    where: { program: { profileId } },
  });
  await prisma.trainingProgram.deleteMany({ where: { profileId } });
  await prisma.exerciseCatalog.deleteMany({ where: { profileId } });
  await deleteDailyHealthRows(prisma, [dateLegacy, dateLinked, dateUnobserved]);
}

async function loadStrengthWorkouts(dates: readonly string[]) {
  const rows = await prisma.workout.findMany({
    where: { dailyHealthData: { date: { in: [...dates] } } },
    select: {
      id: true,
      type: true,
      startAt: true,
      dailyHealthData: { select: { date: true } },
      matchedDiarySession: { select: { id: true } },
    },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    workoutId: row.id,
    localDate: row.dailyHealthData.date,
    type: row.type,
    matchedStrengthDiarySessionId: row.matchedDiarySession?.id ?? null,
  }));
}

describe("ResistanceTrainingExposureHistoryV7 production source wiring (PostgreSQL)", () => {
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("loads legacy strength Workouts without diary as unresolved-dose, not rest", async () => {
    await clean();

    await prisma.dailyHealthData.create({
      data: {
        date: dateLegacy,
        workoutFeedObserved: true,
        rawPayload: {},
        workouts: {
          create: {
            type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
            startAt: new Date(`${dateLegacy}T16:00:00.000Z`),
            endAt: new Date(`${dateLegacy}T17:00:00.000Z`),
            durationMinutes: 60,
            activeEnergyKcal: 400,
            sourceIdentity: workoutSourceIdentity({
              externalId: "legacy-strength-no-diary",
              type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
              startAt: new Date(`${dateLegacy}T16:00:00.000Z`),
              endAt: new Date(`${dateLegacy}T17:00:00.000Z`),
            }),
          },
        },
      },
    });

    const strengthWorkouts = await loadStrengthWorkouts([dateLegacy]);
    expect(strengthWorkouts).toHaveLength(1);
    expect(strengthWorkouts[0]!.matchedStrengthDiarySessionId).toBeNull();

    const history = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: dateLegacy,
      toDate: dateLegacy,
      days: [{ date: dateLegacy, workoutFeedObserved: true }],
      strengthWorkouts,
      sessions: [],
    });

    expect(history.days[0]!.kind).toBe("unresolved-dose");
    expect(history.days[0]!.kind).not.toBe("observed-no-exposure");
    expect(history.days[0]!.completeCessation).toBe(false);
    expect(history.days[0]!.legacyStrengthWorkouts).toEqual([{
      workoutId: strengthWorkouts[0]!.workoutId,
      localDate: dateLegacy,
      matchedStrengthDiarySessionId: null,
    }]);
  });

  it("keeps linked diary + canonical Workout as one mapped exposure without legacy duplicate", async () => {
    await clean();

    const press = await prisma.exerciseCatalog.create({
      data: {
        profileId,
        name: "history-wiring-press",
        stableKey: "seated_dumbbell_press",
      },
    });
    const program = await service.createProgram({
      name: "history-wiring",
      exercises: [{
        catalogId: press.id,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      }],
    }, profileId);

    const day = await prisma.dailyHealthData.create({
      data: {
        date: dateLinked,
        workoutFeedObserved: true,
        rawPayload: {},
        workouts: {
          create: {
            type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
            startAt: new Date(`${dateLinked}T16:00:00.000Z`),
            endAt: new Date(`${dateLinked}T17:00:00.000Z`),
            durationMinutes: 60,
            activeEnergyKcal: 450,
            sourceIdentity: workoutSourceIdentity({
              externalId: "linked-strength-with-diary",
              type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
              startAt: new Date(`${dateLinked}T16:00:00.000Z`),
              endAt: new Date(`${dateLinked}T17:00:00.000Z`),
            }),
          },
        },
      },
      include: { workouts: true },
    });
    const workout = day.workouts[0]!;

    const session = await service.createSessionFromWorkout({
      workoutId: workout.id,
      programId: program.id,
    }, profileId);
    const exercise = session.exercises[0]!;
    await service.createSet(session.id, exercise.id, {
      reps: 8,
      weightKg: 24,
      bandNominalResistanceKg: null,
    rir: null,
    }, profileId);

    const loaded = await repo.getSession(session.id, profileId);
    expect(loaded).not.toBeNull();
    const dose = buildQualifiedResistanceTrainingDoseV7(
      buildCanonicalStrengthTrainingInputV7({
        session: loaded!,
        heartRateSamples: null,
      }),
    );
    expect(dose.availability).toBe("available");

    const strengthWorkouts = await loadStrengthWorkouts([dateLinked]);
    expect(strengthWorkouts[0]!.matchedStrengthDiarySessionId).toBe(session.id);

    const history = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: dateLinked,
      toDate: dateLinked,
      days: [{ date: dateLinked, workoutFeedObserved: true }],
      strengthWorkouts,
      sessions: [{
        localDate: dateLinked,
        strengthDiarySessionId: session.id,
        sessionRevision: loaded!.revision,
        matchedWorkoutId: workout.id,
        occurrenceStartAt: workout.startAt.toISOString(),
        program: {
          programId: loaded!.programId,
          programVersionId: loaded!.programVersionId,
          programVersionNumber: loaded!.programVersionNumber,
        },
        dose,
      }],
    });

    expect(history.days[0]!.kind).toBe("observed-mapped-exposure");
    expect(history.days[0]!.mappedSetCount).toBe(1);
    expect(history.days[0]!.legacyStrengthWorkouts).toEqual([]);
    expect(history.days[0]!.sessions).toHaveLength(1);
    expect(history.days[0]!.muscleGroups.length).toBeGreaterThan(0);
    expect(buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press")).not.toBeNull();
  });

  it("keeps missing workout feed unobserved even when a strength Workout row exists", async () => {
    await clean();

    await prisma.dailyHealthData.create({
      data: {
        date: dateUnobserved,
        workoutFeedObserved: null,
        rawPayload: {},
        workouts: {
          create: {
            type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
            startAt: new Date(`${dateUnobserved}T16:00:00.000Z`),
            endAt: new Date(`${dateUnobserved}T17:00:00.000Z`),
            durationMinutes: 60,
            activeEnergyKcal: 300,
            sourceIdentity: workoutSourceIdentity({
              externalId: "strength-unobserved-feed",
              type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
              startAt: new Date(`${dateUnobserved}T16:00:00.000Z`),
              endAt: new Date(`${dateUnobserved}T17:00:00.000Z`),
            }),
          },
        },
      },
    });

    const strengthWorkouts = await loadStrengthWorkouts([dateUnobserved]);
    const history = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: dateUnobserved,
      toDate: dateUnobserved,
      days: [{ date: dateUnobserved, workoutFeedObserved: null }],
      strengthWorkouts,
      sessions: [],
    });

    expect(history.days[0]!.kind).toBe("unobserved");
    expect(history.days[0]!.completeCessation).toBe(false);
  });
});
