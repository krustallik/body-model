import { partitionEnergyBalance, type EnergyPartitionResult } from "./partition";

export type GlycogenAwareEnergyInput = {
  totalEnergyBalanceKcal: number;
  glycogenStorageEnergyKcal: number;
  fatMassKg: number;
};

export type GlycogenAwareEnergyResult = EnergyPartitionResult & {
  totalEnergyBalanceKcal: number;
  glycogenStorageEnergyKcal: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

/** Allocates total balance to glycogen first, then partitions the remainder. */
export function partitionEnergyBalanceAfterGlycogen(
  input: GlycogenAwareEnergyInput,
): GlycogenAwareEnergyResult {
  assertFinite("totalEnergyBalanceKcal", input.totalEnergyBalanceKcal);
  assertFinite("glycogenStorageEnergyKcal", input.glycogenStorageEnergyKcal);
  const partitionableEnergyKcal = input.totalEnergyBalanceKcal
    - input.glycogenStorageEnergyKcal;
  const partition = partitionEnergyBalance({
    partitionableEnergyKcal,
    fatMassKg: input.fatMassKg,
  });
  return {
    totalEnergyBalanceKcal: input.totalEnergyBalanceKcal,
    glycogenStorageEnergyKcal: input.glycogenStorageEnergyKcal,
    ...partition,
  };
}
