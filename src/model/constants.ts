export const MIFFLIN_ST_JEOR = {
  weightKgCoefficient: 10,
  heightCmCoefficient: 6.25,
  ageYearsCoefficient: -5,
  sexOffsetKcalPerDay: {
    male: 5,
    female: -161,
  },
} as const;

export const MODEL_INPUT_LIMITS = {
  weightKg: { minimumExclusive: 0, maximumInclusive: 1_000 },
  heightCm: { minimumExclusive: 0, maximumInclusive: 300 },
  ageYears: { minimumInclusive: 18, maximumInclusive: 120 },
} as const;

export const KCAL_PER_GRAM = {
  protein: 4,
  carbs: 4,
  fat: 9,
} as const;

/**
 * Engineering defaults selected from literature ranges: protein 20–30%,
 * carbohydrate 5–10%, and fat 0–3%. They are configurable model assumptions,
 * not universal physiological constants.
 */
export const TEF_COEFFICIENTS = {
  protein: 0.25,
  carbs: 0.075,
  fat: 0.02,
} as const;

export type ModelSex = keyof typeof MIFFLIN_ST_JEOR.sexOffsetKcalPerDay;
