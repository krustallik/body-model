import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import { lookupExternalLoadAccountingV1 } from "@/modules/training/external-load-accounting";
import {
  exerciseMappingSnapshotWithAnatomyV1,
  retrospectiveExerciseAnatomyInterpretationV1,
} from "@/modules/training/exercise-anatomy-mapping-v1";
import { RESISTANCE } from "@/modules/training/training.constants";

export const TRAINING_HISTORY_STAGE01_NAMESPACE_V1 = "bodycast-training-history-stage01:v1" as const;
export const TRAINING_HISTORY_STAGE01_TIME_ZONE = "Europe/Bratislava" as const;
export const TRAINING_HISTORY_STAGE01_WEEK_STARTS = [
  "2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26",
  "2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23",
  "2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23",
] as const;

export type Stage01ScenarioId = "progress" | "regression" | "plateau" | "exercise-order";
export type Stage01Role = "direct" | "indirect";
export type Stage01LoadBasis =
  | "per-implement"
  | "per-side"
  | "full-system"
  | "band-nominal-per-logged-side"
  | "bodyweight-reference-separate"
  | "unknown";

type TargetWeek = {
  weightKg: number;
  reps: number;
  rawRir: readonly [number, number, number];
  annotations?: readonly string[];
};
type EquipmentHint =
  | "adjustable-dumbbells-and-30-degree-bench"
  | "adjustable-dumbbells-and-flat-bench"
  | "push-up-handles"
  | "dumbbells-and-bench"
  | "dumbbell"
  | "resistance-band"
  | "pull-up-bar"
  | "hyperextension-bench"
  | "dumbbells-and-incline-bench"
  | "dumbbell-and-wrist-support"
  | "equipment-unspecified";

export type Stage01SetFixture = {
  id: number;
  setNumber: number;
  reps: number;
  weightKg: number | null;
  bandNominalResistanceKg: number | null;
  rir: number | null;
  comment: string | null;
  completedAt: string | null;
};
export type Stage01CatalogExerciseFixture = {
  id: number;
  profileId: number;
  name: string;
  stableKey: string | null;
  kind: "canonical" | "custom-mapped" | "custom-unmapped";
  fixtureOwned: boolean;
  equipment: EquipmentHint;
  equipmentPersisted: false;
  snapshotStableKey: string | null;
};
export type Stage01ExerciseFixture = {
  id: number;
  sourceExerciseCatalogId: number;
  snapshotExerciseName: string;
  stableKey: string | null;
  snapshotStableKey: string | null;
  sortOrder: number;
  actualPosition: number;
  plannedSets: number;
  resistanceType: string;
  origin: "PLANNED" | "EXTRA";
  equipment: EquipmentHint;
  equipmentPersisted: false;
  loadBasis: Stage01LoadBasis;
  muscleMappingSnapshot: ReturnType<typeof exerciseMappingSnapshotWithAnatomyV1>;
  groupOrdinals: Array<{ muscleGroup: string; role: Stage01Role; ordinal: number }>;
  sets: Stage01SetFixture[];
};
export type Stage01SessionFixture = {
  id: number;
  profileId: number;
  programId: number;
  programVersionId: number;
  scenarioId: Stage01ScenarioId | "golden-pull" | "golden-push" | "edge-cases";
  weekNumber: number | null;
  date: string;
  status: "COMPLETED";
  entryMode: "LIVE" | "RETROSPECTIVE";
  webStartedAt: string | null;
  webEndedAt: string | null;
  revision: number;
  matchedWorkoutId: number | null;
  matchStatus: "PENDING" | "MATCHED";
  matchMethod: "DIRECT_BACKFILL" | null;
  matchedAt: string | null;
  exercises: Stage01ExerciseFixture[];
  priorExposure: Array<{ stableKey: string | null; muscleGroup: string; role: Stage01Role }>;
};
export type Stage01WorkoutFixture = {
  id: number;
  dailyHealthDataId: number;
  date: string;
  externalId: string | null;
  sourceIdentity: string;
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  energyKcal: number | null;
  activeEnergyKcal: number | null;
  syncProtected: false;
  hiddenFromHistory: false;
  manualStepCount: number | null;
  manualActiveEnergyKcal: number | null;
  matchedDiarySessionId: number | null;
  scenario: "golden" | "empty-diary" | "ms100-boundary";
};
export type Stage01DailyHealthFixture = {
  id: number;
  date: string;
  weightKg: null;
  steps: null;
  workoutFeedObserved: true;
  rawPayload: { fixtureNamespace: typeof TRAINING_HISTORY_STAGE01_NAMESPACE_V1 };
};
export type Stage01ProgramVersionFixture = {
  id: number;
  programId: number;
  versionNumber: number;
  createdAt: string;
  plannedExercises: Array<{
    exerciseCatalogId: number;
    sortOrder: number;
    plannedSets: number;
    resistanceType: string;
  }>;
};
export type TrainingHistoryStage01FixtureV1 = {
  namespace: typeof TRAINING_HISTORY_STAGE01_NAMESPACE_V1;
  version: 1;
  timezone: typeof TRAINING_HISTORY_STAGE01_TIME_ZONE;
  profiles: Array<{ id: number; sex: "male"; dateOfBirth: "1900-01-01"; heightCm: "1.00"; locale: "en" }>;
  catalogExercises: Stage01CatalogExerciseFixture[];
  programs: Array<{ id: number; profileId: number; name: string; currentVersionId: number }>;
  programVersions: Stage01ProgramVersionFixture[];
  programChanges: Array<{
    id: number;
    sessionId: number;
    fromProgramId: number;
    fromProgramVersionId: number;
    toProgramId: number;
    toProgramVersionId: number;
    createdAt: string;
  }>;
  sessions: Stage01SessionFixture[];
  dailyHealthRows: Stage01DailyHealthFixture[];
  workouts: Stage01WorkoutFixture[];
  comparisonInputs: {
    progress: readonly TargetWeek[];
    regression: readonly TargetWeek[];
    plateau: readonly TargetWeek[];
    "exercise-order": readonly TargetWeek[];
  };
  edgeCaseIds: readonly string[];
};

