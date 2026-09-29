import { addCalendarDays, todayInCalendarTimeZone } from "@/modules/days/calendar-range";
import type {
  DailyMetricDto,
  DayWorkoutDto,
  HeartRateDayDto,
  NightlySleepSummaryDto,
} from "@/modules/days/day.types";
import type { DashboardDto } from "@/modules/days/dashboard.types";
import type { TrainingDayFact } from "@/modules/days/training-day-fact";
import { DEFAULT_TIME_ZONE, localDateTimeToInstant } from "@/model/time-zone";

const DEMO_SEED = "bodycast-dashboard-history-visual-qa-v1";
const HISTORY_DAYS = 90;
const CACHE_LIMIT = 3;

export type LocalDemoDataset = {
  anchorDate: string;
  days: DailyMetricDto[];
  trainingDays: TrainingDayFact[];
};

const EMPTY_HEART_RATE: HeartRateDayDto = {
  sampleCount: 0,
  minBpm: null,
  maxBpm: null,
  avgBpm: null,
  latestBpm: null,
  latestTimestamp: null,
  samples: [],
};

const datasetCache = new Map<string, LocalDemoDataset>();

function seedNumber(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rounded(value: number, places = 1): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function randomInteger(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function instant(date: string, time: string): Date {
  return localDateTimeToInstant(date, time, DEFAULT_TIME_ZONE);
}

function summarizeHeartRate(samples: HeartRateDayDto["samples"]): HeartRateDayDto {
  if (samples.length === 0) return { ...EMPTY_HEART_RATE, samples: [] };
  const values = samples.map(({ bpm }) => bpm);
  const latest = samples[samples.length - 1]!;
  return {
    sampleCount: samples.length,
    minBpm: Math.min(...values),
    maxBpm: Math.max(...values),
    avgBpm: rounded(values.reduce((sum, value) => sum + value, 0) / values.length, 1),
    latestBpm: latest.bpm,
    latestTimestamp: latest.timestamp,
    samples,
  };
}

function createHeartRateDay(date: string, index: number, random: () => number, workout: DayWorkoutDto | undefined): HeartRateDayDto {
  if (index % 29 === 13) return { ...EMPTY_HEART_RATE, samples: [] };
  const start = instant(date, "00:00").getTime();
  const end = instant(date, "23:30").getTime();
  const workoutStart = workout ? Date.parse(workout.startAt) : null;
  const workoutEnd = workout?.endAt ? Date.parse(workout.endAt) : null;
  const samples = Array.from({ length: 48 }, (_, sampleIndex) => {
    const timestamp = new Date(start + ((end - start) * sampleIndex) / 47);
    const fraction = sampleIndex / 47;
    const daytimeWave = 7 * Math.sin((fraction - 0.2) * Math.PI * 2);
    const inWorkout = workoutStart !== null
      && workoutEnd !== null
      && timestamp.getTime() >= workoutStart
      && timestamp.getTime() <= workoutEnd;
    const bpm = Math.round(69 + daytimeWave + (inWorkout ? 35 : 0) + random() * 8 - 4);
    return { timestamp: timestamp.toISOString(), bpm };
  });
  return summarizeHeartRate(samples);
}

function createRestingHeartRateDay(date: string, index: number, random: () => number): HeartRateDayDto {
  if (index % 24 === 6) return { ...EMPTY_HEART_RATE, samples: [] };
  const baseline = 55 + Math.floor(index / 19) % 4 + randomInteger(random, 0, 5);
  const samples = ["04:40", "05:20", "06:00", "06:40"].map((time, sampleIndex) => ({
    timestamp: instant(date, time).toISOString(),
    bpm: baseline + [1, -1, 0, 1][sampleIndex]!,
  }));
  return summarizeHeartRate(samples);
}

function splitMinutes(total: number, count: number, random: () => number): number[] {
  const weights = Array.from({ length: count }, () => 0.72 + random() * 0.56);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const result = weights.map((weight) => Math.floor((total * weight) / weightTotal));
  let remainder = total - result.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) result[index % result.length]! += 1;
  return result;
}

function offsetAtLocalNoon(date: string): number {
  const parts = date.split("-").map(Number);
  const localNoon = instant(date, "12:00").getTime();
  return Math.round((Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, 12) - localNoon) / 60_000);
}

