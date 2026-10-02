import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";
import {
  estimateExperimentalStepperActiveEnergyV1,
  EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
  experimentalStepperActiveEnergyV1Fingerprint,
} from "@/model/activity/experimental-stepper-active-energy-v1";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import type { WorkoutEnergyEvidenceV7 } from "@/model/activity/workout-energy-v7";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import {
  FIXED_STEPPER_EQUIPMENT_V7,
} from "@/model/activity/personal-stepper-reference-v7";
import { canonicalizeWorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import { addCalendarDays, calendarDayIndex } from "@/modules/model-episodes/model-calendar";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import {
  resolveStepperHistoricalMassV1,
  stableStepperMassProvenanceV1,
  stepperActiveEnergyCandidateFingerprintV1,
  stepperActiveEnergyInputFingerprintV1,
  type StepperObservedMassInputV1,
} from "@/model/activity/stepper-historical-mass-v1";
import { persistActiveEnergyCanonicalResolutionV1 } from "@/model/activity/active-energy-canonical.repository";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { adaptManualStepperEnergyV1 } from "@/modules/training/manual-stepper-fields-v1";
import { MANUAL_STEPPER_SOURCE_PREFIX } from "@/modules/health/workout-source-identity";

type ModelMassEpisodeV1 = {
  id: number;
  timezone: string;
  modelVersion: string;
  startDate: string;
  latestModeledDate: string | null;
  initialFilteredWeightKg: number;
  updatedAt: Date;
  createdAt?: Date;
};

function stableReconciliationPairs<T extends { manualWorkoutId: number; garminWorkoutId: number }>(pairs: readonly T[]): T[] {
  return [...pairs].sort((left, right) => left.manualWorkoutId - right.manualWorkoutId
    || left.garminWorkoutId - right.garminWorkoutId);
}

async function loadStepperModelMassContextV1(
  client: Prisma.TransactionClient | typeof prisma,
  input: { profileId: number; episode: ModelMassEpisodeV1 | null; workoutDate: string },
) {
  const episode = input.episode;
  if (episode === null || input.workoutDate < episode.startDate
      || (episode.latestModeledDate !== null && input.workoutDate > episode.latestModeledDate)) {
    return { modelState: null, lifecycle: null, modelEstimate: null };
  }
  if (input.workoutDate === episode.startDate) {
    const valueKg = episode.initialFilteredWeightKg;
    return {
      modelState: null,
      lifecycle: null,
      modelEstimate: Number.isFinite(valueKg) && valueKg > 0 ? {
        valueKg,
        episodeId: episode.id,
        modelVersion: episode.modelVersion,
        sourceKind: "episode-initial" as const,
        sourceId: `episode:${episode.id}:initial-mass`,
        sourceDate: episode.startDate,
        stateUpdatedAt: episode.createdAt ?? episode.updatedAt,
      } : null,
    };
  }
  const predecessorDate = addCalendarDays(input.workoutDate, -1);
  if (predecessorDate < episode.startDate) return { modelState: null, lifecycle: null, modelEstimate: null };
  const [modelState, lifecycle] = await Promise.all([
    client.dailyModelState.findUnique({
      where: { episodeId_date: { episodeId: episode.id, date: predecessorDate } },
      select: { id: true, date: true, status: true, endWeightKg: true, filteredWeightKg: true, modelVersion: true, createdAt: true },
    }),
    client.physiologyV7Lifecycle.findUnique({
      where: { profileId: input.profileId },
      select: { invalidationGeneration: true, productionPublishedGeneration: true, productionStaleFromDate: true },
    }),
  ]);
  const lifecycleCurrent = lifecycle !== null
    && lifecycle.productionPublishedGeneration !== null
    && (lifecycle.productionStaleFromDate === null || lifecycle.productionStaleFromDate > predecessorDate);
  const valueKg = modelState?.filteredWeightKg ?? modelState?.endWeightKg ?? null;
  const compatible = lifecycleCurrent
    && modelState !== null
    && modelState.status === "complete"
    && modelState.date === predecessorDate
    && modelState.modelVersion === episode.modelVersion
    && valueKg !== null && Number.isFinite(valueKg) && valueKg > 0;
  return {
    modelState,
    lifecycle,
    modelEstimate: compatible && modelState !== null && lifecycle !== null ? {
      valueKg,
      episodeId: episode.id,
      modelVersion: episode.modelVersion,
      sourceKind: "predecessor-model" as const,
      sourceId: `daily-model-state:${modelState.id}`,
      sourceDate: predecessorDate,
      stateUpdatedAt: modelState.createdAt,
      generation: lifecycle.invalidationGeneration,
    } : null,
  };
}

/**
 * Persists Stepper estimator evidence and resolves the canonical active-energy
 * event used by production readers. Candidate evidence remains separate from
 * the selected event value.
 */
export async function recordExperimentalStepperActiveEnergyShadow(input: {
  workoutId: number;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const reconciliationCandidates = await prisma.stepperReconciliationCandidate.findMany({
    where: {
      OR: [{ manualWorkoutId: input.workoutId }, { garminWorkoutId: input.workoutId }],
      group: { status: { in: ["pending", "ambiguous", "confirmed"] } },
    },
    orderBy: [{ groupId: "asc" }, { id: "asc" }],
    select: {
      manualWorkoutId: true,
      garminWorkoutId: true,
      candidateStatus: true,
      group: {
        select: {
          id: true,
          status: true,
          evaluationRevision: true,
          provisionalWorkoutId: true,
          sourceRevision: true,
          candidates: {
            orderBy: [{ manualWorkoutId: "asc" }, { garminWorkoutId: "asc" }],
            select: { manualWorkoutId: true, garminWorkoutId: true, candidateStatus: true },
          },
        },
      },
    },
  });
  const reconciliation = reconciliationCandidates[0] ?? null;
  const group = reconciliation?.group ?? null;
  const groupPairsRaw = group === null ? [] : group.status === "confirmed"
    ? group.candidates.filter((pair) => pair.candidateStatus === "confirmed")
    : group.status === "pending"
      ? group.candidates.filter((pair) => pair.candidateStatus === "pending")
      : group.candidates;
  const groupPairs = stableReconciliationPairs(groupPairsRaw);
  const groupWorkoutIds = [...new Set(groupPairs.flatMap((pair) => [pair.manualWorkoutId, pair.garminWorkoutId]))].sort((a, b) => a - b);
  const representativeWorkoutId = group === null
    ? input.workoutId
    : group.status === "confirmed"
      ? groupPairs.find((pair) => pair.candidateStatus === "confirmed")?.garminWorkoutId ?? reconciliation?.garminWorkoutId ?? input.workoutId
      : group.status === "pending"
        ? group.provisionalWorkoutId ?? reconciliation?.manualWorkoutId ?? input.workoutId
        : groupWorkoutIds[0] ?? input.workoutId;
  const workout = await prisma.workout.findUnique({
    where: { id: representativeWorkoutId, hiddenFromHistory: false },
    select: {
      id: true,
      type: true,
      startAt: true,
      endAt: true,
      durationMinutes: true,
      activeEnergyKcal: true,
      manualActiveEnergyKcal: true,
      manualStepCount: true,
      updatedAt: true,
      sourceIdentity: true,
    },
  });
  if (workout === null) return;
  const groupWorkouts = groupWorkoutIds.length === 0 ? [workout] : await prisma.workout.findMany({
    where: { id: { in: groupWorkoutIds }, hiddenFromHistory: false },
    select: {
      id: true, type: true, startAt: true, endAt: true, durationMinutes: true,
      activeEnergyKcal: true, manualActiveEnergyKcal: true, manualStepCount: true,
      sourceIdentity: true, updatedAt: true,
    },
    orderBy: { id: "asc" },
  });

  const canonical = canonicalizeWorkoutType(workout.type);
  if (canonical.classification !== "stair-climbing" || canonical.canonicalType === null) return;

  const episodeRows = await prisma.modelEpisode.findMany({
    where: { profileId },
    select: {
      id: true, timezone: true, modelVersion: true, startDate: true, latestModeledDate: true,
      initialFilteredWeightKg: true, updatedAt: true, createdAt: true, active: true,
    },
    orderBy: { startDate: "asc" },
  });
  const resolvedEpisode = episodeTimeContextForInstantV1(episodeRows, workout.startAt);
  const episode = resolvedEpisode.episode;
  const modelTimeZone = episode?.timezone ?? DEFAULT_TIME_ZONE;
  const workoutDate = resolvedEpisode.date;
  const fromDate = addCalendarDays(workoutDate, -7);
  const throughDate = addCalendarDays(workoutDate, 7);
  const observedStart = localDateTimeToInstant(fromDate, "00:00", modelTimeZone);
  const observedEnd = localDateTimeToInstant(addCalendarDays(throughDate, 1), "00:00", modelTimeZone);

  const [snapshots, stepIntervals, heartRateSamples, timestampedWeights, dailyWeights, modelMassContext] = await Promise.all([
    prisma.healthSyncSnapshot.findMany({
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { id: true, receivedAt: true, syncedAt: true, steps: true },
    }),
    prisma.healthActivityInterval.findMany({
      where: {
        metric: "steps",
        startAt: { lt: workout.endAt },
        endAt: { gt: workout.startAt },
      },
      select: { id: true, startAt: true, endAt: true, value: true },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
    }),
    prisma.heartRateSample.findMany({
      where: {
        profileId,
        timestamp: { gte: workout.startAt, lte: workout.endAt },
      },
      select: { timestamp: true, bpm: true, source: true },
      orderBy: { timestamp: "asc" },
    }),
    prisma.healthMetricSample.findMany({
      where: { metric: "weight-kg", source: "apple-health-shortcut", timestamp: { gte: observedStart, lt: observedEnd } },
      select: { id: true, date: true, timestamp: true, value: true, createdAt: true },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    }),
    prisma.dailyHealthData.findMany({
      where: { date: { gte: fromDate, lte: throughDate }, weightKg: { not: null } },
      select: { date: true, weightKg: true, updatedAt: true },
      orderBy: { date: "asc" },
    }),
    loadStepperModelMassContextV1(prisma, { profileId, episode, workoutDate }),
  ]);

  const observations: StepperObservedMassInputV1[] = [
    ...timestampedWeights.map((sample) => ({
      sourceType: "health-metric-sample" as const,
      sourceId: String(sample.id),
      valueKg: sample.value.toNumber(),
      timestamp: sample.timestamp,
      date: sample.date,
    })),
    ...dailyWeights.flatMap((row) => row.weightKg === null ? [] : [{
      sourceType: "daily-health-data" as const,
      sourceId: row.date,
      valueKg: row.weightKg,
      timestamp: null,
      date: row.date,
    }]),
  ];
  const mass = resolveStepperHistoricalMassV1({
    workoutAt: workout.startAt,
    workoutDate,
    timeZone: modelTimeZone,
    observations,
    modelEstimate: modelMassContext.modelEstimate,
  });

  const startAt = workout.startAt.toISOString();
  const endAt = workout.endAt.toISOString();
  const heartRate = canonicalizeWorkoutHeartRateEvidenceV7({
    workoutInterval: { startAt, endAt },
    heartRate: heartRateSamples.length === 0
      ? { availability: "unavailable" }
      : {
        availability: "loaded",
        samples: heartRateSamples.map((sample) => ({
          timestamp: sample.timestamp.toISOString(),
          bpm: sample.bpm,
          provenance: { provider: sample.source, device: null },
        })),
      },
  });
  const workoutEnergy: WorkoutEnergyEvidenceV7 = {
    workoutId: workout.id,
    canonicalWorkoutType: canonical.canonicalType,
    startAt,
    endAt,
    durationMinutes: workout.durationMinutes,
    deviceEnergy: workout.activeEnergyKcal === null
      ? { availability: "unavailable", availabilityReason: "no-device-active-energy" }
      : {
        availability: "available",
        sourceValueStatus: "observed",
        valueKcal: workout.activeEnergyKcal,
        semantics: "active",
        provenance: "device-estimate",
      },
    heartRate,
  };
  const evidence = canonicalizeWorkoutStepperEvidenceV7({
    workoutEnergy,
    snapshots: snapshots.map((snapshot) => ({
      id: snapshot.id,
      receivedAt: snapshot.receivedAt.toISOString(),
      syncedAt: snapshot.syncedAt?.toISOString() ?? null,
      steps: snapshot.steps,
    })),
    stepIntervals: stepIntervals.map((interval) => ({
      id: interval.id,
      startAt: interval.startAt.toISOString(),
      endAt: interval.endAt.toISOString(),
      stepCount: interval.value.toNumber(),
    })),
  });
  const equipment = FIXED_STEPPER_EQUIPMENT_V7;
  const result = estimateExperimentalStepperActiveEnergyV1({
    workout: evidence,
    bodyMassKg: mass.massKg,
    equipment,
  });
  const fingerprintInputs = {
    workout: { id: workout.id, type: workout.type, sourceIdentity: workout.sourceIdentity, startAt, endAt, durationMinutes: workout.durationMinutes, activeEnergyKcal: workout.activeEnergyKcal, manualActiveEnergyKcal: workout.manualActiveEnergyKcal, manualStepCount: workout.manualStepCount, updatedAt: workout.updatedAt.toISOString() },
    modelContext: { episodeId: episode?.id ?? null, modelVersion: episode?.modelVersion ?? null, modelDate: workoutDate, modelTimeZone },
    reconciliation: group === null ? null : {
      id: group.id, status: group.status, evaluationRevision: group.evaluationRevision,
      sourceRevision: group.sourceRevision, provisionalWorkoutId: group.provisionalWorkoutId,
      members: groupWorkouts.map((row) => [row.id, row.type, row.sourceIdentity, row.startAt.toISOString(), row.endAt.toISOString(), row.durationMinutes, row.activeEnergyKcal, row.manualActiveEnergyKcal, row.manualStepCount, row.updatedAt.toISOString()]),
    },
    massProvenance: stableStepperMassProvenanceV1(mass.provenance),
    snapshots: snapshots.map((row) => [row.id, row.receivedAt.toISOString(), row.syncedAt?.toISOString() ?? null, row.steps]),
    stepIntervals: stepIntervals.map((row) => [row.id, row.startAt.toISOString(), row.endAt.toISOString(), row.value.toString()]),
    heartRate: heartRateSamples.map((row) => [row.timestamp.toISOString(), row.bpm, row.source]),
    weightSamples: timestampedWeights.map((row) => [row.id, row.timestamp.toISOString(), row.value.toString(), row.createdAt.toISOString()]),
    dailyWeights: dailyWeights.map((row) => [row.date, row.weightKg, row.updatedAt.toISOString()]),
    modelMassContext: {
      modelState: modelMassContext.modelState ? [modelMassContext.modelState.id, modelMassContext.modelState.date, modelMassContext.modelState.status, modelMassContext.modelState.modelVersion, modelMassContext.modelState.filteredWeightKg, modelMassContext.modelState.endWeightKg] : null,
      lifecycle: modelMassContext.lifecycle ? [modelMassContext.lifecycle.productionPublishedGeneration !== null, modelMassContext.lifecycle.productionStaleFromDate] : null,
      initialMassKg: episode?.initialFilteredWeightKg ?? null,
    },
  };
  const rawCandidateFingerprint = stepperActiveEnergyInputFingerprintV1(fingerprintInputs);
  const inputFingerprint = rawCandidateFingerprint;
  const sourceFingerprint = stepperActiveEnergyCandidateFingerprintV1(
    experimentalStepperActiveEnergyV1Fingerprint(result), inputFingerprint,
  );
  const persisted = { ...result, massReference: mass.provenance, inputFingerprint };
  const manualSource = groupWorkouts.find((row) => row.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX)) ?? null;
  const deviceSource = group?.status === "pending" || group?.status === "ambiguous"
    ? null
    : groupWorkouts.find((row) => row.id !== manualSource?.id && row.activeEnergyKcal !== null) ?? null;
  const manualMechanical = manualSource?.manualStepCount === null || manualSource?.manualStepCount === undefined
    ? null
    : adaptManualStepperEnergyV1({ manualStepCount: manualSource.manualStepCount, manualActiveEnergyKcal: null, bodyMassKg: mass.massKg }).mechanicalKcal;
  const candidates = group?.status === "ambiguous" ? [] : [
    ...(result.availability === "available" && result.estimatedActiveKcal !== null && mass.massKg !== null
      ? [{ source: "bodycast-stepper-mechanical" as const, sourceIdentity: `stepper-shadow:${workout.id}`, sourceFingerprint, valueKcal: result.estimatedActiveKcal, provenance: { revision: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION, massReference: stableStepperMassProvenanceV1(mass.provenance) } }]
      : []),
    ...(result.availability !== "available" && manualMechanical !== null && Number.isFinite(manualMechanical)
      ? [{ source: "bodycast-stepper-mechanical" as const, sourceIdentity: `stepper-manual-steps:${manualSource!.id}`, sourceFingerprint: stableSha256(`${inputFingerprint}|manual-steps|${manualMechanical}`), valueKcal: manualMechanical, provenance: { source: "bodycast-manual-step-mechanical", workoutId: manualSource!.id, massReference: stableStepperMassProvenanceV1(mass.provenance) } }]
      : []),
    ...(manualSource?.manualActiveEnergyKcal !== null && manualSource?.manualActiveEnergyKcal !== undefined
      ? [{ source: "manual-kcal" as const, sourceIdentity: `workout:${manualSource.id}:manual`, sourceFingerprint: stableSha256(`manual|${manualSource.id}|${manualSource.manualActiveEnergyKcal}|${manualSource.updatedAt.toISOString()}`), valueKcal: manualSource.manualActiveEnergyKcal, provenance: { source: "user-entered-workout", workoutId: manualSource.id } }]
      : []),
    ...(deviceSource?.activeEnergyKcal !== null && deviceSource?.activeEnergyKcal !== undefined
      ? [{ source: "device-kcal" as const, sourceIdentity: `workout:${deviceSource.id}:device`, sourceFingerprint: stableSha256(`device|${deviceSource.id}|${deviceSource.activeEnergyKcal}|${deviceSource.updatedAt.toISOString()}`), valueKcal: deviceSource.activeEnergyKcal, provenance: { source: "wearable-device", workoutId: deviceSource.id } }]
      : []),
  ];
  await prisma.$transaction(async (tx) => {
    await tx.experimentalStepperActiveEnergyShadow.upsert({
      where: { workoutId: workout.id },
      create: {
        workoutId: workout.id,
        profileId,
        sourceFingerprint,
        modelRevision: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
        features: result.features,
        result: persisted as unknown as Prisma.InputJsonValue,
      },
      update: {
        sourceFingerprint,
        modelRevision: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
        features: result.features,
        result: persisted as unknown as Prisma.InputJsonValue,
      },
    });
    const resolution = await persistActiveEnergyCanonicalResolutionV1(tx, {
    profileId,
    logicalEventKey: group === null ? `workout:${workout.id}` : `stepper-reconciliation:${group.id}`,
    eventKind: "stepper",
    occurrenceAt: workout.startAt,
    modelDate: workoutDate,
    modelTimeZone,
    inputFingerprint,
    aliases: (groupWorkoutIds.length === 0 ? [workout.id] : groupWorkoutIds).map((workoutId) => ({
      sourceType: "workout" as const, sourceId: String(workoutId), workoutId,
    })),
    candidates,
    validateSource: async (tx) => {
      const currentWorkout = await tx.workout.findUnique({
        where: { id: workout.id },
        select: { id: true, type: true, sourceIdentity: true, startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true, manualActiveEnergyKcal: true, manualStepCount: true, updatedAt: true },
      });
      if (currentWorkout === null) return false;
      let currentReconciliation: typeof fingerprintInputs.reconciliation = null;
      let currentMembers: typeof groupWorkouts = [currentWorkout];
      if (group !== null) {
        const currentGroup = await tx.stepperReconciliationGroup.findUnique({
          where: { id: group.id },
          select: {
            id: true, status: true, evaluationRevision: true, provisionalWorkoutId: true, sourceRevision: true,
            candidates: {
              orderBy: [{ manualWorkoutId: "asc" }, { garminWorkoutId: "asc" }],
              select: { manualWorkoutId: true, garminWorkoutId: true, candidateStatus: true },
            },
          },
        });
        if (!currentGroup || currentGroup.status !== group.status || currentGroup.evaluationRevision !== group.evaluationRevision
            || currentGroup.provisionalWorkoutId !== group.provisionalWorkoutId || currentGroup.sourceRevision !== group.sourceRevision) return false;
        const activePairs = currentGroup.status === "confirmed"
          ? currentGroup.candidates.filter((pair) => pair.candidateStatus === "confirmed")
          : currentGroup.status === "pending"
            ? currentGroup.candidates.filter((pair) => pair.candidateStatus === "pending")
            : currentGroup.candidates;
        if (JSON.stringify(stableReconciliationPairs(activePairs)) !== JSON.stringify(groupPairs)) return false;
        const memberIds = [...new Set(activePairs.flatMap((pair) => [pair.manualWorkoutId, pair.garminWorkoutId]))].sort((a, b) => a - b);
        if (JSON.stringify(memberIds) !== JSON.stringify(groupWorkoutIds)) return false;
        currentMembers = await tx.workout.findMany({
          where: { id: { in: memberIds }, hiddenFromHistory: false },
          select: { id: true, type: true, sourceIdentity: true, startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true, manualActiveEnergyKcal: true, manualStepCount: true, updatedAt: true },
          orderBy: { id: "asc" },
        });
        if (currentMembers.length !== groupWorkouts.length) return false;
        currentReconciliation = {
          id: currentGroup.id,
          status: currentGroup.status,
          evaluationRevision: currentGroup.evaluationRevision,
          sourceRevision: currentGroup.sourceRevision,
          provisionalWorkoutId: currentGroup.provisionalWorkoutId,
          members: currentMembers.map((row) => [row.id, row.type, row.sourceIdentity, row.startAt.toISOString(), row.endAt.toISOString(), row.durationMinutes, row.activeEnergyKcal, row.manualActiveEnergyKcal, row.manualStepCount, row.updatedAt.toISOString()]),
        };
      }
      const [currentSnapshots, currentIntervals, currentHr, currentTimestampedWeights, currentDailyWeights, currentEpisodeRows] = await Promise.all([
        tx.healthSyncSnapshot.findMany({ orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, receivedAt: true, syncedAt: true, steps: true } }),
        tx.healthActivityInterval.findMany({ where: { metric: "steps", startAt: { lt: workout.endAt }, endAt: { gt: workout.startAt } }, select: { id: true, startAt: true, endAt: true, value: true }, orderBy: [{ startAt: "asc" }, { id: "asc" }] }),
        tx.heartRateSample.findMany({ where: { profileId, timestamp: { gte: workout.startAt, lte: workout.endAt } }, select: { timestamp: true, bpm: true, source: true }, orderBy: { timestamp: "asc" } }),
        tx.healthMetricSample.findMany({ where: { metric: "weight-kg", source: "apple-health-shortcut", timestamp: { gte: observedStart, lt: observedEnd } }, select: { id: true, date: true, timestamp: true, value: true, createdAt: true }, orderBy: [{ timestamp: "asc" }, { id: "asc" }] }),
        tx.dailyHealthData.findMany({ where: { date: { gte: fromDate, lte: throughDate }, weightKg: { not: null } }, select: { date: true, weightKg: true, updatedAt: true }, orderBy: { date: "asc" } }),
        tx.modelEpisode.findMany({
          where: { profileId },
          select: {
            id: true, timezone: true, modelVersion: true, active: true, startDate: true, latestModeledDate: true,
            initialFilteredWeightKg: true, updatedAt: true, createdAt: true,
          },
          orderBy: { startDate: "asc" },
        }),
      ]);
      const currentResolvedEpisode = episodeTimeContextForInstantV1(currentEpisodeRows, workout.startAt);
      const currentEpisode = currentResolvedEpisode.episode;
      if (episode !== null && (!currentEpisode || currentEpisode.timezone !== episode.timezone
          || currentEpisode.id !== episode.id || currentEpisode.modelVersion !== episode.modelVersion || currentEpisode.startDate !== episode.startDate
          || currentEpisode.latestModeledDate !== episode.latestModeledDate
          || currentEpisode.initialFilteredWeightKg !== episode.initialFilteredWeightKg)) return false;
      const currentModelMassContext = await loadStepperModelMassContextV1(tx, {
        profileId,
        episode: currentEpisode === null ? null : {
          ...currentEpisode,
          initialFilteredWeightKg: currentEpisode.initialFilteredWeightKg,
        },
        workoutDate,
      });
      const currentFingerprint = stableSha256(JSON.stringify({
        workout: { id: currentWorkout.id, type: currentWorkout.type, sourceIdentity: currentWorkout.sourceIdentity, startAt: currentWorkout.startAt.toISOString(), endAt: currentWorkout.endAt.toISOString(), durationMinutes: currentWorkout.durationMinutes, activeEnergyKcal: currentWorkout.activeEnergyKcal, manualActiveEnergyKcal: currentWorkout.manualActiveEnergyKcal, manualStepCount: currentWorkout.manualStepCount, updatedAt: currentWorkout.updatedAt.toISOString() },
        modelContext: { episodeId: currentEpisode?.id ?? null, modelVersion: currentEpisode?.modelVersion ?? null, modelDate: workoutDate, modelTimeZone },
        reconciliation: currentReconciliation,
        massProvenance: stableStepperMassProvenanceV1(mass.provenance),
        snapshots: currentSnapshots.map((row) => [row.id, row.receivedAt.toISOString(), row.syncedAt?.toISOString() ?? null, row.steps]),
        stepIntervals: currentIntervals.map((row) => [row.id, row.startAt.toISOString(), row.endAt.toISOString(), row.value.toString()]),
        heartRate: currentHr.map((row) => [row.timestamp.toISOString(), row.bpm, row.source]),
        weightSamples: currentTimestampedWeights.map((row) => [row.id, row.timestamp.toISOString(), row.value.toString(), row.createdAt.toISOString()]),
        dailyWeights: currentDailyWeights.map((row) => [row.date, row.weightKg, row.updatedAt.toISOString()]),
        modelMassContext: {
          modelState: currentModelMassContext.modelState ? [currentModelMassContext.modelState.id, currentModelMassContext.modelState.date, currentModelMassContext.modelState.status, currentModelMassContext.modelState.modelVersion, currentModelMassContext.modelState.filteredWeightKg, currentModelMassContext.modelState.endWeightKg] : null,
          lifecycle: currentModelMassContext.lifecycle ? [currentModelMassContext.lifecycle.productionPublishedGeneration !== null, currentModelMassContext.lifecycle.productionStaleFromDate] : null,
          initialMassKg: currentEpisode?.initialFilteredWeightKg ?? null,
        },
      }));
      return currentFingerprint === inputFingerprint
        && currentModelMassContext.lifecycle?.invalidationGeneration === modelMassContext.lifecycle?.invalidationGeneration;
    },
  });
    if (!resolution.current) throw new Error("stepper source changed before canonical active-energy publication");
  });
}

