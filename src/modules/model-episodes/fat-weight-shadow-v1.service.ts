import { prisma } from "@/lib/db/prisma";
import { transitionFatWeightShadowV1, type FatWeightShadowStateV1 } from "@/model/physiology-v7/fat-weight-shadow-v1";

/** Isolated operational shadow; never read by legacy TDEE, forecast, or v7 runtime. */
export async function rebuildFatWeightShadowV1(input: { profileId: number; fromDate: string; toDate: string }): Promise<void> {
  const [states, health, episode] = await Promise.all([
    prisma.dailyModelState.findMany({ where: { date: { gte: input.fromDate, lte: input.toDate }, episode: { profileId: input.profileId } }, orderBy: { date: "asc" }, select: { date: true, fatMassKg: true, leanTissueKg: true, energyBalanceKcal: true } }),
    prisma.dailyHealthData.findMany({ where: { date: { gte: input.fromDate, lte: input.toDate } }, select: { date: true, weightKg: true, bodyFatPercent: true } }),
    prisma.modelEpisode.findFirst({ where: { profileId: input.profileId, startDate: { lte: input.fromDate } }, orderBy: { startDate: "desc" }, select: { initialFatMassKg: true, initialLeanTissueKg: true } }),
  ]);
  const byDate = new Map(health.map((row) => [row.date, row]));
  let prior: FatWeightShadowStateV1 = episode === null ? { fatMassKg: null, slowNonFatKg: null, availability: "unavailable", provenance: null, uncertainty: "personal-unavailable" } : { fatMassKg: episode.initialFatMassKg, slowNonFatKg: episode.initialLeanTissueKg, availability: "available", provenance: "episode-bia-derived-estimate", uncertainty: "personal-unavailable" };
  for (const row of states) {
    const observed = byDate.get(row.date);
    const result = transitionFatWeightShadowV1({ prior, energyBalanceKcal: row.energyBalanceKcal, observedWeightKg: observed?.weightKg ?? null, observedBodyFatPercent: observed?.bodyFatPercent?.toNumber() ?? null });
    await prisma.fatWeightShadowV1Result.upsert({ where: { profileId_date: { profileId: input.profileId, date: row.date } }, create: { profileId: input.profileId, date: row.date, sourceFingerprint: result.fingerprint, modelVersion: result.modelVersion, result }, update: { sourceFingerprint: result.fingerprint, modelVersion: result.modelVersion, result } });
    prior = result.state;
  }
}
