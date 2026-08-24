import { isOccupationalCategory, type OccupationalCategory } from "@/model/occupational-activity";
import { estimateDailyWorkWalking, type CumulativeSnapshot } from "@/model/work-interval-reconstruction";
import { enumerateCalendarDates } from "./model-calendar";
import { bridgeNutritionGaps, type NutritionGapPolicy } from "./nutrition-gap-bridge";
import type {
  BuiltSimulationDay,
  HistoricalModelSources,
  ModelDaySourceQuality,
  ModelHealthDaySource,
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

/** Builds consecutive local model days without substituting missing data with zero. */
export function buildSimulationDays(input: {
  from: string;
  to: string;
  sources: HistoricalModelSources;
  nutritionGapPolicy?: NutritionGapPolicy;
  baselineNutritionFallback?: NutritionVector | null;
}): BuiltSimulationDay[] {
  const days = new Map(input.sources.days.map((day) => [day.date, day]));
  const snapshots = groupByDate(input.sources.snapshots);
  const workIntervals = groupByDate(input.sources.workIntervals);
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
    const bridgedNutrition = nutrition[index];
    const dailyIntervals = [...(workIntervals.get(date) ?? [])]
      .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
    const cumulativeSnapshots: CumulativeSnapshot[] = (snapshots.get(date) ?? []).map((item) => ({
      timestamp: item.syncedAt ?? item.receivedAt,
      steps: item.steps,
      walkingDistanceKm: item.walkingDistanceKm,
    }));
    const walking = estimateDailyWorkWalking({
      snapshots: cumulativeSnapshots,
      intervals: dailyIntervals.map((interval) => ({
        id: interval.id,
        startTime: interval.startAt,
        endTime: interval.endAt,
      })),
      dailyWalkingDistanceKm: day.walkingDistanceKm,
    });

    const nutritionIssues = ["caloriesKcal", "proteinG", "fatG", "carbsG"]
      .filter((field) => missing(bridgedNutrition[field as keyof Pick<
        NutritionVector,
        "caloriesKcal" | "proteinG" | "fatG" | "carbsG"
      >]));
    const workIssues: string[] = [];
    if (dailyIntervals.some((interval) => !isOccupationalCategory(interval.category))) {
      workIssues.push("occupationalActivity.category");
    }
    if (dailyIntervals.length > 0 && walking.outsideWorkWalkingDistanceKm === null) {
      workIssues.push("outsideWorkWalkingDistanceKm");
    }
    const activityIssues: string[] = [];
    if (walking.outsideWorkWalkingDistanceKm === null) {
      activityIssues.push("outsideWorkWalkingDistanceKm");
    } else if (walking.outsideWorkWalkingDistanceKm > 0
        && day.averageWalkingSpeedKmh === null) {
      activityIssues.push("averageWalkingSpeedKmh");
    }
    if (day.strengthTrainingMinutes === null) {
      activityIssues.push("strengthTrainingMinutes");
    }
    const issues = [...new Set([...nutritionIssues, ...activityIssues, ...workIssues])];
    const sourceQuality: ModelDaySourceQuality = {
      status: qualityStatus({ nutritionIssues, activityIssues, workIssues }),
      issues,
      workIntervalCount: dailyIntervals.length,
      workWalkingDistanceKm: walking.workWalkingDistanceKm,
      outsideWorkWalkingDistanceKm: walking.outsideWorkWalkingDistanceKm,
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
      averageWalkingSpeedKmh: day.averageWalkingSpeedKmh,
    }));

    return {
      input: {
        date,
        caloriesKcal: bridgedNutrition.caloriesKcal,
        proteinG: bridgedNutrition.proteinG,
        fatG: bridgedNutrition.fatG,
        carbsG: bridgedNutrition.carbsG,
        outsideWorkWalkingDistanceKm: walking.outsideWorkWalkingDistanceKm,
        averageWalkingSpeedKmh: day.averageWalkingSpeedKmh,
        strengthTrainingMinutes: day.strengthTrainingMinutes,
        occupationalActivity: {
          category: null,
          durationHours: 0,
          intervals: occupationalIntervals,
        },
        sodiumChangeMgPerDay: null,
        measuredWeightKg: day.weightKg,
      },
      sourceQuality,
    };
  });
}
