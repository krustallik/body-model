import { STAIR_CLIMBING_TYPE } from "@/modules/health/expand-training-workouts";
import type { WorkoutEnergyEvidenceV7 } from "./workout-energy-v7";

export type HealthSyncStepSnapshotV7 = {
  /** Durable HealthSyncSnapshot identity for deterministic reference fingerprints. */
  id: number;
  receivedAt: string;
  syncedAt: string | null;
  steps: number | null;
};

export type EffectiveHealthSyncStepSnapshotV7 = {
  snapshotId: number;
  timestamp: string;
  timestampBasis: "synced-at" | "received-at";
  stepCount: number | null;
};

export type BracketedStepperStepEvidenceV7 = {
  availability: "available";
  before: EffectiveHealthSyncStepSnapshotV7;
  after: EffectiveHealthSyncStepSnapshotV7;
  preGapSeconds: number;
  postGapSeconds: number;
  derivedStepDelta: {
    value: number;
    provenance: "bracketed-health-step-delta";
  };
  /** Derived interval rate, never a directly measured machine cadence. */
  derivedStepRatePerMinute: {
    value: number;
    provenance: "derived-from-bracketed-health-step-delta-and-workout-duration";
  } | null;
} | {
  availability: "unavailable";
  availabilityReason:
    | "not-stair-workout"
    | "no-before-snapshot"
    | "no-after-snapshot"
    | "missing-step-counter"
    | "counter-decrease";
  before: EffectiveHealthSyncStepSnapshotV7 | null;
  after: EffectiveHealthSyncStepSnapshotV7 | null;
  preGapSeconds: number | null;
  postGapSeconds: number | null;
  derivedStepDelta: null;
  derivedStepRatePerMinute: null;
};

/**
 * Generic stair/stepper observation evidence. `workoutEnergy` owns workout
 * identity, HR context, and device-active-energy semantics; no field here is
 * a mechanical-work or energy estimate.
 */
export type WorkoutStepperEvidenceV7 = {
  workoutEnergy: WorkoutEnergyEvidenceV7;
  bracketedSteps: BracketedStepperStepEvidenceV7;
};

/** Compact developer-facing source inspection; not a physiology or UI output. */
export type WorkoutStepperEvidenceDiagnosticV7 = {
  workout: Pick<WorkoutEnergyEvidenceV7,
    "workoutId" | "canonicalWorkoutType" | "startAt" | "endAt" | "durationMinutes">;
  bracketedSteps: BracketedStepperStepEvidenceV7;
  deviceEnergy: WorkoutEnergyEvidenceV7["deviceEnergy"];
  heartRate: {
    availability: WorkoutEnergyEvidenceV7["heartRate"]["availability"];
    summary: WorkoutEnergyEvidenceV7["heartRate"]["summary"];
    samplingTopology: WorkoutEnergyEvidenceV7["heartRate"]["samplingTopology"];
  };
};

function timestampMs(timestamp: string): number {
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) throw new Error(`Invalid health snapshot timestamp: ${timestamp}`);
  return value;
}

function effectiveSnapshot(snapshot: HealthSyncStepSnapshotV7): EffectiveHealthSyncStepSnapshotV7 {
  return snapshot.syncedAt === null
    ? { snapshotId: snapshot.id, timestamp: snapshot.receivedAt, timestampBasis: "received-at", stepCount: snapshot.steps }
    : { snapshotId: snapshot.id, timestamp: snapshot.syncedAt, timestampBasis: "synced-at", stepCount: snapshot.steps };
}

/**
 * Attributes only the counter change bracketed by workout boundaries. It keeps
 * edge gaps explicit because the delta may include non-stepper walking there.
 */
