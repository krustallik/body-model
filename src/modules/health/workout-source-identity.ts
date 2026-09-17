/**
 * Deterministic Workout source-identity for health-sync reconciliation.
 *
 * ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER:
 * Identity uses exact source fields only (externalId, or type+startAt+endAt).
 * It must never use fuzzy time windows or calorie similarity.
 */

export type WorkoutIdentitySource = {
  externalId?: string | null;
  type: string;
  startAt: string | Date;
  endAt: string | Date;
};

function toIsoInstant(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`invalid workout instant for source identity: ${value}`);
  }
  return parsed.toISOString();
}

/**
 * Stable identity key scoped per daily health row.
 * Prefer explicit externalId; otherwise fingerprint exact type + interval endpoints.
 */
export function workoutSourceIdentity(workout: WorkoutIdentitySource): string {
  const externalId = typeof workout.externalId === "string" ? workout.externalId.trim() : "";
  if (externalId.length > 0) {
    return `ext:${externalId}`;
  }
  return `fp:${workout.type}|${toIsoInstant(workout.startAt)}|${toIsoInstant(workout.endAt)}`;
}
