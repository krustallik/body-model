import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  evaluateMigrationFreeEnergyAcceptanceV1,
  type MigrationFreeEnergyEventV1,
  type MigrationFreeDailyModelStateV1,
  type MigrationFreeModelEpisodeV1,
  type MigrationFreeStepperReconciliationGroupV1,
  type MigrationFreeStrengthSessionV1,
  type MigrationFreeWorkoutAliasV1,
  type MigrationFreeWorkoutV1,
  type MigrationFreeStepperLifecycleV1,
} from "../scripts/production-migration-free-acceptance";
import { ACTIVE_ENERGY_SELECTION_POLICY_V1 } from "../src/model/activity/canonical-activity-policy-v1";
import {
  EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_PROVENANCE,
  EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
  experimentalStepperActiveEnergyV1Fingerprint,
  type ExperimentalStepperActiveEnergyResultV1,
} from "../src/model/activity/experimental-stepper-active-energy-v1";
import {
  stepperActiveEnergyCandidateFingerprintV1,
  stepperActiveEnergyInputFingerprintV1,
  STEPPER_HISTORICAL_MASS_POLICY_V1,
  type StepperObservedMassInputV1,
} from "../src/model/activity/stepper-historical-mass-v1";
import {
  EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_PROVENANCE,
  EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  experimentalStrengthActiveEnergyV1Fingerprint,
  type ExperimentalStrengthActiveEnergyResultV1,
} from "../src/modules/training/experimental-strength-active-energy-v1";
import { WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION } from "../src/model/activity/workout-recovery-energy";
import { adaptManualStepperEnergyV1 } from "../src/modules/training/manual-stepper-fields-v1";
import type { MigrationFreeStepperShadowV1, MigrationFreeStrengthShadowV1 } from "../scripts/production-migration-free-acceptance";

function makeStepperShadow(
  workoutId: number,
  valueKcal: number | null,
  massReference: Record<string, unknown>,
  availability: "available" | "unavailable" = "available",
  inputFingerprintOverride?: string,
): MigrationFreeStepperShadowV1 {
  const inputFingerprint = inputFingerprintOverride ?? fingerprint(`stepper-fixture-input:${workoutId}`);
  const estimatorResult = {
    contractVersion: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
    provenance: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_PROVENANCE,
    supportedDomain: "ms100-stair-stepper-experimental-v1",
    availability,
    estimatedActiveKcal: valueKcal,
    lowerBoundKcal: valueKcal,
    upperBoundKcal: valueKcal,
    unavailableReason: null,
    features: {} as ExperimentalStepperActiveEnergyResultV1["features"],
    reasons: [],
    recoveryEnergy: WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
    garminReferenceKcal: null,
  } as ExperimentalStepperActiveEnergyResultV1;
  return {
    workoutId,
    modelRevision: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
    sourceFingerprint: stepperActiveEnergyCandidateFingerprintV1(
      experimentalStepperActiveEnergyV1Fingerprint(estimatorResult), inputFingerprint,
    ),
    result: { ...estimatorResult, massReference, inputFingerprint },
  };
}

function stepperShadowForEvent(event: MigrationFreeEnergyEventV1): MigrationFreeStepperShadowV1 {
  const selected = event.currentProvenance as Record<string, unknown>;
  const identity = String(selected.sourceIdentity);
  const workoutId = Number(/^stepper-shadow:(\d+)$/.exec(identity)?.[1]
    ?? /^stepper-manual-steps:(\d+)$/.exec(identity)?.[1]);
  const evidence = selected.evidence as Record<string, unknown>;
  return makeStepperShadow(workoutId, event.currentKcal!, evidence.massReference as Record<string, unknown>);
}

