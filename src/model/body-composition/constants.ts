/** Exact thermochemical conversion used for the Hall model constants. */
export const KILOJOULES_PER_KILOCALORIE = 4.184;

/** Effective tissue energy densities from the Hall/NIDDK body-weight model. */
export const BODY_COMPARTMENT_ENERGY_DENSITY = {
  fatMassMjPerKg: 39.5,
  leanTissueMjPerKg: 7.6,
  fatMassKcalPerKg: 39_500 / KILOJOULES_PER_KILOCALORIE,
  leanTissueKcalPerKg: 7_600 / KILOJOULES_PER_KILOCALORIE,
} as const;

/** Coefficient in the local Forbes relation used for Hall lean-tissue partitioning. */
export const FORBES_COEFFICIENT_KG = 10.4;

/** Intracellular water stored with each kg of glycogen in the Hall/NIDDK model. */
export const GLYCOGEN_WATER_KG_PER_KG = 2.7;

/**
 * Hall's energy-partition constant C = 10.4 * rho_L / rho_F.
 * Its unit is kg and its value is approximately 2.001 kg.
 */
export const FORBES_ENERGY_PARTITION_CONSTANT_KG =
  FORBES_COEFFICIENT_KG
  * BODY_COMPARTMENT_ENERGY_DENSITY.leanTissueMjPerKg
  / BODY_COMPARTMENT_ENERGY_DENSITY.fatMassMjPerKg;