export function canonicalizeWorkoutStepperEvidenceV7(input: {
  workoutEnergy: WorkoutEnergyEvidenceV7;
  snapshots: readonly HealthSyncStepSnapshotV7[];
}): WorkoutStepperEvidenceV7 {
  const { workoutEnergy } = input;
  if (workoutEnergy.canonicalWorkoutType !== STAIR_CLIMBING_TYPE) {
    return {
      workoutEnergy,
      bracketedSteps: {
        availability: "unavailable",
        availabilityReason: "not-stair-workout",
        before: null,
        after: null,
        preGapSeconds: null,
        postGapSeconds: null,
        derivedStepDelta: null,
        derivedStepRatePerMinute: null,
      },
    };
  }

  const startMs = timestampMs(workoutEnergy.startAt);
  const endMs = timestampMs(workoutEnergy.endAt);
  if (endMs < startMs) throw new Error("Stepper workout end must not precede start");

  const snapshots = input.snapshots
    .map((snapshot, sourceIndex) => ({ snapshot: effectiveSnapshot(snapshot), sourceIndex }))
    .map(({ snapshot, sourceIndex }) => ({ ...snapshot, sourceIndex, timeMs: timestampMs(snapshot.timestamp) }));
  const before = snapshots
    .filter((snapshot) => snapshot.timeMs <= startMs)
    .sort((left, right) => right.timeMs - left.timeMs || right.sourceIndex - left.sourceIndex)[0] ?? null;
  const after = snapshots
    .filter((snapshot) => snapshot.timeMs >= endMs)
    .sort((left, right) => left.timeMs - right.timeMs || left.sourceIndex - right.sourceIndex)[0] ?? null;
  const beforeEvidence = before === null ? null : {
    snapshotId: before.snapshotId,
    timestamp: before.timestamp,
    timestampBasis: before.timestampBasis,
    stepCount: before.stepCount,
  };
  const afterEvidence = after === null ? null : {
    snapshotId: after.snapshotId,
    timestamp: after.timestamp,
    timestampBasis: after.timestampBasis,
    stepCount: after.stepCount,
  };
  const preGapSeconds = before === null ? null : (startMs - before.timeMs) / 1_000;
  const postGapSeconds = after === null ? null : (after.timeMs - endMs) / 1_000;

  const unavailable = (availabilityReason: Extract<BracketedStepperStepEvidenceV7, { availability: "unavailable" }>["availabilityReason"]): WorkoutStepperEvidenceV7 => ({
    workoutEnergy,
    bracketedSteps: {
      availability: "unavailable",
      availabilityReason,
      before: beforeEvidence,
      after: afterEvidence,
      preGapSeconds,
      postGapSeconds,
      derivedStepDelta: null,
      derivedStepRatePerMinute: null,
    },
  });

  if (before === null) return unavailable("no-before-snapshot");
  if (after === null) return unavailable("no-after-snapshot");
  if (before.stepCount === null || after.stepCount === null) return unavailable("missing-step-counter");
  if (after.stepCount < before.stepCount) return unavailable("counter-decrease");

  const derivedStepDelta = after.stepCount - before.stepCount;
  const durationMinutes = workoutEnergy.durationMinutes;
  return {
    workoutEnergy,
    bracketedSteps: {
      availability: "available",
      before: beforeEvidence!,
      after: afterEvidence!,
      preGapSeconds: preGapSeconds!,
      postGapSeconds: postGapSeconds!,
      derivedStepDelta: { value: derivedStepDelta, provenance: "bracketed-health-step-delta" },
      derivedStepRatePerMinute: durationMinutes !== null && durationMinutes > 0
        ? {
          value: derivedStepDelta / durationMinutes,
          provenance: "derived-from-bracketed-health-step-delta-and-workout-duration",
        }
        : null,
    },
  };
}

export function workoutStepperEvidenceDiagnosticV7(
  evidence: WorkoutStepperEvidenceV7,
): WorkoutStepperEvidenceDiagnosticV7 {
  const { workoutEnergy } = evidence;
  return {
    workout: {
      workoutId: workoutEnergy.workoutId,
      canonicalWorkoutType: workoutEnergy.canonicalWorkoutType,
      startAt: workoutEnergy.startAt,
      endAt: workoutEnergy.endAt,
      durationMinutes: workoutEnergy.durationMinutes,
    },
    bracketedSteps: evidence.bracketedSteps,
    deviceEnergy: workoutEnergy.deviceEnergy,
    heartRate: {
      availability: workoutEnergy.heartRate.availability,
      summary: workoutEnergy.heartRate.summary,
      samplingTopology: workoutEnergy.heartRate.samplingTopology,
    },
  };
}
