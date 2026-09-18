import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type { StrengthSessionDto } from "./training.types";

export const EXPERIMENTAL_STRENGTH_ENERGY_MODEL_REVISION = "experimental-personal-strength-energy-shadow-1" as const;

export type ExperimentalStrengthEnergyResult = {
  estimatedActiveKcal: number | null;
  lowerBoundKcal: number | null;
  upperBoundKcal: number | null;
  provenance: "experimental-personal-strength-energy";
  modelRevision: typeof EXPERIMENTAL_STRENGTH_ENERGY_MODEL_REVISION;
  supportedDomain: "shadow-only-insufficient-personal-history";
  timingQuality: "unavailable" | "partial" | "completion-times-complete";
  hrCoverage: "unavailable" | "sparse" | "contextual";
  garminReferenceKcal?: number;
};

export type ExperimentalStrengthEnergyFeatures = {
  sessionId: number;
  entryMode: "LIVE" | "RETROSPECTIVE";
  bodyMassKg: number | null;
  elapsedMinutes: number | null;
  completedSetCount: number;
  totalReps: number;
  loadedSetCount: number;
  bodyweightSetCount: number;
  bandSetCount: number;
  exerciseCount: number;
  stableKeyCoverage: "complete" | "partial" | "unavailable";
  rirReportedSetCount: number;
  timingQuality: ExperimentalStrengthEnergyResult["timingQuality"];
  interCompletionMedianSeconds: number | null;
  hrSampleCount: number;
  averageHrBpm: number | null;
  hrCoverage: ExperimentalStrengthEnergyResult["hrCoverage"];
  garminReferenceKcal: number | null;
};

function minutesBetween(start: string | null, end: string | null): number | null {
  if (start === null || end === null) return null;
  const value = (Date.parse(end) - Date.parse(start)) / 60_000;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function extractExperimentalStrengthEnergyFeatures(input: {
  session: StrengthSessionDto;
  bodyMassKg: number | null;
  heartRateBpms?: readonly number[];
}): ExperimentalStrengthEnergyFeatures {
  const { session } = input;
  const sets = session.exercises.flatMap((exercise) => exercise.sets.map((set) => ({ set, exercise })));
  const completionTimes = sets.map(({ set }) => set.completedAt).filter((value): value is string => value !== null)
    .map(Date.parse).filter(Number.isFinite).sort((a, b) => a - b);
  const allTimed = sets.length > 0 && completionTimes.length === sets.length;
  const timingQuality = session.entryMode === "LIVE" && allTimed && minutesBetween(session.webStartedAt, session.webEndedAt) !== null
    ? "completion-times-complete" as const
    : completionTimes.length > 0 ? "partial" as const : "unavailable" as const;
  const gaps = completionTimes.slice(1).map((value, index) => (value - completionTimes[index]) / 1_000)
    .filter((value) => value > 0 && Number.isFinite(value)).sort((a, b) => a - b);
  const hr = input.heartRateBpms ?? [];
  const elapsedMinutes = minutesBetween(session.webStartedAt, session.webEndedAt)
    ?? session.matchedWorkout?.durationMinutes
    ?? minutesBetween(session.matchedWorkout?.startAt ?? null, session.matchedWorkout?.endAt ?? null);
  const stable = session.exercises.filter((exercise) => exercise.stableKey !== null).length;
  const garminReferenceKcal = session.matchedWorkout?.activeEnergyKcal ?? null;
  return {
    sessionId: session.id,
    entryMode: session.entryMode,
    bodyMassKg: input.bodyMassKg,
    elapsedMinutes,
    completedSetCount: sets.length,
    totalReps: sets.reduce((sum, { set }) => sum + set.reps, 0),
    loadedSetCount: sets.filter(({ exercise, set }) => exercise.resistanceType === "EXTERNAL_WEIGHT" && set.weightKg !== null).length,
    bodyweightSetCount: sets.filter(({ exercise }) => exercise.resistanceType === "BODYWEIGHT").length,
    bandSetCount: sets.filter(({ exercise }) => exercise.resistanceType === "RESISTANCE_BAND").length,
    exerciseCount: session.exercises.length,
    stableKeyCoverage: stable === 0 ? "unavailable" : stable === session.exercises.length ? "complete" : "partial",
    rirReportedSetCount: sets.filter(({ set }) => set.rir !== null).length,
    timingQuality,
    interCompletionMedianSeconds: gaps.length === 0 ? null : gaps[Math.floor(gaps.length / 2)],
    hrSampleCount: hr.length,
    averageHrBpm: hr.length === 0 ? null : hr.reduce((sum, value) => sum + value, 0) / hr.length,
    hrCoverage: hr.length === 0 ? "unavailable" : hr.length < 3 ? "sparse" : "contextual",
    garminReferenceKcal,
  };
}

/** No numeric fallback: without a chronologically validated personal model, missing is not zero. */
export function buildExperimentalStrengthEnergyShadow(features: ExperimentalStrengthEnergyFeatures): {
  sourceFingerprint: string;
  result: ExperimentalStrengthEnergyResult;
} {
  const result: ExperimentalStrengthEnergyResult = {
    estimatedActiveKcal: null,
    lowerBoundKcal: null,
    upperBoundKcal: null,
    provenance: "experimental-personal-strength-energy",
    modelRevision: EXPERIMENTAL_STRENGTH_ENERGY_MODEL_REVISION,
    supportedDomain: "shadow-only-insufficient-personal-history",
    timingQuality: features.timingQuality,
    hrCoverage: features.hrCoverage,
    ...(features.garminReferenceKcal === null ? {} : { garminReferenceKcal: features.garminReferenceKcal }),
  };
  return { sourceFingerprint: stableSha256(features), result };
}