const CATALOG_ID_BASE = 971_000;
const PROGRAM_ID_BASE = 972_000;
const PROGRAM_VERSION_ID_BASE = 973_000;
const SESSION_ID_BASE = 974_000;
const SESSION_EXERCISE_ID_BASE = 975_000;
const SET_ID_BASE = 1_000_000;
export const STAGE01_PROGRAM_EXERCISE_ID_BASE = 1_060_000;
const WORKOUT_ID_BASE = 1_050_000;
const DAILY_HEALTH_ID_BASE = 1_070_000;
const SCENARIO_SLOTS: Record<Stage01SessionFixture["scenarioId"], number> = {
  progress: 0,
  regression: 1,
  plateau: 2,
  "exercise-order": 3,
  "golden-pull": 4,
  "golden-push": 5,
  "edge-cases": 6,
};
const SCENARIO_NAMES: Record<Stage01SessionFixture["scenarioId"], string> = {
  progress: "progress",
  regression: "regression",
  plateau: "plateau",
  "exercise-order": "exercise-order",
  "golden-pull": "golden-pull",
  "golden-push": "golden-push",
  "edge-cases": "edge-cases",
};
const TARGET_KEY = "incline_dumbbell_press_30deg";

const NONLINEAR_INPUTS: Record<"progress" | "regression" | "plateau", readonly TargetWeek[]> = {
  progress: [
    { weightKg: 20, reps: 10, rawRir: [3, 3, 2] },
    { weightKg: 20, reps: 11, rawRir: [3, 2, 2] },
    { weightKg: 21, reps: 10, rawRir: [2, 2, 1] },
    { weightKg: 21, reps: 11, rawRir: [3, 2, 2] },
    { weightKg: 19, reps: 9, rawRir: [1, 1, 1], annotations: ["isolated-bad-day"] },
    { weightKg: 21, reps: 10, rawRir: [2, 2, 2] },
    { weightKg: 22, reps: 10, rawRir: [2, 2, 1] },
    { weightKg: 21, reps: 10, rawRir: [2, 2, 1], annotations: ["exercise-order-changed"] },
    { weightKg: 21, reps: 11, rawRir: [3, 2, 2] },
    { weightKg: 23, reps: 12, rawRir: [4, 4, 3], annotations: ["unusually-good-day"] },
    { weightKg: 22, reps: 11, rawRir: [3, 2, 1] },
    { weightKg: 23, reps: 10, rawRir: [2, 2, 1] },
  ],
  regression: [
    { weightKg: 24, reps: 10, rawRir: [3, 2, 2] },
    { weightKg: 24, reps: 9, rawRir: [2, 2, 1] },
    { weightKg: 23, reps: 10, rawRir: [2, 2, 2] },
    { weightKg: 23, reps: 9, rawRir: [2, 1, 1] },
    { weightKg: 22, reps: 10, rawRir: [2, 2, 2] },
    { weightKg: 21, reps: 10, rawRir: [2, 2, 2] },
    { weightKg: 24, reps: 12, rawRir: [4, 4, 3], annotations: ["unusually-good-day"] },
    { weightKg: 21, reps: 9, rawRir: [1, 1, 2] },
    { weightKg: 20, reps: 10, rawRir: [2, 2, 2] },
    { weightKg: 20, reps: 9, rawRir: [2, 1, 1], annotations: ["prior-work-before-target"] },
    { weightKg: 19, reps: 10, rawRir: [1, 1, 1] },
    { weightKg: 19, reps: 9, rawRir: [1, 1, 2] },
  ],
  plateau: [
    { weightKg: 20, reps: 10, rawRir: [3, 2, 2] },
    { weightKg: 20, reps: 11, rawRir: [3, 2, 1] },
    { weightKg: 21, reps: 9, rawRir: [2, 1, 1] },
    { weightKg: 19.5, reps: 10, rawRir: [2, 2, 2], annotations: ["exercise-order-changed"] },
    { weightKg: 20, reps: 10, rawRir: [2, 2, 2] },
    { weightKg: 20.5, reps: 10, rawRir: [2, 1, 1] },
    { weightKg: 18, reps: 10, rawRir: [1, 1, 1], annotations: ["isolated-bad-day"] },
    { weightKg: 21, reps: 10, rawRir: [2, 2, 2] },
    { weightKg: 20, reps: 10, rawRir: [3, 2, 2] },
    { weightKg: 22, reps: 12, rawRir: [4, 4, 3], annotations: ["unusually-good-day"] },
    { weightKg: 19.5, reps: 10, rawRir: [2, 2, 2] },
    { weightKg: 20, reps: 10, rawRir: [2, 1, 1] },
  ],
};
const ORDER_INPUTS: readonly TargetWeek[] = [
  { weightKg: 20, reps: 9, rawRir: [3, 2, 2] },
  { weightKg: 20, reps: 10, rawRir: [2, 2, 2] },
  { weightKg: 20, reps: 10, rawRir: [2, 2, 2] },
  { weightKg: 20, reps: 10, rawRir: [2, 2, 2], annotations: ["order-third"] },
  { weightKg: 19, reps: 9, rawRir: [1, 1, 1], annotations: ["temporary-degradation-after-reorder"] },
  { weightKg: 20, reps: 9, rawRir: [2, 2, 1] },
  { weightKg: 20, reps: 10, rawRir: [2, 2, 2], annotations: ["order-second-shoulders-first"] },
  { weightKg: 20, reps: 9, rawRir: [1, 1, 2] },
  { weightKg: 20, reps: 10, rawRir: [2, 2, 2] },
  { weightKg: 21, reps: 10, rawRir: [2, 2, 2], annotations: ["returned-to-first-position"] },
  { weightKg: 21, reps: 10, rawRir: [2, 2, 2] },
  { weightKg: 21, reps: 11, rawRir: [3, 2, 2] },
];
const TARGET_INPUTS: Record<Stage01ScenarioId, readonly TargetWeek[]> = {
  ...NONLINEAR_INPUTS,
  "exercise-order": ORDER_INPUTS,
};
const EQUIPMENT_BY_KEY: Readonly<Record<string, EquipmentHint>> = {
  incline_dumbbell_press_30deg: "adjustable-dumbbells-and-30-degree-bench",
  flat_dumbbell_fly: "adjustable-dumbbells-and-flat-bench",
  pushup_handles: "push-up-handles",
  seated_dumbbell_press: "dumbbells-and-bench",
  one_arm_lateral_raise: "dumbbell",
  one_arm_cable_triceps_extension: "resistance-band",
  bent_over_one_arm_dumbbell_triceps_extension: "dumbbell",
  one_arm_seated_cable_row: "resistance-band",
  pull_up: "pull-up-bar",
  hyperextension: "hyperextension-bench",
  one_arm_concentration_curl: "dumbbell",
  incline_seated_rotating_dumbbell_curl: "dumbbells-and-incline-bench",
  supported_dumbbell_wrist_curl: "dumbbell-and-wrist-support",
};

