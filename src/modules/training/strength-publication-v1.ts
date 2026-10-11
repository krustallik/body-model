import { createHash } from "node:crypto";
import { finiteNonNegative } from "@/model/activity/canonical-activity-policy-v1";
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION } from "./experimental-strength-active-energy-v1";
import type { StrengthSessionDto } from "./training.types";

export type StrengthPublicationDecisionV1 = {
  publish: boolean;
  reason: "published" | "session-not-completed" | "stale-inputs" | "missing-mass" | "unavailable";
  kcal: number | null;
};

export function strengthSetFingerprintV1(
  sets: readonly { id?: number; sessionExerciseId?: number; resistanceType?: string; reps: number; weightKg: number | null; bandNominalResistanceKg?: number | null; completedAt?: string | null }[],
): string {
  const ordered = [...sets].sort((left, right) => (left.sessionExerciseId ?? 0) - (right.sessionExerciseId ?? 0)
    || (left.id ?? 0) - (right.id ?? 0));
  return createHash("sha256").update(JSON.stringify(ordered.map((set) => ({
    id: set.id ?? null,
    sessionExerciseId: set.sessionExerciseId ?? null,
    resistanceType: set.resistanceType ?? null,
    reps: set.reps,
    weightKg: set.weightKg,
    bandNominalResistanceKg: set.bandNominalResistanceKg ?? null,
    completedAt: set.completedAt ?? null,
  })))).digest("hex").slice(0, 32);
}

/** Stable fingerprint of the ordered HR observations consumed by the estimator. */
export function strengthHeartRateSourceFingerprintV1(
  samples: readonly { id: number; timestamp: Date | string; bpm: number; source: string }[],
): string {
  const ordered = [...samples].sort((left, right) => {
    const timeOrder = new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
    return timeOrder || left.id - right.id;
  });
  return createHash("sha256").update(stableJson(ordered.map((sample) => ({
    id: sample.id,
    timestamp: new Date(sample.timestamp).toISOString(),
    bpm: sample.bpm,
    source: sample.source,
  })))).digest("hex");
}

/** Stable digest of the raw session inputs consumed by strength publication. */
export function strengthSessionSourceFingerprintV1(session: StrengthSessionDto): string {
  const value = {
    id: session.id,
    status: session.status,
    entryMode: session.entryMode,
    revision: session.revision,
    programId: session.programId,
    programVersionId: session.programVersionId,
    webStartedAt: session.webStartedAt,
    webEndedAt: session.webEndedAt,
    effectiveAccountingAt: session.effectiveAccountingAt ?? null,
    accountingTimeZone: session.accountingTimeZone ?? null,
    accountingTimeZoneProvenance: session.accountingTimeZoneProvenance ?? null,
    matchStatus: session.matchStatus,
    matchMethod: session.matchMethod,
    matchedAt: session.matchedAt,
    matchedWorkoutId: session.matchedWorkoutId,
    matchedWorkout: session.matchedWorkout === null ? null : {
      id: session.matchedWorkout.id,
      type: session.matchedWorkout.type,
      startAt: session.matchedWorkout.startAt,
      endAt: session.matchedWorkout.endAt,
      durationMinutes: session.matchedWorkout.durationMinutes,
      activeEnergyKcal: session.matchedWorkout.activeEnergyKcal,
      manualActiveEnergyKcal: session.matchedWorkout.manualActiveEnergyKcal ?? null,
      externalId: session.matchedWorkout.externalId,
    },
    exercises: [...session.exercises]
      .sort((left, right) => left.order - right.order || left.id - right.id)
      .map((exercise) => ({
        id: exercise.id,
        sourceExerciseCatalogId: exercise.sourceExerciseCatalogId,
        stableKey: exercise.stableKey,
        snapshotExerciseName: exercise.snapshotExerciseName,
        order: exercise.order,
        plannedSets: exercise.plannedSets,
        resistanceType: exercise.resistanceType,
        origin: exercise.origin,
        muscleMappingSnapshot: exercise.muscleMappingSnapshot ?? null,
        loadAccountingConfigSnapshot: exercise.loadAccountingConfigSnapshot ?? null,
        sets: [...exercise.sets]
          .sort((left, right) => left.setNumber - right.setNumber || left.id - right.id)
          .map((set) => ({
            id: set.id,
            setNumber: set.setNumber,
            reps: set.reps,
            weightKg: set.weightKg,
            bandNominalResistanceKg: set.bandNominalResistanceKg,
            rir: set.rir,
            comment: set.comment,
            completedAt: set.completedAt,
            loadAccountingOverride: set.loadAccountingOverride ?? null,
          })),
      })),
  };
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Semantic model-day inputs shared by the Strength candidate writer and its
 * production freshness reader. Timestamps are excluded because a replay may
 * rewrite an equivalent derived row; the writer separately checks timestamps
 * as a transaction-time CAS before persisting the candidate.
 */
export function strengthModelDayFingerprintInputsV1(modelDay: {
  status: string;
  dynamicRmrKcalPerDay: number | null;
  modelVersion: string;
} | null): {
  modelDayRmrKcalPerDay: number | null;
  modelDayVersion: string | null;
} {
  if (!modelDay || modelDay.status !== "complete") {
    return { modelDayRmrKcalPerDay: null, modelDayVersion: null };
  }
  return {
    modelDayRmrKcalPerDay: modelDay.dynamicRmrKcalPerDay,
    modelDayVersion: modelDay.modelVersion,
  };
}

export function strengthInputFingerprintV1(input: {
  sessionId: number;
  sessionRevision: number;
  massKg: number | null;
  setFingerprint: string;
  /** Same-day observed scale mass when present; distinct from as-of fallback mass. */
  sameDayMassKg?: number | null;
  /** Unified / calculated start-of-day mass used when same-day mass is absent. */
  startOfDayMassKg?: number | null;
  /** Exact persisted Stage 02 source identity and estimator timing/class inputs. */
  estimatorInputs?: unknown;
  estimatorVersion?: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    sessionId: input.sessionId,
    sessionRevision: input.sessionRevision,
    massKg: input.massKg,
    sameDayMassKg: input.sameDayMassKg ?? null,
    startOfDayMassKg: input.startOfDayMassKg ?? null,
    setFingerprint: input.setFingerprint,
    estimatorInputs: input.estimatorInputs ?? null,
    estimatorVersion: input.estimatorVersion ?? EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  })).digest("hex");
}

