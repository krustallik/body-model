import {
  isLegacySyntheticWorkoutId,
  workoutFingerprint,
  workoutSourceIdentity,
  type WorkoutIdentitySource,
} from "./workout-source-identity";
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
  /** User edits and deletion tombstones win over subsequent feed copies. */
  syncProtected?: boolean;
  hiddenFromHistory?: boolean;
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
  /** Exact type/start/end identity used only for legacy synthetic fallback. */
  fingerprint: string;
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
  retainedSyncProtected: number[];
};

function toWriteFields(workout: WorkoutInput): WorkoutWriteFields {
  const sourceIdentity = workoutSourceIdentity(workout);
  const fingerprint = workoutFingerprint(workout);
  return {
    externalId: workout.externalId ?? null,
    sourceIdentity,
    type: workout.type,
    startAt: new Date(workout.startAt),
    endAt: new Date(workout.endAt),
    durationMinutes: workout.durationMinutes ?? null,
    energyKcal: workout.energyKcal ?? null,
    activeEnergyKcal: workout.activeEnergyKcal ?? null,
    fingerprint,
  };
}

function legacyIdentity(existing: ExistingDayWorkout): string {
  const sourceIdentity = existing.sourceIdentity?.trim() ?? "";
  const legacyExternalId = isLegacySyntheticWorkoutId(existing.externalId)
    || sourceIdentity.startsWith("ext:training-");
  if (sourceIdentity && !legacyExternalId) return sourceIdentity;
  const source: WorkoutIdentitySource = {
    externalId: legacyExternalId ? null : existing.externalId,
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
  // A retry or copied range feed can contain the same workout more than once.
  // Last occurrence wins its mutable values, while the identity remains stable.
  const incomingFields = [...new Map(incoming.map((workout) => {
    const fields = toWriteFields(workout);
    return [fields.sourceIdentity, fields] as const;
  })).values()];
  const existingByIdentity = new Map<string, ExistingDayWorkout[]>();
  const existingByFingerprint = new Map<string, ExistingDayWorkout[]>();
  for (const row of existing) {
    const identity = legacyIdentity(row);
    const identityRows = existingByIdentity.get(identity) ?? [];
    identityRows.push(row);
    existingByIdentity.set(identity, identityRows);
    const legacy = identity.startsWith("fp:");
    if (legacy) {
      const fingerprintRows = existingByFingerprint.get(identity) ?? [];
      fingerprintRows.push(row);
      existingByFingerprint.set(identity, fingerprintRows);
    }
  }

  const chooseCanonical = (rows: readonly ExistingDayWorkout[]): ExistingDayWorkout | undefined => (
    [...rows].sort((left, right) => Number(Boolean(right.syncProtected || right.hiddenFromHistory)) - Number(Boolean(left.syncProtected || left.hiddenFromHistory))
      || Number(right.linkedToDiary) - Number(left.linkedToDiary)
      || left.id - right.id)[0]
  );

  const matchedExistingIds = new Set<number>();
  const retainedSyncProtected: number[] = [];
  const updates: WorkoutReconciliationPlan["updates"] = [];
  const creates: WorkoutWriteFields[] = [];

  for (const fields of incomingFields) {
    const exact = chooseCanonical(existingByIdentity.get(fields.sourceIdentity) ?? []);
    const legacy = fields.sourceIdentity.startsWith("ext:")
      ? chooseCanonical(existingByFingerprint.get(fields.fingerprint) ?? [])
      : undefined;
    const prior = exact ?? legacy;
    if (prior && !matchedExistingIds.has(prior.id)) {
      matchedExistingIds.add(prior.id);
      if (prior.syncProtected || prior.hiddenFromHistory) {
        retainedSyncProtected.push(prior.id);
        continue;
      }
      updates.push({ id: prior.id, fields });
      continue;
    }
    creates.push(fields);
  }

  const deletes: number[] = [];
  const retainedLinkedMissingFromFeed: number[] = [];
  for (const row of existing) {
    if (matchedExistingIds.has(row.id)) continue;
    if (row.syncProtected || row.hiddenFromHistory) {
      retainedSyncProtected.push(row.id);
    } else if (row.linkedToDiary) {
      retainedLinkedMissingFromFeed.push(row.id);
    } else {
      deletes.push(row.id);
    }
  }

  return { updates, creates, deletes, retainedLinkedMissingFromFeed, retainedSyncProtected };
}
