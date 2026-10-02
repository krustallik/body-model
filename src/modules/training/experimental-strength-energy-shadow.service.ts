import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { calculateStrengthActivity } from "@/model/activity/strength";
import { localDateTimeToInstant, DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import { persistActiveEnergyCanonicalResolutionV1, type ActiveEnergyCandidateV1 } from "@/model/activity/active-energy-canonical.repository";
import { resolveEventEnergyV1 } from "@/model/activity/canonical-activity-policy-v1";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type { StrengthSessionDto } from "./training.types";
import { TrainingRepository } from "./training.repository";
import {
  estimateExperimentalStrengthActiveEnergyV1,
  EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  experimentalStrengthActiveEnergyV1Fingerprint,
} from "./experimental-strength-active-energy-v1";
import {
  strengthInputFingerprintV1,
  strengthModelDayFingerprintInputsV1,
  strengthPublicationDecisionV1,
  strengthSetFingerprintV1,
} from "./strength-publication-v1";

/**
 * Persists Strength estimator evidence and its canonical source resolution.
 * Experimental estimates remain candidate evidence; production readers use
 * only the resolved event value and never add it to device kcal.
 */
export async function recordExperimentalStrengthEnergyShadow(input: {
  session: StrengthSessionDto;
  profileId: number;
}): Promise<void> {
  const interval = input.session.matchedWorkout ?? (input.session.webStartedAt && input.session.webEndedAt
    ? { startAt: input.session.webStartedAt, endAt: input.session.webEndedAt }
    : null);
  const [heartRateBpms] = await Promise.all([
    interval === null
      ? Promise.resolve([] as number[])
      : prisma.heartRateSample.findMany({
        where: {
          profileId: input.profileId,
          timestamp: { gte: new Date(interval.startAt), lte: new Date(interval.endAt) },
        },
        select: { bpm: true },
        orderBy: { timestamp: "asc" },
      }).then((rows) => rows.map((row) => row.bpm)),
  ]);
  const stage02Mass = input.session.activeEnergyMassReference ?? null;
  const bodyMassKg = stage02Mass !== null && stage02Mass.reference.status !== "unavailable"
      && Number.isFinite(stage02Mass.reference.valueKg) && stage02Mass.reference.valueKg > 0
    ? stage02Mass.reference.valueKg
    : null;
  const result = estimateExperimentalStrengthActiveEnergyV1({
    session: input.session,
    bodyMassKg,
    heartRateBpms,
  });
  const occurrenceAt = new Date(input.session.matchedWorkout?.startAt
    ?? input.session.effectiveAccountingAt ?? input.session.webStartedAt ?? input.session.createdAt);
  const episodeRows = await prisma.modelEpisode.findMany({
    where: { profileId: input.profileId },
    select: { id: true, timezone: true, modelVersion: true, startDate: true, latestModeledDate: true, active: true, updatedAt: true },
    orderBy: { startDate: "asc" },
  });
  const eventTimeContext = episodeTimeContextForInstantV1(episodeRows, occurrenceAt);
  const episode = eventTimeContext.episode;
  const modelTimeZone = eventTimeContext.timeZone;
  const modelDate = eventTimeContext.date;
  const durationMinutes = input.session.matchedWorkout?.durationMinutes
    ?? (interval === null ? null : Math.max(0, (Date.parse(interval.endAt) - Date.parse(interval.startAt)) / 60_000));
  const modelDay = episode !== null && modelDate >= episode.startDate
      && (episode.latestModeledDate === null || modelDate <= episode.latestModeledDate)
    ? await prisma.dailyModelState.findUnique({
      where: { episodeId_date: { episodeId: episode.id, date: modelDate } },
      select: { status: true, dynamicRmrKcalPerDay: true, updatedAt: true, modelVersion: true },
    })
    : null;
  const modelDayFingerprintInputs = strengthModelDayFingerprintInputsV1(modelDay);
  const metFallbackKcal = bodyMassKg !== null && modelDay?.status === "complete"
      && modelDay.dynamicRmrKcalPerDay !== null && durationMinutes !== null && durationMinutes > 0
    ? calculateStrengthActivity({ weightKg: bodyMassKg, rmrKcalPerDay: modelDay.dynamicRmrKcalPerDay, durationMinutes })
    : null;
  const manualKcal = input.session.matchedWorkout?.manualActiveEnergyKcal ?? null;
  const deviceKcal = input.session.matchedWorkout?.activeEnergyKcal ?? null;
  const activeEnergyResolution = resolveEventEnergyV1({
    classification: "traditional-strength-training",
    activeEnergyKcal: deviceKcal,
    bodyCastEstimateKcal: result.estimatedActiveKcal,
    bodyCastEstimateFresh: result.availability === "available",
    strengthSessionCompleted: input.session.status === "COMPLETED",
    bodyCastMetFallbackKcal: metFallbackKcal,
    manualActiveKcal: manualKcal,
    manualActiveKcalPresent: manualKcal !== null,
  });
  const setFingerprint = strengthSetFingerprintV1(input.session.exercises.flatMap((exercise) =>
    exercise.sets.map((set) => ({ ...set, sessionExerciseId: exercise.id, resistanceType: exercise.resistanceType })),
  ));
  const estimatorInputs = {
    entryMode: input.session.entryMode,
    startAt: input.session.matchedWorkout?.startAt ?? input.session.webStartedAt,
    endAt: input.session.matchedWorkout?.endAt ?? input.session.webEndedAt,
    durationMinutes: input.session.matchedWorkout?.durationMinutes ?? null,
    stage02MassReference: stage02Mass?.reference ?? null,
    stage02SnapshotRevision: stage02Mass?.snapshotRevision ?? null,
    stage02InputFingerprint: stage02Mass?.inputFingerprint ?? null,
    stage02MassResolutionIdentity: stage02Mass?.massResolutionIdentity ?? null,
    modelEpisodeId: episode?.id ?? null,
    modelEpisodeVersion: episode?.modelVersion ?? null,
    modelEpisodeStartDate: episode?.startDate ?? null,
    modelEpisodeLatestModeledDate: episode?.latestModeledDate ?? null,
    modelEpisodeUpdatedAt: episode?.updatedAt.toISOString() ?? null,
    modelTimeZone,
    modelDate,
    ...modelDayFingerprintInputs,
  };
  const inputFingerprint = strengthInputFingerprintV1({
    sessionId: input.session.id,
    sessionRevision: input.session.revision,
    massKg: bodyMassKg,
    sameDayMassKg: null,
    startOfDayMassKg: null,
    setFingerprint,
    estimatorVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    estimatorInputs,
  });
  const persistedResult = {
    ...result,
    activeEnergyResolution,
    sessionRevision: input.session.revision,
    inputFingerprint,
    stage02MassReference: estimatorInputs.stage02MassReference,
    stage02SnapshotRevision: estimatorInputs.stage02SnapshotRevision,
    stage02MassResolutionIdentity: estimatorInputs.stage02MassResolutionIdentity,
  };
  const sourceFingerprint = stableSha256(`${experimentalStrengthActiveEnergyV1Fingerprint(result)}|${inputFingerprint}`);
  const previous = await prisma.experimentalStrengthEnergyShadow.findUnique({
    where: { sessionId: input.session.id },
    select: { sourceFingerprint: true, result: true },
  });
  const previousResult = previous?.result;
  const previousSessionRevision = previousResult !== null
    && typeof previousResult === "object"
    && !Array.isArray(previousResult)
    && typeof (previousResult as { sessionRevision?: unknown }).sessionRevision === "number"
    ? (previousResult as { sessionRevision: number }).sessionRevision
    : null;
  const publication = strengthPublicationDecisionV1({
    sessionStatus: input.session.status,
    estimateKcal: result.estimatedActiveKcal,
    estimateFresh: result.availability === "available",
    massKg: bodyMassKg,
    inputFingerprint,
    previousFingerprint: (
      previousResult !== null
      && typeof previousResult === "object"
      && !Array.isArray(previousResult)
      && typeof (previousResult as { inputFingerprint?: unknown }).inputFingerprint === "string"
        ? (previousResult as { inputFingerprint: string }).inputFingerprint
        : previous?.sourceFingerprint ?? null
    ),
    previousSessionRevision,
    sessionRevision: input.session.revision,
  });
  if (publication.reason === "stale-inputs") return;
  const validateSource = async (tx: Prisma.TransactionClient): Promise<boolean> => {
    const current = await tx.strengthDiarySession.findUnique({
      where: { id: input.session.id },
      select: {
        revision: true, currentSnapshotRevision: true, matchedWorkoutId: true,
        accountingTimeZone: true, effectiveAccountingAt: true, webStartedAt: true, webEndedAt: true,
      },
    });
    const expectedSnapshotRevision = stage02Mass?.snapshotRevision ?? null;
    if (!current || current.revision !== input.session.revision
        || current.matchedWorkoutId !== input.session.matchedWorkoutId
        || current.currentSnapshotRevision !== expectedSnapshotRevision
        || current.accountingTimeZone !== input.session.accountingTimeZone
        || current.effectiveAccountingAt?.toISOString() !== (input.session.effectiveAccountingAt ?? null)
        || current.webStartedAt?.toISOString() !== (input.session.webStartedAt ?? null)
        || current.webEndedAt?.toISOString() !== (input.session.webEndedAt ?? null)) return false;
    const currentSets = await tx.strengthSet.findMany({
      where: { sessionExercise: { sessionId: input.session.id } },
      select: {
        id: true, sessionExerciseId: true, reps: true, weightKg: true,
        bandNominalResistanceKg: true, completedAt: true,
        sessionExercise: { select: { resistanceType: true } },
      },
      orderBy: [{ sessionExerciseId: "asc" }, { id: "asc" }],
    });
    const currentSetFingerprint = strengthSetFingerprintV1(currentSets.map((set) => ({
      id: set.id, sessionExerciseId: set.sessionExerciseId, resistanceType: set.sessionExercise.resistanceType,
      reps: set.reps, weightKg: set.weightKg?.toNumber() ?? null,
      bandNominalResistanceKg: set.bandNominalResistanceKg?.toNumber() ?? null,
      completedAt: set.completedAt?.toISOString() ?? null,
    })));
    if (currentSetFingerprint !== setFingerprint) return false;
    if (input.session.matchedWorkoutId !== null) {
      const workout = await tx.workout.findUnique({
        where: { id: input.session.matchedWorkoutId },
        select: { startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true, manualActiveEnergyKcal: true },
      });
      if (!workout || workout.startAt.toISOString() !== input.session.matchedWorkout?.startAt
          || workout.endAt.toISOString() !== input.session.matchedWorkout?.endAt
          || workout.durationMinutes !== input.session.matchedWorkout?.durationMinutes
          || workout.activeEnergyKcal !== input.session.matchedWorkout?.activeEnergyKcal
          || workout.manualActiveEnergyKcal !== input.session.matchedWorkout?.manualActiveEnergyKcal) return false;
    }
    const currentEpisodeRows = await tx.modelEpisode.findMany({
      where: { profileId: input.profileId },
      select: { id: true, timezone: true, modelVersion: true, startDate: true, latestModeledDate: true, active: true, updatedAt: true },
      orderBy: { startDate: "asc" },
    });
    const currentEventTimeContext = episodeTimeContextForInstantV1(currentEpisodeRows, occurrenceAt);
    const currentEpisode = currentEventTimeContext.episode;
    if (currentEpisode?.id !== episode?.id || currentEventTimeContext.date !== modelDate
        || currentEventTimeContext.timeZone !== modelTimeZone
        || currentEpisode?.modelVersion !== episode?.modelVersion
        || currentEpisode?.startDate !== episode?.startDate
        || currentEpisode?.latestModeledDate !== episode?.latestModeledDate
        || currentEpisode?.updatedAt.toISOString() !== episode?.updatedAt.toISOString()) return false;
    if (episode !== null) {
      const currentModelDay = await tx.dailyModelState.findUnique({
        where: { episodeId_date: { episodeId: episode.id, date: modelDate } },
        select: { status: true, dynamicRmrKcalPerDay: true, updatedAt: true, modelVersion: true },
      });
      if ((currentModelDay?.updatedAt.toISOString() ?? null) !== (modelDay?.updatedAt.toISOString() ?? null)
          || (currentModelDay?.dynamicRmrKcalPerDay ?? null) !== (modelDay?.dynamicRmrKcalPerDay ?? null)
          || (currentModelDay?.modelVersion ?? null) !== (modelDay?.modelVersion ?? null)) return false;
    }
    return true;
  };
  const candidates: ActiveEnergyCandidateV1[] = [
    ...(input.session.status === "COMPLETED" && result.availability === "available" && result.estimatedActiveKcal !== null
      ? [{ source: "bodycast-strength-estimate" as const, sourceIdentity: `strength-session:${input.session.id}`, sourceFingerprint: inputFingerprint, valueKcal: result.estimatedActiveKcal, provenance: { estimator: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION, stage02MassReference: stage02Mass?.reference ?? null, stage02SnapshotRevision: stage02Mass?.snapshotRevision ?? null } }]
      : []),
    ...(metFallbackKcal !== null && Number.isFinite(metFallbackKcal) && metFallbackKcal >= 0
      ? [{ source: "bodycast-strength-met-fallback" as const, sourceIdentity: `strength-met:${input.session.id}:${modelDate}`, sourceFingerprint: stableSha256(`${inputFingerprint}|${modelDay?.updatedAt.toISOString()}|${modelDay?.dynamicRmrKcalPerDay}`), valueKcal: metFallbackKcal, provenance: { modelEpisodeId: episode?.id ?? null, modelVersion: modelDay?.modelVersion ?? null, modelDate, dynamicRmrKcalPerDay: modelDay?.dynamicRmrKcalPerDay ?? null } }]
      : []),
    ...(manualKcal !== null
      ? [{ source: "manual-kcal" as const, sourceIdentity: `workout:${input.session.matchedWorkoutId}:manual`, sourceFingerprint: stableSha256(`manual|${input.session.matchedWorkoutId}|${manualKcal}`), valueKcal: manualKcal, provenance: { source: "user-entered-workout", workoutId: input.session.matchedWorkoutId } }]
      : []),
    ...(deviceKcal !== null
      ? [{ source: "device-kcal" as const, sourceIdentity: `workout:${input.session.matchedWorkoutId}:device`, sourceFingerprint: stableSha256(`device|${input.session.matchedWorkoutId}|${deviceKcal}`), valueKcal: deviceKcal, provenance: { source: "wearable-device", workoutId: input.session.matchedWorkoutId } }]
      : []),
  ];
  await prisma.$transaction(async (tx) => {
    if (!(await validateSource(tx))) return;
    await tx.experimentalStrengthEnergyShadow.upsert({
      where: { sessionId: input.session.id },
      create: {
        sessionId: input.session.id,
        profileId: input.profileId,
        sourceFingerprint,
        modelRevision: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
        features: result.features,
        result: persistedResult as unknown as Prisma.InputJsonValue,
      },
      update: {
        sourceFingerprint,
        modelRevision: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
        features: result.features,
        result: persistedResult as unknown as Prisma.InputJsonValue,
      },
    });
    await persistActiveEnergyCanonicalResolutionV1(tx, {
    profileId: input.profileId,
    logicalEventKey: input.session.matchedWorkoutId === null
      ? `strength-session:${input.session.id}`
      : `workout:${input.session.matchedWorkoutId}`,
    eventKind: "strength",
    occurrenceAt,
    modelDate,
    modelTimeZone,
    inputFingerprint,
    aliases: [
      { sourceType: "strength-session", sourceId: String(input.session.id) },
      ...(input.session.matchedWorkoutId === null ? [] : [{ sourceType: "workout" as const, sourceId: String(input.session.matchedWorkoutId), workoutId: input.session.matchedWorkoutId }]),
    ],
    candidates,
      validateSource,
    });
  });
}

/** Refreshes a completed session after delayed source matching. */
export async function recordExperimentalStrengthEnergyShadowBySessionId(input: {
  sessionId: number;
  profileId: number;
}): Promise<void> {
  const repository = new TrainingRepository(prisma);
  await repository.materializeAccounting({ sessionId: input.sessionId, profileId: input.profileId, mode: "ordinary" });
  const session = await repository.getSession(input.sessionId, input.profileId);
  if (session !== null) {
    await recordExperimentalStrengthEnergyShadow({ session, profileId: input.profileId });
  }
}

/** Refresh Strength candidates whose Stage 02 nearest mass could change after a weight-source write. */
export async function recordExperimentalStrengthEnergyShadowsForWeightDate(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const episode = await prisma.modelEpisode.findFirst({
    where: { profileId, active: true }, select: { timezone: true }, orderBy: { startDate: "desc" },
  });
  const timeZone = episode?.timezone ?? DEFAULT_TIME_ZONE;
  const fromDate = addCalendarDays(input.date, -7);
  const toDate = addCalendarDays(input.date, 7);
  const fromInstant = localDateTimeToInstant(fromDate, "00:00", timeZone);
  const toInstant = localDateTimeToInstant(addCalendarDays(toDate, 1), "00:00", timeZone);
  const sessions = await prisma.strengthDiarySession.findMany({
    where: {
      profileId,
      status: "COMPLETED",
      OR: [
        { matchedWorkout: { startAt: { gte: fromInstant, lt: toInstant } } },
        { matchedWorkoutId: null, webStartedAt: { gte: fromInstant, lt: toInstant } },
      ],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const session of sessions) {
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: session.id, profileId });
  }
}
