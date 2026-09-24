/**
 * Research 6.1 scientific decision: EPOC/recovery physiology is not denied,
 * but a separate numeric recovery-energy component is intentionally not applied.
 * `addedKcal` is null (not applied), never a measured zero.
 */
export const WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION = {
  component: "separate-epoc-recovery-energy",
  application: "intentionally-not-applied",
  numericComponent: "rejected",
  researchAuthority: "research-6.1",
  scientificDecision: "uncertainty-and-double-counting",
  physiologyClaim: "does-not-assert-epoc-is-physiologically-zero",
  addedKcal: null,
} as const;

export type WorkoutRecoveryEnergyScientificDecision =
  typeof WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION;
