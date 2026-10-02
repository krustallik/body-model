import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { calculateStrengthActivity } from "@/model/activity/strength";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { persistActiveEnergyCanonicalResolutionV1, type ActiveEnergyCandidateV1 } from "@/model/activity/active-energy-canonical.repository";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { stepperMassCandidateDependsOnReplayV1 } from "@/model/activity/stepper-historical-mass-v1";
import { isProductionGenerationCurrentV1 } from "@/modules/model-episodes/publication-generation-v1";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { recordExperimentalStrengthEnergyShadowBySessionId } from "@/modules/training/experimental-strength-energy-shadow.service";
import { recordExperimentalStepperActiveEnergyShadow } from "@/modules/profile/experimental-stepper-active-energy-shadow.service";

type ResolutionSnapshot = {
  id: number;
  modelDate: string;
  isStale: boolean;
  currentResolutionFingerprint: string | null;
  resolutionRevision: number;
};

async function readResolutionSnapshot(profileId: number): Promise<ResolutionSnapshot[]> {
  return prisma.activeEnergyCanonicalEvent.findMany({
    where: { profileId, eventKind: { in: ["strength", "stepper"] }, supersededByEventId: null },
    select: { id: true, modelDate: true, isStale: true, currentResolutionFingerprint: true, resolutionRevision: true },
    orderBy: { id: "asc" },
  });
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function changedResolutionDates(before: readonly ResolutionSnapshot[], after: readonly ResolutionSnapshot[]): string[] {
  const oldById = new Map(before.map((row) => [row.id, row]));
  const newById = new Map(after.map((row) => [row.id, row]));
  const dates: string[] = [];
  for (const id of new Set([...oldById.keys(), ...newById.keys()])) {
    const oldRow = oldById.get(id);
    const newRow = newById.get(id);
    if (!oldRow || !newRow || oldRow.modelDate !== newRow.modelDate
        || oldRow.isStale !== newRow.isStale
        || oldRow.currentResolutionFingerprint !== newRow.currentResolutionFingerprint
        || oldRow.resolutionRevision !== newRow.resolutionRevision) {
      const date = newRow?.modelDate ?? oldRow?.modelDate;
      if (date) dates.push(date);
    }
  }
  return [...new Set(dates)].sort();
}

export async function invalidateActiveEnergyResolutionDatesV1(profileId: number, dates: readonly string[]): Promise<void> {
  const earliest = [...dates].sort()[0];
  if (!earliest) return;
  await prisma.$transaction(async (tx) => {
    await new PhysiologyV7PersistenceRepository(tx).invalidate(profileId, earliest);
  });
}

export async function materializeActiveEnergyCandidatesV1(profileId = 1): Promise<{
  stepperWorkoutIds: number[];
  strengthSessionIds: number[];
  strengthWorkoutIds: number[];
  changedDates: string[];
}> {
  const before = await readResolutionSnapshot(profileId);
  const [sessions, workouts] = await Promise.all([
    prisma.strengthDiarySession.findMany({
      where: { profileId, status: "COMPLETED" },
      select: { id: true },
      orderBy: { id: "asc" },
    }),
    prisma.workout.findMany({
      where: { hiddenFromHistory: false },
      select: { id: true, type: true, matchedDiarySession: { select: { id: true } } },
      orderBy: { id: "asc" },
    }),
  ]);
  for (const session of sessions) {
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: session.id, profileId });
  }
  const strengthWorkoutIds = workouts
    .filter((workout) => workout.matchedDiarySession === null
      && canonicalizeWorkoutType(workout.type).classification === "traditional-strength-training")
    .map((workout) => workout.id);
  for (const workoutId of strengthWorkoutIds) {
    await recordUnmatchedStrengthWorkoutV1({ workoutId, profileId });
  }
  const stepperWorkoutIds = workouts
    .filter((workout) => canonicalizeWorkoutType(workout.type).classification === "stair-climbing")
    .map((workout) => workout.id);
  for (const workoutId of stepperWorkoutIds) {
    await recordExperimentalStepperActiveEnergyShadow({ workoutId, profileId });
  }
  return {
    stepperWorkoutIds,
    strengthSessionIds: sessions.map(({ id }) => id),
    strengthWorkoutIds,
    changedDates: changedResolutionDates(before, await readResolutionSnapshot(profileId)),
  };
}

