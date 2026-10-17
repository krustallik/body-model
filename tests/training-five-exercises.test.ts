import { describe, expect, it } from "vitest";
import { resolveExerciseInfo } from "@/app/training/exercise-info";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import { LEGACY_LOAD_CONFIGS_V1, loadConfigV1Schema } from "@/modules/training/load-accounting-v1";
import { externalWeightEntryLabel } from "@/modules/training/external-load-accounting";

const expected = [
  { key: "bulgarian_split_squat", name: "Болгарські присідання з упором задньої ноги на лаву", primary: "квадрицепси, сідничні м’язи", secondary: "задня поверхня стегна, литкові м’язи, м’язи корпуса" },
  { key: "forward_dumbbell_lunge", name: "Випади вперед", primary: "квадрицепси, сідничні м’язи", secondary: "задня поверхня стегна, литкові м’язи, м’язи корпуса" },
  { key: "goblet_squat", name: "Присідання з гантеллю в руках", primary: "квадрицепси, сідничні м’язи", secondary: "привідні м’язи стегна, м’язи корпуса" },
  { key: "dumbbell_crunch", name: "Прямі скручування з гантеллю на прес", primary: "прямий м’яз живота", secondary: "косі м’язи живота" },
  { key: "dumbbell_russian_twist", name: "Бокові скручування з гантеллю на прес", primary: "косі м’язи живота", secondary: "прямий м’яз живота" },
] as const;

describe("five supported Training exercises", () => {
  it("adds exactly five unique stable identities without renaming existing catalog entries", () => {
    expect(CANONICAL_EXERCISE_IDENTITIES).toHaveLength(18);
    expect(new Set(CANONICAL_EXERCISE_IDENTITIES.map(({ stableKey }) => stableKey)).size).toBe(18);
    for (const exercise of expected) {
      expect(CANONICAL_EXERCISE_IDENTITIES).toContainEqual({ stableKey: exercise.key, displayName: exercise.name });
    }
  });

  it("provides primary and secondary muscle labels and coaching copy in Ukrainian and English", () => {
    for (const exercise of expected) {
      const info = resolveExerciseInfo({ catalogName: exercise.name });
      expect(info).not.toBeNull();
      expect(info?.primaryMusclesUk).toBe(exercise.primary);
      expect(info?.secondaryMusclesUk).toBe(exercise.secondary);
      expect(info?.primaryMusclesEn).toBeTruthy();
      expect(info?.secondaryMusclesEn).toBeTruthy();
      expect(info?.cuesUk.length).toBeGreaterThan(0);
      expect(info?.cuesEn.length).toBeGreaterThan(0);
      expect(resolveExerciseInfo({ snapshotExerciseName: exercise.name })).toEqual(info);
    }
  });

  it("uses validated existing load contracts and keeps single-dumbbell movement load single", () => {
    for (const exercise of expected) {
      expect(loadConfigV1Schema.safeParse(LEGACY_LOAD_CONFIGS_V1[exercise.key]).success).toBe(true);
    }
    for (const key of ["goblet_squat", "dumbbell_crunch", "dumbbell_russian_twist"] as const) {
      expect(LEGACY_LOAD_CONFIGS_V1[key]).toMatchObject({
        accountingKind: "external-per-implement-per-movement",
        implementsPerMovement: 1,
        repsMeaning: "per-movement",
      });
    }
    for (const key of ["bulgarian_split_squat", "forward_dumbbell_lunge"] as const) {
      expect(LEGACY_LOAD_CONFIGS_V1[key]).toMatchObject({
        accountingKind: "external-per-implement-pair-per-side",
        inventoryCount: 2,
        loadedSides: 2,
        execution: "unilateral",
        repsMeaning: "per-side",
        equipment: { setupId: expect.stringContaining("dumbbell-pair") },
      });
      expect(externalWeightEntryLabel(key, true)).toBe("Вага на гантелю, кг");
    }
  });
});
