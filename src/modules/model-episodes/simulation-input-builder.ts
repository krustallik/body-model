import { isOccupationalCategory, type OccupationalCategory } from "@/model/occupational-activity";
import { estimateDailyWorkWalking, type CumulativeSnapshot } from "@/model/work-interval-reconstruction";
import {
  canonicalizeWorkoutType,
  hasExplicitStrengthWorkouts,
  type ExplicitWorkoutActivityEvent,
} from "@/model/activity/workout-energy";
import {
  reconstructStairWalkingOverlap,
  type StairOverlapDiagnostic,
} from "@/model/activity/stair-walking-overlap";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import { canonicalizeWorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import { enumerateCalendarDates } from "./model-calendar";
import { bridgeNutritionGaps, type NutritionGapPolicy } from "./nutrition-gap-bridge";
import { usesBodyCastStepperEnergy, usesWorkoutAwareActivity } from "./model-version";
import type {
  BuiltSimulationDay,
  HistoricalModelSources,
  ModelDaySourceQuality,
  ModelHealthDaySource,
  ModelHeartRateSampleSource,
  ModelSnapshotSource,
  ModelWorkoutSource,
  NutritionVector,
} from "./model-episode.types";

function groupByDate<T extends { date: string }>(values: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const current = grouped.get(value.date) ?? [];
    current.push(value);
    grouped.set(value.date, current);
  }
  return grouped;
}

function missing(value: number | null): boolean {
  return value === null;
}

const WALKING_SPEED_LOOKBACK_DAYS = 14;
const DEFAULT_WALKING_SPEED_KMH = 5;

function recentWalkingSpeedKmh(
  date: string,
  days: readonly ModelHealthDaySource[],
): number | null {
  const candidates = days
    .filter((day) => day.date < date && day.averageWalkingSpeedKmh !== null
      && day.averageWalkingSpeedKmh > 0)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, WALKING_SPEED_LOOKBACK_DAYS)
    .map((day) => day.averageWalkingSpeedKmh!);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function qualityStatus(input: {
  nutritionIssues: string[];
  activityIssues: string[];
  workIssues: string[];
}): ModelDaySourceQuality["status"] {
  if (input.workIssues.length > 0) return "work-reconstruction-unavailable";
  if (input.nutritionIssues.length > 0) return "missing-nutrition";
  if (input.activityIssues.length > 0) return "missing-activity";
  return "complete";
}

function toWorkoutEvents(input: {
  workouts: readonly ModelWorkoutSource[];
  snapshots: readonly ModelSnapshotSource[];
  stepIntervals: readonly { id: number; startAt: Date; endAt: Date; value: number }[];
  heartRateSamples: readonly ModelHeartRateSampleSource[];
  includeStepperEnergyEvidence: boolean;
}): ExplicitWorkoutActivityEvent[] {
  return [...input.workouts]
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
    .map((workout) => {
      const canonical = canonicalizeWorkoutType(workout.type);
      const event: ExplicitWorkoutActivityEvent = {
        workoutId: workout.id,
        type: workout.type,
        canonicalType: canonical.canonicalType,
        classification: canonical.classification,
        startAt: workout.startAt.toISOString(),
        endAt: workout.endAt.toISOString(),
        durationMinutes: workout.durationMinutes,
        activeEnergyKcal: workout.activeEnergyKcal,
      };
      if (input.includeStepperEnergyEvidence
          && canonical.classification === "stair-climbing" && canonical.canonicalType !== null) {
        const interval = { startAt: event.startAt, endAt: event.endAt };
        const matchingHr = input.heartRateSamples
          .filter((sample) => sample.timestamp.getTime() >= workout.startAt.getTime()
            && sample.timestamp.getTime() <= workout.endAt.getTime())
          .map((sample) => ({
            timestamp: sample.timestamp.toISOString(),
            bpm: sample.bpm,
            provenance: { provider: sample.source, device: null },
          }));
        const heartRate = canonicalizeWorkoutHeartRateEvidenceV7({
          workoutInterval: interval,
          heartRate: matchingHr.length === 0
            ? { availability: "unavailable" }
            : { availability: "loaded", samples: matchingHr },
        });
        event.stepperEvidence = canonicalizeWorkoutStepperEvidenceV7({
          workoutEnergy: {
            workoutId: workout.id,
            canonicalWorkoutType: canonical.canonicalType,
            startAt: event.startAt,
            endAt: event.endAt,
            durationMinutes: workout.durationMinutes,
            deviceEnergy: workout.activeEnergyKcal === null
              ? { availability: "unavailable", availabilityReason: "no-device-active-energy" }
              : {
                availability: "available",
                sourceValueStatus: "observed",
                valueKcal: workout.activeEnergyKcal,
                semantics: "active",
                provenance: "device-estimate",
              },
            heartRate,
          },
          snapshots: input.snapshots.map((snapshot) => ({
            id: snapshot.id,
            receivedAt: snapshot.receivedAt.toISOString(),
            syncedAt: snapshot.syncedAt?.toISOString() ?? null,
            steps: snapshot.steps,
          })),
          stepIntervals: input.stepIntervals
            .filter((sample) => sample.startAt < workout.endAt && sample.endAt > workout.startAt)
            .map((sample) => ({
              id: sample.id,
              startAt: sample.startAt.toISOString(),
              endAt: sample.endAt.toISOString(),
              stepCount: sample.value,
            })),
        });
      }
      return event;
    });
}