function makeStrengthShadow(sessionId: number, valueKcal: number, candidateProvenance: Record<string, unknown>, inputFingerprint: string): MigrationFreeStrengthShadowV1 {
  const estimatorResult = {
    contractVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    provenance: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_PROVENANCE,
    supportedDomain: "resistance-diary-session-shadow-only",
    availability: "available",
    estimatedActiveKcal: valueKcal,
    lowerBoundKcal: valueKcal - 1,
    upperBoundKcal: valueKcal + 1,
    unavailableReason: null,
    features: {} as ExperimentalStrengthActiveEnergyResultV1["features"],
    reasons: [],
    recoveryEnergy: WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
    garminReferenceKcal: null,
  } as ExperimentalStrengthActiveEnergyResultV1;
  const result = {
    ...estimatorResult,
    activeEnergyResolution: {},
    sessionRevision: 3,
    inputFingerprint,
    stage02MassReference: candidateProvenance.stage02MassReference,
    stage02SnapshotRevision: candidateProvenance.stage02SnapshotRevision,
    stage02MassResolutionIdentity: null,
    energyMassReference: candidateProvenance.energyMassReference,
    energyMassResolutionMethodVersion: candidateProvenance.energyMassResolutionMethodVersion,
    energyMassResolutionIdentity: candidateProvenance.energyMassResolutionIdentity,
  };
  return {
    sessionId,
    modelRevision: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    sourceFingerprint: fingerprint(`${experimentalStrengthActiveEnergyV1Fingerprint(estimatorResult)}|${inputFingerprint}`),
    result,
  };
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function resolutionFingerprint(logicalEventKey: string, source: string, valueKcal: number | null, provenance: unknown): string {
  // Match persistActiveEnergyCanonicalResolutionV1: it hashes the serialized
  // payload string, rather than the payload object directly.
  return fingerprint(JSON.stringify({ logicalEventKey, source, valueKcal, provenance }));
}

function currentEvent(id: number, eventKind = "other"): MigrationFreeEnergyEventV1 {
  const updatedAt = new Date("2026-10-01T00:00:00.000Z");
  const source = eventKind === "stepper" ? "bodycast-stepper-mechanical" : "device-kcal";
  const sourceIdentity = eventKind === "stepper" ? `stepper-shadow:${id}` : `workout:${id}:device`;
  const valueKcal = id * 10;
  const stepperDateIndex = Math.floor((id - 1) / 2) + 1;
  const stepperDate = `2026-10-${String(stepperDateIndex).padStart(2, "0")}`;
  const stepperMassReference = {
    status: "observed", sourceType: "health-metric-sample", sourceId: String(stepperDateIndex),
    valueKg: 80, sourceTimestamp: `${stepperDate}T09:00:00.000Z`, sourceDate: stepperDate,
    normalizedLocalDate: stepperDate, dayDistance: 0,
    policyVersion: STEPPER_HISTORICAL_MASS_POLICY_V1,
  };
  const sourceFingerprint = source === "device-kcal"
    ? fingerprint(`device|${id}|${valueKcal}|${updatedAt.toISOString()}`)
    : eventKind === "stepper" ? makeStepperShadow(id, valueKcal, stepperMassReference).sourceFingerprint
      : id.toString(16).padStart(64, "0");
  const evidence = eventKind === "stepper"
    ? { revision: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION, massReference: stepperMassReference }
    : { source: "wearable-device", workoutId: id };
  const currentProvenance = { policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1, source,
    sourceIdentity, sourceFingerprint, evidence };
  const currentResolutionFingerprint = resolutionFingerprint(`workout:${id}`, source, valueKcal, currentProvenance);
  return {
    id,
    logicalEventKey: `workout:${id}`,
    eventKind,
    modelDate: eventKind === "stepper" ? stepperDate : "2026-10-01",
    modelTimeZone: "Europe/Bratislava",
    isStale: false,
    supersededByEventId: null,
    currentResolutionFingerprint,
    currentSource: source,
    currentKcal: valueKcal,
    currentProvenance,
    resolutionRevision: 1,
    resolutions: [{ revision: 1, resolutionFingerprint: currentResolutionFingerprint, source, valueKcal, provenance: currentProvenance }],
    candidates: [{ source, sourceIdentity, sourceFingerprint, availability: "available", valueKcal, provenance: evidence }],
  };
}

function strengthAlias(matchedWorkoutId: number | null = null): { alias: MigrationFreeWorkoutAliasV1; session: MigrationFreeStrengthSessionV1; shadow: MigrationFreeStrengthShadowV1 } {
  const sessionId = 900;
  const logicalEventKey = matchedWorkoutId === null ? `strength-session:${sessionId}` : `workout:${matchedWorkoutId}`;
  const sourceFingerprint = "a".repeat(64);
  const massResolutionIdentity = "b".repeat(64);
  const candidateProvenance = {
    estimator: "experimental-strength-active-energy-v1",
    stage02MassReference: null,
    stage02SnapshotRevision: 2,
    energyMassReference: {
      status: "observed",
      valueKg: 80,
      localDate: "2026-10-22",
      source: "apple-health-shortcut",
      sourceId: "weight-observation-1",
    },
    energyMassResolutionIdentity: massResolutionIdentity,
    energyMassResolutionMethodVersion: "bodycast-strength-energy-mass-resolution-v1",
  };
  const selectedProvenance = {
    policyVersion: "bodycast-active-energy-selection-v1",
    source: "bodycast-strength-estimate",
    sourceIdentity: `strength-session:${sessionId}`,
    sourceFingerprint,
    evidence: candidateProvenance,
  };
  const valueKcal = 245.5;
  const shadow = makeStrengthShadow(sessionId, valueKcal, candidateProvenance, sourceFingerprint);
  const event: MigrationFreeEnergyEventV1 = {
    id: 9000,
    logicalEventKey,
    eventKind: "strength",
    modelDate: "2026-10-22",
    modelTimeZone: "Europe/Bratislava",
    isStale: false,
    supersededByEventId: null,
    currentResolutionFingerprint: resolutionFingerprint(logicalEventKey, "bodycast-strength-estimate", valueKcal, selectedProvenance),
    currentSource: "bodycast-strength-estimate",
    currentKcal: valueKcal,
    currentProvenance: selectedProvenance,
    resolutionRevision: 1,
    resolutions: [{
      revision: 1,
      resolutionFingerprint: resolutionFingerprint(logicalEventKey, "bodycast-strength-estimate", valueKcal, selectedProvenance),
      source: "bodycast-strength-estimate",
      valueKcal,
      provenance: selectedProvenance,
    }],
    candidates: [{
      source: "bodycast-strength-estimate",
      sourceIdentity: `strength-session:${sessionId}`,
      sourceFingerprint,
      availability: "available",
      valueKcal,
      provenance: candidateProvenance,
    }],
  };
  const session: MigrationFreeStrengthSessionV1 = {
    id: sessionId,
    status: "COMPLETED",
    entryMode: "LIVE",
    matchStatus: matchedWorkoutId === null ? "UNMATCHED" : "MATCHED",
    matchedWorkoutId,
    effectiveAccountingAt: new Date("2026-10-22T12:41:00.000Z"),
    webStartedAt: new Date("2026-10-22T12:40:00.000Z"),
    webEndedAt: new Date("2026-10-22T13:25:00.000Z"),
    accountingTimeZone: "Europe/Bratislava",
    accountingInputRevision: 3,
    currentSnapshotRevision: 2,
    verifiedEnergyMassReference: {
      stage02MassReference: null,
      stage02SnapshotRevision: 2,
      energyMassReference: candidateProvenance.energyMassReference,
      energyMassResolutionIdentity: candidateProvenance.energyMassResolutionIdentity,
      energyMassResolutionMethodVersion: candidateProvenance.energyMassResolutionMethodVersion,
    },
    exercises: [{ sets: [{ completedAt: new Date("2026-10-22T12:50:00.000Z") }] }],
  };
  return {
    alias: {
      sourceType: "strength-session",
      sourceId: String(sessionId),
      workoutId: null,
      workout: null,
      event,
    },
    session,
    shadow,
  };
}

function validAcceptanceInput(options: { matchedStrengthWorkoutId?: number } = {}): {
  workoutAliases: MigrationFreeWorkoutAliasV1[];
  workouts: MigrationFreeWorkoutV1[];
  stepperReconciliationGroups: MigrationFreeStepperReconciliationGroupV1[];
  strengthSessions: MigrationFreeStrengthSessionV1[];
  stepperShadows: MigrationFreeStepperShadowV1[];
  strengthShadows: MigrationFreeStrengthShadowV1[];
  massObservations: StepperObservedMassInputV1[];
  modelEpisodes: MigrationFreeModelEpisodeV1[];
  modelStates: MigrationFreeDailyModelStateV1[];
  stepperLifecycle: MigrationFreeStepperLifecycleV1 | null;
} {
  const workoutAliases: MigrationFreeWorkoutAliasV1[] = Array.from({ length: 33 }, (_, index) => {
    const id = index + 1;
    const stepper = id <= 12;
    return {
      sourceType: "workout",
      sourceId: String(id),
      workoutId: id,
      workout: { type: stepper ? "Stair Climbing" : "Running", hiddenFromHistory: false },
      event: currentEvent(id, stepper ? "stepper" : "other"),
    };
  });
  const workouts: MigrationFreeWorkoutV1[] = workoutAliases.map((alias, index) => ({
    id: alias.workoutId!,
    type: alias.workout!.type,
    startAt: new Date(`2026-10-${String(1 + Math.floor(index / 2)).padStart(2, "0")}T10:00:00.000Z`),
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    hiddenFromHistory: false,
    activeEnergyKcal: alias.event.currentSource === "device-kcal" ? alias.event.currentKcal : null,
    manualActiveEnergyKcal: null,
    manualStepCount: null,
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  }));
  const matchedStrengthWorkoutId = options.matchedStrengthWorkoutId ?? null;
  const strength = strengthAlias(matchedStrengthWorkoutId);
  if (matchedStrengthWorkoutId !== null) {
    workoutAliases.push({
      sourceType: "workout",
      sourceId: String(matchedStrengthWorkoutId),
      workoutId: matchedStrengthWorkoutId,
      workout: { type: "Traditional Strength Training", hiddenFromHistory: false },
      event: strength.alias.event,
    });
    workouts.push({ id: matchedStrengthWorkoutId, type: "Traditional Strength Training", startAt: new Date("2026-10-22T14:40:00.000Z"),
      createdAt: new Date("2026-10-22T14:41:00.000Z"), hiddenFromHistory: false,
      activeEnergyKcal: null, manualActiveEnergyKcal: null, manualStepCount: null,
      updatedAt: new Date("2026-10-22T14:41:00.000Z") });
  }
  workoutAliases.push(strength.alias);
  return {
    workoutAliases,
    workouts,
    stepperReconciliationGroups: [],
    strengthSessions: [strength.session],
    massObservations: Array.from({ length: 6 }, (_, index) => {
      const date = `2026-10-${String(index + 1).padStart(2, "0")}`;
      return { sourceType: "health-metric-sample", sourceId: String(index + 1), valueKg: 80,
        timestamp: new Date(`${date}T09:00:00.000Z`), date };
    }),
    modelEpisodes: [],
    modelStates: [],
    stepperLifecycle: null,
    stepperShadows: workoutAliases.filter((alias) => alias.sourceType === "workout"
      && alias.event.eventKind === "stepper").map((alias) => stepperShadowForEvent(alias.event))
      .filter((shadow, index, rows) => rows.findIndex((row) => row.workoutId === shadow.workoutId) === index),
    strengthShadows: [strength.shadow],
  };
}

function refreshResolutionFingerprint(event: MigrationFreeEnergyEventV1): void {
  const currentResolutionFingerprint = resolutionFingerprint(
    event.logicalEventKey,
    event.currentSource!,
    event.currentKcal,
    event.currentProvenance,
  );
  event.currentResolutionFingerprint = currentResolutionFingerprint;
  event.resolutions[0]!.resolutionFingerprint = currentResolutionFingerprint;
  event.resolutions[0]!.provenance = structuredClone(event.currentProvenance);
}

function setStepperMassDate(event: MigrationFreeEnergyEventV1, date: string, sourceId: string): void {
  event.modelDate = date;
  event.modelTimeZone = "Europe/Bratislava";
  const evidence = {
    revision: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
    massReference: {
      status: "observed", sourceType: "health-metric-sample", sourceId,
      valueKg: 80, sourceTimestamp: `${date}T09:00:00.000Z`, sourceDate: date,
      normalizedLocalDate: date, dayDistance: 0,
      policyVersion: STEPPER_HISTORICAL_MASS_POLICY_V1,
    },
  };
  (event.currentProvenance as Record<string, unknown>).evidence = evidence;
  event.candidates[0]!.provenance = structuredClone(evidence);
  refreshResolutionFingerprint(event);
}

function currentUnavailableEvent(id: number, eventKind: string): MigrationFreeEnergyEventV1 {
  const event = currentEvent(id, eventKind);
  event.currentSource = "unavailable";
  event.currentKcal = null;
  event.currentProvenance = {
    policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
    source: "unavailable",
    sourceIdentity: null,
    sourceFingerprint: null,
    evidence: null,
  };
  event.candidates = [];
  const digest = resolutionFingerprint(event.logicalEventKey, "unavailable", null, event.currentProvenance);
  event.currentResolutionFingerprint = digest;
  event.resolutions = [{ revision: 1, resolutionFingerprint: digest, source: "unavailable", valueKcal: null,
    provenance: event.currentProvenance }];
  return event;
}

function addStepperDeviceReconciliation(
  input: ReturnType<typeof validAcceptanceInput>,
  status: "confirmed" | "pending",
  deviceWorkoutManualKcal: number | null = null,
): void {
  const event = currentEvent(101, "stepper");
  event.id = 9100;
  event.logicalEventKey = "stepper-reconciliation:9";
  event.modelDate = "2026-10-23";
  const deviceWorkout = {
    id: 101, sourceIdentity: "garmin:fixture", type: "Stair Climbing",
    startAt: new Date("2026-10-23T11:00:00.000Z"), createdAt: new Date("2026-10-23T11:01:00.000Z"),
    hiddenFromHistory: false, activeEnergyKcal: 527, manualActiveEnergyKcal: deviceWorkoutManualKcal,
    manualStepCount: null, updatedAt: new Date("2026-10-23T11:01:00.000Z"),
  };
  const evidence = { source: "wearable-device", workoutId: deviceWorkout.id };
  const sourceFingerprint = fingerprint(`device|${deviceWorkout.id}|${deviceWorkout.activeEnergyKcal}|${deviceWorkout.updatedAt.toISOString()}`);
  event.currentSource = "device-kcal";
  event.currentKcal = deviceWorkout.activeEnergyKcal;
  event.currentProvenance = { policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1, source: "device-kcal",
    sourceIdentity: `workout:${deviceWorkout.id}:device`, sourceFingerprint, evidence };
  event.candidates = [{ source: "device-kcal", sourceIdentity: `workout:${deviceWorkout.id}:device`,
    sourceFingerprint, availability: "available", valueKcal: deviceWorkout.activeEnergyKcal, provenance: evidence }];
  event.resolutions[0]!.source = "device-kcal";
  event.resolutions[0]!.valueKcal = deviceWorkout.activeEnergyKcal;
  refreshResolutionFingerprint(event);

  const manualWorkout = {
    id: 100, sourceIdentity: "manual:stepper:fixture", type: "Stair Climbing",
    startAt: new Date("2026-10-23T10:00:00.000Z"), createdAt: new Date("2026-10-23T10:01:00.000Z"),
    hiddenFromHistory: false, activeEnergyKcal: null, manualActiveEnergyKcal: null,
    manualStepCount: null, updatedAt: new Date("2026-10-23T10:01:00.000Z"),
  };
  for (const workout of [manualWorkout, deviceWorkout]) {
    input.workouts.push(workout);
    input.workoutAliases.push({ sourceType: "workout", sourceId: String(workout.id), workoutId: workout.id,
      workout: { type: workout.type, hiddenFromHistory: false }, event });
  }
  input.stepperReconciliationGroups = [{ id: 9, status, candidates: [
    { manualWorkoutId: 100, garminWorkoutId: 101, candidateStatus: status === "pending" ? "pending" : "confirmed" },
  ] }];
}

describe("migration-free production energy acceptance", () => {
  it("requires the current historical baselines plus the selected Strength estimate", () => {
    expect(evaluateMigrationFreeEnergyAcceptanceV1(validAcceptanceInput())).toEqual({
      historicalWorkoutResolutions: 33,
      currentWorkoutResolutions: 33,
      historicalStepperResolutions: 12,
      currentStepperResolutions: 12,
      strengthSessionCurrent: true,
      diagnosticWorkoutId: 1,
      targetStrengthSessionId: 900,
    });
  });

  it("identifies the Strength session by its stored timezone and exact local minute", () => {
    const input = validAcceptanceInput();
    input.strengthSessions[0]!.effectiveAccountingAt = new Date("2026-10-22T12:41:00.000Z");
    expect(evaluateMigrationFreeEnergyAcceptanceV1(input).strengthSessionCurrent).toBe(true);
    input.strengthSessions[0]!.webStartedAt = new Date("2026-10-22T12:41:00.000Z");
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/expected one LIVE Strength session started/);
  });

  it("counts a matched Strength Workout once as the target session, not as a historical Workout", () => {
    const input = validAcceptanceInput({ matchedStrengthWorkoutId: 34 });
    expect(input.workoutAliases.filter((alias) => alias.sourceType === "workout")).toHaveLength(34);
    expect(evaluateMigrationFreeEnergyAcceptanceV1(input)).toEqual({
      historicalWorkoutResolutions: 33,
      currentWorkoutResolutions: 33,
      historicalStepperResolutions: 12,
      currentStepperResolutions: 12,
      strengthSessionCurrent: true,
      diagnosticWorkoutId: 1,
      targetStrengthSessionId: 900,
    });
  });

  it("requires the matched Strength and Workout aliases to identify one canonical event", () => {
    const input = validAcceptanceInput({ matchedStrengthWorkoutId: 34 });
    input.workoutAliases.find((alias) => alias.sourceType === "workout" && alias.sourceId === "34")!.event = currentEvent(34, "strength");
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/current canonical resolution|current BodyCast candidate/);
  });

  it("keeps the matched Strength session alias unlinked to the Workout row", () => {
    const input = validAcceptanceInput({ matchedStrengthWorkoutId: 34 });
    const strength = input.workoutAliases.find((alias) => alias.sourceType === "strength-session")!;
    strength.workoutId = 34;
    strength.workout = { type: "Traditional Strength Training", hiddenFromHistory: false };
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/current BodyCast candidate/);
  });

  it("does not allow a nearby session to replace the exact target session", () => {
    const input = validAcceptanceInput();
    input.strengthSessions.push({
      ...input.strengthSessions[0]!,
      id: 901,
      effectiveAccountingAt: new Date("2026-10-22T12:42:00.000Z"),
      webStartedAt: new Date("2026-10-22T12:42:00.000Z"),
    });
    expect(evaluateMigrationFreeEnergyAcceptanceV1(input).strengthSessionCurrent).toBe(true);
  });

  it("rejects a same-kcal candidate whose source fingerprint is not the canonical selected evidence", () => {
    const input = validAcceptanceInput();
    const strength = input.workoutAliases.find((alias) => alias.sourceType === "strength-session")!;
    strength.event.candidates[0]!.sourceFingerprint = "d".repeat(64);
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/current BodyCast candidate/);
  });

  it("rejects a Strength candidate whose Stage02 mass snapshot revision is stale", () => {
    const input = validAcceptanceInput();
    const strength = input.workoutAliases.find((alias) => alias.sourceType === "strength-session")!;
    const candidate = strength.event.candidates[0]!;
    const provenance = candidate.provenance as Record<string, unknown>;
    const staleProvenance = {
      ...provenance,
      stage02SnapshotRevision: 1,
    };
    candidate.provenance = staleProvenance;
    (strength.event.currentProvenance as Record<string, unknown>).evidence = staleProvenance;
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/current BodyCast candidate/);
  });

  it("rejects a stale Stepper event from the required historical baseline", () => {
    const input = validAcceptanceInput();
    input.workoutAliases[0]!.event.isStale = true;
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 1 lacks one current canonical resolution/);
  });

  it("retains the 12 Stepper and 33 Workout baseline while accepting legitimate newer workouts", () => {
    const input = validAcceptanceInput();
    const newStepper = currentEvent(100, "stepper");
    setStepperMassDate(newStepper, "2026-09-15", "100");
    input.massObservations.push({ sourceType: "health-metric-sample", sourceId: "100", valueKg: 80,
      timestamp: new Date("2026-09-15T09:00:00.000Z"), date: "2026-09-15" });
    input.workoutAliases.push({ sourceType: "workout", sourceId: "100", workoutId: 100,
      workout: { type: "Stair Climbing", hiddenFromHistory: false }, event: newStepper });
    input.workouts.push({ id: 100, type: "Stair Climbing", startAt: new Date("2026-09-15T10:00:00.000Z"),
      createdAt: new Date("2026-10-23T10:01:00.000Z"), hiddenFromHistory: false,
      activeEnergyKcal: null, manualActiveEnergyKcal: null, manualStepCount: null,
      updatedAt: new Date("2026-10-23T10:01:00.000Z") });
    input.stepperShadows.push(stepperShadowForEvent(newStepper));
    const newWorkout = currentEvent(101);
    input.workoutAliases.push({ sourceType: "workout", sourceId: "101", workoutId: 101,
      workout: { type: "Running", hiddenFromHistory: false }, event: newWorkout });
    input.workouts.push({ id: 101, type: "Running", startAt: new Date("2026-09-16T11:00:00.000Z"),
      createdAt: new Date("2026-10-23T11:01:00.000Z"), hiddenFromHistory: false,
      activeEnergyKcal: newWorkout.currentKcal, manualActiveEnergyKcal: null, manualStepCount: null,
      updatedAt: new Date("2026-10-01T00:00:00.000Z") });
    expect(evaluateMigrationFreeEnergyAcceptanceV1(input)).toMatchObject({
      historicalWorkoutResolutions: 33,
      currentWorkoutResolutions: 35,
      historicalStepperResolutions: 12,
      currentStepperResolutions: 13,
    });
  });

  it("accepts explicit current unavailable energy only for post-cutoff Workouts", () => {
    const input = validAcceptanceInput();
    const unavailableOther = currentUnavailableEvent(200, "other");
    const unavailableStepper = currentUnavailableEvent(201, "stepper");
    input.workoutAliases.push(
      { sourceType: "workout", sourceId: "200", workoutId: 200,
        workout: { type: "Running", hiddenFromHistory: false }, event: unavailableOther },
      { sourceType: "workout", sourceId: "201", workoutId: 201,
        workout: { type: "Stair Climbing", hiddenFromHistory: false }, event: unavailableStepper },
    );
    input.workouts.push(
      { id: 200, type: "Running", startAt: new Date("2026-10-23T10:00:00.000Z"),
        createdAt: new Date("2026-10-23T10:01:00.000Z"), hiddenFromHistory: false,
        activeEnergyKcal: null, manualActiveEnergyKcal: null, manualStepCount: null, updatedAt: new Date("2026-10-23T10:01:00.000Z") },
      { id: 201, type: "Stair Climbing", startAt: new Date("2026-10-23T11:00:00.000Z"),
        createdAt: new Date("2026-10-23T11:01:00.000Z"), hiddenFromHistory: false,
        activeEnergyKcal: null, manualActiveEnergyKcal: null, manualStepCount: null, updatedAt: new Date("2026-10-23T11:01:00.000Z") },
    );

    expect(evaluateMigrationFreeEnergyAcceptanceV1(input)).toMatchObject({
      historicalWorkoutResolutions: 33,
      currentWorkoutResolutions: 33,
      historicalStepperResolutions: 12,
      currentStepperResolutions: 12,
    });
  });

  it("fails closed for post-cutoff Strength unavailable without verified MET fallback inputs", () => {
    const input = validAcceptanceInput();
    const event = currentUnavailableEvent(200, "strength");
    input.workoutAliases.push({ sourceType: "workout", sourceId: "200", workoutId: 200,
      workout: { type: "Traditional Strength Training", hiddenFromHistory: false }, event });
    input.workouts.push({ id: 200, type: "Traditional Strength Training",
      startAt: new Date("2026-10-23T10:00:00.000Z"), createdAt: new Date("2026-10-23T10:01:00.000Z"),
      hiddenFromHistory: false, activeEnergyKcal: null, manualActiveEnergyKcal: null,
      manualStepCount: null, updatedAt: new Date("2026-10-23T10:01:00.000Z") });

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input))
      .toThrow(/Workout 200 lacks one current canonical resolution/);
  });

  it("does not accept unavailable when raw Workout energy or a Stepper shadow is selectable", () => {
    for (const field of ["activeEnergyKcal", "manualActiveEnergyKcal"] as const) {
      const input = validAcceptanceInput();
      const event = currentUnavailableEvent(200, "other");
      input.workoutAliases.push({ sourceType: "workout", sourceId: "200", workoutId: 200,
        workout: { type: "Running", hiddenFromHistory: false }, event });
      input.workouts.push({ id: 200, type: "Running", startAt: new Date("2026-10-23T10:00:00.000Z"),
        createdAt: new Date("2026-10-23T10:01:00.000Z"), hiddenFromHistory: false,
        activeEnergyKcal: field === "activeEnergyKcal" ? 500 : null,
        manualActiveEnergyKcal: field === "manualActiveEnergyKcal" ? 500 : null,
        manualStepCount: null, updatedAt: new Date("2026-10-23T10:01:00.000Z") });

      expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input), `${field} must block unavailable`)
        .toThrow(/Workout 200 lacks one current canonical resolution/);
    }

    const stepperInput = validAcceptanceInput();
    const stepperEvent = currentUnavailableEvent(201, "stepper");
    stepperInput.workoutAliases.push({ sourceType: "workout", sourceId: "201", workoutId: 201,
      workout: { type: "Stair Climbing", hiddenFromHistory: false }, event: stepperEvent });
    stepperInput.workouts.push({ id: 201, type: "Stair Climbing", startAt: new Date("2026-10-23T11:00:00.000Z"),
      createdAt: new Date("2026-10-23T11:01:00.000Z"), hiddenFromHistory: false,
      activeEnergyKcal: null, manualActiveEnergyKcal: null, manualStepCount: null,
      updatedAt: new Date("2026-10-23T11:01:00.000Z") });
    stepperInput.stepperShadows.push(makeStepperShadow(201, 72, { status: "observed" }));

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(stepperInput))
      .toThrow(/Workout 201 lacks one current canonical resolution/);
  });

  it("rejects unavailable historical records, stale state, forged digest, or a selectable candidate", () => {
    const historical = validAcceptanceInput();
    historical.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "13")!.event = currentUnavailableEvent(13, "other");
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(historical)).toThrow(/Workout 13 lacks one current canonical resolution/);

    const candidate = validAcceptanceInput();
    const unavailableWithCandidate = currentUnavailableEvent(200, "other");
    unavailableWithCandidate.candidates.push({ source: "device-kcal", sourceIdentity: "workout:200:device",
      sourceFingerprint: "a".repeat(64), availability: "available", valueKcal: 0, provenance: {} });
    candidate.workoutAliases.push({ sourceType: "workout", sourceId: "200", workoutId: 200,
      workout: { type: "Running", hiddenFromHistory: false }, event: unavailableWithCandidate });
    candidate.workouts.push({ id: 200, type: "Running", startAt: new Date("2026-10-23T10:00:00.000Z"),
      createdAt: new Date("2026-10-23T10:01:00.000Z"), hiddenFromHistory: false,
      activeEnergyKcal: null, manualActiveEnergyKcal: null, manualStepCount: null, updatedAt: new Date("2026-10-23T10:01:00.000Z") });
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(candidate)).toThrow(/Workout 200 lacks one current canonical resolution/);

    const stale = validAcceptanceInput();
    const staleUnavailable = currentUnavailableEvent(200, "other");
    staleUnavailable.isStale = true;
    stale.workoutAliases.push({ sourceType: "workout", sourceId: "200", workoutId: 200,
      workout: { type: "Running", hiddenFromHistory: false }, event: staleUnavailable });
    stale.workouts.push({ id: 200, type: "Running", startAt: new Date("2026-10-23T10:00:00.000Z"),
      createdAt: new Date("2026-10-23T10:01:00.000Z"), hiddenFromHistory: false,
      activeEnergyKcal: null, manualActiveEnergyKcal: null, manualStepCount: null, updatedAt: new Date("2026-10-23T10:01:00.000Z") });
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(stale)).toThrow(/Workout 200 lacks one current canonical resolution/);

    const forged = validAcceptanceInput();
    const forgedUnavailable = currentUnavailableEvent(200, "other");
    forgedUnavailable.currentResolutionFingerprint = "f".repeat(64);
    forgedUnavailable.resolutions[0]!.resolutionFingerprint = "f".repeat(64);
    forged.workoutAliases.push({ sourceType: "workout", sourceId: "200", workoutId: 200,
      workout: { type: "Running", hiddenFromHistory: false }, event: forgedUnavailable });
    forged.workouts.push({ id: 200, type: "Running", startAt: new Date("2026-10-23T10:00:00.000Z"),
      createdAt: new Date("2026-10-23T10:01:00.000Z"), hiddenFromHistory: false,
      activeEnergyKcal: null, manualActiveEnergyKcal: null, manualStepCount: null, updatedAt: new Date("2026-10-23T10:01:00.000Z") });
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(forged)).toThrow(/Workout 200 lacks one current canonical resolution/);
  });

  it("blocks a missing previously accepted historical Workout", () => {
    const input = validAcceptanceInput();
    input.workouts = input.workouts.filter((workout) => workout.id !== 13);
    input.workoutAliases = input.workoutAliases.filter((alias) => !(alias.sourceType === "workout" && alias.sourceId === "13"));
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/32\/33 baseline historical Workout/);
  });

  it("blocks a missing or duplicated canonical Workout alias", () => {
    const missing = validAcceptanceInput();
    missing.workoutAliases = missing.workoutAliases.filter((alias) => !(alias.sourceType === "workout" && alias.sourceId === "1"));
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(missing)).toThrow(/Workout 1 has a missing, duplicated, or mismatched canonical alias/);

    const duplicate = validAcceptanceInput();
    duplicate.workoutAliases.push({ ...duplicate.workoutAliases[0]! });
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(duplicate)).toThrow(/Workout 1 has a missing, duplicated, or mismatched canonical alias/);
  });

  it("blocks two Workouts that share one canonical event", () => {
    const input = validAcceptanceInput();
    const secondAlias = input.workoutAliases.find((alias) => alias.sourceType === "workout" && alias.sourceId === "2")!;
    secondAlias.event = input.workoutAliases[0]!.event;
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 2 (has an invalid canonical event identity|lacks one current canonical resolution)/);
  });

  it("counts one current canonical Stepper reconciliation event for new confirmed group members", () => {
    const input = validAcceptanceInput();
    const groupEvent = currentEvent(100, "stepper");
    groupEvent.logicalEventKey = "stepper-reconciliation:9";
    setStepperMassDate(groupEvent, "2026-10-23", "100");
    input.massObservations.push({ sourceType: "health-metric-sample", sourceId: "100", valueKg: 80,
      timestamp: new Date("2026-10-23T09:00:00.000Z"), date: "2026-10-23" });
    refreshResolutionFingerprint(groupEvent);
    for (const id of [100, 101]) {
      input.workoutAliases.push({ sourceType: "workout", sourceId: String(id), workoutId: id,
        workout: { type: "Stair Climbing", hiddenFromHistory: false }, event: groupEvent });
      input.workouts.push({ id, type: "Stair Climbing", startAt: new Date(`2026-10-${id === 100 ? "23" : "24"}T10:00:00.000Z`),
        createdAt: new Date(`2026-10-${id === 100 ? "23" : "24"}T10:01:00.000Z`), hiddenFromHistory: false,
        activeEnergyKcal: null, manualActiveEnergyKcal: null, manualStepCount: null,
        updatedAt: new Date(`2026-10-${id === 100 ? "23" : "24"}T10:01:00.000Z`) });
    }
    input.stepperShadows.push(stepperShadowForEvent(groupEvent));
    input.stepperReconciliationGroups = [{ id: 9, status: "confirmed", candidates: [
      { manualWorkoutId: 100, garminWorkoutId: 101, candidateStatus: "confirmed" },
    ] }];

    expect(evaluateMigrationFreeEnergyAcceptanceV1(input)).toMatchObject({
      historicalWorkoutResolutions: 33,
      currentWorkoutResolutions: 34,
      historicalStepperResolutions: 12,
      currentStepperResolutions: 13,
    });
  });

  it("rejects a persisted device candidate after a Stepper reconciliation becomes pending", () => {
    const input = validAcceptanceInput();
    addStepperDeviceReconciliation(input, "pending");

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input))
      .toThrow(/Workout 100 lacks one current canonical resolution/);
  });

  it("does not treat manual kcal on the Garmin member as a producer candidate", () => {
    const input = validAcceptanceInput();
    addStepperDeviceReconciliation(input, "confirmed", 900);

    expect(evaluateMigrationFreeEnergyAcceptanceV1(input)).toMatchObject({
      historicalWorkoutResolutions: 33,
      currentWorkoutResolutions: 34,
      historicalStepperResolutions: 12,
      currentStepperResolutions: 13,
    });
  });

  it("validates confirmed manual-step fallback against the Garmin representative shadow", () => {
    const input = validAcceptanceInput();
    const event = currentEvent(100, "stepper");
    event.logicalEventKey = "stepper-reconciliation:10";
    setStepperMassDate(event, "2026-10-24", "101");
    const manualStepCount = 500;
    const mechanicalKcal = adaptManualStepperEnergyV1({ manualStepCount, manualActiveEnergyKcal: null, bodyMassKg: 80 }).mechanicalKcal!;
    const inputFingerprint = fingerprint("stepper-fixture-input:101");
    const massReference = ((event.currentProvenance as Record<string, unknown>).evidence as Record<string, unknown>).massReference;
    const shadow = makeStepperShadow(101, null, massReference as Record<string, unknown>, "unavailable");
    const sourceFingerprint = fingerprint(`${inputFingerprint}|manual-steps|${mechanicalKcal}`);
    const evidence = { source: "bodycast-manual-step-mechanical", workoutId: 100,
      massReference: (event.currentProvenance as Record<string, unknown>).evidence
        && ((event.currentProvenance as Record<string, unknown>).evidence as Record<string, unknown>).massReference };
    event.currentKcal = mechanicalKcal;
    event.currentProvenance = {
      policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
      source: "bodycast-stepper-mechanical",
      sourceIdentity: "stepper-manual-steps:100",
      sourceFingerprint,
      evidence,
    };
    event.candidates = [{ source: "bodycast-stepper-mechanical", sourceIdentity: "stepper-manual-steps:100",
      sourceFingerprint, availability: "available", valueKcal: mechanicalKcal, provenance: evidence }];
    event.resolutions[0]!.source = "bodycast-stepper-mechanical";
    event.resolutions[0]!.valueKcal = mechanicalKcal;
    refreshResolutionFingerprint(event);

    input.workoutAliases.push(...[100, 101].map((id) => ({ sourceType: "workout", sourceId: String(id), workoutId: id,
      workout: { type: "Stair Climbing", hiddenFromHistory: false }, event })));
    input.workouts.push(
      { id: 100, sourceIdentity: "manual:stepper:fixture", type: "Stair Climbing", startAt: new Date("2026-10-24T10:00:00.000Z"),
        createdAt: new Date("2026-10-24T10:01:00.000Z"), hiddenFromHistory: false, activeEnergyKcal: null,
        manualActiveEnergyKcal: null, manualStepCount, updatedAt: new Date("2026-10-24T10:01:00.000Z") },
      { id: 101, sourceIdentity: "garmin:fixture", type: "Stair Climbing", startAt: new Date("2026-10-24T11:00:00.000Z"),
        createdAt: new Date("2026-10-24T11:01:00.000Z"), hiddenFromHistory: false, activeEnergyKcal: null,
        manualActiveEnergyKcal: null, manualStepCount: null, updatedAt: new Date("2026-10-24T11:01:00.000Z") },
    );
    input.massObservations.push({ sourceType: "health-metric-sample", sourceId: "101", valueKg: 80,
      timestamp: new Date("2026-10-24T09:00:00.000Z"), date: "2026-10-24" });
    input.stepperReconciliationGroups = [{ id: 10, status: "confirmed", candidates: [
      { manualWorkoutId: 100, garminWorkoutId: 101, candidateStatus: "confirmed" },
    ] }];
    input.stepperShadows.push(shadow);

    expect(evaluateMigrationFreeEnergyAcceptanceV1(input)).toMatchObject({
      historicalWorkoutResolutions: 33,
      historicalStepperResolutions: 12,
      currentStepperResolutions: 13,
    });

    input.workouts.find((row) => row.id === 100)!.sourceIdentity = "garmin:misidentified-manual";
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 100 lacks one current canonical resolution/);
    input.workouts.find((row) => row.id === 100)!.sourceIdentity = "manual:stepper:fixture";
    input.workouts.find((row) => row.id === 101)!.sourceIdentity = "manual:stepper:duplicate";
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 100 lacks one current canonical resolution/);
  });

  it("does not let a historical reconciliation group replace a distinct baseline Stepper resolution", () => {
    const input = validAcceptanceInput();
    const groupEvent = currentEvent(1, "stepper");
    groupEvent.logicalEventKey = "stepper-reconciliation:9";
    refreshResolutionFingerprint(groupEvent);
    input.workoutAliases.find((alias) => alias.sourceType === "workout" && alias.sourceId === "1")!.event = groupEvent;
    input.workoutAliases.find((alias) => alias.sourceType === "workout" && alias.sourceId === "2")!.event = groupEvent;
    input.stepperReconciliationGroups = [{ id: 9, status: "confirmed", candidates: [
      { manualWorkoutId: 1, garminWorkoutId: 2, candidateStatus: "confirmed" },
    ] }];

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/11\/12 baseline historical Stepper resolutions/);
  });

  it("accepts a producer fingerprint after JSONB key order changes while matching the current revision fields", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "13")!.event;
    const selected = event.currentProvenance as Record<string, unknown>;
    const evidence = selected.evidence as Record<string, unknown>;
    const reorderedProvenance = {
      evidence: { workoutId: evidence.workoutId, source: evidence.source },
      sourceFingerprint: selected.sourceFingerprint,
      sourceIdentity: selected.sourceIdentity,
      source: selected.source,
      policyVersion: selected.policyVersion,
    };
    event.currentProvenance = reorderedProvenance;
    event.resolutions[0]!.provenance = reorderedProvenance;

    expect(evaluateMigrationFreeEnergyAcceptanceV1(input).historicalWorkoutResolutions).toBe(33);
  });

  it("rejects a self-consistent device candidate whose identity belongs to another Workout", () => {
    const input = validAcceptanceInput();
    const alias = input.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "13")!;
    const event = alias.event;
    const provenance = event.currentProvenance as Record<string, unknown>;
    provenance.sourceIdentity = "workout:999:device";
    provenance.evidence = { source: "wearable-device", workoutId: 999 };
    event.candidates[0]!.sourceIdentity = "workout:999:device";
    event.candidates[0]!.provenance = provenance.evidence;
    refreshResolutionFingerprint(event);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 13 lacks one current canonical resolution/);
  });

  it("explains a Stepper acceptance failure without exposing source values", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "1")!.event;
    event.candidates[0]!.provenance = { revision: "mismatched-fixture" };

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1({ ...input, explainWorkoutId: 1 }))
      .toThrow(/Acceptance evidence: .*selected_candidate_provenance_matches=no/);
  });

  it("rejects an unsupported selected source on a generic Workout event", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "13")!.event;
    const source = "unsupported-source";
    const sourceIdentity = "unsupported:13";
    const sourceFingerprint = "e".repeat(64);
    event.currentSource = source;
    event.currentProvenance = {
      policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
      source,
      sourceIdentity,
      sourceFingerprint,
      evidence: { workoutId: 13 },
    };
    event.candidates = [{ source, sourceIdentity, sourceFingerprint, availability: "available",
      valueKcal: event.currentKcal, provenance: { workoutId: 13 } }];
    refreshResolutionFingerprint(event);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 13 lacks one current canonical resolution/);
  });

  it("requires the current fingerprint to match its selected resolution revision", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "13")!.event;
    event.currentResolutionFingerprint = "f".repeat(64);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 13 lacks one current canonical resolution/);
  });

  it("rejects selected Stepper provenance changed in every canonical row but not its producer shadow", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "1")!.event;
    const selected = event.currentProvenance as Record<string, unknown>;
    const changedEvidence = structuredClone(selected.evidence) as Record<string, unknown>;
    (changedEvidence.massReference as Record<string, unknown>).sourceId = "forged-source-id";
    selected.evidence = changedEvidence;
    event.candidates[0]!.provenance = changedEvidence;
    event.resolutions[0]!.provenance = structuredClone(selected);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 1 lacks one current canonical resolution/);
  });

  it("accepts Workout 56 when model mass is unchanged but its publication generation advanced", () => {
    const input = validAcceptanceInput();
    const alias = input.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "1")!;
    const workout = input.workouts.find((row) => row.id === 1)!;
    const event = alias.event;
    const stableMassReference = {
      status: "model-estimated",
      sourceType: "predecessor-model",
      sourceId: "daily-model-state:7001",
      valueKg: 80,
      sourceTimestamp: "2026-10-25T07:00:00.000Z",
      sourceDate: "2026-10-25",
      normalizedLocalDate: "2026-10-25",
      dayDistance: 1,
      policyVersion: STEPPER_HISTORICAL_MASS_POLICY_V1,
      modelSourceKind: "predecessor-model",
      modelEpisodeId: 700,
      modelVersion: "fixture-v1",
      modelStateUpdatedAt: "2026-10-25T07:00:00.000Z",
    };

    alias.sourceId = "56";
    alias.workoutId = 56;
    workout.id = 56;
    event.logicalEventKey = "workout:56";
    event.modelDate = "2026-10-26";
    workout.startAt = new Date("2026-10-26T10:00:00.000Z");
    const selected = event.currentProvenance as Record<string, unknown>;
    selected.sourceIdentity = "stepper-shadow:56";
    (selected.evidence as Record<string, unknown>).massReference = stableMassReference;
    event.candidates[0]!.sourceIdentity = "stepper-shadow:56";
    event.candidates[0]!.provenance = structuredClone(selected.evidence);
    const inputFingerprint = stepperActiveEnergyInputFingerprintV1({
      workout: {
        id: 56,
        type: workout.type,
        sourceIdentity: workout.sourceIdentity,
        startAt: workout.startAt.toISOString(),
        updatedAt: workout.updatedAt.toISOString(),
        activeEnergyKcal: workout.activeEnergyKcal,
        manualActiveEnergyKcal: workout.manualActiveEnergyKcal,
        manualStepCount: workout.manualStepCount,
      },
      modelContext: { modelDate: event.modelDate, modelTimeZone: event.modelTimeZone, episodeId: 700, modelVersion: "fixture-v1" },
      massProvenance: stableMassReference,
    });
    const shadow = makeStepperShadow(56, event.currentKcal!, {
      ...stableMassReference,
      modelGeneration: 8,
    }, "available", inputFingerprint);
    input.stepperShadows = input.stepperShadows.filter((row) => row.workoutId !== 1);
    input.stepperShadows.push(shadow);
    selected.sourceFingerprint = shadow.sourceFingerprint;
    event.candidates[0]!.sourceFingerprint = shadow.sourceFingerprint;
    input.modelEpisodes = [{
      id: 700,
      timezone: "Europe/Bratislava",
      modelVersion: "fixture-v1",
      startDate: "2026-10-25",
      latestModeledDate: "2026-10-26",
      initialFilteredWeightKg: 80,
      updatedAt: new Date("2026-10-25T07:00:00.000Z"),
      createdAt: new Date("2026-10-25T07:00:00.000Z"),
      active: true,
    }];
    input.modelStates = [{
      id: 7001,
      episodeId: 700,
      date: "2026-10-25",
      status: "complete",
      endWeightKg: 80,
      filteredWeightKg: 80,
      modelVersion: "fixture-v1",
      createdAt: new Date("2026-10-25T07:00:00.000Z"),
    }];
    input.stepperLifecycle = {
      invalidationGeneration: 9,
      productionPublishedGeneration: 9,
      productionStaleFromDate: null,
    };
    refreshResolutionFingerprint(event);

    expect(evaluateMigrationFreeEnergyAcceptanceV1(input)).toMatchObject({
      historicalWorkoutResolutions: 33,
      historicalStepperResolutions: 12,
      currentStepperResolutions: 12,
    });
  });

  it("rejects Strength mass provenance changed in event, candidate, and revision while retaining the old digest", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases.find((row) => row.sourceType === "strength-session")!.event;
    const selected = event.currentProvenance as Record<string, unknown>;
    const changedEvidence = structuredClone(selected.evidence) as Record<string, unknown>;
    (changedEvidence.energyMassReference as Record<string, unknown>).sourceId = "forged-source-id";
    selected.evidence = changedEvidence;
    event.candidates[0]!.provenance = changedEvidence;
    event.resolutions[0]!.provenance = structuredClone(selected);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/current BodyCast candidate/);
  });

  it("rejects a coordinated Stepper shadow and canonical edit to a valid but non-selected weight row", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "1")!.event;
    const shadow = input.stepperShadows.find((row) => row.workoutId === 1)!;
    const alternateMass = {
      status: "observed", sourceType: "health-metric-sample", sourceId: "99", valueKg: 80,
      sourceTimestamp: "2026-10-02T09:00:00.000Z", sourceDate: "2026-10-02",
      normalizedLocalDate: "2026-10-02", dayDistance: 1,
      policyVersion: STEPPER_HISTORICAL_MASS_POLICY_V1,
    };
    input.massObservations.push({ sourceType: "health-metric-sample", sourceId: "99", valueKg: 80,
      timestamp: new Date("2026-10-02T09:00:00.000Z"), date: "2026-10-02" });
    (shadow.result as Record<string, unknown>).massReference = alternateMass;
    const selected = event.currentProvenance as Record<string, unknown>;
    (selected.evidence as Record<string, unknown>).massReference = alternateMass;
    event.candidates[0]!.provenance = structuredClone(selected.evidence);
    event.resolutions[0]!.provenance = structuredClone(selected);
    refreshResolutionFingerprint(event);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 1 lacks one current canonical resolution/);
  });

  it("rejects a coordinated Strength shadow and canonical edit to another valid weight reference", () => {
    const input = validAcceptanceInput();
    const alias = input.workoutAliases.find((row) => row.sourceType === "strength-session")!;
    const shadow = input.strengthShadows.find((row) => row.sessionId === 900)!;
    const event = alias.event;
    const alternateReference = {
      status: "observed", valueKg: 79, localDate: "2026-10-22",
      source: "apple-health-shortcut", sourceId: "weight-observation-2",
    };
    (shadow.result as Record<string, unknown>).energyMassReference = alternateReference;
    const selected = event.currentProvenance as Record<string, unknown>;
    const evidence = selected.evidence as Record<string, unknown>;
    evidence.energyMassReference = alternateReference;
    event.candidates[0]!.provenance = structuredClone(evidence);
    event.resolutions[0]!.provenance = structuredClone(selected);
    refreshResolutionFingerprint(event);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/current BodyCast candidate/);
  });

  it("keeps the exact target Strength session blocked when its canonical resolution is unavailable", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases.find((row) => row.sourceType === "strength-session")!.event;
    event.currentSource = "unavailable";
    event.currentKcal = null;
    event.currentProvenance = {
      policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
      source: "unavailable", sourceIdentity: null, sourceFingerprint: null, evidence: null,
    };
    event.candidates = [];
    const digest = resolutionFingerprint(event.logicalEventKey, "unavailable", null, event.currentProvenance);
    event.currentResolutionFingerprint = digest;
    event.resolutions[0] = { revision: 1, resolutionFingerprint: digest, source: "unavailable",
      valueKcal: null, provenance: event.currentProvenance };

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/current BodyCast candidate/);
  });

  it("keeps the required 33 historical resolutions after excluding a matched target Strength Workout", () => {
    const input = validAcceptanceInput({ matchedStrengthWorkoutId: 34 });
    input.workouts.find((row) => row.id === 34)!.createdAt = new Date("2026-10-01T00:00:00.000Z");
    input.workouts = input.workouts.filter((row) => row.id !== 33);
    input.workoutAliases = input.workoutAliases.filter((row) => !(row.sourceType === "workout" && row.sourceId === "33"));

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/32\/33 baseline historical Workout resolutions/);
  });

  it("blocks a Stepper source or provenance that does not match its canonical candidate", () => {
    const wrongSource = validAcceptanceInput();
    wrongSource.workoutAliases[0]!.event.currentSource = "device-kcal";
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(wrongSource)).toThrow(/Workout 1 lacks one current canonical resolution/);

    const wrongProvenance = validAcceptanceInput();
    const stepper = wrongProvenance.workoutAliases[0]!.event;
    (stepper.currentProvenance as Record<string, unknown>).evidence = { revision: "unknown", massReference: {} };
    stepper.candidates[0]!.provenance = { revision: "unknown", massReference: {} };
    refreshResolutionFingerprint(stepper);
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(wrongProvenance)).toThrow(/invalid canonical provenance|lacks one current canonical resolution/);
  });

  it("rejects a lower-priority Stepper source while a BodyCast mechanical candidate is available", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases[0]!.event;
    const workout = input.workouts.find((row) => row.id === 1)!;
    const valueKcal = 17;
    const sourceFingerprint = fingerprint(`device|${workout.id}|${valueKcal}|${workout.updatedAt.toISOString()}`);
    const evidence = { source: "wearable-device", workoutId: workout.id };

    workout.activeEnergyKcal = valueKcal;
    event.currentSource = "device-kcal";
    event.currentKcal = valueKcal;
    event.currentProvenance = { policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1, source: "device-kcal",
      sourceIdentity: `workout:${workout.id}:device`, sourceFingerprint, evidence };
    event.candidates.push({ source: "device-kcal", sourceIdentity: `workout:${workout.id}:device`,
      sourceFingerprint, availability: "available", valueKcal, provenance: evidence });
    refreshResolutionFingerprint(event);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 1 lacks one current canonical resolution/);
  });

  it("rejects a lower-priority Stepper source when its current mechanical shadow is missing from event candidates", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases[0]!.event;
    const workout = input.workouts.find((row) => row.id === 1)!;
    const valueKcal = 17;
    const sourceFingerprint = fingerprint(`device|${workout.id}|${valueKcal}|${workout.updatedAt.toISOString()}`);
    const evidence = { source: "wearable-device", workoutId: workout.id };

    workout.activeEnergyKcal = valueKcal;
    event.currentSource = "device-kcal";
    event.currentKcal = valueKcal;
    event.currentProvenance = { policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1, source: "device-kcal",
      sourceIdentity: `workout:${workout.id}:device`, sourceFingerprint, evidence };
    event.candidates = [{ source: "device-kcal", sourceIdentity: `workout:${workout.id}:device`,
      sourceFingerprint, availability: "available", valueKcal, provenance: evidence }];
    refreshResolutionFingerprint(event);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 1 lacks one current canonical resolution/);
  });

  it("ignores an obsolete fingerprint for the same current Stepper producer", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases[0]!.event;
    const currentCandidate = event.candidates[0]!;
    event.candidates.push({ ...currentCandidate, sourceFingerprint: "e".repeat(64),
      valueKcal: currentCandidate.valueKcal! + 1 });

    expect(evaluateMigrationFreeEnergyAcceptanceV1(input)).toMatchObject({
      historicalWorkoutResolutions: 33,
      historicalStepperResolutions: 12,
      currentStepperResolutions: 12,
    });
  });

  it("does not count an unverified Strength MET fallback toward historical acceptance", () => {
    const input = validAcceptanceInput();
    const event = currentEvent(34, "strength");
    const source = "bodycast-strength-met-fallback";
    const sourceIdentity = "strength-met:34:2026-10-01";
    const sourceFingerprint = "d".repeat(64);
    const evidence = { modelDate: "2026-10-01", modelEpisodeId: 1, modelVersion: "model-v1",
      modelTimeZone: "Europe/Bratislava", dynamicRmrKcalPerDay: 1800, massKg: 80 };
    event.logicalEventKey = "workout:34";
    event.eventKind = "strength";
    event.currentSource = source;
    event.currentProvenance = { policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1, source,
      sourceIdentity, sourceFingerprint, evidence };
    event.candidates = [{ source, sourceIdentity, sourceFingerprint, availability: "available",
      valueKcal: event.currentKcal, provenance: evidence }];
    refreshResolutionFingerprint(event);
    input.workoutAliases.push({ sourceType: "workout", sourceId: "34", workoutId: 34,
      workout: { type: "Traditional Strength Training", hiddenFromHistory: false }, event });
    input.workouts.push({ id: 34, type: "Traditional Strength Training", startAt: new Date("2026-10-01T10:00:00.000Z"),
      createdAt: new Date("2026-10-01T00:00:00.000Z"), hiddenFromHistory: false, activeEnergyKcal: null,
      manualActiveEnergyKcal: null, manualStepCount: null, updatedAt: new Date("2026-10-01T10:00:00.000Z") });

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 34 lacks one current canonical resolution/);
  });

  it("rejects a lower-priority Strength source when its current estimate shadow is missing from event candidates", () => {
    const input = validAcceptanceInput({ matchedStrengthWorkoutId: 34 });
    const event = input.workoutAliases.find((row) => row.sourceType === "strength-session")!.event;
    const workout = input.workouts.find((row) => row.id === 34)!;
    const valueKcal = 527;
    const sourceFingerprint = fingerprint(`device|${workout.id}|${valueKcal}|${workout.updatedAt.toISOString()}`);
    const evidence = { source: "wearable-device", workoutId: workout.id };

    workout.activeEnergyKcal = valueKcal;
    event.currentSource = "device-kcal";
    event.currentKcal = valueKcal;
    event.currentProvenance = { policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1, source: "device-kcal",
      sourceIdentity: `workout:${workout.id}:device`, sourceFingerprint, evidence };
    event.candidates = [{ source: "device-kcal", sourceIdentity: `workout:${workout.id}:device`,
      sourceFingerprint, availability: "available", valueKcal, provenance: evidence }];
    refreshResolutionFingerprint(event);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 34 lacks one current canonical resolution/);
  });

  it("rejects a device source when raw manual kcal is present but its candidate row is missing", () => {
    const input = validAcceptanceInput();
    const event = currentEvent(200);
    const workout: MigrationFreeWorkoutV1 = {
      id: 200,
      type: "Running",
      startAt: new Date("2026-10-23T10:00:00.000Z"),
      createdAt: new Date("2026-10-23T10:01:00.000Z"),
      hiddenFromHistory: false,
      activeEnergyKcal: event.currentKcal,
      manualActiveEnergyKcal: 500,
      manualStepCount: null,
      updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    };
    event.candidates = event.candidates.filter((candidate) => candidate.source !== "manual-kcal");
    input.workoutAliases.push({ sourceType: "workout", sourceId: "200", workoutId: 200,
      workout: { type: "Running", hiddenFromHistory: false }, event });
    input.workouts.push(workout);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input))
      .toThrow(/Workout 200 lacks one current canonical resolution/);
  });

  it("does not allow unavailable for a matched non-target Strength Workout with a current estimator shadow", () => {
    const input = validAcceptanceInput();
    const extra = strengthAlias(35);
    extra.session.id = 901;
    extra.session.effectiveAccountingAt = new Date("2026-10-23T10:41:00.000Z");
    extra.session.webStartedAt = new Date("2026-10-23T10:40:00.000Z");
    extra.session.webEndedAt = new Date("2026-10-23T11:25:00.000Z");
    extra.shadow.sessionId = 901;
    extra.alias.sourceId = "901";
    const unavailableEvent = currentUnavailableEvent(35, "strength");
    unavailableEvent.id = 9001;
    extra.alias.event = unavailableEvent;

    input.strengthSessions.push(extra.session);
    input.strengthShadows.push(extra.shadow);
    input.workoutAliases.push(
      { sourceType: "workout", sourceId: "35", workoutId: 35,
        workout: { type: "Traditional Strength Training", hiddenFromHistory: false }, event: unavailableEvent },
      extra.alias,
    );
    input.workouts.push({ id: 35, type: "Traditional Strength Training",
      startAt: new Date("2026-10-23T10:40:00.000Z"), createdAt: new Date("2026-10-23T10:41:00.000Z"),
      hiddenFromHistory: false, activeEnergyKcal: null, manualActiveEnergyKcal: null,
      manualStepCount: null, updatedAt: new Date("2026-10-23T10:41:00.000Z") });

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input))
      .toThrow(/Workout 35 lacks one current canonical resolution/);
  });

  it("rejects Stepper mechanical energy selected for a non-Stepper Workout", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "13")!.event;
    const stepper = input.workoutAliases[0]!.event;
    event.currentSource = stepper.currentSource;
    event.currentProvenance = structuredClone(stepper.currentProvenance);
    event.candidates = stepper.candidates.map((candidate) => ({ ...candidate, sourceIdentity: "stepper-shadow:13" }));
    (event.currentProvenance as Record<string, unknown>).sourceIdentity = "stepper-shadow:13";
    refreshResolutionFingerprint(event);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 13 lacks one current canonical resolution/);
  });

  it("rejects Strength MET fallback selected for a non-Strength Workout", () => {
    const input = validAcceptanceInput();
    const event = input.workoutAliases.find((row) => row.sourceType === "workout" && row.sourceId === "13")!.event;
    const source = "bodycast-strength-met-fallback";
    const sourceIdentity = "strength-met:13:2026-10-01";
    const sourceFingerprint = "c".repeat(64);
    const evidence = { modelDate: "2026-10-01" };
    event.currentSource = source;
    event.currentProvenance = { policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1, source,
      sourceIdentity, sourceFingerprint, evidence };
    event.candidates = [{ source, sourceIdentity, sourceFingerprint, availability: "available",
      valueKcal: event.currentKcal, provenance: evidence }];
    refreshResolutionFingerprint(event);

    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 13 lacks one current canonical resolution/);
  });

  it("blocks a current resolution with a missing candidate record", () => {
    const input = validAcceptanceInput();
    input.workoutAliases[0]!.event.candidates = [];
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/Workout 1 lacks one current canonical resolution/);
  });
});