function createSleepSummary(date: string, index: number, random: () => number): NightlySleepSummaryDto | null {
  if (index % 18 === 9) return null;

  const totalSleepMinutes = randomInteger(random, 382, 468);
  const awakeMinutes = randomInteger(random, 16, 38);
  const timeInBedMinutes = totalSleepMinutes + awakeMinutes;
  const deepMinutes = Math.round(totalSleepMinutes * (0.17 + random() * 0.035));
  const coreMinutes = Math.round(totalSleepMinutes * (0.49 + random() * 0.045));
  const remMinutes = totalSleepMinutes - deepMinutes - coreMinutes;
  const phaseOrder = [
    "core", "deep", "core", "rem", "awake", "core", "deep", "core",
    "rem", "core", "awake", "rem", "core", "deep", "rem", "core",
  ] as const;
  const allocations = {
    core: splitMinutes(coreMinutes, phaseOrder.filter((phase) => phase === "core").length, random),
    deep: splitMinutes(deepMinutes, phaseOrder.filter((phase) => phase === "deep").length, random),
    rem: splitMinutes(remMinutes, phaseOrder.filter((phase) => phase === "rem").length, random),
    awake: splitMinutes(awakeMinutes, phaseOrder.filter((phase) => phase === "awake").length, random),
  };
  const used = { core: 0, deep: 0, rem: 0, awake: 0 };
  const sleepStart = instant(addCalendarDays(date, -1), "23:00");
  const sleepEnd = new Date(sleepStart.getTime() + timeInBedMinutes * 60_000);
  let cursor = sleepStart.getTime();
  const segments: NightlySleepSummaryDto["segments"] = [
    {
      startAt: sleepStart.toISOString(),
      endAt: sleepEnd.toISOString(),
      state: "inBed",
      rawState: "inBed",
    },
  ];

  for (const phase of phaseOrder) {
    const duration = allocations[phase][used[phase]]!;
    used[phase] += 1;
    const startAt = new Date(cursor);
    cursor += duration * 60_000;
    segments.push({
      startAt: startAt.toISOString(),
      endAt: new Date(cursor).toISOString(),
      state: phase,
      rawState: phase,
    });
  }

  return {
    sleepDate: date,
    sleepStartAt: sleepStart.toISOString(),
    sleepEndAt: sleepEnd.toISOString(),
    totalSleepMinutes,
    timeInBedMinutes,
    awakeMinutes,
    coreMinutes,
    deepMinutes,
    remMinutes,
    unspecifiedSleepMinutes: 0,
    efficiencyPercent: rounded((totalSleepMinutes / timeInBedMinutes) * 100, 1),
    segmentCount: segments.length,
    timeInBedProvenance: "inBed-union",
    sleepDateAttribution: "fallback-timezone",
    wakeOffsetMinutes: offsetAtLocalNoon(date),
    qualityFlags: [],
    segments,
  };
}

function createWorkouts(date: string, index: number, random: () => number, anchorDate: string): DayWorkoutDto[] {
  const hasStrengthSession = index % 3 === 1 || index === HISTORY_DAYS - 1;
  const hasStairSession = index % 19 === 6;
  const definitions = [
    ...(hasStrengthSession ? [{ type: "Traditional Strength Training", classification: "traditional-strength-training" as const, duration: randomInteger(random, 38, 57) }] : []),
    ...(hasStairSession ? [{ type: "Stair Climbing", classification: "stair-climbing" as const, duration: randomInteger(random, 14, 24) }] : []),
  ];
  return definitions.map((definition, workoutIndex) => {
    const startTime = date === anchorDate && workoutIndex === 0 ? "07:35" : workoutIndex === 0 ? "17:40" : "12:25";
    const startAt = instant(date, startTime);
    const endAt = new Date(startAt.getTime() + definition.duration * 60_000);
    const id = 70_000 + index * 3 + workoutIndex;
    return {
      id,
      type: definition.type,
      canonicalType: definition.classification,
      classification: definition.classification,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      durationMinutes: definition.duration,
      activeEnergyKcal: randomInteger(random, 150, 310),
      energySource: "device-estimate",
      diaryOnly: false,
      linkedTrainingSessionId: null,
      linkedTrainingProgramName: null,
      executionStatus: "completed",
      exerciseDetailAvailability: "unavailable",
      loggedSetCount: null,
    };
  });
}

function trainingFactForDay(date: string, workouts: DayWorkoutDto[]): TrainingDayFact {
  const events: TrainingDayFact["events"] = workouts.map((workout) => ({
    eventId: "local-demo-workout-" + workout.id,
    source: "workout",
    type: workout.type,
    occurrenceAt: workout.startAt,
    endAt: workout.endAt,
    durationMinutes: workout.durationMinutes,
    activeEnergyKcal: workout.activeEnergyKcal,
    energySource: "device-estimate",
    executionStatus: "completed",
    workoutId: workout.id ?? null,
    diarySessionId: null,
    diaryProgramName: null,
    diaryOnly: false,
    exerciseDetailAvailability: "unavailable",
    loggedSetCount: null,
  }));
  return {
    date,
    eventCount: events.length,
    durationMinutes: events.reduce((sum, event) => sum + (event.durationMinutes ?? 0), 0),
    hiddenEventCount: 0,
    events,
  };
}

