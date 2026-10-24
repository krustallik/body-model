import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { ACTIVE_ENERGY_SELECTION_POLICY_V1 } from "@/model/activity/canonical-activity-policy-v1";
import { EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION } from "@/model/activity/experimental-stepper-active-energy-v1";
import {
  experimentalStepperActiveEnergyV1Fingerprint,
  type ExperimentalStepperActiveEnergyResultV1,
} from "@/model/activity/experimental-stepper-active-energy-v1";
import {
  resolveStepperHistoricalMassV1,
  stableStepperMassProvenanceV1,
  stepperActiveEnergyCandidateFingerprintV1,
  STEPPER_HISTORICAL_MASS_POLICY_V1,
  type StepperObservedMassInputV1,
  type StepperMassProvenanceV1,
} from "@/model/activity/stepper-historical-mass-v1";
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION, experimentalStrengthActiveEnergyV1Fingerprint, type ExperimentalStrengthActiveEnergyResultV1 } from "@/modules/training/experimental-strength-active-energy-v1";
import { STRENGTH_ENERGY_MASS_RESOLUTION_V1 } from "@/modules/training/session-mass-reference";
import { adaptManualStepperEnergyV1 } from "@/modules/training/manual-stepper-fields-v1";
import { MANUAL_STEPPER_SOURCE_PREFIX } from "@/modules/health/workout-source-identity";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";

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
  modelDate: string;
  modelTimeZone: string;
  isStale: boolean;
  supersededByEventId: number | null;
  currentResolutionFingerprint: string | null;
  currentSource: string | null;
  currentKcal: number | null;
  currentProvenance: unknown;
  resolutionRevision: number;
  resolutions: Array<{
    revision: number;
    resolutionFingerprint: string;
    source: string;
    valueKcal: number | null;
    provenance: unknown;
  }>;
  candidates: MigrationFreeEnergyCandidateV1[];
};

export type MigrationFreeWorkoutAliasV1 = {
  sourceType: string;
  sourceId: string;
  workoutId: number | null;
  workout: { type: string; hiddenFromHistory: boolean } | null;
  event: MigrationFreeEnergyEventV1;
};

export type MigrationFreeWorkoutV1 = {
  id: number;
  sourceIdentity?: string;
  type: string;
  startAt: Date;
  createdAt: Date;
  hiddenFromHistory: boolean;
  activeEnergyKcal: number | null;
  manualActiveEnergyKcal: number | null;
  manualStepCount: number | null;
  updatedAt: Date;
};

export type MigrationFreeStepperReconciliationGroupV1 = {
  id: number;
  status: string;
  candidates: Array<{ manualWorkoutId: number; garminWorkoutId: number; candidateStatus: string }>;
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
  verifiedEnergyMassReference?: unknown;
  exercises: Array<{ sets: Array<{ completedAt: Date | null }> }>;
};

export type MigrationFreeStepperShadowV1 = {
  workoutId: number;
  sourceFingerprint: string;
  modelRevision: string;
  result: unknown;
};

export type MigrationFreeStrengthShadowV1 = {
  sessionId: number;
  sourceFingerprint: string;
  modelRevision: string;
  result: unknown;
};

export type MigrationFreeModelEpisodeV1 = {
  id: number;
  timezone: string;
  modelVersion: string;
  startDate: string;
  latestModeledDate: string | null;
  initialFilteredWeightKg: number;
  updatedAt: Date;
  createdAt: Date;
  active: boolean;
};

export type MigrationFreeDailyModelStateV1 = {
  id: number;
  episodeId: number;
  date: string;
  status: string;
  endWeightKg: number | null;
  filteredWeightKg: number | null;
  modelVersion: string;
  createdAt: Date;
};