function profileId(): number { return 1; }
function programId(slot: number): number { return PROGRAM_ID_BASE + slot + 1; }
function programVersionId(slot: number, version: number): number { return PROGRAM_VERSION_ID_BASE + slot * 10 + version; }
function catalogId(slot: number, index: number): number { return slot === 0 ? index + 1 : CATALOG_ID_BASE + slot * 100 + index + 1; }
function sessionId(slot: number, week: number): number { return SESSION_ID_BASE + slot * 100 + week; }

function localIso(date: string, clock: string): string {
  const offset = date >= "2026-03-29" ? "+02:00" : "+01:00";
  return new Date(date + "T" + clock + offset).toISOString();
}

function catalogForSlot(slot: number, key: string | null, kind: Stage01CatalogExerciseFixture["kind"] = "canonical"): Stage01CatalogExerciseFixture {
  const index = key === null
    ? kind === "custom-mapped" ? CANONICAL_EXERCISE_IDENTITIES.length : CANONICAL_EXERCISE_IDENTITIES.length + 1
    : CANONICAL_EXERCISE_IDENTITIES.findIndex((entry) => entry.stableKey === key);
  const canonical = key === null ? null : CANONICAL_EXERCISE_IDENTITIES.find((entry) => entry.stableKey === key);
  return {
    id: catalogId(slot, index),
    profileId: profileId(),
    name: canonical?.displayName ?? (kind === "custom-mapped" ? "Stage 01 custom mapped cable press" : "Stage 01 custom unmapped movement"),
    stableKey: kind === "canonical" ? key : null,
    kind,
    fixtureOwned: kind !== "canonical",
    equipment: key ? EQUIPMENT_BY_KEY[key] ?? "equipment-unspecified" : "equipment-unspecified",
    equipmentPersisted: false,
    snapshotStableKey: kind === "custom-mapped" ? "seated_dumbbell_press" : key,
  };
}
function loadBasisFor(stableKey: string | null, resistanceType: string): Stage01LoadBasis {
  if (resistanceType === RESISTANCE.RESISTANCE_BAND) return "band-nominal-per-logged-side";
  if (resistanceType === RESISTANCE.BODYWEIGHT) return "bodyweight-reference-separate";
  const accounting = lookupExternalLoadAccountingV1(stableKey);
  if (accounting?.entryBasis === "per-implement") return "per-implement";
  if (accounting?.entryBasis === "per-side") return "per-side";
  if (stableKey === "hyperextension") return "full-system";
  return "unknown";
}
function groupsFor(snapshot: ReturnType<typeof exerciseMappingSnapshotWithAnatomyV1>) {
  return snapshot.availability === "available" ? snapshot.targets : [];
}
function addGroupOrdinals(exercises: Stage01ExerciseFixture[]): Stage01ExerciseFixture[] {
  const counts = new Map<string, number>();
  return exercises.map((exercise) => {
    const groupOrdinals = groupsFor(exercise.muscleMappingSnapshot).map((target) => {
      const key = target.role + "|" + target.muscleGroup;
      const ordinal = (counts.get(key) ?? 0) + 1;
      counts.set(key, ordinal);
      return { muscleGroup: target.muscleGroup, role: target.role, ordinal };
    });
    return { ...exercise, groupOrdinals };
  });
}
function makeExercise(
  slot: number,
  week: number,
  exerciseIndex: number,
  position: number,
  catalog: Stage01CatalogExerciseFixture,
  options: {
    resistanceType: string;
    sets: Array<{ reps: number; weightKg?: number | null; bandNominalResistanceKg?: number | null; rir?: number | null; comment?: string | null }>;
    origin?: "PLANNED" | "EXTRA";
    equipment?: EquipmentHint;
  },
): Stage01ExerciseFixture {
  const initialSnapshot = exerciseMappingSnapshotWithAnatomyV1(catalog.snapshotStableKey);
  const snapshot = catalog.kind === "custom-mapped"
    ? {
      ...initialSnapshot,
      anatomyMappingSnapshotV1: retrospectiveExerciseAnatomyInterpretationV1(initialSnapshot),
    }
    : initialSnapshot;
  const id = SESSION_EXERCISE_ID_BASE + slot * 1_000 + week * 10 + exerciseIndex + 1;
  const sets = options.sets.map((values, index) => ({
    id: SET_ID_BASE + slot * 10_000 + week * 100 + exerciseIndex * 10 + index + 1,
    setNumber: index + 1,
    reps: values.reps,
    weightKg: values.weightKg ?? null,
    bandNominalResistanceKg: values.bandNominalResistanceKg ?? null,
    rir: values.rir ?? null,
    comment: values.comment ?? null,
    completedAt: null,
  }));
  return {
    id,
    sourceExerciseCatalogId: catalog.id,
    snapshotExerciseName: catalog.name,
    stableKey: catalog.stableKey,
    snapshotStableKey: catalog.snapshotStableKey,
    sortOrder: position - 1,
    actualPosition: position,
    plannedSets: sets.length,
    resistanceType: options.resistanceType,
    origin: options.origin ?? "PLANNED",
    equipment: options.equipment ?? catalog.equipment,
    equipmentPersisted: false,
    loadBasis: loadBasisFor(catalog.stableKey ?? catalog.snapshotStableKey, options.resistanceType),
    muscleMappingSnapshot: snapshot,
    groupOrdinals: [],
    sets,
  };
}
function supplementalExercise(slot: number, week: number, exerciseIndex: number, position: number, stableKey: string): Stage01ExerciseFixture {
  const catalog = catalogForSlot(0, stableKey);
  const resistanceType = stableKey === "pull_up" || stableKey === "pushup_handles"
    ? RESISTANCE.BODYWEIGHT
    : stableKey === "one_arm_cable_triceps_extension" || stableKey === "one_arm_seated_cable_row"
      ? RESISTANCE.RESISTANCE_BAND
      : RESISTANCE.EXTERNAL_WEIGHT;
  const repsOne = 8 + (week % 3);
  const repsTwo = 7 + ((week + 1) % 3);
  const sets = resistanceType === RESISTANCE.BODYWEIGHT
    ? [{ reps: repsOne, rir: 2 }, { reps: repsTwo, rir: null }]
    : resistanceType === RESISTANCE.RESISTANCE_BAND
      ? [{ reps: repsOne, bandNominalResistanceKg: 12.5 + week, rir: 3 }, { reps: repsTwo, bandNominalResistanceKg: 14.5 + week, rir: 2 }]
      : [{ reps: repsOne, weightKg: 10 + week / 2, rir: 3 }, { reps: repsTwo, weightKg: 11 + week / 2, rir: 2 }];
  return makeExercise(slot, week, exerciseIndex, position, catalog, { resistanceType, sets });
}

