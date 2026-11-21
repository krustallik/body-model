import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveExerciseInfo } from "@/app/training/exercise-info";
import { resolveExerciseImageSrc } from "@/app/training/exercise-images";
import { exercisePickerMetadata } from "@/app/training/exercise-picker-catalog";
import { externalWeightEntryLabel, lookupExternalLoadAccountingV1 } from "@/modules/training/external-load-accounting";
import { LEGACY_LOAD_CONFIGS_V1, loadConfigV1Schema } from "@/modules/training/load-accounting-v1";
import { recommendedResistanceTypeForCatalogStableKey, RESISTANCE } from "@/modules/training/training.constants";
import { ordinaryExternalWeightTonnageKg } from "@/modules/training/training.tonnage";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";

const variants = [
  { key: "lying_single_arm_dumbbell_triceps_extension_flat", flat: true, unilateral: true },
  { key: "lying_two_hand_dumbbell_triceps_extension_flat", flat: true, unilateral: false },
  { key: "overhead_single_arm_dumbbell_triceps_extension_incline_30", flat: false, unilateral: true },
  { key: "overhead_two_hand_dumbbell_triceps_extension_incline_30", flat: false, unilateral: false },
  { key: "overhead_single_arm_dumbbell_triceps_extension_seated_90", flat: false, unilateral: true },
  { key: "overhead_two_hand_dumbbell_triceps_extension_seated_90", flat: false, unilateral: false },
  { key: "lying_ez_bar_triceps_extension_flat_0", flat: true, unilateral: false },
  { key: "lying_ez_bar_triceps_extension_incline_30", flat: true, unilateral: false },
  { key: "overhead_ez_bar_triceps_extension_seated_90", flat: false, unilateral: false },
  { key: "overhead_ez_bar_triceps_extension_seated_30", flat: false, unilateral: false },
] as const;

describe("French press / triceps extension catalog", () => {
  it("keeps all ten bench, implement, and hand-use variants as distinct identities", () => {
    const byKey = new Map(CANONICAL_EXERCISE_IDENTITIES.map((exercise) => [exercise.stableKey, exercise]));
    expect(variants).toHaveLength(10);
    for (const item of variants) {
      const exercise = byKey.get(item.key);
      expect(exercise, item.key).toBeTruthy();
      const metadata = exercisePickerMetadata({
        id: 1, name: exercise!.displayName, stableKey: item.key, isActive: true, archivedAt: null, muscleMapping: null,
      });
      expect(metadata).toMatchObject({ category: "arms", subcategory: "triceps" });
      expect(resolveExerciseInfo({ catalogName: exercise!.displayName })?.primaryMusclesUk).toBe("трицепс");
      expect(resolveExerciseInfo({ catalogName: exercise!.displayName })?.primaryMusclesEn).toBe("triceps");
      const image = resolveExerciseImageSrc({ stableKey: item.key });
      expect(image).toBeTruthy();
      expect(existsSync(join(process.cwd(), "public", image!.replace(/^\//, "")))).toBe(true);
      if (item.flat) expect(exercise!.displayName).toMatch(/лежачи на (?:горизонтальній|похилій) лаві \((?:0|30)°\)/);
      else expect(exercise!.displayName).toMatch(/з-за голови/);
    }
  });

  it("counts one-arm work per side once and single-dumbbell/EZ-bar work by total setup", () => {
    for (const item of variants) {
      const config = LEGACY_LOAD_CONFIGS_V1[item.key]!;
      expect(loadConfigV1Schema.safeParse(config).success, item.key).toBe(true);
      expect(config.resistanceType).toBe("external");
      expect(recommendedResistanceTypeForCatalogStableKey(item.key)).toBe(RESISTANCE.EXTERNAL_WEIGHT);
      const accounting = lookupExternalLoadAccountingV1(item.key);
      expect(accounting).not.toBeNull();
      if (item.unilateral) {
        expect(config).toMatchObject({
          accountingKind: "external-per-implement-per-side",
          resistanceType: "external",
          repsMeaning: "per-side",
          execution: "unilateral",
        });
        expect(accounting).toMatchObject({ entryBasis: "per-side", ordinaryTonnageFactor: 2 });
        expect(externalWeightEntryLabel(item.key, true)).toBe("Вага на сторону, кг");
        expect(ordinaryExternalWeightTonnageKg([{
          stableKey: item.key, resistanceType: RESISTANCE.EXTERNAL_WEIGHT, weightKg: 10, reps: 8,
        }])).toBe(160);
      } else {
        const singleDumbbell = item.key.includes("two_hand_dumbbell");
        expect(config).toMatchObject({
          accountingKind: singleDumbbell ? "external-per-implement-per-movement" : "external-complete-setup-per-movement",
          resistanceType: "external",
          loadInput: singleDumbbell ? "per-implement-kg" : "complete-setup-kg",
          repsMeaning: "per-movement",
          execution: "simultaneous",
        });
        expect(config.equipment.equipmentId).toBe(singleDumbbell ? "dumbbell" : "ez-bar");
        expect(accounting).toMatchObject({ entryBasis: "total-external-load", ordinaryTonnageFactor: 1 });
        expect(externalWeightEntryLabel(item.key, true)).toBe("Загальна зовнішня вага, кг");
        expect(ordinaryExternalWeightTonnageKg([{
          stableKey: item.key, resistanceType: RESISTANCE.EXTERNAL_WEIGHT, weightKg: 10, reps: 8,
        }])).toBe(80);
      }
    }
  });
});
