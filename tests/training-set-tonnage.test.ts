import { describe, expect, it } from "vitest";
import { RESISTANCE } from "@/modules/training/training.constants";
import { ordinaryExternalWeightTonnageKg } from "@/modules/training/training.tonnage";
import { validateSetFields } from "@/modules/training/training.set-validation";

describe("validateSetFields", () => {
  it("accepts EXTERNAL_WEIGHT with weightKg and null band", () => {
    expect(validateSetFields(RESISTANCE.EXTERNAL_WEIGHT, {
      reps: 10,
      weightKg: 30,
      bandNominalResistanceKg: null,
    })).toEqual({
      ok: true,
      reps: 10,
      weightKg: 30,
      bandNominalResistanceKg: null,
    });
  });

  it("accepts RESISTANCE_BAND with band only", () => {
    expect(validateSetFields(RESISTANCE.RESISTANCE_BAND, {
      reps: 10,
      weightKg: null,
      bandNominalResistanceKg: 108,
    })).toEqual({
      ok: true,
      reps: 10,
      weightKg: null,
      bandNominalResistanceKg: 108,
    });
  });

  it("accepts BODYWEIGHT with reps only", () => {
    expect(validateSetFields(RESISTANCE.BODYWEIGHT, {
      reps: 20,
      weightKg: null,
      bandNominalResistanceKg: null,
    })).toEqual({
      ok: true,
      reps: 20,
      weightKg: null,
      bandNominalResistanceKg: null,
    });
  });

  it("rejects mixed weight and band", () => {
    expect(validateSetFields(RESISTANCE.EXTERNAL_WEIGHT, {
      reps: 8,
      weightKg: 40,
      bandNominalResistanceKg: 108,
    }).ok).toBe(false);
  });

  it("rejects weightKg on BODYWEIGHT (no fake 0 kg)", () => {
    expect(validateSetFields(RESISTANCE.BODYWEIGHT, {
      reps: 12,
      weightKg: 0,
    }).ok).toBe(false);
  });

  it("rejects band on EXTERNAL_WEIGHT and weight on RESISTANCE_BAND", () => {
    expect(validateSetFields(RESISTANCE.EXTERNAL_WEIGHT, {
      reps: 8,
      bandNominalResistanceKg: 50,
    }).ok).toBe(false);
    expect(validateSetFields(RESISTANCE.RESISTANCE_BAND, {
      reps: 8,
      weightKg: 50,
    }).ok).toBe(false);
  });
});

describe("ordinaryExternalWeightTonnageKg", () => {
  it("sums only external-weight sets and excludes band/bodyweight", () => {
    expect(ordinaryExternalWeightTonnageKg([
      { resistanceType: RESISTANCE.EXTERNAL_WEIGHT, weightKg: 30, reps: 12 },
      { resistanceType: RESISTANCE.EXTERNAL_WEIGHT, weightKg: 32.5, reps: 10 },
      { resistanceType: RESISTANCE.EXTERNAL_WEIGHT, weightKg: 32.5, reps: 9 },
      { resistanceType: RESISTANCE.RESISTANCE_BAND, weightKg: null, reps: 12 },
      { resistanceType: RESISTANCE.BODYWEIGHT, weightKg: null, reps: 20 },
    ])).toBe(30 * 12 + 32.5 * 10 + 32.5 * 9);
  });

  it("returns null when no external-weight contribution exists", () => {
    expect(ordinaryExternalWeightTonnageKg([
      { resistanceType: RESISTANCE.RESISTANCE_BAND, weightKg: null, reps: 12 },
      { resistanceType: RESISTANCE.BODYWEIGHT, weightKg: null, reps: 20 },
      { resistanceType: RESISTANCE.EXTERNAL_WEIGHT, weightKg: null, reps: 10 },
    ])).toBeNull();
  });
});
