import type { PrismaClient, Prisma } from "@prisma/client";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { calculateHistoricalBodyweightAsOfV1, MAX_HISTORICAL_BODYWEIGHT_REPLAY_DAYS_V1 } from "@/modules/model-episodes/historical-bodyweight-asof-v1";
import { addCalendarDays, calendarDayIndex } from "@/modules/model-episodes/model-calendar";
import { localDateTimeToInstant } from "@/model/time-zone";
import { resolveBodyweightReferenceV2 } from "./bodyweight-reference-v2";
import type { BodyweightReferenceV1 } from "./load-accounting-v1";
import { buildMassResolutionIdentity, sha256Canonical } from "./persisted-load-accounting-v1";
import type { StrengthSessionDto } from "./training.types";

export const STRENGTH_ENERGY_MASS_RESOLUTION_V1 = "bodycast-strength-energy-mass-resolution-v1" as const;
type MassReference = NonNullable<StrengthSessionDto["activeEnergyMassReference"]>;

/** Shared historical source policy; callers decide whether their calculation needs mass. */
export async function resolveSessionHistoricalMassReferenceV1(
  db: PrismaClient | Prisma.TransactionClient,
  localDate: string,
  timeZone: string,
): Promise<BodyweightReferenceV1> {
  const unavailable: BodyweightReferenceV1 = {
    status: "unavailable", valueKg: null, localDate, source: null, sourceId: null,
  };
  const dataClient = db as unknown as {
    healthMetricSample?: {
      findMany?: (args: unknown) => Promise<Array<{
        id: number;
        timestamp: Date;
        value: { toNumber(): number };
        source: string | null;
      }>>;
    };
  };
  const findSamples = dataClient.healthMetricSample?.findMany;
  if (typeof findSamples !== "function") return unavailable;
  let start: Date;
  let end: Date;
  try {
    start = localDateTimeToInstant(addCalendarDays(localDate, -7), "00:00", timeZone);
    end = localDateTimeToInstant(addCalendarDays(localDate, 8), "00:00", timeZone);
  } catch {
    return unavailable;
  }
  let observedSamples;
  try {
    const samples = await findSamples.call(dataClient.healthMetricSample, {
      where: {
        metric: "weight-kg",
        source: "apple-health-shortcut",
        timestamp: { gte: start, lt: end },
      },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      select: { id: true, timestamp: true, value: true, source: true },
    });
    observedSamples = samples.map((sample) => ({
      id: String(sample.id),
      timestamp: sample.timestamp,
      valueKg: sample.value.toNumber(),
      source: sample.source,
    }));
  } catch {
    return unavailable;
  }

  const observedReference = resolveBodyweightReferenceV2({
    localDate,
    timeZone,
    observedSamples,
  });
  if (observedReference.status !== "unavailable") return observedReference;

  let modelEstimate = null;
  try {
    const episodes = new ModelEpisodeRepository(db);
    const episode = await episodes.getAsOf(localDate);
    if (episode && calendarDayIndex(localDate) - calendarDayIndex(episode.startDate) + 1
        <= MAX_HISTORICAL_BODYWEIGHT_REPLAY_DAYS_V1) {
      const sources = await episodes.loadSources(episode.startDate, localDate, undefined, { resolveEnergyMass: false });
      const estimate = calculateHistoricalBodyweightAsOfV1({ episode, sources, localDate });
      if (estimate.status === "available" && estimate.valueKg !== null) {
        modelEstimate = {
          localDate: estimate.localDate,
          valueKg: estimate.valueKg,
          episodeId: estimate.episodeId,
          modelVersion: estimate.modelVersion,
          uncertainty: estimate.uncertainty,
        };
      }
    }
  } catch {
    // Historical fallback is optional; fail closed while preserving observed inputs.
  }

  return resolveBodyweightReferenceV2({
    localDate,
    timeZone,
    observedSamples,
    modelEstimate,
  });
}

/** Energy has a mass dependency even when Stage 02 has no BODYWEIGHT rows.
 * Existing available Stage 02 references remain frozen and retain their identities.
 * The independent reference is derived only; it never rewrites accounting snapshots.
 */
export async function resolveStrengthEnergyMassReferenceV1(
  db: PrismaClient | Prisma.TransactionClient,
  input: { stage02Mass: MassReference | null; localDate: string; timeZone: string },
): Promise<MassReference | null> {
  if (input.stage02Mass === null || input.stage02Mass.reference.status !== "unavailable") return input.stage02Mass;
  const reference = await resolveSessionHistoricalMassReferenceV1(db, input.localDate, input.timeZone);
  const massResolutionIdentity = buildMassResolutionIdentity({
    localDate: input.localDate,
    timeZone: input.timeZone,
    methodVersion: STRENGTH_ENERGY_MASS_RESOLUTION_V1,
    reference,
  });
  return {
    reference,
    snapshotRevision: input.stage02Mass.snapshotRevision,
    inputFingerprint: sha256Canonical({
      stage02InputFingerprint: input.stage02Mass.inputFingerprint,
      massResolutionIdentity,
      methodVersion: STRENGTH_ENERGY_MASS_RESOLUTION_V1,
    }),
    massResolutionIdentity,
  };
}
