export const MACRO_ENERGY_KCAL_PER_GRAM = Object.freeze({ protein: 4, fat: 9, carbohydrate: 4 });
/** Retained product fallback from the existing default plan; it is not a personal energy estimate. */
export const DEFAULT_STARTING_CALORIES_KCAL = 2200;
/** Retained product fallback from the existing default plan; used only when weight is missing. */
export const DEFAULT_STARTING_PROTEIN_G = 150;
/** Product-rounded sedentary/maintenance protein heuristic; 0.8 approximates, but is not the exact, 0.83 g/kg EFSA PRI. */
export const APPROXIMATE_UNTRAINED_PROTEIN_PER_KG_G = 0.8;
/** Lower edge of the adult National Academies AMDR; a template distribution, not a clinical minimum. */
export const MIN_FAT_ENERGY_FRACTION = 0.2;
/** Product template preference, kept inside the adult 20–35% fat AMDR. */
export const PREFERRED_FAT_ENERGY_FRACTION = 0.25;
/** National Academies adult AMDR bounds (2005 DRI): protein 10–35% energy. */
export const ADULT_MIN_PROTEIN_ENERGY_FRACTION = 0.1;
export const ADULT_MAX_PROTEIN_ENERGY_FRACTION = 0.35;
/** Adult National Academies AMDR: carbohydrate 45–65% energy. */
export const ADULT_MIN_CARBOHYDRATE_ENERGY_FRACTION = 0.45;
export const ADULT_MAX_CARBOHYDRATE_ENERGY_FRACTION = 0.65;
/** Product guardrail only: it reports pace for review and never changes calories. */
export const LOSS_PACE_REVIEW_LIMIT_PER_WEEK = 0.01;
/** Product review heuristic informed by off-season bodybuilding guidance; not a general safe-rate limit. */
export const GAIN_PACE_REVIEW_LIMIT_PER_WEEK = 0.005;

export type NutritionRecommendationInput = {
  currentWeightKg?: number | null;
  modeledTdeeKcalPerDay?: number | null;
  modelEnergyStatus?: "available" | "limited";
  calibrationStatus?: "fully-calibrated" | "offset-only" | "insufficient-history" | "invalid-history" | "defaults-retained";
  strengthSessionsPerWeek?: number;
  otherTrainingSessionsPerWeek?: number;
  averageStepsPerDay?: number;
  workActivity?: { planned: boolean; daysPerWeek?: number };
  targetWeightKg?: number | null;
  targetDate?: string | null;
  latestModeledDate?: string | null;
  /** Optional profile metadata. Adult macro rules here do not use sex or height. */
  ageYears?: number | null;
  bodyCompositionAvailable?: boolean;
  sex?: "female" | "male" | "other" | null;
  heightCm?: number | null;
};

export type NutritionLimitationCode =
  | "model-expenditure-unavailable"
  | "current-weight-unavailable"
  | "target-date-or-weight-incomplete"
  | "target-date-invalid"
  | "target-rate-review"
  | "adult-guidance-only"
  | "older-adult-guidance-not-modeled"
  | "body-composition-and-clinical-context-not-modeled"
  | "invalid-input"
  | "protein-energy-bound";

