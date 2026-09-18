import { prisma } from "@/lib/db/prisma";
import {
  EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION,
  initialExperimentalFatWeightUncertaintyStateV1,
  transitionExperimentalFatWeightUncertaintyV1,
  type ExperimentalFatWeightUncertaintyStateV1,
} from "@/model/physiology-v7/experimental-fat-weight-uncertainty-v1";
import type { FatWeightShadowStateV1 } from "@/model/physiology-v7/fat-weight-shadow-v1";

function uncertaintyFromStored(result: unknown): ExperimentalFatWeightUncertaintyStateV1 | null {
  if (!result || typeof result !== "object") return null;
  const state = (result as { uncertaintyState?: ExperimentalFatWeightUncertaintyStateV1 }).uncertaintyState;
  if (!state || state.availability !== "available") return null;
  return state;
}

/**
 * Deterministic historical rebuild of experimental fat/weight uncertainty.
 * Isolated shadow — never read by TDEE, forecast, or production v7.
 */
export async function rebuildExperimentalFatWeightUncertaintyV1(input: {
  profileId: number;
  fromDate: string;
  toDate: string;
}): Promise<void> {
  const [states, health, episode, priorUncertaintyRow] = await Promise.all([
    prisma.dailyModelState.findMany({
      where: {
        date: { gte: input.fromDate, lte: input.toDate },
        episode: { profileId: input.profileId },
      },
      orderBy: { date: "asc" },
      select: { date: true, energyBalanceKcal: true },
    }),
    prisma.dailyHealthData.findMany({
      where: { date: { gte: input.fromDate, lte: input.toDate } },
      select: { date: true, weightKg: true, bodyFatPercent: true },
    }),
    prisma.modelEpisode.findFirst({
      where: { profileId: input.profileId, startDate: { lte: input.fromDate } },
      orderBy: { startDate: "desc" },
      select: { initialFatMassKg: true, initialLeanTissueKg: true },
    }),
    prisma.experimentalFatWeightUncertaintyShadow.findFirst({
      where: { profileId: input.profileId, date: { lt: input.fromDate } },
      orderBy: { date: "desc" },
      select: { result: true },
    }),
  ]);

  const byDate = new Map(health.map((row) => [row.date, row]));
  let priorMean: FatWeightShadowStateV1 = episode === null
    ? {
      fatMassKg: null,
      slowNonFatKg: null,
      availability: "unavailable",
      provenance: null,
      uncertainty: "personal-unavailable",
    }
    : {
      fatMassKg: episode.initialFatMassKg,
      slowNonFatKg: episode.initialLeanTissueKg,
      availability: "available",
      provenance: "episode-bia-derived-estimate",
      uncertainty: "personal-unavailable",
    };
  let priorUncertainty = uncertaintyFromStored(priorUncertaintyRow?.result)
    ?? initialExperimentalFatWeightUncertaintyStateV1();

  for (const row of states) {
    const observed = byDate.get(row.date);
    const result = transitionExperimentalFatWeightUncertaintyV1({
      priorMean,
      priorUncertainty,
      energyBalanceKcal: row.energyBalanceKcal,
      observedWeightKg: observed?.weightKg ?? null,
      observedBodyFatPercent: observed?.bodyFatPercent?.toNumber() ?? null,
      fastCompartmentContextKg: null,
    });
    await prisma.experimentalFatWeightUncertaintyShadow.upsert({
      where: { profileId_date: { profileId: input.profileId, date: row.date } },
      create: {
        profileId: input.profileId,
        date: row.date,
        sourceFingerprint: result.fingerprint,
        modelRevision: EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION,
        features: result.features,
        result,
      },
      update: {
        sourceFingerprint: result.fingerprint,
        modelRevision: EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION,
        features: result.features,
        result,
      },
    });
    if (result.availability === "available"
        && result.fatMassKg.pointKg !== null
        && result.slowNonFatKgPoint !== null) {
      priorMean = {
        fatMassKg: result.fatMassKg.pointKg,
        slowNonFatKg: result.slowNonFatKgPoint,
        availability: "available",
        provenance: "episode-bia-derived-estimate",
        uncertainty: "personal-unavailable",
      };
      priorUncertainty = result.uncertaintyState;
    } else {
      priorMean = {
        fatMassKg: null,
        slowNonFatKg: null,
        availability: "unavailable",
        provenance: null,
        uncertainty: "personal-unavailable",
      };
      priorUncertainty = {
        availability: "unavailable",
        weightHalfWidthKg: null,
        fatHalfWidthKg: null,
        consecutiveCompatibleScaleDays: 0,
        daysSinceScaleObservation: 0,
        daysSinceEnergyBalance: 0,
      };
    }
  }
}
