import type { ForecastModelRequest } from "@/modules/model-forecast/model-forecast.schema";
import { buildPlanningActivityAdapter } from "@/modules/planning-activity/planning-activity-adapter";

export type PlanValues = {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  averageStepsPerDay: number;
  strengthDaysPerWeek: number;
  strengthTrainingMinutes: number;
  otherTrainingDaysPerWeek: number;
  otherTrainingMinutes: number;
  plannedWork: boolean;
  workDaysPerWeek: number;
  workCategory: "standingLight" | "manualLight" | "standingLightModerate" | "manualModerate";
  shiftHours: number;
  breakHours: number;
};

export const DEFAULT_PLAN: PlanValues = {
  caloriesKcal: 2200, proteinG: 150, fatG: 75, carbsG: 240,
  averageStepsPerDay: 8_000, strengthDaysPerWeek: 3, strengthTrainingMinutes: 45,
  otherTrainingDaysPerWeek: 0, otherTrainingMinutes: 45, plannedWork: false,
  workDaysPerWeek: 5, workCategory: "standingLight", shiftHours: 8, breakHours: 0.5,
};

const TRAINING_WEEKDAYS: ReadonlyArray<0 | 1 | 2 | 3 | 4 | 5 | 6> = [1, 3, 5, 2, 4, 6, 0];

export function addCalendarDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function calendarWeekday(date: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return new Date(`${date}T12:00:00Z`).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function buildPlanningScenario(
  mode: Exclude<ForecastModelRequest["scenario"]["mode"], "recent-behavior">,
  horizonDays: number,
  plan: PlanValues,
  today: string,
): Extract<ForecastModelRequest["scenario"], { mode: "fixed" }> | Extract<ForecastModelRequest["scenario"], { mode: "target-centered" }> {
  const activity = buildPlanningActivityAdapter(plan.averageStepsPerDay);
  const occupation = plan.plannedWork ? [{
    category: plan.workCategory,
    durationHours: plan.shiftHours,
    breakDurationHours: plan.breakHours,
    workWalkingDistanceKm: activity.workWalkingDistanceKm,
    averageWalkingSpeedKmh: activity.workWalkingSpeedKmh,
  }] : [];
  const defaultDay = {
    nutrition: { caloriesKcal: plan.caloriesKcal, proteinG: plan.proteinG, fatG: plan.fatG, carbsG: plan.carbsG },
    outsideWorkWalkingDistanceKm: activity.outsideWorkWalkingDistanceKm,
    averageWalkingSpeedKmh: activity.averageWalkingSpeedKmh,
    strengthTrainingMinutes: 0,
    occupation: [],
  };
  const selectedTrainingDays = new Set(TRAINING_WEEKDAYS.slice(0, Math.round(plan.strengthDaysPerWeek)));
  type FixedSchedule = Extract<ForecastModelRequest["scenario"], { mode: "fixed" }>["schedule"];
  const byDate: NonNullable<FixedSchedule["byDate"]> = {};
  const selectedWorkDays = new Set(TRAINING_WEEKDAYS.slice(0, Math.round(plan.workDaysPerWeek)));
  if (plan.plannedWork) {
    for (let index = 1; index <= horizonDays; index += 1) {
      const date = addCalendarDays(today, index);
      if (selectedWorkDays.has(calendarWeekday(date))) byDate[date] = { occupation };
    }
  }
  const selectedOtherTrainingDays = new Set(TRAINING_WEEKDAYS.slice(0, Math.round(plan.otherTrainingDaysPerWeek)));
  const strengthByWeekday: NonNullable<FixedSchedule["strengthByWeekday"]> = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0 };
  const workoutsByWeekday: NonNullable<FixedSchedule["workoutsByWeekday"]> = {};
  for (const weekday of TRAINING_WEEKDAYS) {
    const events = [];
    if (selectedTrainingDays.has(weekday) && plan.strengthTrainingMinutes > 0) events.push({
      type: "Traditional Strength Training", canonicalType: "Traditional Strength Training" as const,
      classification: "traditional-strength-training" as const,
      startAt: "1970-01-01T17:00:00.000Z",
      endAt: new Date(Date.parse("1970-01-01T17:00:00.000Z") + plan.strengthTrainingMinutes * 60_000).toISOString(),
      durationMinutes: plan.strengthTrainingMinutes, activeEnergyKcal: null,
      energyProvenance: "strength-met-fallback" as const,
    });
    if (selectedOtherTrainingDays.has(weekday) && plan.otherTrainingMinutes > 0) events.push({
      type: "Stair Climbing", canonicalType: "Stair Climbing" as const,
      classification: "stair-climbing" as const, startAt: "1970-01-01T12:00:00.000Z",
      endAt: new Date(Date.parse("1970-01-01T12:00:00.000Z") + plan.otherTrainingMinutes * 60_000).toISOString(),
      durationMinutes: plan.otherTrainingMinutes, activeEnergyKcal: null, energyProvenance: "unspecified" as const,
    });
    if (events.length > 0) workoutsByWeekday[String(weekday) as keyof typeof workoutsByWeekday] = { events };
  }
  const schedule: FixedSchedule = { defaultDay, byDate, strengthByWeekday, workoutsByWeekday };
  return { mode, schedule };
}
