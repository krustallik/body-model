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

/** Hall/NIDDK simplified glycogen-model assumptions. */
export const GLYCOGEN_MODEL = {
  energyDensityMjPerKg: 17.6,
  energyDensityKcalPerKg: 17_600 / KILOJOULES_PER_KILOCALORIE,
  defaultInitialGlycogenKg: 0.5,
  stepDurationDays: 1,
} as const;

/** Hall/NIDDK simplified extracellular-fluid model constants. */
export const EXTRACELLULAR_FLUID_MODEL = {
  sodiumConcentrationMgPerLiter: 3_220,
  sodiumHomeostasisMgPerLiterPerDay: 3_000,
  carbohydrateResponseMgPerDay: 4_000,
  waterDensityKgPerLiter: 1,
  stepDurationDays: 1,
} as const;

/** Tabibzadeh et al. 2022 externally validated healthy-adult ECFV equation. */
export const EXTRACELLULAR_FLUID_ESTIMATE = {
  weightKgCoefficient: 0.1393,
  heightCmCoefficient: 0.0455,
  ageYearsCoefficient: 0.0125,
  sexInterceptLiters: {
    male: -2.6631,
    female: -3.3407,
  },
} as const;

/**
 * Hall's energy-partition constant C = 10.4 * rho_L / rho_F.
 * Its unit is kg and its value is approximately 2.001 kg.
 */
export const FORBES_ENERGY_PARTITION_CONSTANT_KG =
  FORBES_COEFFICIENT_KG
  * BODY_COMPARTMENT_ENERGY_DENSITY.leanTissueMjPerKg
  / BODY_COMPARTMENT_ENERGY_DENSITY.fatMassMjPerKg;
