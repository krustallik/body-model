import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import {
  selectCanonicalBodyMassV1,
  selectStrengthEnergyV1,
  type SelectedEnergyV1,
} from "@/model/activity/canonical-activity-policy-v1";
import {
  estimateExperimentalStrengthActiveEnergyV1,
  EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
} from "./experimental-strength-active-energy-v1";
import {
  strengthEstimateFreshV1,
  strengthInputFingerprintV1,
  strengthSetFingerprintV1,
} from "./strength-publication-v1";
import type { StrengthSessionDto } from "./training.types";

export type HistoricalStrengthMassSource =
  | "same-day-observed"
  | "unified-start-of-day"
  | "unavailable";

export type HistoricalStrengthSetInput = {
  id?: number;
  sessionExerciseId?: number;
  completedAt?: string | null;
  reps: number;
  weightKg: number | null;
  bandNominalResistanceKg?: number | null;
  rir?: number | null;
};

/**
 * Canonical historical mass for a workout date: same-day observed, else
 * start-of-day / prior-day mass. Never substitutes a later day's mass.
 */
export function resolveHistoricalStrengthMassV1(input: {
  sameDayMassKg: number | null;
  startOfDayMassKg: number | null;
}): { massKg: number | null; source: HistoricalStrengthMassSource } {
  const selected = selectCanonicalBodyMassV1({
    sameDayObservedKg: input.sameDayMassKg,
    unifiedStartOfDayKg: input.startOfDayMassKg,
  });
  return { massKg: selected.massKg, source: selected.source };
}

export function historicalStrengthInputFingerprintV1(input: {
  sessionId: number;
  sessionRevision: number;
  sets: readonly HistoricalStrengthSetInput[];
  sameDayMassKg: number | null;
  startOfDayMassKg: number | null;
  stage02MassReference?: StrengthSessionDto["activeEnergyMassReference"];
  estimatorInputs?: unknown;
  estimatorVersion?: string | null;
}): string {
  const reference = input.stage02MassReference;
  const massKg = reference === undefined
    ? resolveHistoricalStrengthMassV1({
      sameDayMassKg: input.sameDayMassKg,
      startOfDayMassKg: input.startOfDayMassKg,
    }).massKg
    : reference !== null && reference.reference.status !== "unavailable"
      && Number.isFinite(reference.reference.valueKg) && reference.reference.valueKg > 0
      ? reference.reference.valueKg
      : null;
  return strengthInputFingerprintV1({
    sessionId: input.sessionId,
    sessionRevision: input.sessionRevision,
    massKg,
    sameDayMassKg: input.sameDayMassKg,
    startOfDayMassKg: input.startOfDayMassKg,
    estimatorInputs: input.estimatorInputs ?? (reference === undefined ? null : {
      stage02MassReference: reference?.reference ?? null,
      stage02SnapshotRevision: reference?.snapshotRevision ?? null,
      stage02InputFingerprint: reference?.inputFingerprint ?? null,
      stage02MassResolutionIdentity: reference?.massResolutionIdentity ?? null,
    }),
    setFingerprint: strengthSetFingerprintV1(input.sets),
    estimatorVersion: input.estimatorVersion ?? EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  });
}

function shadowEstimateKcal(result: unknown): number | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
  const resolution = (result as { activeEnergyResolution?: unknown; estimatedActiveKcal?: unknown }).activeEnergyResolution
    ?? result;
  if (typeof resolution !== "object" || resolution === null || Array.isArray(resolution)) {
    const direct = (result as { estimatedActiveKcal?: unknown }).estimatedActiveKcal;
    return typeof direct === "number" && Number.isFinite(direct) && direct >= 0 ? direct : null;
  }
  const kcal = (resolution as { estimatedActiveKcal?: unknown }).estimatedActiveKcal;
  return typeof kcal === "number" && Number.isFinite(kcal) && kcal >= 0 ? kcal : null;
}

function shadowSessionRevision(result: unknown): number | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
  const revision = (result as { sessionRevision?: unknown }).sessionRevision;
  return typeof revision === "number" && Number.isInteger(revision) ? revision : null;
}

function shadowInputFingerprint(result: unknown): string | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
  const fingerprint = (result as { inputFingerprint?: unknown }).inputFingerprint;
  return typeof fingerprint === "string" && fingerprint.length > 0 ? fingerprint : null;
}

export type HistoricalStrengthBodyCastOrigin =
  | "stored-shadow"
  | "on-demand-recompute"
  | "none";

/**
 * Resolve BodyCast kcal for a historical workout without writing.
 *
 * - Modern fingerprinted shadows that still match as-of-date inputs are used.
 * - Legacy unmarked shadows are never accepted as fresh; they are replaced by
 *   an on-demand recompute when historical inputs support it.
 * - Original shadow rows remain untouched (audit); callers must not persist.
 */
