export type EnergyBalanceInput = {
  intakeKcal: number;
  expenditureKcal: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

/**
 * Returns intake minus expenditure. A deficit is negative and a surplus is positive.
 */
export function calculateEnergyBalance(input: EnergyBalanceInput): number {
  assertFinite("intakeKcal", input.intakeKcal);
  assertFinite("expenditureKcal", input.expenditureKcal);

  if (input.intakeKcal < 0) throw new RangeError("intakeKcal must be nonnegative");
  if (input.expenditureKcal <= 0) throw new RangeError("expenditureKcal must be positive");

  return input.intakeKcal - input.expenditureKcal;
}
