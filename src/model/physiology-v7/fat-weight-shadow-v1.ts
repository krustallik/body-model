import { partitionEnergyBalance } from "@/model/body-composition/partition";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

export const FAT_WEIGHT_SHADOW_V1_VERSION = "bodycast-fat-weight-shadow-v1" as const;
export type FatWeightShadowStateV1 = { fatMassKg: number | null; slowNonFatKg: number | null; availability: "available" | "unavailable"; provenance: "episode-bia-derived-estimate" | null; uncertainty: "personal-unavailable" };
export function transitionFatWeightShadowV1(input: { prior: FatWeightShadowStateV1; energyBalanceKcal: number | null; observedWeightKg: number | null; observedBodyFatPercent: number | null }) {
  const reasons: string[] = [];
  if (input.prior.availability === "unavailable" || input.prior.fatMassKg === null || input.prior.slowNonFatKg === null) reasons.push("missing-defensible-initial-fat-state");
  if (input.energyBalanceKcal === null) reasons.push("missing-energy-balance");
  const state = reasons.length > 0 ? { fatMassKg: null, slowNonFatKg: null, availability: "unavailable" as const, provenance: null, uncertainty: "personal-unavailable" as const }
    : (() => { const p = partitionEnergyBalance({ fatMassKg: input.prior.fatMassKg!, availableEnergyKcal: input.energyBalanceKcal! }); return { fatMassKg: input.prior.fatMassKg! + p.deltaFatMassKg, slowNonFatKg: input.prior.slowNonFatKg! + p.deltaLeanTissueKg, availability: "available" as const, provenance: "episode-bia-derived-estimate" as const, uncertainty: "personal-unavailable" as const }; })();
  return { modelVersion: FAT_WEIGHT_SHADOW_V1_VERSION, state, observation: { scaleWeightKg: input.observedWeightKg, bodyFatPercent: input.observedBodyFatPercent, handling: "noisy-not-state-overwrite" as const }, reasons, fingerprint: stableSha256({ input, state, reasons, version: FAT_WEIGHT_SHADOW_V1_VERSION }) };
}
