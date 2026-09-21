import { prisma } from "@/lib/db/prisma";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION,
  initialExperimentalFatWeightUncertaintyStateV1,
  transitionExperimentalFatWeightUncertaintyV1,
  type ExperimentalFatWeightUncertaintyStateV1,
} from "@/model/physiology-v7/experimental-fat-weight-uncertainty-v1";
import type { FatWeightShadowStateV1 } from "@/model/physiology-v7/fat-weight-shadow-v1";
import {
  transitionExperimentalDataGapContextV1,
  type ExperimentalDataGapContextV1,
} from "@/model/physiology-v7/experimental-data-gap-context-v1";

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
  const source = await prisma.dailyModelState.findFirst({
    where: { date: { gte: input.fromDate, lte: input.toDate }, episode: { profileId: input.profileId } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { episodeId: true, episode: { select: { initialFatMassKg: true, initialLeanTissueKg: true, startDate: true } } },
  });
  if (source === null) return;
  const predecessorSource = await prisma.dailyModelState.findFirst({ where: { episodeId: source.episodeId, date: { lt: input.fromDate } }, orderBy: { date: "desc" }, select: { date: true } });
  const [priorMeanRow, priorUncertaintyRow] = predecessorSource === null ? [null, null] : await Promise.all([
    prisma.fatWeightShadowV1Result.findUnique({ where: { profileId_date: { profileId: input.profileId, date: predecessorSource.date } }, select: { result: true } }),
    prisma.experimentalFatWeightUncertaintyShadow.findUnique({ where: { profileId_date: { profileId: input.profileId, date: predecessorSource.date } }, select: { result: true } }),
  ]);
  const storedMean = priorMeanRow?.result && typeof priorMeanRow.result === "object" ? (priorMeanRow.result as { state?: FatWeightShadowStateV1 }).state : null;
  const rebuildFrom = predecessorSource !== null && storedMean?.availability === "available" && uncertaintyFromStored(priorUncertaintyRow?.result) !== null
    ? input.fromDate
    : source.episode.startDate;
  const [states, health] = await Promise.all([
    prisma.dailyModelState.findMany({
      where: {
        date: { gte: rebuildFrom, lte: input.toDate },
        episodeId: source.episodeId,
      },
      orderBy: { date: "asc" },
      select: { date: true, energyBalanceKcal: true },
    }),
    prisma.dailyHealthData.findMany({
      where: { date: { gte: rebuildFrom, lte: input.toDate } },
      select: { date: true, weightKg: true, bodyFatPercent: true },
    }),
  ]);

  const byDate = new Map(health.map((row) => [row.date, row]));
  let priorMean: FatWeightShadowStateV1 = storedMean?.availability === "available" ? storedMean : {
      fatMassKg: source.episode.initialFatMassKg,
      slowNonFatKg: source.episode.initialLeanTissueKg,
      availability: "available",
      provenance: "episode-bia-derived-estimate",
      uncertainty: "personal-unavailable",
    };
  let priorUncertainty = uncertaintyFromStored(priorUncertaintyRow?.result)
    ?? initialExperimentalFatWeightUncertaintyStateV1();
  let priorGapContext = (priorUncertaintyRow?.result as { gapContext?: ExperimentalDataGapContextV1 } | null)?.gapContext ?? null;

  for (const row of states) {
    const observed = byDate.get(row.date);
    const transition = transitionExperimentalFatWeightUncertaintyV1({
      priorMean,
      priorUncertainty,
      energyBalanceKcal: row.energyBalanceKcal,
      observedWeightKg: observed?.weightKg ?? null,
      observedBodyFatPercent: observed?.bodyFatPercent?.toNumber() ?? null,
      fastCompartmentContextKg: null,
    });
    const gapContext = transitionExperimentalDataGapContextV1({
      date: row.date,
      sources: {
        nutrition: row.energyBalanceKcal === null ? "missing" : "model-estimated",
        weight: observed?.weightKg === null || observed?.weightKg === undefined ? "missing" : "observed",
        bodyComposition: observed?.bodyFatPercent === null || observed?.bodyFatPercent === undefined ? "missing" : "device-estimated",
      },
      prior: priorGapContext,
    });
    const result = { ...transition, gapContext };
    const sourceFingerprint = stableSha256(result);
    await prisma.experimentalFatWeightUncertaintyShadow.upsert({
      where: { profileId_date: { profileId: input.profileId, date: row.date } },
      create: {
        profileId: input.profileId,
        date: row.date,
        sourceFingerprint,
        modelRevision: EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION,
        features: { ...result.features, gapContext },
        result,
      },
      update: {
        sourceFingerprint,
        modelRevision: EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION,
        features: { ...result.features, gapContext },
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
    priorGapContext = gapContext;
  }
}