export function createLocalDemoDataset(anchorDate: string): LocalDemoDataset {
  const random = randomFrom(seedNumber(DEMO_SEED + ":" + anchorDate));
  const days: DailyMetricDto[] = [];
  const trainingDays: TrainingDayFact[] = [];

  for (let index = 0; index < HISTORY_DAYS; index += 1) {
    const date = addCalendarDays(anchorDate, index - (HISTORY_DAYS - 1));
    const workouts = createWorkouts(date, index, random, anchorDate);
    const trainingDayFact = trainingFactForDay(date, workouts);
    const heartRate = createHeartRateDay(date, index, random, workouts[0]);
    const restingHeartRate = createRestingHeartRateDay(date, index, random);
    const sleep = createSleepSummary(date, index, random);
    const weightKg = index % 7 === 2
      ? null
      : rounded(78.4 - index * 0.006 + Math.sin(index / 8) * 0.18 + random() * 0.12 - 0.06, 1);
    const bodyFatPercent = index % 5 === 1
      ? null
      : rounded(24.1 - index * 0.004 + Math.sin(index / 11) * 0.16 + random() * 0.12 - 0.06, 1);
    const nutritionMissing = index % 19 === 7;
    const proteinG = nutritionMissing ? null : randomInteger(random, 112, 164);
    const fatG = nutritionMissing ? null : randomInteger(random, 58, 88);
    const carbsG = nutritionMissing ? null : randomInteger(random, 175, 275);
    const caloriesKcal = nutritionMissing || proteinG === null || fatG === null || carbsG === null
      ? null
      : proteinG * 4 + fatG * 9 + carbsG * 4 + randomInteger(random, 40, 150);
    const stepsMissing = index % 31 === 14;
    const steps = stepsMissing ? null : randomInteger(random, 3_600, 15_800);
    const walkingDistanceKm = steps === null ? null : rounded(steps * (0.00068 + random() * 0.00008), 2);
    const averageWalkingSpeedKmh = steps === null || index % 17 === 8
      ? null
      : rounded(4.1 + random() * 1.35, 1);
    const activeEnergyKcal = steps === null || index % 23 === 11
      ? null
      : Math.round(210 + steps * 0.037 + (trainingDayFact.durationMinutes ?? 0) * 2.2 + randomInteger(random, 0, 80));
    const updatedAt = instant(date, "12:00").toISOString();
    const restingHeartRateBpm = restingHeartRate.latestBpm;
    const day: DailyMetricDto = {
      date,
      updatedAt,
      hasHealthRecord: true,
      workouts,
      totalWorkoutMinutes: trainingDayFact.durationMinutes,
      workoutSource: workouts.length > 0 ? "workouts" : "none",
      workoutFeedObserved: true,
      trainingDayFact,
      heartRate,
      restingHeartRate,
      restingHeartRateBpm,
      sleepMinutes: sleep?.totalSleepMinutes ?? null,
      sleep,
      weightKg,
      bodyFatPercent,
      caloriesKcal,
      proteinG,
      fatG,
      carbsG,
      steps,
      activeEnergyKcal,
      averageWalkingSpeedKmh,
      walkingDistanceKm,
      strengthTrainingMinutes: null,
    };
    days.push(day);
    trainingDays.push(trainingDayFact);
  }

  return { anchorDate, days, trainingDays };
}

export function getLocalDemoDataset(anchorDate = todayInCalendarTimeZone()): LocalDemoDataset {
  const cached = datasetCache.get(anchorDate);
  if (cached) return cached;
  const dataset = createLocalDemoDataset(anchorDate);
  datasetCache.set(anchorDate, dataset);
  if (datasetCache.size > CACHE_LIMIT) {
    const oldestKey = datasetCache.keys().next().value;
    if (oldestKey !== undefined) datasetCache.delete(oldestKey);
  }
  return dataset;
}

export function localDemoDashboard(date = todayInCalendarTimeZone()): DashboardDto {
  const dataset = getLocalDemoDataset(date);
  const today = dataset.days.find((day) => day.date === date) ?? null;
  const recentDays = [...dataset.days]
    .filter((day) => day.date <= date)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 7);
  const recentTrainingDays = [...dataset.trainingDays]
    .filter((fact) => fact.date <= date)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 7);
  const latestRestingDay = [...dataset.days].reverse().find((day) => (
    day.restingHeartRate?.latestBpm !== null && day.restingHeartRate?.latestBpm !== undefined
  ));
  const latestSleepDay = [...dataset.days].reverse().find((day) => day.sleep !== null);

  return {
    today,
    todayTrainingDay: today?.trainingDayFact ?? {
      date,
      eventCount: 0,
      durationMinutes: 0,
      hiddenEventCount: 0,
      events: [],
    },
    recentDays,
    recentTrainingDays,
    hasToday: today !== null,
    lastSync: { at: today?.updatedAt ?? null, status: null },
    restingHeartRate: {
      latestBpm: latestRestingDay?.restingHeartRate?.latestBpm ?? null,
      timestamp: latestRestingDay?.restingHeartRate?.latestTimestamp ?? null,
    },
    sleep: latestSleepDay?.sleep ?? null,
  };
}

export function localDemoHeartRateForDate(date: string): HeartRateDayDto {
  return getLocalDemoDataset().days.find((day) => day.date === date)?.heartRate ?? { ...EMPTY_HEART_RATE, samples: [] };
}

export function localDemoSleepForDate(date: string): NightlySleepSummaryDto | null {
  return getLocalDemoDataset().days.find((day) => day.date === date)?.sleep ?? null;
}