export type MigrationFreeStepperLifecycleV1 = {
  invalidationGeneration: number;
  productionPublishedGeneration: number | null;
  productionStaleFromDate: string | null;
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

function isCurrentResolutionRevision(event: MigrationFreeEnergyEventV1): boolean {
  const currentResolution = event.resolutions.find((row) => row.revision === event.resolutionRevision);
  return Number.isSafeInteger(event.resolutionRevision) && event.resolutionRevision >= 1
    && currentResolution !== undefined
    && currentResolution.resolutionFingerprint === event.currentResolutionFingerprint
    && currentResolution.source === event.currentSource
    && currentResolution.valueKcal === event.currentKcal
    && stableJson(currentResolution.provenance) === stableJson(event.currentProvenance);
}

function isCurrentUnavailableEvent(event: MigrationFreeEnergyEventV1): boolean {
  const provenance = event.currentProvenance;
  const expectedProvenance = {
    policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
    source: "unavailable",
    sourceIdentity: null,
    sourceFingerprint: null,
    evidence: null,
  };
  if (event.isStale || event.supersededByEventId !== null || event.currentSource !== "unavailable"
    || event.currentKcal !== null || typeof event.currentResolutionFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(event.currentResolutionFingerprint) || !isRecord(provenance)
    || stableJson(provenance) !== stableJson(expectedProvenance) || !isCurrentResolutionRevision(event)) return false;

  // Match the writer's exact JSON property order for the canonical unavailable
  // state; JSONB key order is irrelevant here because this is a known object.
  const expectedFingerprint = stableSha256(JSON.stringify({
    logicalEventKey: event.logicalEventKey,
    source: "unavailable",
    valueKcal: null,
    provenance: expectedProvenance,
  }));
  return event.currentResolutionFingerprint === expectedFingerprint
    && !event.candidates.some((candidate) => candidate.availability === "available"
      && candidate.valueKcal !== null && Number.isFinite(candidate.valueKcal) && candidate.valueKcal >= 0);
}

function activeEnergyCandidatePriority(eventKind: string, source: string): number {
  if (eventKind === "strength") {
    return source === "bodycast-strength-estimate" ? 0
      : source === "bodycast-strength-met-fallback" ? 1
        : source === "manual-kcal" ? 2
          : source === "device-kcal" ? 3 : 4;
  }
  if (eventKind === "stepper") {
    return source === "bodycast-stepper-mechanical" ? 0
      : source === "manual-kcal" ? 1
        : source === "device-kcal" ? 2 : 4;
  }
  return source === "manual-kcal" ? 0 : source === "device-kcal" ? 1 : 4;
}

function hasSelectableRawWorkoutEnergy(workoutIds: readonly number[], workoutsById: ReadonlyMap<number, MigrationFreeWorkoutV1>): boolean {
  return workoutIds.some((workoutId) => {
    const workout = workoutsById.get(workoutId);
    return workout !== undefined
      && [workout.manualActiveEnergyKcal, workout.activeEnergyKcal]
        .some((value) => value !== null && Number.isFinite(value) && value >= 0);
  });
}

function hasAvailableStepperShadow(
  workoutIds: readonly number[],
  shadowsByWorkoutId: ReadonlyMap<number, MigrationFreeStepperShadowV1>,
): boolean {
  return workoutIds.some((workoutId) => {
    const shadow = stepperShadowEvidence(shadowsByWorkoutId.get(workoutId));
    const estimatedKcal = shadow?.result.estimatedActiveKcal;
    return shadow?.result.availability === "available"
      && typeof estimatedKcal === "number" && Number.isFinite(estimatedKcal) && estimatedKcal >= 0;
  });
}

function stepperShadowEvidence(shadow: MigrationFreeStepperShadowV1 | undefined): {
  result: JsonObject;
  massReference: StepperMassProvenanceV1;
  inputFingerprint: string;
  sourceFingerprint: string;
} | null {
  if (!shadow || shadow.modelRevision !== EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION
    || !isRecord(shadow.result)) return null;
  const result = shadow.result;
  const inputFingerprint = result.inputFingerprint;
  const massReference = result.massReference;
  if (typeof inputFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(inputFingerprint)
    || !isRecord(massReference)) return null;
  const estimatorResult = {
    contractVersion: result.contractVersion,
    provenance: result.provenance,
    supportedDomain: result.supportedDomain,
    availability: result.availability,
    estimatedActiveKcal: result.estimatedActiveKcal,
    lowerBoundKcal: result.lowerBoundKcal,
    upperBoundKcal: result.upperBoundKcal,
    unavailableReason: result.unavailableReason,
    features: result.features,
    reasons: result.reasons,
    recoveryEnergy: result.recoveryEnergy,
    garminReferenceKcal: result.garminReferenceKcal,
  } as unknown as ExperimentalStepperActiveEnergyResultV1;
  if (estimatorResult.contractVersion !== EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION) return null;
  const sourceFingerprint = stepperActiveEnergyCandidateFingerprintV1(
    experimentalStepperActiveEnergyV1Fingerprint(estimatorResult), inputFingerprint,
  );
  if (shadow.sourceFingerprint !== sourceFingerprint) return null;
  return { result, massReference: massReference as unknown as StepperMassProvenanceV1, inputFingerprint, sourceFingerprint };
}

function stepperMassMatchesRawInputs(
  shadow: NonNullable<ReturnType<typeof stepperShadowEvidence>>,
  workout: MigrationFreeWorkoutV1 | undefined,
  event: MigrationFreeEnergyEventV1,
  observations: readonly StepperObservedMassInputV1[],
  episodes: readonly MigrationFreeModelEpisodeV1[],
  modelStates: readonly MigrationFreeDailyModelStateV1[],
  lifecycle: MigrationFreeStepperLifecycleV1 | null,
): boolean {
  if (!workout || !event.modelDate || !event.modelTimeZone) return false;
  const timeContext = episodeTimeContextForInstantV1(episodes, workout.startAt);
  if (timeContext.date !== event.modelDate || timeContext.timeZone !== event.modelTimeZone) return false;

  const episode = timeContext.episode;
  let modelEstimate: Parameters<typeof resolveStepperHistoricalMassV1>[0]["modelEstimate"] = null;
  if (episode !== null && event.modelDate >= episode.startDate
    && (episode.latestModeledDate === null || event.modelDate <= episode.latestModeledDate)) {
    if (event.modelDate === episode.startDate) {
      modelEstimate = {
        valueKg: episode.initialFilteredWeightKg,
        episodeId: episode.id,
        modelVersion: episode.modelVersion,
        sourceKind: "episode-initial",
        sourceId: `episode:${episode.id}:initial-mass`,
        sourceDate: episode.startDate,
        stateUpdatedAt: episode.createdAt ?? episode.updatedAt,
      };
    } else {
      const predecessorDate = addCalendarDays(event.modelDate, -1);
      const state = modelStates.find((row) => row.episodeId === episode.id && row.date === predecessorDate);
      const lifecycleCurrent = lifecycle !== null && lifecycle.productionPublishedGeneration !== null
        && (lifecycle.productionStaleFromDate === null || lifecycle.productionStaleFromDate > predecessorDate);
      const valueKg = state?.filteredWeightKg ?? state?.endWeightKg ?? null;
      if (lifecycleCurrent && state && state.status === "complete" && state.modelVersion === episode.modelVersion
        && valueKg !== null && Number.isFinite(valueKg) && valueKg > 0 && lifecycle !== null) {
        modelEstimate = {
          valueKg,
          episodeId: episode.id,
          modelVersion: episode.modelVersion,
          sourceKind: "predecessor-model",
          sourceId: `daily-model-state:${state.id}`,
          sourceDate: predecessorDate,
          stateUpdatedAt: state.createdAt,
          generation: lifecycle.invalidationGeneration,
        };
      }
    }
  }

  const resolved = resolveStepperHistoricalMassV1({
    workoutAt: workout.startAt,
    workoutDate: event.modelDate,
    timeZone: event.modelTimeZone,
    observations,
    modelEstimate,
  });
  return stableJson(resolved.provenance) === stableJson(shadow.massReference);
}

function strengthShadowEvidence(shadow: MigrationFreeStrengthShadowV1 | undefined): {
  result: JsonObject;
  inputFingerprint: string;
} | null {
  if (!shadow || shadow.modelRevision !== EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION
    || !isRecord(shadow.result)) return null;
  const result = shadow.result;
  const inputFingerprint = result.inputFingerprint;
  if (typeof inputFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(inputFingerprint)) return null;
  const estimatorResult = {
    contractVersion: result.contractVersion,
    provenance: result.provenance,
    supportedDomain: result.supportedDomain,
    availability: result.availability,
    estimatedActiveKcal: result.estimatedActiveKcal,
    lowerBoundKcal: result.lowerBoundKcal,
    upperBoundKcal: result.upperBoundKcal,
    unavailableReason: result.unavailableReason,
    features: result.features,
    reasons: result.reasons,
    recoveryEnergy: result.recoveryEnergy,
    garminReferenceKcal: result.garminReferenceKcal,
  } as unknown as ExperimentalStrengthActiveEnergyResultV1;
  if (estimatorResult.contractVersion !== EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION
    || shadow.sourceFingerprint !== stableSha256(`${experimentalStrengthActiveEnergyV1Fingerprint(estimatorResult)}|${inputFingerprint}`)) return null;
  return { result, inputFingerprint };
}

function isAvailableCurrentEvent(event: MigrationFreeEnergyEventV1): boolean {
  if (event.isStale || event.supersededByEventId !== null
    || event.currentSource === null || event.currentSource === "unavailable"
    || event.currentKcal === null || !Number.isFinite(event.currentKcal) || event.currentKcal < 0
    || typeof event.currentResolutionFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(event.currentResolutionFingerprint)) return false;

  const selected = event.currentProvenance;
  if (!isRecord(selected) || selected.policyVersion !== ACTIVE_ENERGY_SELECTION_POLICY_V1
    || selected.source !== event.currentSource
    || typeof selected.sourceIdentity !== "string" || selected.sourceIdentity.length === 0
    || typeof selected.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(selected.sourceFingerprint)
    || !isRecord(selected.evidence)) return false;

  const candidate = event.candidates.find((row) => row.source === event.currentSource
    && row.sourceIdentity === selected.sourceIdentity
    && row.sourceFingerprint === selected.sourceFingerprint
    && row.availability === "available"
    && row.valueKcal === event.currentKcal
    && isRecord(row.provenance)
    && stableJson(row.provenance) === stableJson(selected.evidence));
  if (!candidate) return false;

  if (!isCurrentResolutionRevision(event)) return false;

  // PostgreSQL JSONB does not preserve the writer's JSON.stringify key order,
  // so verify row consistency here and bind structured producer evidence to
  // the independently persisted estimator shadow below.

  return true;
}

type WorkoutSourceBindingContext = {
  expectedClassification: ReturnType<typeof canonicalizeWorkoutType>["classification"];
  workoutIds: readonly number[];
  workoutsById: ReadonlyMap<number, MigrationFreeWorkoutV1>;
  strengthSessionsById: ReadonlyMap<number, MigrationFreeStrengthSessionV1>;
  strengthAliasesBySourceId: ReadonlyMap<string, MigrationFreeWorkoutAliasV1[]>;
  stepperShadowsByWorkoutId: ReadonlyMap<number, MigrationFreeStepperShadowV1>;
  strengthShadowsBySessionId: ReadonlyMap<number, MigrationFreeStrengthShadowV1>;
  stepperDeviceSourceAllowed: boolean;
  stepperManualSourceWorkoutId: number | null;
  stepperDeviceSourceWorkoutId: number | null;
  massObservations: readonly StepperObservedMassInputV1[];
  modelEpisodes: readonly MigrationFreeModelEpisodeV1[];
  modelStates: readonly MigrationFreeDailyModelStateV1[];
  stepperLifecycle: MigrationFreeStepperLifecycleV1 | null;
};

function eventForCandidate(event: MigrationFreeEnergyEventV1, candidate: MigrationFreeEnergyCandidateV1): MigrationFreeEnergyEventV1 | null {
  if (!isRecord(candidate.provenance)) return null;
  return {
    ...event,
    currentSource: candidate.source,
    currentKcal: candidate.valueKcal,
    currentProvenance: {
      policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
      source: candidate.source,
      sourceIdentity: candidate.sourceIdentity,
      sourceFingerprint: candidate.sourceFingerprint,
      evidence: candidate.provenance,
    },
    candidates: [...event.candidates, candidate],
  };
}

function isCurrentWorkoutSourceBound(
  event: MigrationFreeEnergyEventV1,
  context: WorkoutSourceBindingContext,
): boolean {
  const { expectedClassification, workoutIds, workoutsById, strengthSessionsById,
    strengthAliasesBySourceId, stepperShadowsByWorkoutId, strengthShadowsBySessionId,
    massObservations, modelEpisodes, modelStates, stepperLifecycle } = context;
  const selected = event.currentProvenance;
  if (!isRecord(selected) || typeof selected.sourceIdentity !== "string"
    || typeof selected.sourceFingerprint !== "string" || !isRecord(selected.evidence)) return false;
  const evidence = selected.evidence;
  if (event.currentSource === "manual-kcal" || event.currentSource === "device-kcal") {
    if (typeof evidence.workoutId !== "number" || !workoutIds.includes(evidence.workoutId)) return false;
    if (expectedClassification === "stair-climbing"
      && (event.currentSource === "manual-kcal"
        ? evidence.workoutId !== context.stepperManualSourceWorkoutId
        : !context.stepperDeviceSourceAllowed || evidence.workoutId !== context.stepperDeviceSourceWorkoutId)) return false;
    const workout = workoutsById.get(evidence.workoutId);
    const expectedIdentity = `workout:${evidence.workoutId}:${event.currentSource === "manual-kcal" ? "manual" : "device"}`;
    const expectedEvidence = event.currentSource === "manual-kcal" ? "user-entered-workout" : "wearable-device";
    const candidate = event.candidates.find((row) => row.source === event.currentSource
      && row.sourceIdentity === expectedIdentity && row.sourceFingerprint === selected.sourceFingerprint);
    if (!workout || !candidate || evidence.source !== expectedEvidence) return false;
    const sourceValue = event.currentSource === "manual-kcal" ? workout.manualActiveEnergyKcal : workout.activeEnergyKcal;
    if (sourceValue === null || candidate.valueKcal !== sourceValue) return false;
    const prefix = event.currentSource === "manual-kcal" ? "manual" : "device";
    const allowedFingerprints = [
      stableSha256(`${prefix}|${workout.id}|${sourceValue}`),
      stableSha256(`${prefix}|${workout.id}|${sourceValue}|${workout.updatedAt.toISOString()}`),
    ];
    return allowedFingerprints.includes(candidate.sourceFingerprint);
  }

  if (event.currentSource === "bodycast-stepper-mechanical") {
    if (expectedClassification !== "stair-climbing") return false;
    const identity = selected.sourceIdentity;
    const direct = /^stepper-shadow:(\d+)$/.exec(identity);
    const manual = /^stepper-manual-steps:(\d+)$/.exec(identity);
    const workoutId = Number(direct?.[1] ?? manual?.[1]);
    if (!Number.isSafeInteger(workoutId) || !workoutIds.includes(workoutId)) return false;
    const candidate = event.candidates.find((row) => row.source === event.currentSource
      && row.sourceIdentity === identity && row.sourceFingerprint === selected.sourceFingerprint
      && row.availability === "available" && row.valueKcal === event.currentKcal && isRecord(row.provenance));
    if (!candidate) return false;
    if (direct) {
      const shadow = stepperShadowEvidence(stepperShadowsByWorkoutId.get(workoutId));
      if (!shadow || !stepperMassMatchesRawInputs(shadow, workoutsById.get(workoutId), event,
        massObservations, modelEpisodes, modelStates, stepperLifecycle)) return false;
      const massReference = stableStepperMassProvenanceV1(shadow.massReference);
      const expectedEvidence = {
        revision: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
        massReference,
      };
      return shadow.sourceFingerprint === selected.sourceFingerprint
        && shadow.result.availability === "available"
        && shadow.result.estimatedActiveKcal === event.currentKcal
        && evidence.revision === EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION
        && stableJson(evidence) === stableJson(expectedEvidence)
        && stableJson(candidate.provenance) === stableJson(expectedEvidence);
    }
    const workout = workoutsById.get(workoutId);
    const manualSourceWorkouts = workoutIds
      .map((memberId) => workoutsById.get(memberId))
      .filter((member): member is MigrationFreeWorkoutV1 =>
        member !== undefined && member.sourceIdentity?.startsWith(MANUAL_STEPPER_SOURCE_PREFIX) === true);
    if (!workout || workout.sourceIdentity?.startsWith(MANUAL_STEPPER_SOURCE_PREFIX) !== true
      || manualSourceWorkouts.length !== 1 || manualSourceWorkouts[0]!.id !== workoutId
      || workout.manualStepCount === null || workout.manualStepCount <= 0) return false;
    const matchingShadows = workoutIds.flatMap((representativeId) => {
      const shadow = stepperShadowEvidence(stepperShadowsByWorkoutId.get(representativeId));
      if (!shadow || !stepperMassMatchesRawInputs(shadow, workoutsById.get(representativeId), event,
        massObservations, modelEpisodes, modelStates, stepperLifecycle)
        || shadow.result.availability === "available") return [];
      const mechanicalKcal = adaptManualStepperEnergyV1({
        manualStepCount: workout.manualStepCount!,
        manualActiveEnergyKcal: null,
        bodyMassKg: shadow.massReference.valueKg,
      }).mechanicalKcal;
      if (mechanicalKcal === null || mechanicalKcal !== event.currentKcal
        || candidate.sourceFingerprint !== stableSha256(`${shadow.inputFingerprint}|manual-steps|${mechanicalKcal}`)) return [];
      const expectedEvidence = {
        source: "bodycast-manual-step-mechanical",
        workoutId,
        massReference: stableStepperMassProvenanceV1(shadow.massReference),
      };
      return evidence.source === "bodycast-manual-step-mechanical" && evidence.workoutId === workoutId
        && stableJson(evidence) === stableJson(expectedEvidence)
        && stableJson(candidate.provenance) === stableJson(expectedEvidence) ? [shadow] : [];
    });
    return matchingShadows.length === 1;
  }

  if (event.currentSource === "bodycast-strength-estimate") {
    if (expectedClassification !== "traditional-strength-training") return false;
    const match = /^strength-session:(\d+)$/.exec(selected.sourceIdentity);
    if (!match) return false;
    const sessionId = Number(match[1]);
    const session = strengthSessionsById.get(sessionId);
    const aliases = strengthAliasesBySourceId.get(String(sessionId)) ?? [];
    return Boolean(session && session.status === "COMPLETED" && session.matchStatus === "MATCHED"
      && session.matchedWorkoutId !== null && workoutIds.includes(session.matchedWorkoutId)
      && aliases.length === 1 && aliases[0]!.event.id === event.id
      && selectedStrengthCandidateIsCurrent(event, sessionId, session.currentSnapshotRevision ?? -1,
        strengthShadowsBySessionId.get(sessionId), session.verifiedEnergyMassReference));
  }

  if (event.currentSource === "bodycast-strength-met-fallback") {
    // Historical MET fallbacks depend on model-day RMR/mass and their exact
    // producer inputs. This read-only release contract does not reconstruct
    // those inputs, so never count them as provenance-verified acceptance.
    return false;
  }

  return false;
}

function currentProducerCandidates(
  event: MigrationFreeEnergyEventV1,
  context: WorkoutSourceBindingContext,
): MigrationFreeEnergyCandidateV1[] {
  const candidates: MigrationFreeEnergyCandidateV1[] = [];
  const groupWorkouts = context.workoutIds
    .map((workoutId) => context.workoutsById.get(workoutId))
    .filter((workout): workout is MigrationFreeWorkoutV1 => workout !== undefined);
  const rawSourceWorkouts = context.expectedClassification === "stair-climbing"
    ? [
      ...(context.stepperManualSourceWorkoutId === null ? [] : [context.workoutsById.get(context.stepperManualSourceWorkoutId)]),
      ...(context.stepperDeviceSourceWorkoutId === null ? [] : [context.workoutsById.get(context.stepperDeviceSourceWorkoutId)]),
    ].filter((workout): workout is MigrationFreeWorkoutV1 => workout !== undefined)
    : groupWorkouts;
  for (const workout of rawSourceWorkouts) {
    const rawCandidates = [
      ...((context.expectedClassification !== "stair-climbing"
        || workout.id === context.stepperManualSourceWorkoutId)
        && workout.manualActiveEnergyKcal !== null && Number.isFinite(workout.manualActiveEnergyKcal)
        && workout.manualActiveEnergyKcal >= 0
        ? [{ source: "manual-kcal", valueKcal: workout.manualActiveEnergyKcal,
          sourceIdentity: `workout:${workout.id}:manual`, prefix: "manual", sourceName: "user-entered-workout" }]
        : []),
      ...((context.expectedClassification !== "stair-climbing"
        || workout.id === context.stepperDeviceSourceWorkoutId)
        && workout.activeEnergyKcal !== null && Number.isFinite(workout.activeEnergyKcal)
        && workout.activeEnergyKcal >= 0
        ? [{ source: "device-kcal", valueKcal: workout.activeEnergyKcal,
          sourceIdentity: `workout:${workout.id}:device`, prefix: "device", sourceName: "wearable-device" }]
        : []),
    ];
    for (const candidate of rawCandidates) {
      candidates.push({
        source: candidate.source,
        sourceIdentity: candidate.sourceIdentity,
        sourceFingerprint: stableSha256(`${candidate.prefix}|${workout.id}|${candidate.valueKcal}|${workout.updatedAt.toISOString()}`),
        availability: "available",
        valueKcal: candidate.valueKcal,
        provenance: { source: candidate.sourceName, workoutId: workout.id },
      });
    }
  }
  if (context.expectedClassification === "stair-climbing") {
    for (const workoutId of context.workoutIds) {
      const workout = context.workoutsById.get(workoutId);
      const shadow = stepperShadowEvidence(context.stepperShadowsByWorkoutId.get(workoutId));
      if (!workout || !shadow || !stepperMassMatchesRawInputs(shadow, workout, event,
        context.massObservations, context.modelEpisodes, context.modelStates, context.stepperLifecycle)) continue;
      const estimate = shadow.result.estimatedActiveKcal;
      if (shadow.result.availability === "available" && typeof estimate === "number"
        && Number.isFinite(estimate) && estimate >= 0) {
        candidates.push({
          source: "bodycast-stepper-mechanical",
          sourceIdentity: `stepper-shadow:${workoutId}`,
          sourceFingerprint: shadow.sourceFingerprint,
          availability: "available",
          valueKcal: estimate,
          provenance: {
            revision: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
            massReference: stableStepperMassProvenanceV1(shadow.massReference),
          },
        });
      }
    }

    const manualWorkouts = context.workoutIds
      .map((workoutId) => context.workoutsById.get(workoutId))
      .filter((workout): workout is MigrationFreeWorkoutV1 => workout !== undefined
        && workout.sourceIdentity?.startsWith(MANUAL_STEPPER_SOURCE_PREFIX) === true
        && workout.manualStepCount !== null && workout.manualStepCount > 0);
    if (manualWorkouts.length === 1) {
      const manualWorkout = manualWorkouts[0]!;
      for (const representativeId of context.workoutIds) {
        const representative = context.workoutsById.get(representativeId);
        const shadow = stepperShadowEvidence(context.stepperShadowsByWorkoutId.get(representativeId));
        if (!representative || !shadow || shadow.result.availability === "available"
          || !stepperMassMatchesRawInputs(shadow, representative, event, context.massObservations,
            context.modelEpisodes, context.modelStates, context.stepperLifecycle)) continue;
        const mechanicalKcal = adaptManualStepperEnergyV1({
          manualStepCount: manualWorkout.manualStepCount!,
          manualActiveEnergyKcal: null,
          bodyMassKg: shadow.massReference.valueKg,
        }).mechanicalKcal;
        if (mechanicalKcal === null || !Number.isFinite(mechanicalKcal) || mechanicalKcal < 0) continue;
        candidates.push({
          source: "bodycast-stepper-mechanical",
          sourceIdentity: `stepper-manual-steps:${manualWorkout.id}`,
          sourceFingerprint: stableSha256(`${shadow.inputFingerprint}|manual-steps|${mechanicalKcal}`),
          availability: "available",
          valueKcal: mechanicalKcal,
          provenance: {
            source: "bodycast-manual-step-mechanical",
            workoutId: manualWorkout.id,
            massReference: stableStepperMassProvenanceV1(shadow.massReference),
          },
        });
      }
    }
  }

  if (context.expectedClassification === "traditional-strength-training") {
    for (const session of context.strengthSessionsById.values()) {
      if (session.status !== "COMPLETED" || session.matchStatus !== "MATCHED"
        || session.matchedWorkoutId === null || !context.workoutIds.includes(session.matchedWorkoutId)) continue;
      const aliases = context.strengthAliasesBySourceId.get(String(session.id)) ?? [];
      const shadow = strengthShadowEvidence(context.strengthShadowsBySessionId.get(session.id));
      const estimate = shadow?.result.estimatedActiveKcal;
      if (aliases.length !== 1 || aliases[0]!.event.id !== event.id || !shadow
        || shadow.result.availability !== "available" || typeof estimate !== "number"
        || !Number.isFinite(estimate) || estimate < 0) continue;
      candidates.push({
        source: "bodycast-strength-estimate",
        sourceIdentity: `strength-session:${session.id}`,
        sourceFingerprint: shadow.inputFingerprint,
        availability: "available",
        valueKcal: estimate,
        provenance: {
          estimator: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
          stage02MassReference: shadow.result.stage02MassReference ?? null,
          stage02SnapshotRevision: shadow.result.stage02SnapshotRevision ?? null,
          energyMassReference: shadow.result.energyMassReference ?? null,
          energyMassResolutionIdentity: shadow.result.energyMassResolutionIdentity ?? null,
          energyMassResolutionMethodVersion: shadow.result.energyMassResolutionMethodVersion ?? null,
        },
      });
    }
  }
  return candidates;
}

function isHighestPriorityCurrentCandidate(
  event: MigrationFreeEnergyEventV1,
  context: WorkoutSourceBindingContext,
): boolean {
  const selected = event.currentProvenance;
  if (!isRecord(selected) || typeof selected.sourceIdentity !== "string"
    || typeof selected.sourceFingerprint !== "string") return false;
  const deduplicated = new Map<string, MigrationFreeEnergyCandidateV1>();
  for (const candidate of [...event.candidates, ...currentProducerCandidates(event, context)]) {
    if (candidate.availability !== "available" || candidate.valueKcal === null
      || !Number.isFinite(candidate.valueKcal) || candidate.valueKcal < 0) continue;
    const key = `${candidate.source}\u0000${candidate.sourceIdentity}\u0000${candidate.sourceFingerprint}`;
    deduplicated.set(key, candidate);
  }
  const currentCandidates = [...deduplicated.values()].filter((candidate) => {
    const candidateEvent = eventForCandidate(event, candidate);
    return candidateEvent !== null && isCurrentWorkoutSourceBound(candidateEvent, context);
  });
  const winner = currentCandidates.sort((left, right) => activeEnergyCandidatePriority(event.eventKind, left.source)
    - activeEnergyCandidatePriority(event.eventKind, right.source)
    || left.sourceIdentity.localeCompare(right.sourceIdentity))[0];
  return winner !== undefined && winner.source === event.currentSource
    && winner.sourceIdentity === selected.sourceIdentity
    && winner.sourceFingerprint === selected.sourceFingerprint
    && winner.valueKcal === event.currentKcal;
}

function reconciliationMemberWorkoutIds(group: MigrationFreeStepperReconciliationGroupV1): number[] {
  const rows = group.status === "confirmed"
    ? group.candidates.filter((candidate) => candidate.candidateStatus === "confirmed")
    : group.status === "pending"
      ? group.candidates.filter((candidate) => candidate.candidateStatus === "pending")
      : [];
  return [...new Set(rows.flatMap((candidate) => [candidate.manualWorkoutId, candidate.garminWorkoutId]))]
    .sort((left, right) => left - right);
}

function isCurrentStepperProvenance(event: MigrationFreeEnergyEventV1, workoutIds: readonly number[]): boolean {
  if (!isAvailableCurrentEvent(event) || event.eventKind !== "stepper") return false;
  const selected = event.currentProvenance;
  if (!isRecord(selected) || typeof selected.sourceIdentity !== "string" || !isRecord(selected.evidence)) return false;

  const identity = selected.sourceIdentity;
  const evidence = selected.evidence;
  if (event.currentSource === "bodycast-stepper-mechanical") {
    const mass = evidence.massReference;
    const directEstimate = [...workoutIds].some((workoutId) => identity === `stepper-shadow:${workoutId}`)
      && evidence.revision === EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION;
    const manualStepsWorkoutId = Number(/^stepper-manual-steps:(\d+)$/.exec(identity)?.[1]);
    const manualStepsEstimate = workoutIds.includes(manualStepsWorkoutId)
      && evidence.source === "bodycast-manual-step-mechanical" && evidence.workoutId === manualStepsWorkoutId;
    return (directEstimate || manualStepsEstimate)
      && isRecord(mass)
      && ["observed", "model-estimated"].includes(String(mass.status))
      && mass.policyVersion === STEPPER_HISTORICAL_MASS_POLICY_V1
      && typeof mass.sourceType === "string" && mass.sourceType.length > 0
      && typeof mass.sourceId === "string" && mass.sourceId.length > 0
      && typeof mass.valueKg === "number" && Number.isFinite(mass.valueKg) && mass.valueKg > 0;
  }
  if (event.currentSource === "manual-kcal") {
    return [...workoutIds].some((workoutId) => identity === `workout:${workoutId}:manual`)
      && evidence.source === "user-entered-workout" && workoutIds.includes(Number(evidence.workoutId));
  }
  if (event.currentSource === "device-kcal") {
    return [...workoutIds].some((workoutId) => identity === `workout:${workoutId}:device`)
      && evidence.source === "wearable-device" && workoutIds.includes(Number(evidence.workoutId));
  }
  return false;
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
  shadowRecord: MigrationFreeStrengthShadowV1 | undefined,
  verifiedEnergyMassReference: unknown,
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
  const shadow = strengthShadowEvidence(shadowRecord);
  if (!candidate || event.currentSource !== candidate.source || event.currentKcal !== candidate.valueKcal
    || !shadow || candidate.sourceFingerprint !== shadow.inputFingerprint
    || shadow.result.availability !== "available"
    || shadow.result.estimatedActiveKcal !== candidate.valueKcal
    || !isRecord(candidate.provenance)
    || stableJson(selected.evidence) !== stableJson(candidate.provenance)) return false;

  const provenance = candidate.provenance;
  const expectedProvenance = {
    estimator: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    stage02MassReference: shadow.result.stage02MassReference ?? null,
    stage02SnapshotRevision: shadow.result.stage02SnapshotRevision ?? null,
    energyMassReference: shadow.result.energyMassReference ?? null,
    energyMassResolutionIdentity: shadow.result.energyMassResolutionIdentity ?? null,
    energyMassResolutionMethodVersion: shadow.result.energyMassResolutionMethodVersion ?? null,
  };
  if (stableJson(provenance) !== stableJson(expectedProvenance)) return false;
  if (!isRecord(verifiedEnergyMassReference)
    || stableJson(shadow.result.stage02MassReference) !== stableJson(verifiedEnergyMassReference.stage02MassReference)
    || stableJson(shadow.result.stage02SnapshotRevision) !== stableJson(verifiedEnergyMassReference.stage02SnapshotRevision)
    || stableJson(shadow.result.energyMassReference) !== stableJson(verifiedEnergyMassReference.energyMassReference)
    || stableJson(shadow.result.energyMassResolutionIdentity) !== stableJson(verifiedEnergyMassReference.energyMassResolutionIdentity)
    || stableJson(shadow.result.energyMassResolutionMethodVersion)
      !== stableJson(verifiedEnergyMassReference.energyMassResolutionMethodVersion)) return false;
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
  workouts: readonly MigrationFreeWorkoutV1[];
  stepperReconciliationGroups: readonly MigrationFreeStepperReconciliationGroupV1[];
  strengthSessions: readonly MigrationFreeStrengthSessionV1[];
  stepperShadows: readonly MigrationFreeStepperShadowV1[];
  strengthShadows: readonly MigrationFreeStrengthShadowV1[];
  massObservations: readonly StepperObservedMassInputV1[];
  modelEpisodes: readonly MigrationFreeModelEpisodeV1[];
  modelStates: readonly MigrationFreeDailyModelStateV1[];
  stepperLifecycle: MigrationFreeStepperLifecycleV1 | null;
}): { historicalWorkoutResolutions: number; currentWorkoutResolutions: number; historicalStepperResolutions: number; currentStepperResolutions: number; strengthSessionCurrent: true; diagnosticWorkoutId: number; targetStrengthSessionId: number } {
  // Keep the accepted source cohort stable while allowing later syncs to add
  // activities with either recent or historical occurrence timestamps.
  const historicalBaselineCutoff = new Date("2026-10-22T00:00:00.000Z");
  const currentWorkoutEventIds = new Set<number>();
  const currentStepperByWorkoutId = new Map<number, MigrationFreeEnergyEventV1>();
  const baselineWorkoutEventIds = new Set<number>();
  const baselineStepperEventIds = new Set<number>();
  const currentStepperEventIds = new Set<number>();
  const workoutAliasesBySourceId = new Map<string, MigrationFreeWorkoutAliasV1[]>();
  const canonicalEventKeysByEventId = new Map<number, string>();
  const workoutsById = new Map(input.workouts.map((workout) => [workout.id, workout]));
  const strengthSessionsById = new Map(input.strengthSessions.map((session) => [session.id, session]));
  const strengthAliasesBySourceId = new Map<string, MigrationFreeWorkoutAliasV1[]>();
  const reconciliationGroupsById = new Map(input.stepperReconciliationGroups.map((group) => [group.id, group]));
  const stepperShadowsByWorkoutId = new Map(input.stepperShadows.map((shadow) => [shadow.workoutId, shadow]));
  const strengthShadowsBySessionId = new Map(input.strengthShadows.map((shadow) => [shadow.sessionId, shadow]));

  for (const alias of input.workoutAliases) {
    if (alias.sourceType === "strength-session") {
      const rows = strengthAliasesBySourceId.get(alias.sourceId) ?? [];
      rows.push(alias);
      strengthAliasesBySourceId.set(alias.sourceId, rows);
      continue;
    }
    if (alias.sourceType !== "workout") continue;
    const rows = workoutAliasesBySourceId.get(alias.sourceId) ?? [];
    rows.push(alias);
    workoutAliasesBySourceId.set(alias.sourceId, rows);
  }

  for (const workout of input.workouts) {
    if (workout.hiddenFromHistory) continue;
    const aliases = workoutAliasesBySourceId.get(String(workout.id)) ?? [];
    if (aliases.length !== 1 || aliases[0]!.workoutId !== workout.id
      || aliases[0]!.workout === null || aliases[0]!.workout.type !== workout.type
      || aliases[0]!.workout.hiddenFromHistory) {
      throw new Error(`Migration-free serving is blocked: Workout ${workout.id} has a missing, duplicated, or mismatched canonical alias.`);
    }
    const event = aliases[0]!.event;
    const classification = canonicalizeWorkoutType(workout.type).classification;
    const expectedKind = classification === "traditional-strength-training" ? "strength"
      : classification === "stair-climbing" ? "stepper" : "other";
    let eventWorkoutIds = [workout.id];
    let reconciliationGroup: MigrationFreeStepperReconciliationGroupV1 | undefined;
    if (event.logicalEventKey !== `workout:${workout.id}`) {
      const reconciliationId = /^stepper-reconciliation:(\d+)$/.exec(event.logicalEventKey);
      const group = reconciliationId ? reconciliationGroupsById.get(Number(reconciliationId[1])) : undefined;
      const groupWorkoutIds = group ? reconciliationMemberWorkoutIds(group) : [];
      if (classification !== "stair-climbing" || !group || groupWorkoutIds.length < 2
        || !groupWorkoutIds.includes(workout.id)) {
        throw new Error(`Migration-free serving is blocked: Workout ${workout.id} has an invalid canonical event identity.`);
      }
      reconciliationGroup = group;
      eventWorkoutIds = groupWorkoutIds;
      for (const memberId of groupWorkoutIds) {
        const memberWorkout = workoutsById.get(memberId);
        const memberAliases = workoutAliasesBySourceId.get(String(memberId)) ?? [];
        if (!memberWorkout || memberWorkout.hiddenFromHistory
          || canonicalizeWorkoutType(memberWorkout.type).classification !== "stair-climbing"
          || memberAliases.length !== 1 || memberAliases[0]!.event.id !== event.id
          || memberAliases[0]!.event.logicalEventKey !== event.logicalEventKey) {
          throw new Error(`Migration-free serving is blocked: Stepper reconciliation ${group.id} does not have exactly one matching alias for each visible member Workout.`);
        }
      }
    }
    const existingEventKey = canonicalEventKeysByEventId.get(event.id);
    if (existingEventKey !== undefined && existingEventKey !== event.logicalEventKey) {
      throw new Error(`Migration-free serving is blocked: canonical event ${event.id} is linked to conflicting logical event keys.`);
    }
    canonicalEventKeysByEventId.set(event.id, event.logicalEventKey);

    const stepperDeviceSourceAllowed = !reconciliationGroup
      || (reconciliationGroup.status !== "pending" && reconciliationGroup.status !== "ambiguous");
    const sourceWorkouts = eventWorkoutIds
      .map((id) => workoutsById.get(id))
      .filter((row): row is MigrationFreeWorkoutV1 => row !== undefined);
    const stepperManualSource = classification === "stair-climbing"
      ? sourceWorkouts.find((row) => row.sourceIdentity?.startsWith(MANUAL_STEPPER_SOURCE_PREFIX) === true)
      : undefined;
    const stepperDeviceSource = classification === "stair-climbing" && stepperDeviceSourceAllowed
      ? sourceWorkouts.find((row) => row.id !== stepperManualSource?.id && row.activeEnergyKcal !== null)
      : undefined;
    const sourceContext: WorkoutSourceBindingContext = {
      expectedClassification: classification,
      workoutIds: eventWorkoutIds,
      workoutsById,
      strengthSessionsById,
      strengthAliasesBySourceId,
      stepperShadowsByWorkoutId,
      strengthShadowsBySessionId,
      stepperDeviceSourceAllowed,
      stepperManualSourceWorkoutId: stepperManualSource?.id ?? null,
      stepperDeviceSourceWorkoutId: stepperDeviceSource?.id ?? null,
      massObservations: input.massObservations,
      modelEpisodes: input.modelEpisodes,
      modelStates: input.modelStates,
      stepperLifecycle: input.stepperLifecycle,
    };
    const available = isAvailableCurrentEvent(event)
      && isCurrentWorkoutSourceBound(event, sourceContext)
      && isHighestPriorityCurrentCandidate(event, sourceContext);
    const postCutoffUnavailable = workout.createdAt >= historicalBaselineCutoff
      // This preflight does not load model-day RMR inputs needed to rule out
      // the Strength MET fallback, so Strength must fail closed when unavailable.
      && expectedKind !== "strength"
      && isCurrentUnavailableEvent(event)
      && !hasSelectableRawWorkoutEnergy(eventWorkoutIds, workoutsById)
      && (expectedKind !== "stepper" || !hasAvailableStepperShadow(eventWorkoutIds, stepperShadowsByWorkoutId))
      && currentProducerCandidates(event, sourceContext).length === 0;
    if (event.eventKind !== expectedKind || (!available && !postCutoffUnavailable)) {
      throw new Error(`Migration-free serving is blocked: Workout ${workout.id} lacks one current canonical resolution with matching identity, kind, and provenance.`);
    }
    if (postCutoffUnavailable && !available) continue;
    currentWorkoutEventIds.add(event.id);

    if (workout.createdAt < historicalBaselineCutoff) baselineWorkoutEventIds.add(event.id);
    if (classification === "stair-climbing") {
      if (!isCurrentStepperProvenance(event, eventWorkoutIds)) {
        throw new Error(`Migration-free serving is blocked: Stepper Workout ${workout.id} has stale, missing, or invalid canonical provenance.`);
      }
      currentStepperByWorkoutId.set(workout.id, event);
      currentStepperEventIds.add(event.id);
      if (workout.createdAt < historicalBaselineCutoff) baselineStepperEventIds.add(event.id);
    }
  }

  const unmatchedWorkoutAliases = [...workoutAliasesBySourceId.keys()]
    .filter((sourceId) => !input.workouts.some((workout) => !workout.hiddenFromHistory && String(workout.id) === sourceId)
      && (workoutAliasesBySourceId.get(sourceId) ?? []).some((alias) => alias.workout === null || !alias.workout.hiddenFromHistory));
  if (unmatchedWorkoutAliases.length > 0) {
    throw new Error("Migration-free serving is blocked: a canonical Workout alias has no matching visible raw Workout.");
  }
  if (baselineStepperEventIds.size !== 12) {
    throw new Error(`Migration-free serving is blocked: ${baselineStepperEventIds.size}/12 baseline historical Stepper resolutions are current and available.`);
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
    || !selectedStrengthCandidateIsCurrent(strengthEvent, targetSession.id, currentSnapshotRevision,
      strengthShadowsBySessionId.get(targetSession.id), targetSession.verifiedEnergyMassReference)) {
    throw new Error("Migration-free serving is blocked: the specified Strength session lacks the current BodyCast candidate and verified Health mass provenance.");
  }

  // A matched Strength session and its Workout are two aliases for one canonical
  // event. Keep that event out of the historical Workout total, which is
  // accepted separately from the target Strength resolution.
  const targetStrengthEventId = isMatched ? strengthEvent.id : null;
  const historicalWorkoutResolutions = baselineWorkoutEventIds.size
    - (targetStrengthEventId !== null && baselineWorkoutEventIds.has(targetStrengthEventId) ? 1 : 0);
  const currentWorkoutResolutions = currentWorkoutEventIds.size
    - (targetStrengthEventId !== null && currentWorkoutEventIds.has(targetStrengthEventId) ? 1 : 0);
  if (historicalWorkoutResolutions !== 33) {
    throw new Error(`Migration-free serving is blocked: ${historicalWorkoutResolutions}/33 baseline historical Workout resolutions are current and available after excluding the target Strength match.`);
  }

  const diagnosticWorkoutId = [...currentStepperByWorkoutId.keys()].sort((left, right) => left - right)[0];
  if (!diagnosticWorkoutId) {
    throw new Error("Migration-free serving is blocked: no current Stepper workout is available for the diagnostic route probe.");
  }
  return {
    historicalWorkoutResolutions,
    currentWorkoutResolutions,
    historicalStepperResolutions: baselineStepperEventIds.size,
    currentStepperResolutions: currentStepperEventIds.size,
    strengthSessionCurrent: true,
    diagnosticWorkoutId,
    targetStrengthSessionId: targetSession.id,
  };
}
