import { workoutSourceIdentity, type WorkoutIdentitySource } from "./workout-source-identity";
import type { WorkoutInput } from "./health.types";

export type ExistingDayWorkout = {
  id: number;
  sourceIdentity: string | null;
  externalId: string | null;
  type: string;
  startAt: Date;
  endAt: Date;
  /** True when a StrengthDiarySession currently points at this Workout. */
  linkedToDiary: boolean;
};

export type WorkoutWriteFields = {
  externalId: string | null;
  sourceIdentity: string;
  type: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number | null;
  energyKcal: number | null;
  activeEnergyKcal: number | null;
};

export type WorkoutReconciliationPlan = {
  updates: Array<{ id: number; fields: WorkoutWriteFields }>;
  creates: WorkoutWriteFields[];
  /** Unlinked workouts absent from the incoming feed — safe to delete. */
  deletes: number[];
  /**
   * Linked workouts absent from the incoming feed.
   * Keep them to protect diary FK; do not rebind diary elsewhere.
   */
  retainedLinkedMissingFromFeed: number[];
};

function toWriteFields(workout: WorkoutInput): WorkoutWriteFields {
  const sourceIdentity = workoutSourceIdentity(workout);
  return {
    externalId: workout.externalId ?? null,
    sourceIdentity,
    type: workout.type,
    startAt: new Date(workout.startAt),
    endAt: new Date(workout.endAt),
    durationMinutes: workout.durationMinutes ?? null,
    energyKcal: workout.energyKcal ?? null,
    activeEnergyKcal: workout.activeEnergyKcal ?? null,
  };
}

function legacyIdentity(existing: ExistingDayWorkout): string {
  if (existing.sourceIdentity) return existing.sourceIdentity;
  const source: WorkoutIdentitySource = {
    externalId: existing.externalId,
    type: existing.type,
    startAt: existing.startAt,
    endAt: existing.endAt,
  };
  return workoutSourceIdentity(source);
}

/**
 * Plan in-place upsert reconciliation for one calendar day's workouts.
 * Preserves Workout.id for matching identities; never fuzzy-remaps FKs.
 */
export function planDayWorkoutReconciliation(
  existing: readonly ExistingDayWorkout[],
  incoming: readonly WorkoutInput[],
): WorkoutReconciliationPlan {
  const incomingFields = incoming.map(toWriteFields);
  const existingByIdentity = new Map<string, ExistingDayWorkout>();
  for (const row of existing) {
    existingByIdentity.set(legacyIdentity(row), row);
  }

  const matchedExistingIds = new Set<number>();
  const updates: WorkoutReconciliationPlan["updates"] = [];
  const creates: WorkoutWriteFields[] = [];

  for (const fields of incomingFields) {
    const prior = existingByIdentity.get(fields.sourceIdentity);
    if (prior && !matchedExistingIds.has(prior.id)) {
      matchedExistingIds.add(prior.id);
      updates.push({ id: prior.id, fields });
      continue;
    }
    creates.push(fields);
  }

  const deletes: number[] = [];
  const retainedLinkedMissingFromFeed: number[] = [];
  for (const row of existing) {
    if (matchedExistingIds.has(row.id)) continue;
    if (row.linkedToDiary) {
      retainedLinkedMissingFromFeed.push(row.id);
    } else {
      deletes.push(row.id);
    }
  }

  return { updates, creates, deletes, retainedLinkedMissingFromFeed };
}
