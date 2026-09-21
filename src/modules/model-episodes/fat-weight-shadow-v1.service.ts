import { prisma } from "@/lib/db/prisma";
import { transitionFatWeightShadowV1, type FatWeightShadowStateV1 } from "@/model/physiology-v7/fat-weight-shadow-v1";

function initialState(episode: { initialFatMassKg: number; initialLeanTissueKg: number } | null): FatWeightShadowStateV1 {
  return episode === null ? { fatMassKg: null, slowNonFatKg: null, availability: "unavailable", provenance: null, uncertainty: "personal-unavailable" } : { fatMassKg: episode.initialFatMassKg, slowNonFatKg: episode.initialLeanTissueKg, availability: "available", provenance: "episode-bia-derived-estimate", uncertainty: "personal-unavailable" };
}

function stateFromStored(result: unknown): FatWeightShadowStateV1 | null {
  const state = result && typeof result === "object" ? (result as { state?: FatWeightShadowStateV1 }).state : null;
  return state?.availability === "available" ? state : null;
}

/** Isolated operational shadow; never read by legacy TDEE, forecast, or v7 runtime. */
export async function rebuildFatWeightShadowV1(input: { profileId: number; fromDate: string; toDate: string }): Promise<void> {
  const source = await prisma.dailyModelState.findFirst({ where: { date: { gte: input.fromDate, lte: input.toDate }, episode: { profileId: input.profileId } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { episodeId: true, episode: { select: { initialFatMassKg: true, initialLeanTissueKg: true, startDate: true } } } });
  if (source === null) return;
  const predecessorSource = await prisma.dailyModelState.findFirst({ where: { episodeId: source.episodeId, date: { lt: input.fromDate } }, orderBy: { date: "desc" }, select: { date: true } });
  const predecessor = predecessorSource === null ? null : await prisma.fatWeightShadowV1Result.findUnique({ where: { profileId_date: { profileId: input.profileId, date: predecessorSource.date } }, select: { result: true } });
  // A suffix is legal only with the exact preceding modeled day. Otherwise
  // replay this episode from its deterministic baseline instead of restarting
  // in the middle with an incompatible initial state.
  const hasCompatibleBaseline = source.episode.startDate <= input.fromDate;
  const rebuildFrom = predecessorSource !== null && stateFromStored(predecessor?.result) !== null
    ? input.fromDate
    : hasCompatibleBaseline ? source.episode.startDate : input.fromDate;
  const [states, health] = await Promise.all([
    prisma.dailyModelState.findMany({ where: { episodeId: source.episodeId, date: { gte: rebuildFrom, lte: input.toDate } }, orderBy: { date: "asc" }, select: { date: true, fatMassKg: true, leanTissueKg: true, energyBalanceKcal: true } }),
    prisma.dailyHealthData.findMany({ where: { date: { gte: rebuildFrom, lte: input.toDate } }, select: { date: true, weightKg: true, bodyFatPercent: true } }),
  ]);
  const byDate = new Map(health.map((row) => [row.date, row]));
  let prior = stateFromStored(predecessor?.result) ?? initialState(hasCompatibleBaseline ? source.episode : null);
  for (const row of states) {
    const observed = byDate.get(row.date);
    const result = transitionFatWeightShadowV1({ prior, energyBalanceKcal: row.energyBalanceKcal, observedWeightKg: observed?.weightKg ?? null, observedBodyFatPercent: observed?.bodyFatPercent?.toNumber() ?? null });
    await prisma.fatWeightShadowV1Result.upsert({ where: { profileId_date: { profileId: input.profileId, date: row.date } }, create: { profileId: input.profileId, date: row.date, sourceFingerprint: result.fingerprint, modelVersion: result.modelVersion, result }, update: { sourceFingerprint: result.fingerprint, modelVersion: result.modelVersion, result } });
    prior = result.state;
  }
}
