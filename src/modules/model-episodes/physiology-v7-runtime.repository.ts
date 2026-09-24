import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import { canonicalizeWorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import { instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import type {
  ResistanceTrainingExposureHistorySourceSessionV7,
  ResistanceTrainingExposureHistorySourceWorkoutV7,
} from "@/model/physiology-v7/resistance-training-exposure-history-sources-v7";
import type { PhysiologyDaySourceV7 } from "@/model/physiology-v7/daily-runtime-v7";
import type { PhysiologyRangeSourceBundleV7 } from "@/model/physiology-v7/rebuild-v7";
import { bridgeNutritionGaps, type NutritionGapPolicy } from "./nutrition-gap-bridge";
import { addCalendarDays, enumerateCalendarDates } from "./model-calendar";
import { buildCanonicalStrengthTrainingInputV7 } from "./strength-training-input-v7";
import { TrainingRepository } from "@/modules/training/training.repository";

export type LoadPhysiologyV7SourcesInput = {
  profileId: number;
  fromDate: string;
  toDate: string;
  historyFromDate: string;
  timeZone: string;
  nutritionGapPolicy?: NutritionGapPolicy;
};

export interface PhysiologyV7RangeSourceLoader {
  loadRangeSources(input: LoadPhysiologyV7SourcesInput): Promise<PhysiologyRangeSourceBundleV7>;
}

function decimal(value: { toNumber(): number } | null): number | null {
  return value?.toNumber() ?? null;
}

export class PhysiologyV7RuntimeRepository implements PhysiologyV7RangeSourceLoader {
  constructor(private readonly client: PrismaClient = prisma) {}

  async loadRangeSources(input: LoadPhysiologyV7SourcesInput): Promise<PhysiologyRangeSourceBundleV7> {
    const dates = enumerateCalendarDates(input.fromDate, input.toDate);
    if (dates.length === 0) throw new RangeError("v7 rebuild date range must be nonempty");
    if (input.historyFromDate > input.fromDate) {
      throw new RangeError("historyFromDate must not follow fromDate");
    }
    const historyDates = enumerateCalendarDates(input.historyFromDate, input.toDate);
    const rangeStart = localDateTimeToInstant(input.historyFromDate, "00:00", input.timeZone);
    const rangeEnd = localDateTimeToInstant(addCalendarDays(input.toDate, 1), "00:00", input.timeZone);
    const [dailyRows, snapshotRows, activityIntervalRows, workoutRows, heartRateRows, restingRows, sleepRows, sessionIds] = await Promise.all([
      this.client.dailyHealthData.findMany({
        where: { date: { gte: input.historyFromDate, lte: input.toDate } },
        orderBy: { date: "asc" },
        select: {
          id: true,
          date: true,
          weightKg: true,
          bodyFatPercent: true,
          caloriesKcal: true,
          proteinG: true,
          fatG: true,
          carbsG: true,
          steps: true,
          walkingDistanceKm: true,
          workoutFeedObserved: true,
        },
      }),
      this.client.healthSyncSnapshot.findMany({
        where: { date: { gte: input.historyFromDate, lte: input.toDate } },
        orderBy: [{ date: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
        select: { id: true, date: true, receivedAt: true, syncedAt: true, steps: true },
      }),
      this.client.healthActivityInterval.findMany({
        where: {
          metric: "steps",
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        select: { id: true, startAt: true, endAt: true, value: true },
      }),
      this.client.workout.findMany({
        where: { hiddenFromHistory: false, dailyHealthData: { date: { gte: input.historyFromDate, lte: input.toDate } } },
        orderBy: [{ dailyHealthData: { date: "asc" } }, { startAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          externalId: true,
          type: true,
          startAt: true,
          endAt: true,
          durationMinutes: true,
          activeEnergyKcal: true,
          dailyHealthData: { select: { date: true } },
          matchedDiarySession: { select: { id: true } },
        },
      }),
      this.client.heartRateSample.findMany({
        where: { profileId: input.profileId, timestamp: { gte: rangeStart, lt: rangeEnd } },
        orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        select: { date: true, timestamp: true, bpm: true, source: true },
      }),
      this.client.restingHeartRateSample.findMany({
        where: { profileId: input.profileId, timestamp: { gte: rangeStart, lt: rangeEnd } },
        orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        select: { date: true },
      }),
      this.client.sleepSegment.findMany({
        where: { profileId: input.profileId, endAt: { gt: rangeStart, lte: rangeEnd } },
        orderBy: [{ endAt: "asc" }, { id: "asc" }],
        select: { endAt: true },
      }),
      this.client.strengthDiarySession.findMany({
        where: {
          profileId: input.profileId,
          status: "COMPLETED",
          OR: [
            { matchedWorkout: { dailyHealthData: { date: { gte: input.historyFromDate, lte: input.toDate } } } },
            {
              matchedWorkoutId: null,
              webStartedAt: { gte: rangeStart, lt: rangeEnd },
            },
          ],
        },
        orderBy: [{ id: "asc" }],
        select: { id: true },
      }),
    ]);

    const dailyByDate = new Map(dailyRows.map((row) => [row.date, row] as const));
    const snapshotsByDate = new Map<string, typeof snapshotRows>();
    for (const row of snapshotRows) {
      const values = snapshotsByDate.get(row.date) ?? [];
      values.push(row);
      snapshotsByDate.set(row.date, values);
    }
    const workoutsByDate = new Map<string, typeof workoutRows>();
    const workoutLocalDate = new Map<number, string>();
    for (const row of workoutRows) {
      const date = row.dailyHealthData.date;
      workoutLocalDate.set(row.id, date);
      const values = workoutsByDate.get(date) ?? [];
      values.push(row);
      workoutsByDate.set(date, values);
    }
    const hrByDate = new Map<string, typeof heartRateRows>();
    for (const row of heartRateRows) {
      const values = hrByDate.get(row.date) ?? [];
      values.push(row);
      hrByDate.set(row.date, values);
    }
    const restingCount = new Map<string, number>();
    for (const row of restingRows) restingCount.set(row.date, (restingCount.get(row.date) ?? 0) + 1);
    const sleepCount = new Map<string, number>();
    for (const row of sleepRows) {
      const date = instantToLocalDateTime(row.endAt, input.timeZone).date;
      sleepCount.set(date, (sleepCount.get(date) ?? 0) + 1);
    }

    const nutrition = bridgeNutritionGaps({
      days: dates.map((date) => {
        const row = dailyByDate.get(date);
        return {
          date,
          caloriesKcal: row?.caloriesKcal ?? null,
          proteinG: row?.proteinG ?? null,
          fatG: row?.fatG ?? null,
          carbsG: row?.carbsG ?? null,
        };
      }),
      policy: input.nutritionGapPolicy,
    });
    const nutritionByDate = new Map(nutrition.map((day) => [day.date, day] as const));

    const daySources: PhysiologyDaySourceV7[] = dates.map((date) => {
      const daily = dailyByDate.get(date);
      const dayWorkouts = workoutsByDate.get(date) ?? [];
      const dayHr = hrByDate.get(date) ?? [];
      const stepSnapshots = (snapshotsByDate.get(date) ?? []).map((snapshot) => ({
        id: snapshot.id,
        receivedAt: snapshot.receivedAt.toISOString(),
        syncedAt: snapshot.syncedAt?.toISOString() ?? null,
        steps: snapshot.steps,
      }));
      const canonicalWorkouts = dayWorkouts.map((workout) => {
        const canonical = canonicalizeWorkoutType(workout.type);
        const heartRate = canonicalizeWorkoutHeartRateEvidenceV7({
          workoutInterval: {
            startAt: workout.startAt.toISOString(),
            endAt: workout.endAt.toISOString(),
          },
          heartRate: {
            availability: "loaded" as const,
            samples: dayHr.map((sample) => ({
              timestamp: sample.timestamp.toISOString(),
              bpm: sample.bpm,
              provenance: { provider: sample.source, device: null },
            })),
          },
        });
        const workoutEnergy = {
          workoutId: workout.id,
          canonicalWorkoutType: canonical.canonicalType,
          startAt: workout.startAt.toISOString(),
          endAt: workout.endAt.toISOString(),
          durationMinutes: workout.durationMinutes,
          deviceEnergy: workout.activeEnergyKcal === null
            ? { availability: "unavailable" as const, availabilityReason: "no-device-active-energy" as const }
            : {
              availability: "available" as const,
              sourceValueStatus: "observed" as const,
              valueKcal: workout.activeEnergyKcal,
              semantics: "active" as const,
              provenance: "device-estimate" as const,
            },
          heartRate,
        };
        return {
          raw: workout,
          stepper: canonicalizeWorkoutStepperEvidenceV7({
            workoutEnergy,
            snapshots: stepSnapshots,
            stepIntervals: activityIntervalRows
              .filter((sample) => sample.startAt < workout.endAt && sample.endAt > workout.startAt)
              .map((sample) => ({
                id: sample.id,
                startAt: sample.startAt.toISOString(),
                endAt: sample.endAt.toISOString(),
                stepCount: sample.value.toNumber(),
              })),
          }),
        };
      });
      const bridged = nutritionByDate.get(date)!;
      return {
        date,
        observedWeightKg: daily?.weightKg ?? null,
        observedBodyFatPercent: decimal(daily?.bodyFatPercent ?? null),
        nutrition: {
          caloriesKcal: bridged.caloriesKcal,
          proteinG: bridged.proteinG,
          fatG: bridged.fatG,
          carbsG: bridged.carbsG,
          provenance: bridged.provenance,
        },
        workoutFeedObserved: daily?.workoutFeedObserved ?? null,
        steps: daily?.steps ?? null,
        walkingRunningDistanceKm: decimal(daily?.walkingDistanceKm ?? null),
        workouts: canonicalWorkouts.map(({ raw }) => ({
          workoutId: raw.id,
          type: raw.type,
          startAt: raw.startAt.toISOString(),
          endAt: raw.endAt.toISOString(),
          durationMinutes: raw.durationMinutes,
          activeEnergyKcal: raw.activeEnergyKcal,
        })),
        stepperWorkouts: canonicalWorkouts
          .map(({ stepper }) => stepper)
          .filter(({ workoutEnergy }) => workoutEnergy.canonicalWorkoutType === "Stair Climbing"),
        context: {
          heartRateSampleCount: dayHr.length,
          restingHeartRateSampleCount: restingCount.get(date) ?? 0,
          sleepSegmentCount: sleepCount.get(date) ?? 0,
        },
      };
    });

    const trainingRepository = new TrainingRepository(this.client);
    const sessions: ResistanceTrainingExposureHistorySourceSessionV7[] = [];
    for (const { id } of sessionIds) {
      const session = await trainingRepository.getSession(id, input.profileId);
      if (!session) continue;
      const localDate = session.matchedWorkout === null
        ? session.webStartedAt === null
          ? null
          : instantToLocalDateTime(new Date(session.webStartedAt), input.timeZone).date
        : workoutLocalDate.get(session.matchedWorkout.id) ?? null;
      if (localDate === null || localDate < input.historyFromDate || localDate > input.toDate) continue;
      const intervalHr = session.matchedWorkout === null
        ? null
        : heartRateRows.filter((sample) => (
          sample.timestamp >= new Date(session.matchedWorkout!.startAt)
          && sample.timestamp <= new Date(session.matchedWorkout!.endAt)
        )).map((sample) => ({
          timestamp: sample.timestamp.toISOString(),
          bpm: sample.bpm,
          source: sample.source,
        }));
      const canonical = buildCanonicalStrengthTrainingInputV7({
        session,
        heartRateSamples: intervalHr,
      });
      sessions.push({
        localDate,
        strengthDiarySessionId: session.id,
        sessionRevision: session.revision,
        occurrenceStartAt: session.matchedWorkout?.startAt ?? session.webStartedAt,
        matchedWorkoutId: session.matchedWorkout?.id ?? null,
        program: canonical.program,
        dose: buildQualifiedResistanceTrainingDoseV7(canonical),
      });
    }

    const strengthWorkouts: ResistanceTrainingExposureHistorySourceWorkoutV7[] = workoutRows.map((workout) => ({
      workoutId: workout.id,
      localDate: workout.dailyHealthData.date,
      type: workout.type,
      matchedStrengthDiarySessionId: workout.matchedDiarySession?.id ?? null,
    }));
    return {
      days: daySources,
      exposure: {
        historyFromDate: input.historyFromDate,
        days: historyDates.map((date) => ({
          date,
          workoutFeedObserved: dailyByDate.get(date)?.workoutFeedObserved ?? null,
        })),
        strengthWorkouts,
        sessions,
      },
    };
  }
}

export const physiologyV7RuntimeRepository = new PhysiologyV7RuntimeRepository();
