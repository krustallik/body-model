type OptionalEnergy = number | null | undefined;

export type BaseTdeeInput = {
  rmrKcal: number;
  tefKcal: OptionalEnergy;
  activityKcal: OptionalEnergy;
};

function validateEnergy(name: string, value: OptionalEnergy, allowZero: boolean): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  if (value < 0 || (!allowZero && value === 0)) {
    throw new RangeError(`${name} must be ${allowZero ? "nonnegative" : "positive"}`);
  }
}

/** Returns the non-personalized RMR + TEF + net Activity estimate. */
export function calculateBaseTdee(input: BaseTdeeInput): number | null {
  validateEnergy("rmrKcal", input.rmrKcal, false);
  validateEnergy("tefKcal", input.tefKcal, true);
  validateEnergy("activityKcal", input.activityKcal, true);

  if (input.tefKcal === null || input.tefKcal === undefined
      || input.activityKcal === null || input.activityKcal === undefined) {
    return null;
  }
  return input.rmrKcal + input.tefKcal + input.activityKcal;
}