async function recordUnmatchedStrengthWorkoutV1(input: { workoutId: number; profileId: number }): Promise<void> {
  const workout = await prisma.workout.findFirst({
    where: { id: input.workoutId, hiddenFromHistory: false, matchedDiarySession: null },
    select: {
      id: true, type: true, sourceIdentity: true, startAt: true, endAt: true,
      durationMinutes: true, activeEnergyKcal: true, manualActiveEnergyKcal: true, updatedAt: true,
    },
  });
  if (!workout || canonicalizeWorkoutType(workout.type).classification !== "traditional-strength-training") return;
  const episodes = await prisma.modelEpisode.findMany({
    where: { profileId: input.profileId },
    select: { id: true, startDate: true, timezone: true, modelVersion: true, active: true, latestModeledDate: true },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  const context = episodeTimeContextForInstantV1(episodes, workout.startAt);
  const episode = context.episode;
  const lifecycle = await prisma.physiologyV7Lifecycle.findUnique({
    where: { profileId: input.profileId },
    select: { invalidationGeneration: true, productionPublishedGeneration: true, productionStaleFromDate: true },
  });
  const productionCurrent = isProductionGenerationCurrentV1(lifecycle);
  const modelDay = productionCurrent && episode !== null
    ? await prisma.dailyModelState.findUnique({
      where: { episodeId_date: { episodeId: episode.id, date: context.date } },
      select: {
        id: true, date: true, status: true, modelVersion: true, dynamicRmrKcalPerDay: true,
        filteredWeightKg: true, endWeightKg: true, updatedAt: true,
      },
    })
    : null;
  const massKg = modelDay?.filteredWeightKg ?? modelDay?.endWeightKg ?? null;
  const durationMinutes = workout.durationMinutes !== null && Number.isFinite(workout.durationMinutes) && workout.durationMinutes > 0
    ? workout.durationMinutes
    : (workout.endAt.getTime() - workout.startAt.getTime()) / 60_000;
  const metKcal = modelDay?.status === "complete" && modelDay.modelVersion === episode?.modelVersion
      && massKg !== null && Number.isFinite(massKg) && massKg > 0
      && modelDay.dynamicRmrKcalPerDay !== null && Number.isFinite(modelDay.dynamicRmrKcalPerDay)
      && Number.isFinite(durationMinutes) && durationMinutes > 0
    ? calculateStrengthActivity({ weightKg: massKg, rmrKcalPerDay: modelDay.dynamicRmrKcalPerDay, durationMinutes })
    : null;
  const fingerprintInputs = {
    workout: [workout.id, workout.type, workout.sourceIdentity, workout.startAt.toISOString(),
      workout.endAt.toISOString(), workout.durationMinutes, workout.activeEnergyKcal,
      workout.manualActiveEnergyKcal, workout.updatedAt.toISOString()],
    episode: episode ? [episode.id, episode.modelVersion, episode.startDate, episode.timezone] : null,
    modelDate: context.date,
    modelDay: modelDay ? [modelDay.id, modelDay.status, modelDay.modelVersion,
      modelDay.dynamicRmrKcalPerDay, massKg, modelDay.updatedAt.toISOString()] : null,
    productionGeneration: productionCurrent ? lifecycle?.invalidationGeneration : null,
  };
  const inputFingerprint = stableSha256(JSON.stringify(fingerprintInputs));
  const candidates: ActiveEnergyCandidateV1[] = [
    ...(metKcal !== null && Number.isFinite(metKcal) && metKcal >= 0
      ? [{ source: "bodycast-strength-met-fallback" as const, sourceIdentity: `strength-met:${workout.id}:${context.date}`, sourceFingerprint: inputFingerprint, valueKcal: metKcal, provenance: { modelEpisodeId: episode?.id ?? null, modelVersion: modelDay?.modelVersion ?? null, modelDate: context.date, modelTimeZone: context.timeZone, dynamicRmrKcalPerDay: modelDay?.dynamicRmrKcalPerDay ?? null, massKg } }]
      : []),
    ...(workout.manualActiveEnergyKcal === null ? [] : [{ source: "manual-kcal" as const, sourceIdentity: `workout:${workout.id}:manual`, sourceFingerprint: stableSha256(`manual|${workout.id}|${workout.manualActiveEnergyKcal}|${workout.updatedAt.toISOString()}`), valueKcal: workout.manualActiveEnergyKcal, provenance: { source: "user-entered-workout", workoutId: workout.id } }]),
    ...(workout.activeEnergyKcal === null ? [] : [{ source: "device-kcal" as const, sourceIdentity: `workout:${workout.id}:device`, sourceFingerprint: stableSha256(`device|${workout.id}|${workout.activeEnergyKcal}|${workout.updatedAt.toISOString()}`), valueKcal: workout.activeEnergyKcal, provenance: { source: "wearable-device", workoutId: workout.id } }]),
  ];
  const occurrenceAt = workout.startAt;
  const validateSource = async (tx: Prisma.TransactionClient) => {
    const [currentWorkout, currentEpisodes, currentLifecycle] = await Promise.all([
      tx.workout.findUnique({ where: { id: workout.id }, select: { type: true, sourceIdentity: true, startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true, manualActiveEnergyKcal: true, updatedAt: true, hiddenFromHistory: true, matchedDiarySession: { select: { id: true } } } }),
      tx.modelEpisode.findMany({ where: { profileId: input.profileId }, select: { id: true, startDate: true, timezone: true, modelVersion: true, active: true, latestModeledDate: true }, orderBy: [{ startDate: "asc" }, { id: "asc" }] }),
      tx.physiologyV7Lifecycle.findUnique({ where: { profileId: input.profileId }, select: { invalidationGeneration: true, productionPublishedGeneration: true, productionStaleFromDate: true } }),
    ]);
    if (!currentWorkout || currentWorkout.hiddenFromHistory || currentWorkout.matchedDiarySession !== null
        || currentWorkout.type !== workout.type || currentWorkout.sourceIdentity !== workout.sourceIdentity
        || currentWorkout.startAt.toISOString() !== workout.startAt.toISOString()
        || currentWorkout.endAt.toISOString() !== workout.endAt.toISOString()
        || currentWorkout.durationMinutes !== workout.durationMinutes
        || currentWorkout.activeEnergyKcal !== workout.activeEnergyKcal
        || currentWorkout.manualActiveEnergyKcal !== workout.manualActiveEnergyKcal
        || currentWorkout.updatedAt.toISOString() !== workout.updatedAt.toISOString()) return false;
    const currentContext = episodeTimeContextForInstantV1(currentEpisodes, occurrenceAt);
    if (currentContext.episode?.id !== episode?.id || currentContext.date !== context.date
        || currentContext.timeZone !== context.timeZone) return false;
    const currentGeneration = isProductionGenerationCurrentV1(currentLifecycle)
      ? currentLifecycle?.invalidationGeneration ?? null
      : null;
    if (currentGeneration !== (productionCurrent ? lifecycle?.invalidationGeneration ?? null : null)) return false;
    if (modelDay !== null) {
      const currentModelDay = await tx.dailyModelState.findUnique({
        where: { episodeId_date: { episodeId: episode!.id, date: context.date } },
        select: { id: true, status: true, updatedAt: true, dynamicRmrKcalPerDay: true, filteredWeightKg: true, endWeightKg: true, modelVersion: true },
      });
      if (currentModelDay?.id !== modelDay.id || currentModelDay.updatedAt.toISOString() !== modelDay.updatedAt.toISOString()
          || currentModelDay.status !== modelDay.status
          || currentModelDay.dynamicRmrKcalPerDay !== modelDay.dynamicRmrKcalPerDay
          || currentModelDay.filteredWeightKg !== modelDay.filteredWeightKg
          || currentModelDay.endWeightKg !== modelDay.endWeightKg
          || currentModelDay.modelVersion !== modelDay.modelVersion) return false;
    }
    return true;
  };
  await prisma.$transaction(async (tx) => {
    await persistActiveEnergyCanonicalResolutionV1(tx, {
      profileId: input.profileId,
      logicalEventKey: `workout:${workout.id}`,
      eventKind: "strength",
      occurrenceAt,
      modelDate: context.date,
      modelTimeZone: context.timeZone,
      inputFingerprint,
      aliases: [{ sourceType: "workout", sourceId: String(workout.id), workoutId: workout.id }],
      candidates,
      validateSource,
    });
  });
}

export async function refreshStepperCandidatesV1(profileId: number, workoutIds: readonly number[]): Promise<string[]> {
  if (workoutIds.length === 0) return [];
  const before = await readResolutionSnapshot(profileId);
  for (const workoutId of workoutIds) {
    await recordExperimentalStepperActiveEnergyShadow({ workoutId, profileId });
  }
  return changedResolutionDates(before, await readResolutionSnapshot(profileId));
}

/** Refresh only active-energy candidates whose values can depend on replayed days. */
export async function refreshCandidatesAfterProductionV1(
  profileId: number,
  replayFromDate: string,
): Promise<string[]> {
  const before = await readResolutionSnapshot(profileId);
  const [episodes, sessions, workouts] = await Promise.all([
    prisma.modelEpisode.findMany({
      where: { profileId },
      select: { startDate: true, timezone: true, active: true },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    }),
    prisma.strengthDiarySession.findMany({
      where: { profileId, status: "COMPLETED" },
      select: {
        id: true,
        effectiveAccountingAt: true,
        webStartedAt: true,
        createdAt: true,
        matchedWorkout: { select: { startAt: true } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.workout.findMany({
      where: { hiddenFromHistory: false },
      select: {
        id: true,
        type: true,
        startAt: true,
        matchedDiarySession: { select: { id: true } },
        experimentalStepperActiveEnergyShadow: { select: { result: true } },
      },
      orderBy: { id: "asc" },
    }),
  ]);
  const aliases = sessions.length === 0 ? [] : await prisma.activeEnergyEventAlias.findMany({
    where: {
      profileId,
      sourceType: "strength-session",
      sourceId: { in: sessions.map((session) => String(session.id)) },
    },
    select: { sourceId: true, event: { select: { currentSource: true } } },
  });
  const strengthSourceBySessionId = new Map(aliases.map((row) => [row.sourceId, row.event.currentSource]));
  for (const session of sessions) {
    const eventInstant = session.matchedWorkout?.startAt
      ?? session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt;
    const modelDate = episodeTimeContextForInstantV1(episodes, eventInstant).date;
    const currentSource = strengthSourceBySessionId.get(String(session.id));
    if (modelDate < replayFromDate || currentSource === "bodycast-strength-estimate") continue;
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: session.id, profileId });
  }
  for (const workout of workouts) {
    const classification = canonicalizeWorkoutType(workout.type).classification;
    const modelDate = episodeTimeContextForInstantV1(episodes, workout.startAt).date;
    if (classification === "traditional-strength-training" && workout.matchedDiarySession === null
        && modelDate >= replayFromDate) {
      await recordUnmatchedStrengthWorkoutV1({ workoutId: workout.id, profileId });
      continue;
    }
    if (classification !== "stair-climbing") continue;
    const shadow = objectValue(workout.experimentalStepperActiveEnergyShadow?.result);
    const massReference = objectValue(shadow?.massReference);
    if (!stepperMassCandidateDependsOnReplayV1({
      workoutDate: modelDate,
      replayFromDate,
      massStatus: massReference?.status === "observed" || massReference?.status === "model-estimated"
        ? massReference.status
        : "unavailable",
    })) continue;
    await recordExperimentalStepperActiveEnergyShadow({ workoutId: workout.id, profileId });
  }
  return changedResolutionDates(before, await readResolutionSnapshot(profileId));
}
