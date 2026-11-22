import type { AnatomyIdV2, BodyMapGroupIdV2 } from "@/modules/training/body-map-catalog-v2";
import type {
  BodyMapAnalyticsSetV1,
  BodyMapTrainingAnalyticsResponseV1,
} from "@/modules/training/body-map-training-analytics-v1";

export type BodyMapMuscleProgressStatusV1 =
  | "progress"
  | "regression"
  | "stable"
  | "mixed"
  | "ambiguous"
  | "insufficient-data";

export type BodyMapExerciseProgressPointV1 = {
  sessionId: number;
  date: string;
  loadKg: number | null;
  reps: number;
  rir: number | null;
  exerciseIndex: number;
  precedingTargetMuscleSets: number;
  phaseNumber: number;
  trainingBlockLabel: string | null;
  plannedSets: number;
  plannedRepsMin: number | null;
  plannedRepsMax: number | null;
  plannedRir: number | null;
  lighter: boolean;
  uncertainSessionLoad: boolean;
};

export type BodyMapExerciseProgressV1 = {
  key: string;
  stableKey: string | null;
  name: string;
  resistanceType: string;
  role: "direct" | "assisting";
  status: BodyMapMuscleProgressStatusV1;
  early: { loadKg: number | null; reps: number; rir: number | null } | null;
  late: { loadKg: number | null; reps: number; rir: number | null } | null;
  points: BodyMapExerciseProgressPointV1[];
  usableSessionCount: number;
  comparablePairCount: number;
  lighterSessionCount: number;
  hasOrderShift: boolean;
  hasDuplicateOccurrences: boolean;
  hasProgramChange: boolean;
  hasLongGap: boolean;
  hasUnreportedRir: boolean;
  hasUncertainSessionLoad: boolean;
  hasEffortMismatch: boolean;
  hasConflictingLoadAndReps: boolean;
};

export type BodyMapMuscleProgressAssessmentV1 = {
  status: BodyMapMuscleProgressStatusV1;
  exercises: BodyMapExerciseProgressV1[];
  progressExerciseCount: number;
  regressionExerciseCount: number;
  stableExerciseCount: number;
  mixedExerciseCount: number;
  ambiguousExerciseCount: number;
  insufficientExerciseCount: number;
  mappingIncomplete: boolean;
};

type GroupReport = BodyMapTrainingAnalyticsResponseV1["groups"][number];
type Direction = "up" | "down" | "steady" | "ambiguous";
type Slice = { loadKg: number | null; reps: number; rir: number | null };

