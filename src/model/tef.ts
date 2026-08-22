import { KCAL_PER_GRAM, TEF_COEFFICIENTS } from "./constants";

type MacroValue = number | null | undefined;

export type TefInput = {
  proteinG: MacroValue;
  carbsG: MacroValue;
  fatG: MacroValue;
};

function validateMacro(name: string, value: MacroValue): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  if (value < 0) throw new RangeError(`${name} must not be negative`);
}

/** Returns estimated thermic effect of food in kcal/day, or null if any macro is missing. */
export function calculateTef(input: TefInput): number | null {
  validateMacro("proteinG", input.proteinG);
  validateMacro("carbsG", input.carbsG);
  validateMacro("fatG", input.fatG);

  if (input.proteinG === null || input.proteinG === undefined
      || input.carbsG === null || input.carbsG === undefined
      || input.fatG === null || input.fatG === undefined) {
    return null;
  }

  return input.proteinG * KCAL_PER_GRAM.protein * TEF_COEFFICIENTS.protein
    + input.carbsG * KCAL_PER_GRAM.carbs * TEF_COEFFICIENTS.carbs
    + input.fatG * KCAL_PER_GRAM.fat * TEF_COEFFICIENTS.fat;
}
