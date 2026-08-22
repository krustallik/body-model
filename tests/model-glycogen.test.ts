import { describe, expect, it } from "vitest";
import { GLYCOGEN_MODEL } from "@/model/body-composition/constants";
import {
  createGlycogenParameters,
  stepGlycogenOneDay,
  type GlycogenParameters,
} from "@/model/body-composition/glycogen";

const parameters = createGlycogenParameters({ baselineCarbIntakeG: 250 });

describe("glycogen parameters", () => {
  it("uses the documented Hall constants and explicit kcal conversion", () => {
    expect(GLYCOGEN_MODEL.energyDensityMjPerKg).toBe(17.6);
    expect(GLYCOGEN_MODEL.energyDensityKcalPerKg).toBeCloseTo(4_206.500956022945, 10);
    expect(GLYCOGEN_MODEL.defaultInitialGlycogenKg).toBe(0.5);
    expect(parameters).toEqual({
      baselineCarbIntakeG: 250,
      baselineCarbEnergyKcalPerDay: 1_000,
      initialGlycogenKg: 0.5,
      quadraticOutflowKcalPerKgSquaredPerDay: 4_000,
    });
  });

  it("supports a configurable initial glycogen assumption", () => {
    expect(createGlycogenParameters({
      baselineCarbIntakeG: 300,
      initialGlycogenKg: 0.6,
    })).toEqual({
      baselineCarbIntakeG: 300,
      baselineCarbEnergyKcalPerDay: 1_200,
      initialGlycogenKg: 0.6,
      quadraticOutflowKcalPerKgSquaredPerDay: 1_200 / 0.36,
    });
  });

  it.each([0, -1])("rejects invalid baseline carbohydrate %s", (baselineCarbIntakeG) => {
    expect(() => createGlycogenParameters({ baselineCarbIntakeG })).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects non-finite baseline carbohydrate %s",
    (baselineCarbIntakeG) => {
      expect(() => createGlycogenParameters({ baselineCarbIntakeG })).toThrow(TypeError);
    },
  );

  it.each([0, -1])("rejects invalid initial glycogen %s", (initialGlycogenKg) => {
    expect(() => createGlycogenParameters({ baselineCarbIntakeG: 250, initialGlycogenKg }))
      .toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects non-finite initial glycogen %s",
    (initialGlycogenKg) => {
      expect(() => createGlycogenParameters({ baselineCarbIntakeG: 250, initialGlycogenKg }))
        .toThrow(TypeError);
    },
  );

  it("rejects parameter values outside supported floating-point precision", () => {
    expect(() => createGlycogenParameters({ baselineCarbIntakeG: Number.MIN_VALUE }))
      .toThrow(RangeError);
    expect(() => createGlycogenParameters({ baselineCarbIntakeG: Number.MAX_VALUE }))
      .toThrow(RangeError);
    expect(() => createGlycogenParameters({
      baselineCarbIntakeG: 250,
      initialGlycogenKg: Number.MIN_VALUE,
    })).toThrow(RangeError);
  });
});

describe("stepGlycogenOneDay", () => {
  it("is at equilibrium at baseline intake and initial glycogen", () => {
    const result = stepGlycogenOneDay({
      currentGlycogenKg: 0.5,
      carbIntakeG: 250,
      parameters,
    });
    expect(result?.glycogenKg).toBeCloseTo(0.5, 14);
    expect(result?.deltaGlycogenKg).toBeCloseTo(0, 14);
    expect(result?.glycogenStorageEnergyKcal).toBeCloseTo(0, 12);
  });

  it("reduces glycogen below baseline carbohydrate intake", () => {
    const result = stepGlycogenOneDay({
      currentGlycogenKg: 0.5,
      carbIntakeG: 100,
      parameters,
    });
    expect(result?.glycogenKg).toBeCloseTo(0.4052511555601081, 12);
    expect(result?.deltaGlycogenKg).toBeCloseTo(-0.0947488444398919, 12);
    expect(result?.glycogenStorageEnergyKcal).toBeCloseTo(-398.56110471847455, 9);
  });

  it("increases glycogen above baseline carbohydrate intake", () => {
    const result = stepGlycogenOneDay({
      currentGlycogenKg: 0.5,
      carbIntakeG: 400,
      parameters,
    });
    expect(result?.glycogenKg).toBeCloseTo(0.5895277830461885, 12);
    expect(result?.deltaGlycogenKg).toBeCloseTo(0.08952778304618847, 12);
    expect(result?.glycogenStorageEnergyKcal).toBeCloseTo(376.5987049744066, 9);
  });

  it("treats explicit zero carbs as real zero intake", () => {
    const result = stepGlycogenOneDay({
      currentGlycogenKg: 0.5,
      carbIntakeG: 0,
      parameters,
    });
    expect(result?.glycogenKg).toBeCloseTo(0.33887861983980283, 12);
    expect(result?.deltaGlycogenKg).toBeLessThan(0);
  });

  it.each([null, undefined])("returns unavailable for missing carbs %s", (carbIntakeG) => {
    expect(stepGlycogenOneDay({ currentGlycogenKg: 0.5, carbIntakeG, parameters })).toBeNull();
  });

  it("keeps glycogen nonnegative when both current store and intake are zero", () => {
    const result = stepGlycogenOneDay({
      currentGlycogenKg: 0,
      carbIntakeG: 0,
      parameters,
    });
    expect(result?.glycogenKg).toBe(0);
    expect(result?.deltaGlycogenKg).toBe(0);
  });

  it("derives water, associated mass, and chemical energy from glycogen change", () => {
    const result = stepGlycogenOneDay({
      currentGlycogenKg: 0.5,
      carbIntakeG: 100,
      parameters,
    });
    expect(result).not.toBeNull();
    expect(result!.deltaGlycogenWaterKg).toBeCloseTo(result!.deltaGlycogenKg * 2.7, 12);
    expect(result!.deltaGlycogenAssociatedMassKg).toBeCloseTo(
      result!.deltaGlycogenKg * 3.7,
      12,
    );
    expect(result!.glycogenStorageEnergyKcal).toBeCloseTo(
      result!.deltaGlycogenKg * GLYCOGEN_MODEL.energyDensityKcalPerKg,
      12,
    );
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid current glycogen %s",
    (currentGlycogenKg) => {
      expect(() => stepGlycogenOneDay({ currentGlycogenKg, carbIntakeG: 250, parameters }))
        .toThrowError();
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid carbohydrate intake %s",
    (carbIntakeG) => {
      expect(() => stepGlycogenOneDay({ currentGlycogenKg: 0.5, carbIntakeG, parameters }))
        .toThrowError();
    },
  );

  it("rejects carbohydrate and transitions outside supported numeric precision", () => {
    expect(() => stepGlycogenOneDay({
      currentGlycogenKg: 0.5,
      carbIntakeG: Number.MAX_VALUE,
      parameters,
    })).toThrow(RangeError);
    expect(() => stepGlycogenOneDay({
      currentGlycogenKg: Number.MAX_VALUE,
      carbIntakeG: 250,
      parameters,
    })).toThrow(RangeError);
    expect(() => stepGlycogenOneDay({
      currentGlycogenKg: 0.5,
      carbIntakeG: Number.MAX_VALUE / 4,
      parameters: {
        ...parameters,
        quadraticOutflowKcalPerKgSquaredPerDay:
          Number.MIN_VALUE * GLYCOGEN_MODEL.energyDensityKcalPerKg,
      },
    })).toThrow(RangeError);
  });

  it.each([
    { ...parameters, baselineCarbIntakeG: 0 },
    { ...parameters, baselineCarbEnergyKcalPerDay: 0 },
    { ...parameters, initialGlycogenKg: 0 },
    { ...parameters, quadraticOutflowKcalPerKgSquaredPerDay: 0 },
    { ...parameters, quadraticOutflowKcalPerKgSquaredPerDay: Number.NaN },
    { ...parameters, quadraticOutflowKcalPerKgSquaredPerDay: Number.MIN_VALUE },
  ])("rejects forged invalid parameters", (forgedParameters: GlycogenParameters) => {
    expect(() => stepGlycogenOneDay({
      currentGlycogenKg: 0.5,
      carbIntakeG: 250,
      parameters: forgedParameters,
    })).toThrowError();
  });
});
