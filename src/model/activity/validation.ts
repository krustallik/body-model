import { MODEL_INPUT_LIMITS } from "../constants";

export function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

export function assertWeight(weightKg: number): void {
  assertFinite("weightKg", weightKg);
  if (weightKg <= MODEL_INPUT_LIMITS.weightKg.minimumExclusive
      || weightKg > MODEL_INPUT_LIMITS.weightKg.maximumInclusive) {
    throw new RangeError("weightKg is outside the supported physical range");
  }
}

export function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

export function validateOptionalNonnegative(name: string, value: number | null | undefined): void {
  if (value === null || value === undefined) return;
  assertFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must not be negative`);
}
