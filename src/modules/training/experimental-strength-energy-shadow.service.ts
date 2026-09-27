import { prisma } from "@/lib/db/prisma";
import type { StrengthSessionDto } from "./training.types";
import { TrainingRepository } from "./training.repository";
import {
  estimateExperimentalStrengthActiveEnergyV1,
  EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  experimentalStrengthActiveEnergyV1Fingerprint,
  resolveExperimentalStrengthActiveEnergyV1,
} from "./experimental-strength-active-energy-v1";
import {
  strengthInputFingerprintV1,
  strengthPublicationDecisionV1,
  strengthSetFingerprintV1,
} from "./strength-publication-v1";

async function resolveBodyMassContext(input: {
  session: StrengthSessionDto;
  profileId: number;
}): Promise<{
  massKg: number | null;
  sameDayMassKg: number | null;
  startOfDayMassKg: number | null;
}> {
  const asOfDate = (input.session.matchedWorkout?.startAt
    ?? input.session.webStartedAt
    ?? input.session.createdAt).slice(0, 10);
  let sameDayMassKg: number | null = null;
  if (input.session.matchedWorkoutId !== null) {
    const workout = await prisma.workout.findUnique({
      where: { id: input.session.matchedWorkoutId, hiddenFromHistory: false },
      select: { dailyHealthData: { select: { date: true, weightKg: true } } },
    });
    if (workout?.dailyHealthData.date === asOfDate && workout.dailyHealthData.weightKg != null) {
      sameDayMassKg = workout.dailyHealthData.weightKg;
    }
  }
  if (sameDayMassKg === null) {
    const sameDay = await prisma.dailyHealthData.findUnique({
      where: { date: asOfDate },
      select: { weightKg: true },
    });
    sameDayMassKg = sameDay?.weightKg ?? null;
  }
  // Prior-day mass is the calculated start-of-day fallback, not a later scale rewrite.
  const prior = await prisma.dailyHealthData.findFirst({
    where: { weightKg: { not: null }, date: { lt: asOfDate } },
    orderBy: { date: "desc" },
    select: { weightKg: true },
  });
  const startOfDayMassKg = prior?.weightKg ?? null;
  return {
    massKg: sameDayMassKg ?? startOfDayMassKg,
    sameDayMassKg,
    startOfDayMassKg,
  };
}

/**
 * Writes an isolated shadow record only. It is deliberately not an input to
 * TDEE, physiology, forecast, or any scientific result.
 */
export async function recordExperimentalStrengthEnergyShadow(input: {
  session: StrengthSessionDto;
  profileId: number;
}): Promise<void> {
  const interval = input.session.matchedWorkout ?? (input.session.webStartedAt && input.session.webEndedAt
    ? { startAt: input.session.webStartedAt, endAt: input.session.webEndedAt }
    : null);
  const [massContext, heartRateBpms] = await Promise.all([
    resolveBodyMassContext(input),
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
  const bodyMassKg = massContext.massKg;
  const result = estimateExperimentalStrengthActiveEnergyV1({
    session: input.session,
    bodyMassKg,
    heartRateBpms,
  });
  const activeEnergyResolution = resolveExperimentalStrengthActiveEnergyV1({
    bodycast: result,
    matchedGarminActiveKcal: input.session.matchedWorkout?.activeEnergyKcal ?? null,
  });
  const setFingerprint = strengthSetFingerprintV1(
    input.session.exercises.flatMap((exercise) => exercise.sets),
  );
  const inputFingerprint = strengthInputFingerprintV1({
    sessionId: input.session.id,
    sessionRevision: input.session.revision,
    massKg: bodyMassKg,
    sameDayMassKg: massContext.sameDayMassKg,
    startOfDayMassKg: massContext.startOfDayMassKg,
    setFingerprint,
    estimatorVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  });
  const persistedResult = {
    ...result,
    activeEnergyResolution,
    sessionRevision: input.session.revision,
    inputFingerprint,
  };
  const sourceFingerprint = experimentalStrengthActiveEnergyV1Fingerprint(result);
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
  await prisma.experimentalStrengthEnergyShadow.upsert({
    where: { sessionId: input.session.id },
    create: {
      sessionId: input.session.id,
      profileId: input.profileId,
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
      features: result.features,
      result: persistedResult,
    },
    update: {
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
      features: result.features,
      result: persistedResult,
    },
  });
}

/** Refreshes a completed session after delayed source matching. */
export async function recordExperimentalStrengthEnergyShadowBySessionId(input: {
  sessionId: number;
  profileId: number;
}): Promise<void> {
  const session = await new TrainingRepository(prisma).getSession(input.sessionId, input.profileId);
  if (session !== null) {
    await recordExperimentalStrengthEnergyShadow({ session, profileId: input.profileId });
  }
}