function preWorkSpecs(scenario: Stage01ScenarioId, week: number): Array<{
  stableKey: string;
  equipment: EquipmentHint;
  resistanceType: string;
  sets: Array<{ reps: number; weightKg?: number; rir: number }>;
}> {
  if ((scenario === "progress" && week === 8) || (scenario === "plateau" && week === 4)) {
    return [{ stableKey: "flat_dumbbell_fly", equipment: "adjustable-dumbbells-and-flat-bench", resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      sets: [{ reps: 10, weightKg: 15, rir: 3 }, { reps: 10, weightKg: 15, rir: 2 }] }];
  }
  if (scenario === "regression" && week === 10) {
    return [{ stableKey: "bent_over_one_arm_dumbbell_triceps_extension", equipment: "dumbbell", resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      sets: [{ reps: 15, weightKg: 15, rir: 3 }] }];
  }
  if (scenario === "exercise-order" && week >= 4 && week <= 6) {
    return [
      { stableKey: "flat_dumbbell_fly", equipment: "adjustable-dumbbells-and-flat-bench", resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        sets: [{ reps: 10, weightKg: 15, rir: 3 }, { reps: 10, weightKg: 15, rir: 2 }] },
      { stableKey: "seated_dumbbell_press", equipment: "dumbbells-and-bench", resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        sets: [{ reps: 10, weightKg: 12, rir: 3 }, { reps: 10, weightKg: 12, rir: 2 }] },
    ];
  }
  if (scenario === "exercise-order" && week >= 7 && week <= 9) {
    return [{ stableKey: "seated_dumbbell_press", equipment: "dumbbells-and-bench", resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      sets: [{ reps: 10, weightKg: 12, rir: 3 }, { reps: 10, weightKg: 12, rir: 2 }] }];
  }
  return [];
}