const MIN_SESSIONS = 4;
const MIN_SPAN_DAYS = 28;
const MAX_UNBRIDGED_GAP_DAYS = 42;
const MIN_DIRECTIONAL_CONSENSUS = 0.65;
const MIN_COMPARABLE_PAIRS = 3;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function setLoad(set: BodyMapAnalyticsSetV1): number | null {
  if (set.resistanceType === "BODYWEIGHT") return null;
  const value = set.resistanceType === "RESISTANCE_BAND" ? set.bandNominalResistanceKg : set.weightKg;
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function precedingTargetMuscleSets(set: BodyMapAnalyticsSetV1, groupId: BodyMapGroupIdV2): number {
  return set.precedingExercises.reduce((total, exercise) =>
    total + (exercise.groupIds.includes(groupId) ? exercise.loggedSets : 0), 0);
}

function pointFromSession(
  rows: readonly BodyMapAnalyticsSetV1[],
  groupId: BodyMapGroupIdV2,
): BodyMapExerciseProgressPointV1 | null {
  const first = rows[0];
  if (!first || rows.length === 0) return null;
  const validReps = rows.map(({ reps }) => reps).filter((reps) => Number.isFinite(reps) && reps > 0);
  const reps = median(validReps);
  if (reps === null) return null;
  const loads = rows.map(setLoad).filter((load): load is number => load !== null);
  const loadKg = first.resistanceType === "BODYWEIGHT"
    ? null
    : loads.length >= Math.ceil(rows.length / 2) ? median(loads) : null;
  const rirs = rows.flatMap(({ rir }) => rir !== null && Number.isFinite(rir) ? [rir] : []);
  const rir = rirs.length >= Math.ceil(rows.length / 2) ? median(rirs) : null;
  const sessionIntent = first.sessionIntent;
  return {
    sessionId: first.sessionId,
    date: first.sessionDate,
    loadKg,
    reps,
    rir,
    exerciseIndex: first.exerciseIndex,
    precedingTargetMuscleSets: precedingTargetMuscleSets(first, groupId),
    phaseNumber: first.sessionPhaseNumber,
    trainingBlockLabel: first.trainingBlockLabel,
    plannedSets: first.plannedSets,
    plannedRepsMin: first.plannedRepsMin,
    plannedRepsMax: first.plannedRepsMax,
    plannedRir: first.plannedRir,
    lighter: first.sessionLoadStatus === "lighter" || sessionIntent === "easy-deload",
    uncertainSessionLoad: first.sessionLoadStatus === "uncertain",
  };
}

function sessionSlice(points: readonly BodyMapExerciseProgressPointV1[]): Slice | null {
  if (points.length === 0) return null;
  const loads = points.flatMap(({ loadKg }) => loadKg === null ? [] : [loadKg]);
  const rirs = points.flatMap(({ rir }) => rir === null ? [] : [rir]);
  const reps = median(points.map(({ reps }) => reps));
  if (reps === null) return null;
  return {
    loadKg: loads.length >= Math.ceil(points.length / 2) ? median(loads) : null,
    reps,
    rir: rirs.length >= Math.ceil(points.length / 2) ? median(rirs) : null,
  };
}

function sliceFor(points: readonly BodyMapExerciseProgressPointV1[]): Slice | null {
  const summaries = points.flatMap((point) => {
    const summary = sessionSlice([point]);
    return summary ? [summary] : [];
  });
  if (summaries.length === 0) return null;
  const loads = summaries.flatMap(({ loadKg }) => loadKg === null ? [] : [loadKg]);
  const rirs = summaries.flatMap(({ rir }) => rir === null ? [] : [rir]);
  const reps = median(summaries.map(({ reps }) => reps));
  if (reps === null) return null;
  return {
    loadKg: loads.length >= Math.ceil(summaries.length / 2) ? median(loads) : null,
    reps,
    rir: rirs.length >= Math.ceil(summaries.length / 2) ? median(rirs) : null,
  };
}

function daySpan(points: readonly BodyMapExerciseProgressPointV1[]): number {
  if (points.length < 2) return 0;
  const dates = points.map(({ date }) => date).sort();
  return (Date.parse(`${dates.at(-1)}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000;
}

function modalOrderContext(points: readonly BodyMapExerciseProgressPointV1[]): string | null {
  const counts = new Map<string, number>();
  for (const point of points) {
    const key = `${point.exerciseIndex}:${point.precedingTargetMuscleSets}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  if (!ranked[0] || ranked[0][1] < Math.ceil(points.length * 0.6) || ranked[0][1] === ranked[1]?.[1]) return null;
  return ranked[0][0];
}

function orderContextChanged(previous: BodyMapExerciseProgressPointV1, current: BodyMapExerciseProgressPointV1): boolean {
  return previous.exerciseIndex !== current.exerciseIndex
    || previous.precedingTargetMuscleSets !== current.precedingTargetMuscleSets;
}

function programContextChanged(previous: BodyMapExerciseProgressPointV1, current: BodyMapExerciseProgressPointV1): boolean {
  return previous.phaseNumber !== current.phaseNumber
    || previous.trainingBlockLabel !== current.trainingBlockLabel
    || previous.plannedSets !== current.plannedSets
    || previous.plannedRepsMin !== current.plannedRepsMin
    || previous.plannedRepsMax !== current.plannedRepsMax
    || previous.plannedRir !== current.plannedRir;
}

function compareSlices(
  previous: Slice,
  current: Slice,
  resistanceType: string,
): Direction | null {
  const hasPrevLoad = previous.loadKg !== null;
  const hasCurrentLoad = current.loadKg !== null;
  if (resistanceType !== "BODYWEIGHT" && hasPrevLoad !== hasCurrentLoad) return "ambiguous";

  let loadDirection = 0;
  if (resistanceType !== "BODYWEIGHT") {
    if (!hasPrevLoad || !hasCurrentLoad) return "ambiguous";
    loadDirection = Math.sign(current.loadKg! - previous.loadKg!);
    // A nominal band rating can only be compared at the same setting; it is not a direct force measurement.
    if (resistanceType === "RESISTANCE_BAND" && loadDirection !== 0) return "ambiguous";
  }
  const repsDirection = Math.sign(current.reps - previous.reps);
  if (loadDirection !== 0 && repsDirection !== 0 && loadDirection !== repsDirection) return "ambiguous";
  let outputDirection = loadDirection || repsDirection;

  if ((previous.rir === null) !== (current.rir === null)) return "ambiguous";
  if (previous.rir !== null && current.rir !== null) {
    const rirDirection = Math.sign(current.rir - previous.rir);
    if (outputDirection > 0 && rirDirection < 0) return "ambiguous";
    if (outputDirection < 0 && rirDirection > 0) return "ambiguous";
    if (outputDirection === 0 && Math.abs(current.rir - previous.rir) >= 2) outputDirection = rirDirection;
  }
  return outputDirection > 0 ? "up" : outputDirection < 0 ? "down" : "steady";
}

function assessExercise(input: {
  key: string;
  stableKey: string | null;
  name: string;
  resistanceType: string;
  role: "direct" | "assisting";
  sets: readonly BodyMapAnalyticsSetV1[];
  groupId: BodyMapGroupIdV2;
}): BodyMapExerciseProgressV1 {
  const groupedBySession = new Map<number, BodyMapAnalyticsSetV1[]>();
  for (const set of input.sets) groupedBySession.set(set.sessionId, [...(groupedBySession.get(set.sessionId) ?? []), set]);
  let hasDuplicateOccurrences = false;
  const allPoints = [...groupedBySession.values()]
    .flatMap((sessionSets) => {
      const occurrences = new Map<number, BodyMapAnalyticsSetV1[]>();
      for (const set of sessionSets) occurrences.set(set.exerciseIndex, [...(occurrences.get(set.exerciseIndex) ?? []), set]);
      // A repeated canonical movement can be intentionally programmed twice in
      // one session. Without a stable occurrence identity, combining its sets
      // would create a synthetic median across different order/fatigue contexts.
      if (occurrences.size !== 1) {
        hasDuplicateOccurrences = true;
        return [];
      }
      const onlyOccurrence = occurrences.values().next().value as BodyMapAnalyticsSetV1[] | undefined;
      const point = onlyOccurrence ? pointFromSession(onlyOccurrence, input.groupId) : null;
      return point ? [point] : [];
    })
    .sort((left, right) => left.date.localeCompare(right.date) || left.sessionId - right.sessionId);
  // Exclude both known lighter sessions and sessions whose load context could
  // not be classified. The source points remain available for provenance/UI.
  const standardPoints = allPoints.filter((point) => !point.lighter && !point.uncertainSessionLoad);
  const lighterSessionCount = allPoints.filter((point) => point.lighter).length;
  const usable = input.stableKey === null ? [] : standardPoints;
  const boundarySize = usable.length >= 6
    ? Math.max(3, Math.ceil(usable.length / 3))
    : Math.max(2, Math.ceil(usable.length / 3));
  const earlyPoints = usable.length >= 4 ? usable.slice(0, boundarySize) : usable;
  const latePoints = usable.length >= 4 ? usable.slice(-boundarySize) : usable;
  const early = sliceFor(earlyPoints);
  const late = sliceFor(latePoints);
  let comparablePairCount = 0;
  let up = 0;
  let down = 0;
  let steady = 0;
  let hasEffortMismatch = false;
  let hasConflictingLoadAndReps = false;
  const hasUnreportedRir = usable.some((point) => point.rir === null);
  let hasOrderShift = false;
  let hasProgramChange = false;
  const hasLongGap = usable.some((point, index) => index > 0
    && (Date.parse(`${point.date}T00:00:00Z`) - Date.parse(`${usable[index - 1]!.date}T00:00:00Z`)) / 86_400_000 > MAX_UNBRIDGED_GAP_DAYS);
  const hasUncertainSessionLoad = allPoints.some((point) => point.uncertainSessionLoad);

  for (let leftIndex = 0; leftIndex < usable.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < usable.length; rightIndex += 1) {
      const previous = usable[leftIndex]!;
      const current = usable[rightIndex]!;
      if (previous.date === current.date) continue;
      if (orderContextChanged(previous, current)) {
        hasOrderShift = true;
        continue;
      }
      const gap = (Date.parse(`${current.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86_400_000;
      if (gap > MAX_UNBRIDGED_GAP_DAYS) continue;
      if (programContextChanged(previous, current)) hasProgramChange = true;
      if ((previous.rir === null) !== (current.rir === null)
        || (previous.rir !== null && current.rir !== null && previous.rir !== current.rir)) hasEffortMismatch = true;
      const previousSlice = sessionSlice([previous]);
      const currentSlice = sessionSlice([current]);
      if (!previousSlice || !currentSlice) continue;
      const direction = compareSlices(previousSlice, currentSlice, input.resistanceType);
      if (direction === null) continue;
      if (direction === "ambiguous") {
        if (previous.loadKg !== null && current.loadKg !== null
          && Math.sign(current.loadKg - previous.loadKg) * Math.sign(current.reps - previous.reps) < 0) {
          hasConflictingLoadAndReps = true;
        }
        continue;
      }
      comparablePairCount += 1;
      if (direction === "up") up += 1;
      else if (direction === "down") down += 1;
      else steady += 1;
    }
  }

  const earlyOrderContext = modalOrderContext(earlyPoints);
  const lateOrderContext = modalOrderContext(latePoints);
  const boundaryContextStable = earlyOrderContext !== null && earlyOrderContext === lateOrderContext;
  const boundaryDirection = early && late && boundaryContextStable
    ? compareSlices(early, late, input.resistanceType)
    : "ambiguous";
  const directionCount = up + down + steady;
  const uniqueTrainingDates = new Set(usable.map(({ date }) => date)).size;
  const enoughHistory = uniqueTrainingDates >= MIN_SESSIONS && daySpan(usable) >= MIN_SPAN_DAYS;
  let status: BodyMapMuscleProgressStatusV1 = "insufficient-data";
  if (input.stableKey === null) status = "insufficient-data";
  else if (!enoughHistory) status = "insufficient-data";
  else if (comparablePairCount < MIN_COMPARABLE_PAIRS) status = "ambiguous";
  else if (boundaryDirection === "ambiguous") status = "ambiguous";
  else if (up > 0 && down > 0) status = "mixed";
  else if (up / directionCount >= MIN_DIRECTIONAL_CONSENSUS && boundaryDirection === "up") status = "progress";
  else if (down / directionCount >= MIN_DIRECTIONAL_CONSENSUS && boundaryDirection === "down") status = "regression";
  else if (steady / directionCount >= MIN_DIRECTIONAL_CONSENSUS && boundaryDirection === "steady") status = "stable";
  else status = "ambiguous";

  return {
    key: input.key,
    stableKey: input.stableKey,
    name: input.name,
    resistanceType: input.resistanceType,
    role: input.role,
    status,
    early,
    late,
    points: allPoints,
    usableSessionCount: usable.length,
    comparablePairCount,
    lighterSessionCount,
    hasOrderShift,
    hasDuplicateOccurrences,
    hasProgramChange,
    hasLongGap,
    hasUnreportedRir,
    hasUncertainSessionLoad,
    hasEffortMismatch,
    hasConflictingLoadAndReps,
  };
}

function groupStatus(exercises: readonly BodyMapExerciseProgressV1[]): BodyMapMuscleProgressStatusV1 {
  const evaluated = exercises.filter(({ status }) => status !== "insufficient-data");
  if (evaluated.length === 0) return "insufficient-data";
  const progress = evaluated.filter(({ status }) => status === "progress").length;
  const regression = evaluated.filter(({ status }) => status === "regression").length;
  const stable = evaluated.filter(({ status }) => status === "stable").length;
  const mixed = evaluated.filter(({ status }) => status === "mixed").length;
  const ambiguous = evaluated.filter(({ status }) => status === "ambiguous").length;
  if (progress > 0 && regression > 0 || mixed > 0) return "mixed";
  if (ambiguous > 0) return "ambiguous";
  const total = evaluated.length;
  if (progress / total >= 2 / 3) return "progress";
  if (regression / total >= 2 / 3) return "regression";
  if (stable === total) return "stable";
  if (progress === 0 && regression === 0 && stable === 0) return "ambiguous";
  return "mixed";
}

export function assessBodyMapMusclePerformanceV1(input: {
  groupReport: GroupReport | null;
  anatomyId: AnatomyIdV2 | null;
}): BodyMapMuscleProgressAssessmentV1 {
  const { groupReport, anatomyId } = input;
  if (!groupReport) return {
    status: "insufficient-data", exercises: [], progressExerciseCount: 0, regressionExerciseCount: 0,
    stableExerciseCount: 0, mixedExerciseCount: 0, ambiguousExerciseCount: 0,
    insufficientExerciseCount: 0, mappingIncomplete: true,
  };

  const byExercise = new Map<string, {
    stableKey: string | null;
    name: string;
    resistanceType: string;
    sets: BodyMapAnalyticsSetV1[];
    direct: boolean;
  }>();
  for (const exercise of groupReport.exercises) {
    const sets = exercise.sets.filter((set) => anatomyId === null || set.anatomyIds.includes(anatomyId));
    if (sets.length === 0) continue;
    const stableKey = exercise.stableKey;
    // Custom-name grouping is presentation-only; no cross-session trend is inferred without a stable catalog identity.
    const key = `${stableKey ?? `custom:${exercise.exerciseName}`}:${exercise.resistanceType}`;
    const current = byExercise.get(key) ?? {
      stableKey,
      name: exercise.exerciseName,
      resistanceType: exercise.resistanceType,
      sets: [],
      direct: false,
    };
    current.sets.push(...sets);
    current.direct ||= sets.some((set) => anatomyId === null ? set.directAnatomyIds.length > 0 : set.directAnatomyIds.includes(anatomyId));
    byExercise.set(key, current);
  }

  const exercises = [...byExercise.entries()]
    .map(([key, exercise]) => assessExercise({
      key,
      stableKey: exercise.stableKey,
      name: exercise.name,
      resistanceType: exercise.resistanceType,
      role: exercise.direct ? "direct" : "assisting",
      sets: exercise.sets,
      groupId: groupReport.groupId,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    status: groupStatus(exercises),
    exercises,
    progressExerciseCount: exercises.filter(({ status }) => status === "progress").length,
    regressionExerciseCount: exercises.filter(({ status }) => status === "regression").length,
    stableExerciseCount: exercises.filter(({ status }) => status === "stable").length,
    mixedExerciseCount: exercises.filter(({ status }) => status === "mixed").length,
    ambiguousExerciseCount: exercises.filter(({ status }) => status === "ambiguous").length,
    insufficientExerciseCount: exercises.filter(({ status }) => status === "insufficient-data").length,
    mappingIncomplete: groupReport.mappingCoverage !== "complete-for-input",
  };
}
