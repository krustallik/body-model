import { PrismaClient } from "@prisma/client";
import { assessBodyMapMusclePerformanceV1 } from "@/modules/training/body-map-training-performance-v1";
import { readBodyMapTrainingAnalyticsV1 } from "@/modules/training/body-map-training-analytics.repository";
import {
  buildExerciseAnatomySnapshotV3,
  EXERCISE_ANATOMY_SNAPSHOT_V3_PROPERTY,
} from "@/modules/training/exercise-anatomy-mapping-v3";

const prisma = new PrismaClient();
const QA_DATABASE = "bodycast_bodymap_qa_test";
const QA_ROLE = "bodycast_bodymap_qa_test";
const QA_HOST = "127.0.0.1";
const QA_PORT = "55436";
const QA_EMAIL = "bodymap.qa@example.test";
const QA_MARKER_NAME = "BodyCast QA (synthetic data)";
const QA_BLOCK_LABEL = "QA synthetic 6-month progress history";
const QA_TIME_ZONE = "Europe/Bratislava";
const WINDOW_START = "2026-05-22";
const WINDOW_END = "2026-11-22";
const TARGET_TRAINING_DAYS = 100;

type ResistanceType = "EXTERNAL_WEIGHT" | "BODYWEIGHT";
type ExerciseSpec = { key: string; resistanceType: ResistanceType };
type WorkoutType = "pull" | "upper" | "lower" | "chest-and-arms";

const workouts: Record<WorkoutType, readonly ExerciseSpec[]> = {
  pull: [
    { key: "one_arm_seated_cable_row", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "pull_up", resistanceType: "BODYWEIGHT" },
    { key: "one_arm_concentration_curl", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "incline_seated_rotating_dumbbell_curl", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "supported_dumbbell_wrist_curl", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "hyperextension", resistanceType: "BODYWEIGHT" },
  ],
  upper: [
    { key: "incline_dumbbell_press_30deg", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "flat_dumbbell_fly", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "seated_dumbbell_press", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "one_arm_lateral_raise", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "one_arm_cable_triceps_extension", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "pushup_handles", resistanceType: "BODYWEIGHT" },
    { key: "goblet_squat", resistanceType: "EXTERNAL_WEIGHT" },
  ],
  lower: [
    { key: "bulgarian_split_squat", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "romanian_deadlift", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "cable_leg_curl", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "barbell_hip_thrust", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "seated_calf_raise", resistanceType: "EXTERNAL_WEIGHT" },
  ],
  "chest-and-arms": [
    { key: "flat_dumbbell_bench_press", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "one_arm_dumbbell_row_bench_supported", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "lying_two_hand_dumbbell_triceps_extension_flat", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "dumbbell_front_raise_bilateral", resistanceType: "EXTERNAL_WEIGHT" },
    { key: "dumbbell_hammer_curl_bilateral", resistanceType: "EXTERNAL_WEIGHT" },
  ],
};

const workoutTypes = Object.keys(workouts) as WorkoutType[];
const deloadWeeks = new Set([3, 7, 11, 15, 19, 23]);

function assertSafeDatabaseUrl(): void {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed synthetic history in production.");
  if (process.env.BODYCAST_QA_MODE !== "1") throw new Error("Set BODYCAST_QA_MODE=1 to seed the isolated QA database.");
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required.");
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== QA_HOST || url.port !== QA_PORT
    || url.pathname !== `/${QA_DATABASE}` || decodeURIComponent(url.username) !== QA_ROLE
    || !url.password || url.search || url.hash) {
    throw new Error("Refusing: DATABASE_URL must target the isolated Body Map QA database on 127.0.0.1:55436.");
  }
}

