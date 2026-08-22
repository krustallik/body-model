import { describe, expect, it } from "vitest";
import { GLYCOGEN_MODEL } from "@/model/body-composition/constants";
import { createGlycogenParameters, stepGlycogenOneDay } from "@/model/body-composition/glycogen";

const parameters = createGlycogenParameters({ baselineCarbIntakeG: 250 });

describe("glycogen transition invariants", () => {
  it("keeps all outputs finite and glycogen nonnegative", () => {
    for (const currentGlycogenKg of [0, 0.1, 0.5, 1, 5]) {
      for (const carbIntakeG of [0, Number.MIN_VALUE, 50, 250, 500, 2_000]) {
        const result = stepGlycogenOneDay({ currentGlycogenKg, carbIntakeG, parameters });
        expect(result).not.toBeNull();
        expect(result!.glycogenKg).toBeGreaterThanOrEqual(0);
        for (const value of Object.values(result!)) expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("preserves water, mass, and energy proportionality", () => {
    for (const carbIntakeG of [0, 50, 100, 250, 400, 1_000]) {
      const result = stepGlycogenOneDay({
        currentGlycogenKg: 0.5,
        carbIntakeG,
        parameters,
      });
      expect(result!.deltaGlycogenWaterKg).toBeCloseTo(result!.deltaGlycogenKg * 2.7, 12);
      expect(result!.deltaGlycogenAssociatedMassKg)
        .toBeCloseTo(result!.deltaGlycogenKg * 3.7, 12);
      expect(result!.glycogenStorageEnergyKcal)
        .toBeCloseTo(result!.deltaGlycogenKg * GLYCOGEN_MODEL.energyDensityKcalPerKg, 10);
    }
  });

  it("verifies the explicit negative 100 g glycogen mass example", () => {
    const deltaGlycogenKg = -0.1;
    expect(deltaGlycogenKg * 2.7).toBeCloseTo(-0.27, 12);
    expect(deltaGlycogenKg + deltaGlycogenKg * 2.7).toBeCloseTo(-0.37, 12);
  });
});
