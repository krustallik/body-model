import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { ACTIVE_ENERGY_SELECTION_POLICY_V1 } from "@/model/activity/canonical-activity-policy-v1";
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION } from "@/modules/training/experimental-strength-active-energy-v1";
import { STRENGTH_ENERGY_MASS_RESOLUTION_V1 } from "@/modules/training/session-mass-reference";

type JsonObject = Record<string, unknown>;

export type MigrationFreeEnergyCandidateV1 = {
  source: string;
  sourceIdentity: string;
  sourceFingerprint: string;
  availability: string;
  valueKcal: number | null;
  provenance: unknown;
};

export type MigrationFreeEnergyEventV1 = {
  id: number;
  logicalEventKey: string;
  eventKind: string;
  isStale: boolean;
  supersededByEventId: number | null;
  currentResolutionFingerprint: string | null;
  currentSource: string | null;
  currentKcal: number | null;
  currentProvenance: unknown;
  candidates: MigrationFreeEnergyCandidateV1[];
};

export type MigrationFreeWorkoutAliasV1 = {
  sourceType: string;
  sourceId: string;
  workoutId: number | null;
  workout: { type: string; hiddenFromHistory: boolean } | null;
  event: MigrationFreeEnergyEventV1;
};

export type MigrationFreeStrengthSessionV1 = {
  id: number;
  status: string;
  entryMode: string;
  matchStatus: string;
  matchedWorkoutId: number | null;
  effectiveAccountingAt: Date | null;
  webStartedAt: Date | null;
  webEndedAt: Date | null;
  accountingTimeZone: string | null;
  accountingInputRevision: number;
  currentSnapshotRevision: number | null;
  exercises: Array<{ sets: Array<{ completedAt: Date | null }> }>;
};

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function isAvailableCurrentEvent(event: MigrationFreeEnergyEventV1): boolean {
  return !event.isStale && event.supersededByEventId === null
    && event.currentSource !== null && event.currentSource !== "unavailable"
    && event.currentKcal !== null && Number.isFinite(event.currentKcal) && event.currentKcal >= 0
    && typeof event.currentResolutionFingerprint === "string"
    && /^[a-f0-9]{64}$/.test(event.currentResolutionFingerprint);
}

function localMinute(date: Date, timeZone: string): string | null {
  if (!Number.isFinite(date.getTime()) || !timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  } catch {
    return null;
  }
}

function selectedStrengthCandidateIsCurrent(
  event: MigrationFreeEnergyEventV1,
  sessionId: number,
  currentSnapshotRevision: number,
): boolean {
  const selected = event.currentProvenance;
  if (!isRecord(selected) || selected.policyVersion !== ACTIVE_ENERGY_SELECTION_POLICY_V1
    || selected.source !== "bodycast-strength-estimate"
    || typeof selected.sourceIdentity !== "string" || typeof selected.sourceFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(selected.sourceFingerprint)
    || !isRecord(selected.evidence)) return false;

  const candidate = event.candidates.find((row) => row.source === "bodycast-strength-estimate"
    && row.sourceIdentity === `strength-session:${sessionId}`
    && row.sourceIdentity === selected.sourceIdentity
    && row.sourceFingerprint === selected.sourceFingerprint
    && row.availability === "available"
    && row.valueKcal !== null && Number.isFinite(row.valueKcal) && row.valueKcal >= 0);
  if (!candidate || event.currentSource !== candidate.source || event.currentKcal !== candidate.valueKcal
    || !isRecord(candidate.provenance)
    || stableJson(selected.evidence) !== stableJson(candidate.provenance)) return false;

  const provenance = candidate.provenance;
  const reference = provenance.energyMassReference;
  if (provenance.estimator !== EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION
    || provenance.stage02SnapshotRevision !== currentSnapshotRevision
    || (provenance.energyMassResolutionMethodVersion !== null
      && provenance.energyMassResolutionMethodVersion !== STRENGTH_ENERGY_MASS_RESOLUTION_V1)
    || typeof provenance.energyMassResolutionIdentity !== "string"
    || provenance.energyMassResolutionIdentity.length === 0
    || !isRecord(reference)
    || !["observed", "nearest-observed"].includes(String(reference.status))
    || reference.source !== "apple-health-shortcut"
    || typeof reference.sourceId !== "string" || reference.sourceId.length === 0
    || typeof reference.valueKg !== "number" || !Number.isFinite(reference.valueKg) || reference.valueKg <= 0) return false;

  return true;
}

