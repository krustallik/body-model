import { prisma } from "@/lib/db/prisma";
import type { StrengthSessionDto } from "./training.types";
import { TrainingRepository } from "./training.repository";
import {
  estimateExperimentalStrengthActiveEnergyV1,
  EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  experimentalStrengthActiveEnergyV1Fingerprint,
  resolveExperimentalStrengthActiveEnergyV1,
} from "./experimental-strength-active-energy-v1";

async function resolveBodyMassKg(input: {
  session: StrengthSessionDto;
  profileId: number;
}): Promise<number | null> {
  const asOfDate = (input.session.matchedWorkout?.startAt
    ?? input.session.webStartedAt
    ?? input.session.createdAt).slice(0, 10);
  if (input.session.matchedWorkoutId !== null) {
    const workout = await prisma.workout.findUnique({
      where: { id: input.session.matchedWorkoutId },
      select: { dailyHealthData: { select: { weightKg: true } } },
    });
    if (workout?.dailyHealthData.weightKg != null) {
      return workout.dailyHealthData.weightKg;
    }
  }
  const latest = await prisma.dailyHealthData.findFirst({
    // An energy estimate for an old diary session must not change because a
    // user later records a scale weight. This is a historical as-of fallback,
    // not retrospective smoothing.
    where: { weightKg: { not: null }, date: { lte: asOfDate } },
    orderBy: { date: "desc" },
    select: { weightKg: true },
  });
  return latest?.weightKg ?? null;
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
  const [bodyMassKg, heartRateBpms] = await Promise.all([
    resolveBodyMassKg(input),
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
  const result = estimateExperimentalStrengthActiveEnergyV1({
    session: input.session,
    bodyMassKg,
    heartRateBpms,
  });
  const activeEnergyResolution = resolveExperimentalStrengthActiveEnergyV1({
    bodycast: result,
    matchedGarminActiveKcal: input.session.matchedWorkout?.activeEnergyKcal ?? null,
  });
  const persistedResult = { ...result, activeEnergyResolution };
  const sourceFingerprint = experimentalStrengthActiveEnergyV1Fingerprint(result);
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