function dateOnly(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: QA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (kind: string) => parts.find(({ type }) => type === kind)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function localAfternoon(date: string): Date {
  const offset = date < "2026-10-25" ? "+02:00" : "+01:00";
  return new Date(`${date}T17:00:00${offset}`);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function loadFor(key: string, week: number): number | null {
  switch (key) {
    case "incline_dumbbell_press_30deg":
      return week <= 14 ? 10 + week * 0.43 : 16 + (week - 14) * 1.27;
    case "one_arm_seated_cable_row":
      return week <= 14 ? 13.5 + week * 0.61 : 22 + (week - 14) * 0.68;
    case "one_arm_concentration_curl":
      return week <= 14 ? 5.8 + week * 0.085 : 7 + (week - 14) * 0.45;
    case "flat_dumbbell_fly": return 8;
    case "seated_dumbbell_press": return 12;
    case "one_arm_lateral_raise": return 5;
    case "one_arm_cable_triceps_extension": return Math.max(8, 12 - week * 0.29);
    case "goblet_squat": return 16;
    case "flat_dumbbell_bench_press": return 18 + week * 0.32;
    case "bulgarian_split_squat": return 8 + Math.floor(week / 3) * 0.75;
    case "romanian_deadlift": return 24 + week * 0.72;
    case "cable_leg_curl": return 8 + Math.floor(week / 4) * 2;
    case "barbell_hip_thrust": return 40 + week * 1.25;
    case "seated_calf_raise": return 20 + Math.floor(week / 3);
    case "one_arm_dumbbell_row_bench_supported": return 16 + week * 0.48;
    case "lying_two_hand_dumbbell_triceps_extension_flat": return 20 - week * 0.31;
    case "dumbbell_front_raise_bilateral": return 5 + week * 0.12;
    case "dumbbell_hammer_curl_bilateral": return 8 + week * 0.15;
    case "incline_seated_rotating_dumbbell_curl": return 6;
    case "supported_dumbbell_wrist_curl": return 4;
    default: return null;
  }
}

function repsFor(key: string, week: number, setNumber: number): number {
  if (key === "pull_up") return 6 + Math.min(2, Math.floor(week / 12));
  if (key === "pushup_handles") return 10 + Math.min(2, Math.floor(week / 8));
  if (key === "hyperextension") return 12;
  if (key === "flat_dumbbell_fly") return 12;
  if (key === "goblet_squat") return 10;
  if (key === "incline_seated_rotating_dumbbell_curl") return 10;
  if (key === "supported_dumbbell_wrist_curl") return 15;
  const base = key === "one_arm_cable_triceps_extension" ? 10 : 8;
  return Math.max(6, base - (setNumber - 1));
}

function workDateSlots(weekStart: string): string[] {
  const offsets = weekStart === "2026-05-18" ? [5, 6] : [0, 2, 4, 6, 1, 3, 5];
  return offsets.map((offset) => addDays(weekStart, offset))
    .filter((date) => date >= WINDOW_START && date <= WINDOW_END);
}

function groupStatusSummary(analytics: Awaited<ReturnType<typeof readBodyMapTrainingAnalyticsV1>>) {
  return analytics.groups
    .filter(({ totalUniqueSetCount }) => totalUniqueSetCount !== null && totalUniqueSetCount > 0)
    .map((group) => ({
      groupId: group.groupId,
      status: assessBodyMapMusclePerformanceV1({ groupReport: group, anatomyId: null }).status,
    }));
}

async function main() {
  assertSafeDatabaseUrl();
  const identity = await prisma.$queryRaw<Array<{ databaseName: string; databaseRole: string; serverPort: number | null }>>`
    SELECT current_database() AS "databaseName", current_user AS "databaseRole", inet_server_port() AS "serverPort"
  `;
  if (identity[0]?.databaseName !== QA_DATABASE || identity[0]?.databaseRole !== QA_ROLE) {
    throw new Error("Connected PostgreSQL identity did not match the isolated Body Map QA database.");
  }

  const user = await prisma.user.findUnique({
    where: { email: QA_EMAIL },
    select: { id: true, name: true, emailVerified: true, profile: { select: { id: true } } },
  });
  if (!user || user.name !== QA_MARKER_NAME || !user.emailVerified || !user.profile) {
    throw new Error("The marked synthetic Body Map QA user is missing or not ready.");
  }

  const catalogRows = await prisma.exerciseCatalog.findMany({
    where: { profileId: user.profile.id, isActive: true },
    select: { id: true, name: true, stableKey: true },
  });
  const catalog = new Map(catalogRows.flatMap((row) => row.stableKey ? [[row.stableKey, row] as const] : []));
  for (const spec of Object.values(workouts).flat()) {
    if (!catalog.has(spec.key) || !buildExerciseAnatomySnapshotV3(spec.key)) {
      throw new Error(`The synthetic QA catalog has no registered anatomy mapping for ${spec.key}.`);
    }
  }

  const existing = await prisma.strengthDiarySession.findMany({
    where: {
      profileId: user.profile.id,
      status: "COMPLETED",
      effectiveAccountingAt: { gte: localAfternoon(WINDOW_START), lte: localAfternoon(WINDOW_END) },
    },
    select: { id: true, effectiveAccountingAt: true, webStartedAt: true, createdAt: true },
  });
  const existingDates = new Set(existing.map((session) => dateOnly(
    session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt,
  )));
  if (existingDates.size >= TARGET_TRAINING_DAYS) {
    const analytics = await readBodyMapTrainingAnalyticsV1(
      user.profile.id,
      12,
      new Date(`${WINDOW_END}T23:59:59.999Z`),
      6,
    );
    if (analytics.coverage.completedSessionCount < TARGET_TRAINING_DAYS) {
      throw new Error(`The QA account has ${existingDates.size} distinct days but only ${analytics.coverage.completedSessionCount} sessions in the six-month analytics window.`);
    }
    if (analytics.coverage.unmappedSetCount > 0) {
      throw new Error(`The QA history still contains ${analytics.coverage.unmappedSetCount} sets without Body Map mappings.`);
    }
    console.log(JSON.stringify({
      ready: true,
      insertedSessions: 0,
      trainingDays: existingDates.size,
      completedSessionsInAnalytics: analytics.coverage.completedSessionCount,
      recordedSets: analytics.coverage.recordedSetCount,
      mappedSets: analytics.coverage.mappedSetCount,
      unmappedSets: analytics.coverage.unmappedSetCount,
      groupStatuses: groupStatusSummary(analytics),
      period: { from: WINDOW_START, through: WINDOW_END },
      database: "isolated local Body Map QA test database",
      note: "The QA history already contains at least 100 distinct training days; no rows were changed.",
    }, null, 2));
    return;
  }

  const weeks: string[] = [];
  for (let date = mondayOf(WINDOW_START); date <= WINDOW_END; date = addDays(date, 7)) weeks.push(date);
  const datesByWeek = weeks.map((weekStart) => {
    const days = workDateSlots(weekStart);
    return { weekStart, days, existingDays: days.filter((date) => existingDates.has(date)).length };
  });
  const targets = datesByWeek.map(({ days }) => Math.min(4, days.length));
  let targetTotal = targets.reduce((sum, target) => sum + target, 0);
  const reductionCandidates = datesByWeek
    .map((week, index) => ({ index, existingDays: week.existingDays, minimum: Math.max(3, week.existingDays) }))
    .filter(({ index, minimum }) => targets[index]! > minimum)
    .sort((left, right) => left.existingDays - right.existingDays || left.index - right.index);
  for (const candidate of reductionCandidates) {
    if (targetTotal <= TARGET_TRAINING_DAYS) break;
    targets[candidate.index] = targets[candidate.index]! - 1;
    targetTotal -= 1;
  }
  if (targetTotal !== TARGET_TRAINING_DAYS || datesByWeek.some((week, index) => week.existingDays > targets[index]!)) {
    throw new Error("Could not fit 100 distinct training days around the preserved QA history.");
  }

  const planned: Array<{ date: string; week: number; type: WorkoutType; deload: boolean }> = [];
  for (const [weekIndex, week] of datesByWeek.entries()) {
    const needed = targets[weekIndex]! - week.existingDays;
    const openDays = week.days.filter((date) => !existingDates.has(date));
    if (openDays.length < needed) throw new Error(`Not enough unused dates in week beginning ${week.weekStart}.`);
    for (let slot = 0; slot < needed; slot += 1) {
      planned.push({
        date: openDays[slot]!,
        week: weekIndex,
        type: workoutTypes[(weekIndex + slot) % workoutTypes.length]!,
        deload: deloadWeeks.has(weekIndex),
      });
    }
  }

  const insertedIds: number[] = [];
  await prisma.$transaction(async (transaction) => {
    for (const workout of planned) {
      const startedAt = localAfternoon(workout.date);
      const setCount = workout.deload ? 2 : 3;
      const specs = workouts[workout.type];
      const created = await transaction.strengthDiarySession.create({
        data: {
          profileId: user.profile!.id,
          status: "COMPLETED",
          entryMode: "LIVE",
          matchStatus: "UNMATCHED",
          matchMethod: null,
          sessionIntent: null,
          sessionLoadAssessment: null,
          trainingBlockLabel: QA_BLOCK_LABEL,
          trainingWeekNumber: workout.week + 1,
          webStartedAt: startedAt,
          webEndedAt: new Date(startedAt.getTime() + 60 * 60_000),
          effectiveAccountingAt: startedAt,
          accountingTimeZone: QA_TIME_ZONE,
          accountingTimeZoneProvenance: "client-session",
          exercises: {
            create: specs.map((spec, exerciseIndex) => {
              const catalogRow = catalog.get(spec.key)!;
              const anatomySnapshot = buildExerciseAnatomySnapshotV3(spec.key)!;
              return {
                sourceExerciseCatalogId: catalogRow.id,
                snapshotExerciseName: catalogRow.name,
                sortOrder: exerciseIndex,
                plannedSets: setCount,
                plannedRepsMin: 6,
                plannedRepsMax: 12,
                plannedRir: workout.deload ? 4 : 2,
                resistanceType: spec.resistanceType,
                origin: "EXTRA",
                muscleMappingSnapshot: { [EXERCISE_ANATOMY_SNAPSHOT_V3_PROPERTY]: anatomySnapshot },
                sets: {
                  create: Array.from({ length: setCount }, (_, index) => {
                    const weight = loadFor(spec.key, workout.week);
                    const anomalousGoodSession = workout.week === 10 && spec.key === "flat_dumbbell_bench_press";
                    const anomalousPoorSession = workout.week === 17 && spec.key === "romanian_deadlift";
                    const adjustedWeight = weight === null ? null : anomalousGoodSession
                      ? weight * 1.3
                      : anomalousPoorSession ? weight * 0.65 : weight;
                    return {
                      setNumber: index + 1,
                      reps: repsFor(spec.key, workout.week, index + 1),
                      weightKg: spec.resistanceType === "BODYWEIGHT" ? null : Number(adjustedWeight!.toFixed(2)),
                      bandNominalResistanceKg: null,
                      rir: workout.deload ? 4 : index === 1 ? 1 : 2,
                      restBeforeSeconds: 90,
                      completedAt: new Date(startedAt.getTime() + (exerciseIndex * 6 + index + 1) * 60_000),
                      comment: anomalousGoodSession || anomalousPoorSession ? "QA synthetic one-session outlier" : null,
                    };
                  }),
                },
              };
            }),
          },
        },
        select: { id: true },
      });
      insertedIds.push(created.id);
    }
  }, { maxWait: 10_000, timeout: 120_000 });

  const analytics = await readBodyMapTrainingAnalyticsV1(
    user.profile.id,
    12,
    new Date(`${WINDOW_END}T23:59:59.999Z`),
    6,
  );
  const groupStatuses = groupStatusSummary(analytics);
  const after = await prisma.strengthDiarySession.findMany({
    where: {
      profileId: user.profile.id,
      status: "COMPLETED",
      effectiveAccountingAt: { gte: localAfternoon(WINDOW_START), lte: localAfternoon(WINDOW_END) },
    },
    select: { effectiveAccountingAt: true, webStartedAt: true, createdAt: true },
  });
  const days = new Set(after.map((session) => dateOnly(
    session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt,
  )));
  const sets = await prisma.strengthSet.count({ where: { sessionExercise: { profileId: user.profile.id, sessionId: { in: insertedIds } } } });
  if (days.size !== TARGET_TRAINING_DAYS || analytics.coverage.completedSessionCount < TARGET_TRAINING_DAYS
    || analytics.coverage.unmappedSetCount > 0) {
    throw new Error(`Post-seed verification found ${days.size} unique days and ${analytics.coverage.completedSessionCount} sessions.`);
  }

  console.log(JSON.stringify({
    ready: true,
    period: { from: WINDOW_START, through: WINDOW_END },
    preexistingTrainingDays: existingDates.size,
    insertedSessions: insertedIds.length,
    totalTrainingDays: days.size,
    completedSessionsInAnalytics: analytics.coverage.completedSessionCount,
    recordedSets: analytics.coverage.recordedSetCount,
    insertedWorkSets: sets,
    unmappedSets: analytics.coverage.unmappedSetCount,
    groupStatuses,
    weeklyPlan: "mostly four workouts per week; several three-day weeks; automatic lighter-volume weeks and isolated one-session outliers included",
    exerciseMapping: "all generated sets use registered Body Map anatomy snapshots",
    database: "isolated local Body Map QA test database; synthetic data only",
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : "unknown failure";
    console.error(`Body Map synthetic history seeding failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