function createSession(scenario: Stage01ScenarioId, week: number, catalogs: Map<string, Stage01CatalogExerciseFixture>): Stage01SessionFixture {
  const slot = SCENARIO_SLOTS[scenario];
  const date = TRAINING_HISTORY_STAGE01_WEEK_STARTS[week - 1]!;
  const preWork = preWorkSpecs(scenario, week);
  const targetAt = scenario === "exercise-order"
    ? week >= 4 && week <= 6 ? 3 : week >= 7 && week <= 9 ? 2 : 1
    : preWork.length + 1;
  const exercises: Stage01ExerciseFixture[] = [];
  let position = 1;
  for (const spec of preWork) {
    exercises.push(makeExercise(slot, week, exercises.length, position++, catalogs.get(spec.stableKey)!, {
      resistanceType: spec.resistanceType, equipment: spec.equipment, sets: spec.sets,
    }));
  }
  const target = TARGET_INPUTS[scenario][week - 1]!;
  exercises.push(makeExercise(slot, week, exercises.length, targetAt, catalogs.get(TARGET_KEY)!, {
    resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
    sets: target.rawRir.map((rir, index) => ({
      reps: target.reps, weightKg: target.weightKg, rir,
      comment: index === 0 ? target.annotations?.join(", ") ?? null : null,
    })),
  }));
  position = targetAt + 1;
  if (scenario !== "exercise-order") {
    exercises.push(supplementalExercise(slot, week, exercises.length, position, CANONICAL_EXERCISE_IDENTITIES[week]!.stableKey));
  } else if (week <= 3 || week >= 10) {
    exercises.push(supplementalExercise(slot, week, exercises.length, position++, CANONICAL_EXERCISE_IDENTITIES[week]!.stableKey));
    if (week === 11 || week === 12) {
      exercises.push(makeExercise(slot, week, exercises.length, position++, catalogs.get("custom-mapped")!, {
        resistanceType: RESISTANCE.RESISTANCE_BAND, origin: "EXTRA", sets: [{ reps: 10, bandNominalResistanceKg: 20, rir: 2 }],
      }));
      exercises.push(makeExercise(slot, week, exercises.length, position, catalogs.get("custom-unmapped")!, {
        resistanceType: RESISTANCE.BODYWEIGHT, origin: "EXTRA", sets: [{ reps: 8, rir: null }],
      }));
    }
  }
  const ordered = addGroupOrdinals(exercises.sort((left, right) => left.sortOrder - right.sortOrder));
  const previous = ordered.filter((exercise) => exercise.actualPosition < targetAt);
  const priorExposure = previous.flatMap((exercise) =>
    groupsFor(exercise.muscleMappingSnapshot).map((target) => ({
      stableKey: exercise.stableKey ?? exercise.snapshotStableKey,
      muscleGroup: target.muscleGroup,
      role: target.role,
    })),
  );
  const phase = Math.floor((week - 1) / 3) + 1;
  return {
    id: sessionId(slot, week), profileId: profileId(), programId: programId(slot), programVersionId: programVersionId(slot, phase),
    scenarioId: scenario, weekNumber: week, date, status: "COMPLETED", entryMode: "LIVE",
    webStartedAt: localIso(date, "17:00:00"), webEndedAt: localIso(date, "18:00:00"), revision: 1,
    matchedWorkoutId: null, matchStatus: "PENDING", matchMethod: null, matchedAt: null,
    exercises: ordered, priorExposure,
  };
}

type GoldenSetInput = { reps: number; weightKg?: number; bandNominalResistanceKg?: number };
type GoldenExerciseInput = { stableKey: string; resistanceType: string; loadBasis: Stage01LoadBasis; equipment: EquipmentHint; sets: readonly GoldenSetInput[] };