export async function recordExperimentalStepperActiveEnergyShadowsForLocalDate(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const workouts = await prisma.workout.findMany({
    where: {
      hiddenFromHistory: false,
      dailyHealthData: { date: input.date },
    },
    select: { id: true, type: true },
  });
  for (const workout of workouts) {
    if (canonicalizeWorkoutType(workout.type).classification !== "stair-climbing") continue;
    await recordExperimentalStepperActiveEnergyShadow({ workoutId: workout.id, profileId });
  }
}

export async function recordExperimentalStepperActiveEnergyShadowsForWorkouts(input: {
  workoutIds: readonly number[];
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  for (const workoutId of [...new Set(input.workoutIds)].sort((left, right) => left - right)) {
    await recordExperimentalStepperActiveEnergyShadow({ workoutId, profileId });
  }
}

export async function recordExperimentalStepperActiveEnergyShadowsForMassWindow(input: {
  measurementDates?: readonly string[];
  measurementInstants?: readonly Date[];
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const episodes = await prisma.modelEpisode.findMany({
    where: { profileId },
    select: {
      id: true, timezone: true, modelVersion: true, startDate: true, latestModeledDate: true,
      initialFilteredWeightKg: true, updatedAt: true, createdAt: true, active: true,
    },
    orderBy: { startDate: "asc" },
  });
  const measurementDates = input.measurementDates ?? [];
  const measurementInstants = input.measurementInstants ?? [];
  if (measurementDates.length === 0 && measurementInstants.length === 0) return;
  const workouts = await prisma.workout.findMany({
    where: { hiddenFromHistory: false, type: { equals: "Stair Climbing", mode: "insensitive" } },
    select: { id: true, startAt: true },
  });
  for (const workout of workouts) {
    const context = episodeTimeContextForInstantV1(episodes, workout.startAt);
    const workoutDate = context.date;
    const workoutDay = calendarDayIndex(workoutDate);
    const dateMatch = measurementDates.some((date) => Math.abs(calendarDayIndex(date) - workoutDay) <= 7);
    const instantMatch = measurementInstants.some((instant) => {
      // Timestamped observations are normalized in the target workout's
      // episode timezone, matching the transactional invalidation contract.
      const measurementDate = instantToLocalDateTime(instant, context.timeZone).date;
      return Math.abs(calendarDayIndex(measurementDate) - workoutDay) <= 7;
    });
    if (dateMatch || instantMatch) {
      await recordExperimentalStepperActiveEnergyShadow({ workoutId: workout.id, profileId });
    }
  }
}