export function resolveHistoricalStrengthBodyCastV1(input: {
  sessionCompleted: boolean;
  sessionId: number;
  sessionRevision: number;
  energyShadow: unknown;
  sets: readonly HistoricalStrengthSetInput[];
  sameDayMassKg: number | null;
  startOfDayMassKg: number | null;
  stage02MassReference?: StrengthSessionDto["activeEnergyMassReference"];
  estimatorInputs?: unknown;
  estimatorVersion?: string | null;
  /** Read-only estimator output for as-of-date inputs; null when unavailable. */
  onDemandEstimateKcal: number | null;
}): {
  bodyCastKcal: number | null;
  bodyCastFresh: boolean;
  origin: HistoricalStrengthBodyCastOrigin;
  currentInputFingerprint: string;
} {
  const currentInputFingerprint = historicalStrengthInputFingerprintV1({
    sessionId: input.sessionId,
    sessionRevision: input.sessionRevision,
    sets: input.sets,
    sameDayMassKg: input.sameDayMassKg,
    startOfDayMassKg: input.startOfDayMassKg,
    stage02MassReference: input.stage02MassReference,
    estimatorInputs: input.estimatorInputs,
    estimatorVersion: input.estimatorVersion,
  });
  if (!input.sessionCompleted) {
    return {
      bodyCastKcal: null,
      bodyCastFresh: false,
      origin: "none",
      currentInputFingerprint,
    };
  }

  const storedKcal = shadowEstimateKcal(input.energyShadow);
  const storedFresh = strengthEstimateFreshV1({
    estimateKcal: storedKcal,
    sessionRevision: input.sessionRevision,
    shadowSessionRevision: shadowSessionRevision(input.energyShadow),
    storedInputFingerprint: shadowInputFingerprint(input.energyShadow),
    currentInputFingerprint,
  });
  if (storedFresh && storedKcal !== null) {
    return {
      bodyCastKcal: storedKcal,
      bodyCastFresh: true,
      origin: "stored-shadow",
      currentInputFingerprint,
    };
  }

  const recomputed = input.onDemandEstimateKcal;
  if (typeof recomputed === "number" && Number.isFinite(recomputed) && recomputed >= 0) {
    return {
      bodyCastKcal: recomputed,
      bodyCastFresh: true,
      origin: "on-demand-recompute",
      currentInputFingerprint,
    };
  }

  return {
    bodyCastKcal: null,
    bodyCastFresh: false,
    origin: "none",
    currentInputFingerprint,
  };
}

/** Canonical selected active energy for historical strength display surfaces. */
export function selectHistoricalStrengthEnergyV1(input: {
  sessionCompleted: boolean;
  sessionId: number;
  sessionRevision: number;
  energyShadow: unknown;
  sets: readonly HistoricalStrengthSetInput[];
  sameDayMassKg: number | null;
  startOfDayMassKg: number | null;
  stage02MassReference?: StrengthSessionDto["activeEnergyMassReference"];
  estimatorInputs?: unknown;
  estimatorVersion?: string | null;
  onDemandEstimateKcal: number | null;
  manualKcal?: number | null;
  garminKcal: number | null;
}): SelectedEnergyV1 & { bodyCastOrigin: HistoricalStrengthBodyCastOrigin } {
  const bodyCast = resolveHistoricalStrengthBodyCastV1(input);
  const selected = selectStrengthEnergyV1({
    bodyCastKcal: bodyCast.bodyCastKcal,
    bodyCastFresh: bodyCast.bodyCastFresh,
    sessionCompleted: input.sessionCompleted,
    manualKcal: input.manualKcal ?? null,
    manualKcalPresent: input.manualKcal !== undefined && input.manualKcal !== null,
    garminKcal: input.garminKcal,
  });
  return { ...selected, bodyCastOrigin: bodyCast.origin };
}

/**
 * Read-only as-of-date recompute. Does not write ExperimentalStrengthEnergyShadow.
 * Returns null when historical mass or other estimator evidence is insufficient.
 */
export function recomputeHistoricalStrengthEstimateKcalV1(input: {
  session: StrengthSessionDto;
  sameDayMassKg: number | null;
  startOfDayMassKg: number | null;
  stage02MassReference?: StrengthSessionDto["activeEnergyMassReference"];
  heartRateBpms?: readonly number[];
}): number | null {
  const reference = input.stage02MassReference;
  const massKg = reference === undefined
    ? resolveHistoricalStrengthMassV1({
      sameDayMassKg: input.sameDayMassKg,
      startOfDayMassKg: input.startOfDayMassKg,
    }).massKg
    : reference !== null && reference.reference.status !== "unavailable"
      && Number.isFinite(reference.reference.valueKg) && reference.reference.valueKg > 0
      ? reference.reference.valueKg
      : null;
  if (massKg === null) return null;
  const result = estimateExperimentalStrengthActiveEnergyV1({
    session: input.session,
    bodyMassKg: massKg,
    heartRateBpms: input.heartRateBpms,
  });
  if (result.availability !== "available") return null;
  const kcal = result.estimatedActiveKcal;
  return typeof kcal === "number" && Number.isFinite(kcal) && kcal >= 0 ? kcal : null;
}

/** Local calendar date used for historical mass lookup (Europe/Bratislava). */
export function strengthWorkoutAsOfDateV1(input: {
  matchedWorkoutStartAt: string | null;
  webStartedAt: string | null;
  createdAt: string;
  timeZone?: string;
}): string {
  const instantIso = input.matchedWorkoutStartAt ?? input.webStartedAt ?? input.createdAt;
  return instantToLocalDateTime(new Date(instantIso), input.timeZone ?? DEFAULT_TIME_ZONE).date;
}