const PULL_GOLDEN_ROWS: readonly GoldenExerciseInput[] = [
  { stableKey: "pull_up", resistanceType: RESISTANCE.BODYWEIGHT, loadBasis: "bodyweight-reference-separate", equipment: "pull-up-bar", sets: [{ reps: 8 }, { reps: 6 }, { reps: 4 }] },
  { stableKey: "one_arm_seated_cable_row", resistanceType: RESISTANCE.RESISTANCE_BAND, loadBasis: "band-nominal-per-logged-side", equipment: "resistance-band", sets: [{ reps: 10, bandNominalResistanceKg: 92.7 }, { reps: 9, bandNominalResistanceKg: 101.8 }, { reps: 10, bandNominalResistanceKg: 92.7 }] },
  { stableKey: "hyperextension", resistanceType: RESISTANCE.EXTERNAL_WEIGHT, loadBasis: "full-system", equipment: "hyperextension-bench", sets: [{ reps: 10, weightKg: 26 }, { reps: 10, weightKg: 36 }, { reps: 10, weightKg: 46 }, { reps: 10, weightKg: 46 }] },
  { stableKey: "one_arm_concentration_curl", resistanceType: RESISTANCE.EXTERNAL_WEIGHT, loadBasis: "per-side", equipment: "dumbbell", sets: [{ reps: 8, weightKg: 18.5 }, { reps: 7, weightKg: 23.5 }, { reps: 8, weightKg: 21 }] },
  { stableKey: "incline_seated_rotating_dumbbell_curl", resistanceType: RESISTANCE.EXTERNAL_WEIGHT, loadBasis: "per-implement", equipment: "dumbbells-and-incline-bench", sets: [{ reps: 4, weightKg: 21 }, { reps: 8, weightKg: 18.5 }, { reps: 7, weightKg: 18.5 }] },
  { stableKey: "supported_dumbbell_wrist_curl", resistanceType: RESISTANCE.EXTERNAL_WEIGHT, loadBasis: "per-side", equipment: "dumbbell-and-wrist-support", sets: [{ reps: 10, weightKg: 16 }, { reps: 5, weightKg: 23.5 }, { reps: 8, weightKg: 18.5 }, { reps: 10, weightKg: 18.5 }, { reps: 6, weightKg: 18.5 }] },
];
const PUSH_GOLDEN_ROWS: readonly GoldenExerciseInput[] = [
  { stableKey: "incline_dumbbell_press_30deg", resistanceType: RESISTANCE.EXTERNAL_WEIGHT, loadBasis: "per-implement", equipment: "adjustable-dumbbells-and-30-degree-bench", sets: [{ reps: 8, weightKg: 26 }, { reps: 8, weightKg: 36 }, { reps: 4, weightKg: 36 }, { reps: 5, weightKg: 33.5 }] },
  { stableKey: "flat_dumbbell_fly", resistanceType: RESISTANCE.EXTERNAL_WEIGHT, loadBasis: "per-implement", equipment: "adjustable-dumbbells-and-flat-bench", sets: [{ reps: 8, weightKg: 21 }, { reps: 4, weightKg: 26 }, { reps: 10, weightKg: 21 }] },
  { stableKey: "pushup_handles", resistanceType: RESISTANCE.BODYWEIGHT, loadBasis: "bodyweight-reference-separate", equipment: "push-up-handles", sets: [{ reps: 18 }] },
  { stableKey: "seated_dumbbell_press", resistanceType: RESISTANCE.EXTERNAL_WEIGHT, loadBasis: "per-implement", equipment: "dumbbells-and-bench", sets: [{ reps: 7, weightKg: 21 }, { reps: 5, weightKg: 23.5 }, { reps: 5, weightKg: 21 }] },
  { stableKey: "one_arm_lateral_raise", resistanceType: RESISTANCE.EXTERNAL_WEIGHT, loadBasis: "per-side", equipment: "dumbbell", sets: [{ reps: 12, weightKg: 13.5 }, { reps: 12, weightKg: 18.5 }, { reps: 12, weightKg: 18.5 }] },
  { stableKey: "one_arm_cable_triceps_extension", resistanceType: RESISTANCE.RESISTANCE_BAND, loadBasis: "band-nominal-per-logged-side", equipment: "resistance-band", sets: [{ reps: 10, bandNominalResistanceKg: 54 }, { reps: 8, bandNominalResistanceKg: 72 }, { reps: 10, bandNominalResistanceKg: 63 }] },
  { stableKey: "bent_over_one_arm_dumbbell_triceps_extension", resistanceType: RESISTANCE.EXTERNAL_WEIGHT, loadBasis: "per-side", equipment: "dumbbell", sets: [{ reps: 12, weightKg: 16 }, { reps: 12, weightKg: 23.5 }, { reps: 12, weightKg: 23.5 }] },
];

function goldenExercise(slot: number, week: number, index: number, input: GoldenExerciseInput): Stage01ExerciseFixture {
  const exercise = makeExercise(slot, week, index, index + 1, catalogForSlot(0, input.stableKey), {
    resistanceType: input.resistanceType,
    equipment: input.equipment,
    sets: input.sets.map((set) => ({
      reps: set.reps, weightKg: set.weightKg ?? null, bandNominalResistanceKg: set.bandNominalResistanceKg ?? null, rir: null,
    })),
  });
  return { ...exercise, loadBasis: input.loadBasis };
}
function createGoldenSession(side: "pull" | "push", rows: readonly GoldenExerciseInput[]): Stage01SessionFixture {
  const name = side === "pull" ? "golden-pull" : "golden-push";
  const slot = SCENARIO_SLOTS[name];
  const date = side === "pull" ? "2026-09-24" : "2026-09-25";
  const week = side === "pull" ? 90 : 91;
  return {
    id: sessionId(slot, week), profileId: profileId(), programId: programId(slot), programVersionId: programVersionId(slot, 1),
    scenarioId: name, weekNumber: null, date, status: "COMPLETED", entryMode: "RETROSPECTIVE",
    webStartedAt: null, webEndedAt: null, revision: 1,
    matchedWorkoutId: WORKOUT_ID_BASE + (side === "pull" ? 1 : 2), matchStatus: "MATCHED",
    matchMethod: "DIRECT_BACKFILL", matchedAt: localIso(date, "10:30:00"),
    exercises: addGroupOrdinals(rows.map((row, index) => goldenExercise(slot, week, index, row))),
    priorExposure: [],
  };
}
function createEmptyDiarySession(): Stage01SessionFixture {
  const slot = SCENARIO_SLOTS["edge-cases"];
  const date = "2026-09-24";
  return {
    id: 974_699, profileId: profileId(), programId: programId(slot), programVersionId: programVersionId(slot, 1),
    scenarioId: "edge-cases", weekNumber: null, date, status: "COMPLETED", entryMode: "RETROSPECTIVE",
    webStartedAt: null, webEndedAt: null, revision: 1, matchedWorkoutId: WORKOUT_ID_BASE + 3,
    matchStatus: "MATCHED", matchMethod: "DIRECT_BACKFILL", matchedAt: localIso(date, "12:30:00"),
    exercises: [], priorExposure: [],
  };
}

