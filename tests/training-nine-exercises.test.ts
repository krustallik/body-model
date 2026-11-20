import { describe, expect, it } from "vitest";
import { resolveExerciseImageSrc } from "@/app/training/exercise-images";
import { resolveExerciseInfo } from "@/app/training/exercise-info";
import {
  ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES,
  CANONICAL_EXERCISES_WITHOUT_V7_MAPPING,
  CANONICAL_EXERCISE_IDENTITIES,
} from "@/modules/training/canonical-exercise-identity";
import {
  LEGACY_LOAD_CONFIGS_V1,
  loadConfigV1Schema,
} from "@/modules/training/load-accounting-v1";
import {
  externalWeightEntryLabel,
  lookupExternalLoadAccountingV1,
} from "@/modules/training/external-load-accounting";
import { ordinaryExternalWeightTonnageKg } from "@/modules/training/training.tonnage";
import { recommendedResistanceTypeForCatalogStableKey, RESISTANCE } from "@/modules/training/training.constants";

const expected = [
  { key: "front_foot_elevated_split_squat", name: "Спліт-присідання з піднятою передньою стопою", image: "front-foot-elevated-split-squat.png", resistance: "external", factor: 4, label: "Вага на гантелю, кг" },
  { key: "romanian_deadlift", name: "Румунська тяга (Romanian Deadlift)", image: "romanian-deadlift.png", resistance: "external", factor: 1, label: "Загальна зовнішня вага, кг" },
  { key: "cable_leg_curl", name: "Згинання ніг із нижнім блоком", image: "cable-leg-curl.png", resistance: "band-nominal", factor: null, label: null },
  { key: "barbell_hip_thrust", name: "Підйом таза зі штангою (Hip Thrust)", image: "barbell-hip-thrust.png", resistance: "external", factor: 1, label: "Загальна зовнішня вага, кг" },
  { key: "cable_glute_kickback", name: "Відведення ноги назад із нижнім блоком", image: "cable-glute-kickback.png", resistance: "band-nominal", factor: null, label: null },
  { key: "single_leg_standing_calf_raise", name: "Підйоми на носок стоячи на одній нозі", image: "single-leg-standing-calf-raise.png", resistance: "external", factor: 2, label: "Вага на сторону, кг" },
  { key: "seated_calf_raise", name: "Підйоми на носок сидячи", image: "seated-calf-raise.png", resistance: "external", factor: 1, label: "Загальна зовнішня вага, кг" },
  { key: "cable_hip_adduction", name: "Приведення ноги на нижньому блоці", image: "cable-hip-adduction.png", resistance: "band-nominal", factor: null, label: null },
  { key: "cable_hip_abduction", name: "Відведення ноги вбік на нижньому блоці", image: "cable-hip-abduction.png", resistance: "band-nominal", factor: null, label: null },
] as const;

describe("nine new Training exercises", () => {
  it("adds the requested stable identities once, without aliases colliding", () => {
    expect(ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES).toHaveLength(9);
    expect(CANONICAL_EXERCISE_IDENTITIES).toHaveLength(27);
    expect(new Set(CANONICAL_EXERCISE_IDENTITIES.map(({ stableKey }) => stableKey)).size).toBe(27);
    expect(new Set(CANONICAL_EXERCISE_IDENTITIES.map(({ displayName }) => displayName)).size).toBe(27);
    for (const item of expected) {
      expect(ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES).toContainEqual({ stableKey: item.key, displayName: item.name });
    }
  });

  it("keeps cable-stack nominal resistance distinct from external loads", () => {
    for (const item of expected) {
      const config = LEGACY_LOAD_CONFIGS_V1[item.key];
      expect(loadConfigV1Schema.safeParse(config).success).toBe(true);
      expect(config.resistanceType).toBe(item.resistance);
      expect(config.equipment.equipmentId).toBeTruthy();
      expect(lookupExternalLoadAccountingV1(item.key)).not.toBeNull();
      expect(config.resistanceType).not.toBe("bodyweight");
      expect(recommendedResistanceTypeForCatalogStableKey(item.key)).toBe(
        item.resistance === "band-nominal" ? RESISTANCE.RESISTANCE_BAND : RESISTANCE.EXTERNAL_WEIGHT,
      );
      if (item.resistance === "external") {
        expect(externalWeightEntryLabel(item.key, true)).toBe(item.label);
      } else {
        expect(config).toMatchObject({
          accountingKind: "band-nominal-per-logged-side",
          resistanceType: "band-nominal",
          equipment: { equipmentId: "cable-stack" },
          loadInput: "nominal-kg-per-logged-side",
          repsMeaning: "per-logged-side",
        });
      }
    }

    expect(LEGACY_LOAD_CONFIGS_V1.front_foot_elevated_split_squat).toMatchObject({
      accountingKind: "external-per-implement-pair-per-side",
      execution: "unilateral",
      repsMeaning: "per-side",
      inventoryCount: 2,
      loadedSides: 2,
    });
    for (const key of ["single_leg_standing_calf_raise"] as const) {
      expect(LEGACY_LOAD_CONFIGS_V1[key]).toMatchObject({
        accountingKind: "external-per-implement-per-side",
        execution: "unilateral",
        repsMeaning: "per-side",
        loadedSides: 2,
      });
    }
    for (const key of ["romanian_deadlift", "barbell_hip_thrust", "seated_calf_raise"] as const) {
      expect(LEGACY_LOAD_CONFIGS_V1[key]).toMatchObject({
        accountingKind: "external-complete-setup-per-movement",
        execution: "simultaneous",
        repsMeaning: "per-movement",
      });
    }
  });

  it("applies the declared tonnage factor and never counts bodyweight/band fields", () => {
    for (const item of expected) {
      if (item.resistance !== "external" || item.factor === null) continue;
      expect(ordinaryExternalWeightTonnageKg([{
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        stableKey: item.key,
        weightKg: 10,
        reps: 8,
      }])).toBe(10 * 8 * item.factor);
    }
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.BODYWEIGHT,
      stableKey: "front_foot_elevated_split_squat",
      weightKg: null,
      reps: 8,
    }])).toBeNull();
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.RESISTANCE_BAND,
      stableKey: "cable_leg_curl",
      weightKg: null,
      reps: 8,
    }])).toBeNull();
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.RESISTANCE_BAND,
      stableKey: "cable_leg_curl",
      weightKg: 10,
      reps: 8,
    }])).toBeNull();
  });

  it("resolves every supplied illustration and bilingual exercise details by exact catalog name", () => {
    for (const item of expected) {
      expect(resolveExerciseImageSrc({ catalogName: item.name })).toBe(`/training/exercises/${item.image}`);
      const info = resolveExerciseInfo({ catalogName: item.name });
      expect(info?.primaryMusclesUk).toBeTruthy();
      expect(info?.primaryMusclesEn).toBeTruthy();
      expect(info?.cuesUk.length).toBeGreaterThan(0);
      expect(info?.cuesEn.length).toBeGreaterThan(0);
      expect(CANONICAL_EXERCISES_WITHOUT_V7_MAPPING).toContain(item.key);
    }
  });
});
