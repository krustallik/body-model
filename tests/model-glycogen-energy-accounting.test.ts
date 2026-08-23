import { describe, expect, it } from "vitest";
import { partitionEnergyBalanceAfterGlycogen } from "@/model/body-composition/energy-accounting";
import { createGlycogenParameters, stepGlycogenOneDay } from "@/model/body-composition/glycogen";

const parameters = createGlycogenParameters({ baselineCarbIntakeG: 250 });

describe("glycogen-aware energy accounting", () => {
  it.each([100, 250, 400])("conserves energy for %s g carbohydrate", (carbIntakeG) => {
    const transition = stepGlycogenOneDay({
      currentGlycogenKg: 0.5,
      carbIntakeG,
      parameters,
    });
    expect(transition).not.toBeNull();

    const result = partitionEnergyBalanceAfterGlycogen({
      totalEnergyBalanceKcal: -500,
      glycogenStorageEnergyKcal: transition!.glycogenStorageEnergyKcal,
      fatMassKg: 20,
    });
    expect(
      result.glycogenStorageEnergyKcal
      + result.fatStorageEnergyKcal
      + result.leanTissueStorageEnergyKcal
      + result.totalRemodelingEnergyKcal,
    ).toBeCloseTo(result.totalEnergyBalanceKcal, 10);
  });

  it("leaves less partitionable storage energy when glycogen increases", () => {
    const result = partitionEnergyBalanceAfterGlycogen({
      totalEnergyBalanceKcal: 600,
      glycogenStorageEnergyKcal: 200,
      fatMassKg: 20,
    });
    expect(result.availableEnergyBeforeTissueKcal).toBe(400);
    expect(result.partitionableEnergyKcal).toBeLessThan(400);
  });

  it("adds released glycogen energy to the partitionable balance", () => {
    const result = partitionEnergyBalanceAfterGlycogen({
      totalEnergyBalanceKcal: -500,
      glycogenStorageEnergyKcal: -200,
      fatMassKg: 20,
    });
    expect(result.availableEnergyBeforeTissueKcal).toBe(-300);
    expect(result.partitionableEnergyKcal).toBeGreaterThan(-300);
  });

  it.each([
    { totalEnergyBalanceKcal: 600, glycogenStorageEnergyKcal: 100, expectedSign: 1 },
    { totalEnergyBalanceKcal: -600, glycogenStorageEnergyKcal: -100, expectedSign: -1 },
  ])("closes complete glycogen and tissue energy for $totalEnergyBalanceKcal kcal", (input) => {
    const result = partitionEnergyBalanceAfterGlycogen({ ...input, fatMassKg: 20 });
    expect(result.availableEnergyBeforeTissueKcal).toBe(input.expectedSign * 500);
    expect(result.partitionableEnergyKcal).toBeCloseTo(
      input.expectedSign * 486.0272207457518,
      10,
    );
    expect(result.glycogenStorageEnergyKcal
      + result.fatStorageEnergyKcal
      + result.leanTissueStorageEnergyKcal
      + result.totalRemodelingEnergyKcal).toBeCloseTo(
      result.totalEnergyBalanceKcal,
      10,
    );
  });

  it.each([
    { totalEnergyBalanceKcal: Number.NaN, glycogenStorageEnergyKcal: 0, fatMassKg: 20 },
    { totalEnergyBalanceKcal: 0, glycogenStorageEnergyKcal: Number.POSITIVE_INFINITY, fatMassKg: 20 },
  ])("rejects non-finite energy", (input) => {
    expect(() => partitionEnergyBalanceAfterGlycogen(input)).toThrow(TypeError);
  });

  it("rejects an overflowing partitionable-energy calculation", () => {
    expect(() => partitionEnergyBalanceAfterGlycogen({
      totalEnergyBalanceKcal: Number.MAX_VALUE,
      glycogenStorageEnergyKcal: -Number.MAX_VALUE,
      fatMassKg: 20,
    })).toThrow(TypeError);
  });
});