export type NutritionRecommendation = {
  nutrition: { caloriesKcal: number; proteinG: number; fatG: number; carbsG: number };
  basis: "model-tdee" | "product-fallback";
  confidence: "model-anchored" | "approximate" | "fallback";
  limitations: NutritionLimitationCode[];
};

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function validDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00.000Z`).getTime();
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function targetRateNeedsReview(input: NutritionRecommendationInput): boolean | "invalid" | null {
  if (input.targetWeightKg == null && input.targetDate == null) return null;
  if (!isPositiveFinite(input.currentWeightKg) || !isPositiveFinite(input.targetWeightKg)
      || !input.latestModeledDate || !input.targetDate) return null;
  const start = validDate(input.latestModeledDate);
  const end = validDate(input.targetDate);
  if (start === null || end === null || end <= start) return "invalid";
  const days = (end - start) / 86_400_000;
  const weeklyRelativeChange = (input.targetWeightKg - input.currentWeightKg) / input.currentWeightKg * 7 / days;
  if (weeklyRelativeChange < 0) {
    // Loss limit reflects the upper end of the 0.5–1.0%/week athlete-prep discussion (Helms et al., PMID 24864135).
    return -weeklyRelativeChange > LOSS_PACE_REVIEW_LIMIT_PER_WEEK;
  }
  // Gain limit reflects the upper end of 0.25–0.5%/week novice/intermediate bodybuilder guidance
  // (Iraki et al., PMID 31247944); neither athlete threshold is a general clinical safe-rate limit.
  return weeklyRelativeChange > GAIN_PACE_REVIEW_LIMIT_PER_WEEK;
}

/**
 * Deterministic starter template. Current modeled TDEE anchors energy; activity is deliberately not
 * added again because the model expenditure already reflects the modeled activity history.
 * Goal target/date only emit a review limitation; the target solver owns calorie search.
 */
export function recommendNutrition(input: NutritionRecommendationInput): NutritionRecommendation {
  const numericInputs = [input.currentWeightKg, input.modeledTdeeKcalPerDay, input.strengthSessionsPerWeek,
    input.otherTrainingSessionsPerWeek, input.averageStepsPerDay, input.workActivity?.daysPerWeek,
    input.targetWeightKg, input.ageYears, input.heightCm];
  const invalidInput = numericInputs.some((value) => value != null && !Number.isFinite(value))
    || (input.sex != null && !["female", "male", "other"].includes(input.sex));
  const usableTdee = isPositiveFinite(input.modeledTdeeKcalPerDay)
    && input.modelEnergyStatus !== "limited"
    && input.calibrationStatus !== "invalid-history"
    && input.calibrationStatus !== "insufficient-history"
    ? input.modeledTdeeKcalPerDay : null;
  const modelAvailable = usableTdee !== null;
  const caloriesKcal = Math.round(usableTdee ?? DEFAULT_STARTING_CALORIES_KCAL);
  const limitations: NutritionLimitationCode[] = [];
  if (invalidInput) limitations.push("invalid-input");
  if (!modelAvailable) limitations.push("model-expenditure-unavailable");
  if (!isPositiveFinite(input.currentWeightKg)) limitations.push("current-weight-unavailable");
  if (input.ageYears != null && input.ageYears < 18) limitations.push("adult-guidance-only");
  // Older-adult expert guidance can recommend higher protein than the generic adult RDA;
  // do not silently present the general rule as age-tailored (e.g. PROT-AGE, PMID 23867520).
  if (input.ageYears != null && input.ageYears >= 65) limitations.push("older-adult-guidance-not-modeled");
  // The generic template does not use body composition or clinical context, even when those
  // values exist elsewhere in the model. Keep that scope visible instead of implying tailoring.
  if (input.bodyCompositionAvailable) limitations.push("body-composition-and-clinical-context-not-modeled");

  const pace = targetRateNeedsReview(input);
  if (pace === true) limitations.push("target-rate-review");
  else if (pace === "invalid") limitations.push("target-date-invalid");
  else if ((input.targetWeightKg != null || input.targetDate != null)
      && (!isPositiveFinite(input.targetWeightKg) || !input.targetDate || !input.latestModeledDate)) {
    limitations.push("target-date-or-weight-incomplete");
  }

  const strengthTraining = (input.strengthSessionsPerWeek ?? 0) > 0;
  const otherTraining = (input.otherTrainingSessionsPerWeek ?? 0) > 0;
  const losing = isPositiveFinite(input.currentWeightKg)
    && isPositiveFinite(input.targetWeightKg)
    && input.targetWeightKg < input.currentWeightKg;
  // Resistance training: 1.6 g/kg/day is within the ISSN 1.4–2.0 range (DOI 10.1186/s12970-017-0177-8)
  // and near the Morton meta-analysis breakpoint (PMID 28698222; 1.62, 95% CI 1.03–2.20).
  // Other exercise uses the ISSN lower bound. Sedentary loss uses 1.0 g/kg as an explicitly
  // approximate product choice. 0.8 is rounded from EFSA's 0.83 g/kg PRI, not that exact PRI
  // (EFSA DOI 10.2903/j.efsa.2012.2557).
  const proteinPerKg = strengthTraining ? 1.6 : otherTraining ? 1.4 : losing ? 1.0 : APPROXIMATE_UNTRAINED_PROTEIN_PER_KG_G;
  const rawProteinG = isPositiveFinite(input.currentWeightKg)
    ? input.currentWeightKg * proteinPerKg : DEFAULT_STARTING_PROTEIN_G;
  const proteinMinG = caloriesKcal * ADULT_MIN_PROTEIN_ENERGY_FRACTION
    / MACRO_ENERGY_KCAL_PER_GRAM.protein;
  const proteinMaxG = caloriesKcal * ADULT_MAX_PROTEIN_ENERGY_FRACTION
    / MACRO_ENERGY_KCAL_PER_GRAM.protein;
  const proteinG = roundTo(Math.min(proteinMaxG, Math.max(proteinMinG, rawProteinG)), 6);
  if (proteinG !== roundTo(rawProteinG, 6)) limitations.push("protein-energy-bound");
  const proteinEnergyFraction = proteinG * MACRO_ENERGY_KCAL_PER_GRAM.protein / caloriesKcal;
  const fatEnergyFraction = Math.max(
    MIN_FAT_ENERGY_FRACTION,
    Math.min(PREFERRED_FAT_ENERGY_FRACTION, 1 - ADULT_MIN_CARBOHYDRATE_ENERGY_FRACTION - proteinEnergyFraction),
  );
  const fatG = roundTo(caloriesKcal * fatEnergyFraction / MACRO_ENERGY_KCAL_PER_GRAM.fat, 6);
  const carbsG = roundTo((caloriesKcal
    - proteinG * MACRO_ENERGY_KCAL_PER_GRAM.protein
    - fatG * MACRO_ENERGY_KCAL_PER_GRAM.fat) / MACRO_ENERGY_KCAL_PER_GRAM.carbohydrate, 6);

  const qualitySignalsUsable = modelAvailable && isPositiveFinite(input.currentWeightKg)
    && input.ageYears !== undefined && input.ageYears !== null && input.ageYears >= 18
    && input.calibrationStatus === "fully-calibrated";
  return {
    nutrition: { caloriesKcal, proteinG, fatG, carbsG },
    basis: modelAvailable ? "model-tdee" : "product-fallback",
    confidence: !modelAvailable ? "fallback" : qualitySignalsUsable && limitations.length === 0
      ? "model-anchored" : "approximate",
    limitations,
  };
}