/**
 * A published shadow is fresh only when every estimator input still matches
 * the historical as-of-date fingerprint (mass, sets, revision, estimator).
 * Legacy unmarked shadows are never treated as fresh — callers must recompute
 * on demand from historical inputs or fall back to Garmin.
 */
export function strengthEstimateFreshV1(input: {
  estimateKcal: number | null;
  sessionRevision: number;
  shadowSessionRevision: number | null;
  storedInputFingerprint: string | null;
  currentInputFingerprint: string;
}): boolean {
  if (input.estimateKcal === null) return false;
  if (input.shadowSessionRevision === null || input.shadowSessionRevision !== input.sessionRevision) {
    return false;
  }
  if (input.storedInputFingerprint === null) return false;
  return input.storedInputFingerprint === input.currentInputFingerprint;
}

/**
 * Publishes a fresh completed BodyCast estimate into the staged shadow only.
 * A write from an older session revision cannot replace a newer fingerprint.
 * Legacy Garmin activeEnergyKcal is not a write target.
 */
export function strengthPublicationDecisionV1(input: {
  sessionStatus: string;
  estimateKcal: number | null;
  estimateFresh: boolean;
  massKg: number | null;
  inputFingerprint: string;
  previousFingerprint: string | null;
  previousSessionRevision: number | null;
  sessionRevision: number;
}): StrengthPublicationDecisionV1 {
  if (input.sessionStatus !== "COMPLETED") {
    return { publish: false, reason: "session-not-completed", kcal: null };
  }
  if (input.previousFingerprint !== null
    && input.previousSessionRevision !== null
    && input.previousSessionRevision > input.sessionRevision
    && input.previousFingerprint !== input.inputFingerprint) {
    return { publish: false, reason: "stale-inputs", kcal: null };
  }
  if (!input.estimateFresh) {
    return { publish: false, reason: "unavailable", kcal: null };
  }
  const mass = finiteNonNegative(input.massKg);
  if (mass === null || mass <= 0) {
    return { publish: false, reason: "missing-mass", kcal: null };
  }
  const kcal = finiteNonNegative(input.estimateKcal);
  if (kcal === null) return { publish: false, reason: "unavailable", kcal: null };
  return { publish: true, reason: "published", kcal };
}