export function evaluateMigrationFreeEnergyAcceptanceV1(input: {
  workoutAliases: readonly MigrationFreeWorkoutAliasV1[];
  strengthSessions: readonly MigrationFreeStrengthSessionV1[];
}): { currentWorkoutResolutions: number; currentStepperResolutions: number; strengthSessionCurrent: true; diagnosticWorkoutId: number } {
  const currentWorkoutEvents = new Map<number, MigrationFreeEnergyEventV1>();
  const currentStepperByWorkoutId = new Map<number, MigrationFreeEnergyEventV1>();
  const stepperWorkoutIds = new Set<number>();

  for (const alias of input.workoutAliases) {
    if (alias.workoutId === null || alias.workout === null || alias.workout.hiddenFromHistory
      || alias.event.supersededByEventId !== null) continue;
    if (!currentWorkoutEvents.has(alias.event.id) && isAvailableCurrentEvent(alias.event)) {
      currentWorkoutEvents.set(alias.event.id, alias.event);
    }
    if (canonicalizeWorkoutType(alias.workout.type).classification === "stair-climbing") {
      stepperWorkoutIds.add(alias.workoutId);
      if (alias.event.eventKind === "stepper" && isAvailableCurrentEvent(alias.event)) {
        currentStepperByWorkoutId.set(alias.workoutId, alias.event);
      }
    }
  }

  if (stepperWorkoutIds.size !== 12 || currentStepperByWorkoutId.size !== 12) {
    throw new Error(`Migration-free serving is blocked: ${currentStepperByWorkoutId.size}/12 historical Stepper resolutions are current and available.`);
  }

  const targetSessions = input.strengthSessions.filter((session) => {
    return session.webStartedAt !== null && session.accountingTimeZone !== null
      && localMinute(session.webStartedAt, session.accountingTimeZone) === "2026-10-22T14:40";
  });
  if (targetSessions.length !== 1) {
    throw new Error(`Migration-free serving is blocked: expected one LIVE Strength session started at local 2026-10-22 14:40, found ${targetSessions.length}.`);
  }

  const targetSession = targetSessions[0]!;
  const intervalStart = targetSession.webStartedAt ?? targetSession.effectiveAccountingAt;
  const completedSetCount = targetSession.exercises.flatMap((exercise) => exercise.sets)
    .filter((set) => set.completedAt !== null).length;
  const isUnmatched = targetSession.matchStatus === "UNMATCHED" && targetSession.matchedWorkoutId === null;
  const isMatched = targetSession.matchStatus === "MATCHED" && targetSession.matchedWorkoutId !== null;
  if (targetSession.status !== "COMPLETED" || targetSession.entryMode !== "LIVE"
    || (!isUnmatched && !isMatched)
    || !targetSession.accountingTimeZone || targetSession.accountingInputRevision < 1
    || targetSession.currentSnapshotRevision === null || targetSession.currentSnapshotRevision < 1
    || !intervalStart || !targetSession.webEndedAt || targetSession.webEndedAt <= intervalStart
    || completedSetCount < 1) {
    throw new Error("Migration-free serving is blocked: the specified Strength session lacks its expected LIVE accounting snapshot, interval, or completed sets.");
  }

  const strengthAliases = input.workoutAliases.filter((alias) => alias.sourceType === "strength-session"
    && alias.sourceId === String(targetSession.id));
  const strengthAlias = strengthAliases.length === 1 ? strengthAliases[0] : undefined;
  const strengthEvent = strengthAlias?.event;
  const currentSnapshotRevision = targetSession.currentSnapshotRevision;
  const matchedWorkoutAliases = isMatched
    ? input.workoutAliases.filter((alias) => alias.sourceType === "workout"
      && alias.sourceId === String(targetSession.matchedWorkoutId)
      && alias.workoutId === targetSession.matchedWorkoutId)
    : [];
  const matchedWorkoutAlias = matchedWorkoutAliases.length === 1 ? matchedWorkoutAliases[0] : undefined;
  const expectedLogicalEventKey = isMatched
    ? `workout:${targetSession.matchedWorkoutId}`
    : `strength-session:${targetSession.id}`;
  if (!strengthEvent || strengthEvent.logicalEventKey !== expectedLogicalEventKey
    || strengthEvent.eventKind !== "strength" || !isAvailableCurrentEvent(strengthEvent)
    || (strengthAlias?.workoutId !== null)
    || (isMatched && (strengthAlias?.workout !== null
      || matchedWorkoutAlias?.workout === null || matchedWorkoutAlias?.workout?.hiddenFromHistory
      || (matchedWorkoutAlias?.workout !== null && matchedWorkoutAlias?.workout !== undefined
        && canonicalizeWorkoutType(matchedWorkoutAlias.workout.type).classification !== "traditional-strength-training")
      || matchedWorkoutAlias?.event.id !== strengthEvent.id))
    || currentSnapshotRevision === null
    || !selectedStrengthCandidateIsCurrent(strengthEvent, targetSession.id, currentSnapshotRevision)) {
    throw new Error("Migration-free serving is blocked: the specified Strength session lacks the current BodyCast candidate and verified Health mass provenance.");
  }

  // A matched Strength session and its Workout are two aliases for one canonical
  // event. Keep that event out of the historical Workout total, which is
  // accepted separately from the target Strength resolution.
  const targetStrengthWorkoutEventId = isMatched ? strengthEvent.id : null;
  const historicalWorkoutResolutions = currentWorkoutEvents.size
    - (targetStrengthWorkoutEventId !== null && currentWorkoutEvents.has(targetStrengthWorkoutEventId) ? 1 : 0);
  if (historicalWorkoutResolutions !== 33) {
    throw new Error(`Migration-free serving is blocked: ${historicalWorkoutResolutions}/33 historical Workout energy resolutions are current and available.`);
  }

  const diagnosticWorkoutId = [...currentStepperByWorkoutId.keys()].sort((left, right) => left - right)[0];
  if (!diagnosticWorkoutId) {
    throw new Error("Migration-free serving is blocked: no current Stepper workout is available for the diagnostic route probe.");
  }
  return {
    currentWorkoutResolutions: historicalWorkoutResolutions,
    currentStepperResolutions: currentStepperByWorkoutId.size,
    strengthSessionCurrent: true,
    diagnosticWorkoutId,
  };
}
