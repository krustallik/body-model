import { describe, expect, it } from "vitest";
import { partitionEnergyBalanceAfterGlycogen } from "@/model/body-composition/energy-accounting";
import { stepExtracellularFluidOneDay } from "@/model/body-composition/extracellular-fluid";
import { stepGlycogenOneDay, createGlycogenParameters } from "@/model/body-composition/glycogen";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";

const baseState = {
  fatMassKg: 16,
  leanTissueKg: 47.15,
  glycogenKg: 0.5,
  baselineExtracellularFluidLiters: 15,
  extracellularFluidDeviationLiters: 0,
};

describe("extracellular-fluid cross-module invariants", () => {
  it("keeps ECF mass distinct from glycogen and its associated water", () => {
    const baselineWeight = reconstructBodyWeightKg(baseState);
    const moreGlycogen = reconstructBodyWeightKg({ ...baseState, glycogenKg: 0.6 });
    const moreEcf = reconstructBodyWeightKg({
      ...baseState, extracellularFluidDeviationLiters: 0.1,
    });
    expect(moreGlycogen - baselineWeight).toBeCloseTo(0.37, 12);
    expect(moreEcf - baselineWeight).toBeCloseTo(0.1, 12);
  });

  it("reconstructs exactly the ECF transition's mass change", () => {
    const transition = stepExtracellularFluidOneDay({
      baselineExtracellularFluidLiters: 15,
      currentExtracellularFluidDeviationLiters: 0,
      carbIntakeG: 400,
      baselineCarbIntakeG: 250,
      sodiumChangeMgPerDay: 0,
    })!;
    const previousWeight = reconstructBodyWeightKg(baseState);
    const nextWeight = reconstructBodyWeightKg({
      ...baseState,
      extracellularFluidDeviationLiters: transition.extracellularFluidDeviationLiters,
    });
    expect(nextWeight - previousWeight).toBeCloseTo(transition.deltaExtracellularFluidMassKg, 12);
  });

  it("does not enter tissue or glycogen energy accounting", () => {
    const glycogen = stepGlycogenOneDay({
      currentGlycogenKg: 0.5,
      carbIntakeG: 400,
      parameters: createGlycogenParameters({ baselineCarbIntakeG: 250 }),
    })!;
    const energy = partitionEnergyBalanceAfterGlycogen({
      totalEnergyBalanceKcal: -500,
      glycogenStorageEnergyKcal: glycogen.glycogenStorageEnergyKcal,
      fatMassKg: baseState.fatMassKg,
    });
    const ecf = stepExtracellularFluidOneDay({
      baselineExtracellularFluidLiters: 15,
      currentExtracellularFluidDeviationLiters: 0,
      carbIntakeG: 400,
      baselineCarbIntakeG: 250,
      sodiumChangeMgPerDay: 1_000,
    })!;
    expect(energy.glycogenStorageEnergyKcal + energy.fatStorageEnergyKcal
      + energy.leanTissueStorageEnergyKcal + energy.totalRemodelingEnergyKcal)
      .toBeCloseTo(energy.totalEnergyBalanceKcal, 10);
    expect(ecf.deltaExtracellularFluidMassKg).not.toBe(0);
  });

  it("produces only finite, positive absolute ECF for representative valid inputs", () => {
    for (const deviation of [-1, 0, 1]) {
      for (const carbIntakeG of [0, 100, 250, 400, 1_000]) {
        for (const sodiumChangeMgPerDay of [-1_000, 0, 1_000]) {
          const result = stepExtracellularFluidOneDay({
            baselineExtracellularFluidLiters: 17,
            currentExtracellularFluidDeviationLiters: deviation,
            carbIntakeG,
            baselineCarbIntakeG: 250,
            sodiumChangeMgPerDay,
          })!;
          expect(result.extracellularFluidLiters).toBeGreaterThan(0);
          for (const value of Object.values(result)) expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });
});
