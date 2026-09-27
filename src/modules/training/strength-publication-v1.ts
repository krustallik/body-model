import { createHash } from "node:crypto";
import { finiteNonNegative } from "@/model/activity/canonical-activity-policy-v1";
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION } from "./experimental-strength-active-energy-v1";

export type StrengthPublicationDecisionV1 = {
  publish: boolean;
  reason: "published" | "session-not-completed" | "stale-inputs" | "missing-mass" | "unavailable";
  kcal: number | null;
};

export function strengthSetFingerprintV1(
  sets: readonly { id?: number; reps: number; weightKg: number | null; bandNominalResistanceKg?: number | null; rir?: number | null }[],
): string {
  return createHash("sha256").update(JSON.stringify(sets.map((set) => ({
    id: set.id ?? null,
    reps: set.reps,
    weightKg: set.weightKg,
    bandNominalResistanceKg: set.bandNominalResistanceKg ?? null,
    rir: set.rir ?? null,
  })))).digest("hex").slice(0, 32);
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
  estimatorVersion?: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    sessionId: input.sessionId,
    sessionRevision: input.sessionRevision,
    massKg: input.massKg,
    sameDayMassKg: input.sameDayMassKg ?? null,
    startOfDayMassKg: input.startOfDayMassKg ?? null,
    setFingerprint: input.setFingerprint,
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