function createPrograms(sessions: readonly Stage01SessionFixture[]) {
  const names = Object.keys(SCENARIO_SLOTS) as Array<keyof typeof SCENARIO_SLOTS>;
  const programs = names.map((name) => {
    const slot = SCENARIO_SLOTS[name];
    const versions = ["progress", "regression", "plateau", "exercise-order"].includes(name) ? 4 : 1;
    return { id: programId(slot), profileId: profileId(), name: "stage01-v1-" + SCENARIO_NAMES[name], currentVersionId: programVersionId(slot, versions) };
  });
  const programVersions: Stage01ProgramVersionFixture[] = [];
  for (const name of names) {
    const slot = SCENARIO_SLOTS[name];
    const versionCount = ["progress", "regression", "plateau", "exercise-order"].includes(name) ? 4 : 1;
    for (let versionNumber = 1; versionNumber <= versionCount; versionNumber += 1) {
      const phaseSessions = sessions.filter((session) =>
        session.programId === programId(slot)
        && (session.weekNumber === null || Math.floor(((session.weekNumber ?? 1) - 1) / 3) + 1 === versionNumber),
      );
      const first = phaseSessions[0];
      const versionDate = first?.date ?? "2026-09-24";
      const rows = new Map<number, Stage01ExerciseFixture>();
      for (const exercise of first?.exercises ?? []) rows.set(exercise.sourceExerciseCatalogId, exercise);
      const target = first?.exercises.find((exercise) => exercise.stableKey === TARGET_KEY);
      if (target) rows.set(target.sourceExerciseCatalogId, target);
      const planned = [...rows.values()].sort((left, right) => {
        if (left.stableKey === TARGET_KEY) return -1;
        if (right.stableKey === TARGET_KEY) return 1;
        return left.sourceExerciseCatalogId - right.sourceExerciseCatalogId;
      });
      programVersions.push({
        id: programVersionId(slot, versionNumber), programId: programId(slot), versionNumber,
        createdAt: localIso(versionDate, "00:00:00"),
        plannedExercises: planned.map((exercise, index) => ({
          exerciseCatalogId: exercise.sourceExerciseCatalogId, sortOrder: index,
          plannedSets: exercise.plannedSets, resistanceType: exercise.resistanceType,
        })),
      });
    }
  }
  return { programs, programVersions };
}
function createProgramChanges(sessions: readonly Stage01SessionFixture[]) {
  const changes: TrainingHistoryStage01FixtureV1["programChanges"] = [];
  for (const session of sessions) {
    if (session.weekNumber === null || ![4, 7, 10].includes(session.weekNumber)) continue;
    const slot = session.programId - PROGRAM_ID_BASE - 1;
    const fromVersion = Math.floor((session.weekNumber - 2) / 3) + 1;
    changes.push({
      id: 1_080_000 + slot * 10 + session.weekNumber, sessionId: session.id, fromProgramId: session.programId,
      fromProgramVersionId: programVersionId(slot, fromVersion), toProgramId: session.programId,
      toProgramVersionId: programVersionId(slot, fromVersion + 1), createdAt: localIso(session.date, "16:55:00"),
    });
  }
  return changes;
}
function makeWorkout(
  id: number,
  dailyHealthDataId: number,
  date: string,
  type: string,
  startAt: string,
  endAt: string,
  scenario: Stage01WorkoutFixture["scenario"],
  options: { externalId?: string | null; sourceIdentity?: string; matchedDiarySessionId?: number | null; manualStepCount?: number | null } = {},
): Stage01WorkoutFixture {
  return {
    id, dailyHealthDataId, date, externalId: options.externalId ?? null,
    sourceIdentity: options.sourceIdentity ?? (options.externalId ? `ext:${options.externalId}` : "fp:stage01|" + type + "|" + startAt + "|" + endAt),
    type, startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(),
    durationMinutes: null, energyKcal: null, activeEnergyKcal: null, syncProtected: false, hiddenFromHistory: false,
    manualStepCount: options.manualStepCount ?? null, manualActiveEnergyKcal: null,
    matchedDiarySessionId: options.matchedDiarySessionId ?? null, scenario,
  };
}
function createWorkouts(sessions: readonly Stage01SessionFixture[]): Stage01WorkoutFixture[] {
  const pull = sessions.find((session) => session.scenarioId === "golden-pull")!;
  const push = sessions.find((session) => session.scenarioId === "golden-push")!;
  const empty = sessions.find((session) => session.scenarioId === "edge-cases")!;
  const pullDay = DAILY_HEALTH_ID_BASE + 1;
  const pushDay = DAILY_HEALTH_ID_BASE + 2;
  return [
    makeWorkout(WORKOUT_ID_BASE + 1, pullDay, "2026-09-24", "Traditional Strength Training", "2026-09-24T09:00:00+02:00", "2026-09-24T10:30:00+02:00", "golden", {
      externalId: "stage01-golden-pull-source", sourceIdentity: "ext:stage01-golden-pull-source", matchedDiarySessionId: pull.id,
    }),
    makeWorkout(WORKOUT_ID_BASE + 2, pushDay, "2026-09-25", "Traditional Strength Training", "2026-09-25T09:00:00+02:00", "2026-09-25T10:30:00+02:00", "golden", {
      externalId: "stage01-golden-push-source", sourceIdentity: "ext:stage01-golden-push-source", matchedDiarySessionId: push.id,
    }),
    makeWorkout(WORKOUT_ID_BASE + 3, pullDay, "2026-09-24", "Traditional Strength Training", "2026-09-24T11:30:00+02:00", "2026-09-24T12:30:00+02:00", "empty-diary", {
      externalId: "stage01-empty-diary-source", sourceIdentity: "ext:stage01-empty-diary-source", matchedDiarySessionId: empty.id,
    }),
    makeWorkout(WORKOUT_ID_BASE + 4, pullDay, "2026-09-24", "MS100", "2026-09-24T23:40:00+02:00", "2026-09-25T00:25:00+02:00", "ms100-boundary", {
      externalId: "stage01-ms100-cross-midnight-a",
    }),
    makeWorkout(WORKOUT_ID_BASE + 5, pullDay, "2026-09-24", "MS100", "2026-09-24T23:55:00+02:00", "2026-09-25T00:30:00+02:00", "ms100-boundary", {
      manualStepCount: 100,
    }),
  ];
}
function createDailyHealthRows(): Stage01DailyHealthFixture[] {
  return ["2026-09-24", "2026-09-25"].map((date, index) => ({
    id: DAILY_HEALTH_ID_BASE + index + 1, date, weightKg: null, steps: null, workoutFeedObserved: true,
    rawPayload: { fixtureNamespace: TRAINING_HISTORY_STAGE01_NAMESPACE_V1 },
  }));
}
function createCatalogExercises(): Stage01CatalogExerciseFixture[] {
  const rows = CANONICAL_EXERCISE_IDENTITIES.map((exercise) => catalogForSlot(0, exercise.stableKey));
  rows.push(
    catalogForSlot(SCENARIO_SLOTS["exercise-order"], null, "custom-mapped"),
    catalogForSlot(SCENARIO_SLOTS["exercise-order"], null, "custom-unmapped"),
  );
  return rows;
}