/** Builds consecutive local model days without substituting missing data with zero. */
export function buildSimulationDays(input: {
  from: string;
  to: string;
  sources: HistoricalModelSources;
  nutritionGapPolicy?: NutritionGapPolicy;
  baselineNutritionFallback?: NutritionVector | null;
  /** Episode physiology version; defaults to legacy v5 walking/strength path. */
  modelVersion?: string;
}): BuiltSimulationDay[] {
  const workoutAware = usesWorkoutAwareActivity(input.modelVersion ?? "bodycast-physiology-v5");
  const days = new Map(input.sources.days.map((day) => [day.date, day]));
  const snapshots = groupByDate(input.sources.snapshots);
  const activityIntervals = groupByDate(input.sources.activityIntervals ?? []);
  const workIntervals = groupByDate(input.sources.workIntervals);
  const workouts = groupByDate(input.sources.workouts ?? []);
  const allWorkouts = input.sources.workouts ?? [];
  const allStepIntervals = (input.sources.activityIntervals ?? [])
    .filter((sample) => sample.metric === "steps")
    .map((sample) => ({
      id: sample.id,
      startAt: sample.startAt,
      endAt: sample.endAt,
      value: sample.value,
    }));
  const allHeartRateSamples = input.sources.heartRateSamples ?? [];
  const allWorkoutEvents = workoutAware
    ? allWorkouts.flatMap((workout) => toWorkoutEvents({
      workouts: [workout],
      // Keep legacy cumulative snapshots scoped to the workout's source day;
      // those counters can reset at local midnight. Timed intervals are global
      // to the loaded range and safely bracket a session spanning two dates.
      snapshots: snapshots.get(workout.date) ?? [],
      stepIntervals: allStepIntervals,
      heartRateSamples: allHeartRateSamples,
      includeStepperEnergyEvidence: usesBodyCastStepperEnergy(input.modelVersion ?? "bodycast-physiology-v5"),
    }))
    : [];
  const workoutEventById = new Map(
    allWorkoutEvents.flatMap((event) => event.workoutId === undefined ? [] : [[event.workoutId, event] as const]),
  );
  const dates = enumerateCalendarDates(input.from, input.to);
  const dayFor = (date: string): ModelHealthDaySource => days.get(date) ?? {
    date,
    weightKg: null,
    bodyFatPercent: null,
    caloriesKcal: null,
    proteinG: null,
    fatG: null,
    carbsG: null,
    averageWalkingSpeedKmh: null,
    walkingDistanceKm: null,
    strengthTrainingMinutes: null,
    workoutFeedObserved: null,
  };
  const nutrition = bridgeNutritionGaps({
    days: dates.map((date) => {
      const day = dayFor(date);
      return {
        date,
        caloriesKcal: day.caloriesKcal,
        proteinG: day.proteinG,
        fatG: day.fatG,
        carbsG: day.carbsG,
      };
    }),
    fallbackNutrition: input.baselineNutritionFallback,
    policy: input.nutritionGapPolicy,
  });

  return dates.map((date, index) => {
    const day = dayFor(date);
    const sourceDay = days.get(date);
    // Use a recent personal median (or the model's conservative default when
    // no prior observation exists) only for model calculations. The raw day
    // remains null, so history/provenance continues to show the missing speed.
    const effectiveWalkingSpeedKmh = day.averageWalkingSpeedKmh
      ?? (workoutAware
        ? recentWalkingSpeedKmh(date, input.sources.days) ?? DEFAULT_WALKING_SPEED_KMH
        : null);
    const bridgedNutrition = nutrition[index];
    const dailyIntervals = [...(workIntervals.get(date) ?? [])]
      .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
    const dailyWorkouts = workouts.get(date) ?? [];
    const cumulativeSnapshots: CumulativeSnapshot[] = (snapshots.get(date) ?? []).map((item) => ({
      timestamp: item.syncedAt ?? item.receivedAt,
      steps: item.steps,
      walkingDistanceKm: item.walkingDistanceKm,
    }));
    const dailyActivityIntervals = activityIntervals.get(date) ?? [];
    const dailyHeartRateSamples = allHeartRateSamples
      .filter((sample) => sample.date === date);
    const walking = estimateDailyWorkWalking({
      snapshots: cumulativeSnapshots,
      activityIntervals: {
        steps: dailyActivityIntervals.filter((sample) => sample.metric === "steps").map((sample) => ({
          startTime: sample.startAt,
          endTime: sample.endAt,
          value: sample.value,
        })),
        walkingDistanceKm: dailyActivityIntervals.filter((sample) => sample.metric === "walking-distance-km").map((sample) => ({
          startTime: sample.startAt,
          endTime: sample.endAt,
          value: sample.value,
        })),
      },
      intervals: dailyIntervals.map((interval) => ({
        id: interval.id,
        startTime: interval.startAt,
        endTime: interval.endAt,
      })),
      dailyWalkingDistanceKm: day.walkingDistanceKm,
    });

    let outsideWorkWalkingDistanceKm = walking.outsideWorkWalkingDistanceKm;
    // Reconstruction stays honest (null work walk). When the daily total is known,
    // allocate it all outside work so occupation can use category-only fallback
    // without breaking physiological continuity.
    const softIssues: string[] = [];
    if (
      dailyIntervals.length > 0
      && walking.workWalkingDistanceKm === null
      && day.walkingDistanceKm !== null
      && outsideWorkWalkingDistanceKm === null
    ) {
      outsideWorkWalkingDistanceKm = day.walkingDistanceKm;
      softIssues.push("work-walking-unallocated", "outside-work-assumed-from-daily-total");
    }
    let stairDiagnostics: StairOverlapDiagnostic[] = [];
    let workoutEvents: ExplicitWorkoutActivityEvent[] | undefined;

    if (workoutAware) {
      workoutEvents = dailyWorkouts.flatMap((workout) => {
        const event = workoutEventById.get(workout.id);
        return event === undefined ? [] : [event];
      });
      const dailyWalkingDistanceIntervals = dailyActivityIntervals
        .filter((sample) => sample.metric === "walking-distance-km");
      const stairEventsForOverlap = allWorkoutEvents.filter((event) => {
        if (event.classification !== "stair-climbing") return false;
        if (dailyWorkouts.some((workout) => workout.id === event.workoutId)) return true;
        const workoutStart = new Date(event.startAt).getTime();
        const workoutEnd = new Date(event.endAt).getTime();
        // A session is booked to its start date, but interval walking distance
        // can be recorded on the following date. Include it there for overlap
        // subtraction while retaining its kcal exactly once on its source date.
        return dailyWalkingDistanceIntervals.some((sample) => (
          sample.startAt.getTime() < workoutEnd && sample.endAt.getTime() > workoutStart
        ));
      });
      const stairOverlap = reconstructStairWalkingOverlap({
        snapshots: cumulativeSnapshots.map((snapshot) => ({
          timestamp: snapshot.timestamp,
          steps: snapshot.steps ?? null,
          walkingDistanceKm: snapshot.walkingDistanceKm ?? null,
        })),
        walkingDistanceIntervals: dailyWalkingDistanceIntervals
          .map((sample) => ({
            startAt: sample.startAt,
            endAt: sample.endAt,
            walkingDistanceKm: sample.value,
          })),
        stairWorkouts: stairEventsForOverlap.map((event) => ({
          startAt: new Date(event.startAt),
          endAt: new Date(event.endAt),
          activeEnergyKcal: event.activeEnergyKcal,
          bodyCastEstimateAvailable: event.stepperEvidence?.bracketedSteps.availability === "available",
          bodyCastEstimatePositive: event.stepperEvidence?.bracketedSteps.availability === "available"
            && event.stepperEvidence.bracketedSteps.derivedStepDelta.value > 0,
        })),
        workIntervals: input.sources.workIntervals.map((interval) => ({
          startAt: interval.startAt,
          endAt: interval.endAt,
        })),
      });
      stairDiagnostics = stairOverlap.diagnostics;
      if (outsideWorkWalkingDistanceKm !== null) {
        outsideWorkWalkingDistanceKm = Math.max(
          0,
          outsideWorkWalkingDistanceKm - stairOverlap.overlapDistanceKm,
        );
      }
    }

    const nutritionIssues = ["caloriesKcal", "proteinG", "fatG", "carbsG"]
      .filter((field) => missing(bridgedNutrition[field as keyof Pick<
        NutritionVector,
        "caloriesKcal" | "proteinG" | "fatG" | "carbsG"
      >]));
    const workIssues: string[] = [];
    if (dailyIntervals.some((interval) => !isOccupationalCategory(interval.category))) {
      workIssues.push("occupationalActivity.category");
    }
    // Hard-fail only when outside walking is still unknown after the daily-total fallback.
    if (dailyIntervals.length > 0 && outsideWorkWalkingDistanceKm === null) {
      workIssues.push("outsideWorkWalkingDistanceKm");
    }
    const activityIssues: string[] = [];
    if (outsideWorkWalkingDistanceKm === null) {
      activityIssues.push("outsideWorkWalkingDistanceKm");
    } else if (outsideWorkWalkingDistanceKm > 0
        && effectiveWalkingSpeedKmh === null) {
      activityIssues.push("averageWalkingSpeedKmh");
    }
    const strengthSuppressed = workoutAware
      && workoutEvents !== undefined
      && hasExplicitStrengthWorkouts(workoutEvents);
    // For workout-aware models, an absent strength record means that no
    // strength session was recorded for this day. It is therefore a
    // deterministic zero, even when the optional workout feed itself is
    // absent. Explicit strength workouts remain authoritative below.
    const workoutFeedObserved = day.workoutFeedObserved === true;
    const assumedZeroStrength = workoutAware && !strengthSuppressed && day.strengthTrainingMinutes === null;
    if (!workoutAware && day.strengthTrainingMinutes === null) {
      activityIssues.push("strengthTrainingMinutes");
    }
    if (!sourceDay && dailyIntervals.length === 0) {
      activityIssues.push("occupationalActivity.durationHours");
    }
    const issues = [...new Set([
      ...nutritionIssues, ...activityIssues, ...workIssues, ...softIssues,
    ])];
    const sourceObservationFields = sourceDay
      ? [
          "weightKg", "bodyFatPercent", "caloriesKcal", "proteinG", "fatG", "carbsG",
          "averageWalkingSpeedKmh", "walkingDistanceKm", "strengthTrainingMinutes",
        ].filter((field) => sourceDay[field as keyof ModelHealthDaySource] !== null)
      : [];
    if (cumulativeSnapshots.length > 0) sourceObservationFields.push("healthSyncSnapshots");
    if (dailyIntervals.length > 0) sourceObservationFields.push("workIntervals");
    if (workoutAware && dailyWorkouts.length > 0) sourceObservationFields.push("workouts");
    if (workoutAware && dailyHeartRateSamples.length > 0) sourceObservationFields.push("heartRateSamples");
    if (workoutAware && workoutFeedObserved) sourceObservationFields.push("workoutFeedObserved");
    const sourceQuality: ModelDaySourceQuality = {
      status: qualityStatus({ nutritionIssues, activityIssues, workIssues }),
      issues,
      workIntervalCount: dailyIntervals.length,
      workWalkingDistanceKm: walking.workWalkingDistanceKm,
      outsideWorkWalkingDistanceKm,
      sourceObservationFields,
      workWalkingReconstruction: walking.intervals.map((interval) => ({
        intervalId: interval.intervalId,
        distanceKm: interval.estimatedWalkingDistanceKm.value,
        reason: interval.estimatedWalkingDistanceKm.reason ?? null,
        startMethod: "method" in interval.estimatedWalkingDistanceKm.start
          ? interval.estimatedWalkingDistanceKm.start.method
          : null,
        endMethod: "method" in interval.estimatedWalkingDistanceKm.end
          ? interval.estimatedWalkingDistanceKm.end.method
          : null,
      })),
      workBreaks: dailyIntervals.map((interval) => ({
        intervalId: interval.id,
        breakMinutes: interval.breakMinutes,
        source: interval.breakMinutes === null ? "legacy-unreported" : "user-entered",
      })),
      nutrition: { ...bridgedNutrition.provenance,
        referenceDates: [...bridgedNutrition.provenance.referenceDates],
        observedFields: [...bridgedNutrition.provenance.observedFields],
        imputedFields: [...bridgedNutrition.provenance.imputedFields],
        referenceMacroMadG: bridgedNutrition.provenance.referenceMacroMadG
          ? { ...bridgedNutrition.provenance.referenceMacroMadG }
          : null,
      },
      ...(workoutAware ? {
        stairWalkingOverlap: stairDiagnostics,
        workoutCount: dailyWorkouts.length,
        workoutFeedObserved,
      } : {}),
    };
    const occupationalIntervals = dailyIntervals.map((interval) => ({
      category: isOccupationalCategory(interval.category)
        ? interval.category as OccupationalCategory
        : null,
      durationHours: (interval.endAt.getTime() - interval.startAt.getTime()) / 3_600_000,
      breakDurationHours: interval.breakMinutes === null ? null : interval.breakMinutes / 60,
      workWalkingDistanceKm: walking.intervals.find(({ intervalId }) => (
        intervalId === interval.id
      ))?.estimatedWalkingDistanceKm.value ?? null,
      averageWalkingSpeedKmh: effectiveWalkingSpeedKmh,
    }));

    const strengthTrainingMinutes = strengthSuppressed
      ? 0
      : assumedZeroStrength
        ? 0
        : day.strengthTrainingMinutes;

    return {
      input: {
        date,
        caloriesKcal: bridgedNutrition.caloriesKcal,
        proteinG: bridgedNutrition.proteinG,
        fatG: bridgedNutrition.fatG,
        carbsG: bridgedNutrition.carbsG,
        outsideWorkWalkingDistanceKm,
        averageWalkingSpeedKmh: effectiveWalkingSpeedKmh,
        strengthTrainingMinutes,
        ...(workoutAware ? { workoutActivity: { events: workoutEvents ?? [] } } : {}),
        occupationalActivity: {
          category: null,
          durationHours: sourceDay || dailyIntervals.length > 0 ? 0 : null,
          intervals: sourceDay || dailyIntervals.length > 0 ? occupationalIntervals : undefined,
        },
        sodiumChangeMgPerDay: null,
        measuredWeightKg: day.weightKg,
      },
      sourceQuality,
    };
  });
}
