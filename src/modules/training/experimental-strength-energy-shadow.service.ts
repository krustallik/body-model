import { prisma } from "@/lib/db/prisma";
import type { StrengthSessionDto } from "./training.types";
import { TrainingRepository } from "./training.repository";
import {
  EXPERIMENTAL_STRENGTH_ENERGY_MODEL_REVISION,
  buildExperimentalStrengthEnergyShadow,
  extractExperimentalStrengthEnergyFeatures,
} from "./experimental-strength-energy";

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
  const workout = input.session.matchedWorkoutId === null ? null : await prisma.workout.findUnique({
    where: { id: input.session.matchedWorkoutId },
    select: { dailyHealthData: { select: { weightKg: true } } },
  });
  const heartRateBpms = interval === null ? [] : await prisma.heartRateSample.findMany({
    where: { profileId: input.profileId, timestamp: { gte: new Date(interval.startAt), lte: new Date(interval.endAt) } },
    select: { bpm: true }, orderBy: { timestamp: "asc" },
  }).then((rows) => rows.map((row) => row.bpm));
  const features = extractExperimentalStrengthEnergyFeatures({
    session: input.session,
    bodyMassKg: workout?.dailyHealthData?.weightKg ?? null,
    heartRateBpms,
  });
  const shadow = buildExperimentalStrengthEnergyShadow(features);
  await prisma.experimentalStrengthEnergyShadow.upsert({
    where: { sessionId: input.session.id },
    create: {
      sessionId: input.session.id,
      profileId: input.profileId,
      sourceFingerprint: shadow.sourceFingerprint,
      modelRevision: EXPERIMENTAL_STRENGTH_ENERGY_MODEL_REVISION,
      features,
      result: shadow.result,
    },
    update: {
      sourceFingerprint: shadow.sourceFingerprint,
      modelRevision: EXPERIMENTAL_STRENGTH_ENERGY_MODEL_REVISION,
      features,
      result: shadow.result,
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