export function createTrainingHistoryStage01FixtureV1(): TrainingHistoryStage01FixtureV1 {
  const catalogExercises = createCatalogExercises();
  const sessions: Stage01SessionFixture[] = [];
  for (const scenario of ["progress", "regression", "plateau", "exercise-order"] as const) {
    const catalogs = new Map<string, Stage01CatalogExerciseFixture>();
    for (const exercise of catalogExercises.filter((row) => row.profileId === profileId())) {
      catalogs.set(exercise.kind === "canonical" ? exercise.stableKey! : exercise.kind, exercise);
    }
    for (let week = 1; week <= 12; week += 1) sessions.push(createSession(scenario, week, catalogs));
  }
  sessions.push(createGoldenSession("pull", PULL_GOLDEN_ROWS), createGoldenSession("push", PUSH_GOLDEN_ROWS), createEmptyDiarySession());
  const profiles = [{
    id: 1, sex: "male" as const, dateOfBirth: "1900-01-01" as const, heightCm: "1.00" as const, locale: "en" as const,
  }];
  const { programs, programVersions } = createPrograms(sessions);
  return {
    namespace: TRAINING_HISTORY_STAGE01_NAMESPACE_V1, version: 1, timezone: TRAINING_HISTORY_STAGE01_TIME_ZONE,
    profiles, catalogExercises, programs, programVersions, programChanges: createProgramChanges(sessions),
    sessions, dailyHealthRows: createDailyHealthRows(), workouts: createWorkouts(sessions),
    comparisonInputs: { progress: NONLINEAR_INPUTS.progress, regression: NONLINEAR_INPUTS.regression, plateau: NONLINEAR_INPUTS.plateau, "exercise-order": ORDER_INPUTS },
    edgeCaseIds: [
      "no-workout-event-zero-trainings", "workout-with-empty-diary-no-exercise-detail", "matched-workout-and-diary-single-event",
      "missing-heart-rate-or-body-mass-remains-unavailable", "historical-snapshots-survive-retrospective-edit", "program-version-change-retained",
      "null-rir-is-unreported", "null-load-is-unavailable", "custom-mapped-snapshot", "custom-unmapped-snapshot", "rest-day", "partial-period",
      "multiple-workouts-per-day", "bilateral-per-implement-and-unilateral-per-side", "ms100-keeps-manual-fields-outside-strength-sets",
      "missing-steps-remains-unavailable", "garmin-source-identity-fallback", "overlapping-activity-intervals", "cross-midnight-activity",
    ],
  };
}
