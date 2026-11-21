import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  knownExerciseImageCatalogNames,
  resolveExerciseImageSrc,
} from "@/app/training/exercise-images";
import { EXERCISE_PICKER_CATEGORIES } from "@/app/training/exercise-picker-catalog";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";

describe("exercise image catalog mapping", () => {
  it("maps by stable ExerciseCatalog name, not index", () => {
    expect(resolveExerciseImageSrc({
      catalogName: "Жим гантелей на похилій лаві вгору (30°)",
    })).toBe("/training/exercises/incline-dumbbell-press-30.jpg");

    expect(resolveExerciseImageSrc({
      snapshotExerciseName: "Гіперекстензія",
    })).toBe("/training/exercises/hyperextension.jpg");
  });

  it("resolves active sessions by stable key when their snapshot name is localized", () => {
    expect(resolveExerciseImageSrc({
      stableKey: "incline_dumbbell_press_30deg",
      snapshotExerciseName: "30° incline dumbbell press",
    })).toBe("/training/exercises/incline-dumbbell-press-30.jpg");
    expect(resolveExerciseImageSrc({
      stableKey: "front_foot_elevated_split_squat",
      snapshotExerciseName: "Front-foot-elevated split squat",
    })).toBe("/training/exercises/front-foot-elevated-split-squat.png");
    const pushupImage = resolveExerciseImageSrc({
      stableKey: "pushup_handles",
      snapshotExerciseName: "Push-up on handles",
    });
    expect(pushupImage).toBe("/training/exercises/push-up-on-handles.jpg");
    expect(existsSync(join(process.cwd(), "public", "training", "exercises", "push-up-on-handles.jpg"))).toBe(true);
  });

  it("returns null when no image exists (no broken placeholder)", () => {
    expect(resolveExerciseImageSrc({
      snapshotExerciseName: "Unknown custom lift",
    })).toBeNull();
  });

  it("covers every canonical catalog exercise and resolves the supplied images", () => {
    expect(knownExerciseImageCatalogNames()).toHaveLength(50);
    const expected = [
      ["Болгарські присідання з упором задньої ноги на лаву", "bulgarian-split-squat.png"],
      ["Випади вперед", "forward-dumbbell-lunge.png"],
      ["Присідання з гантеллю в руках", "goblet-squat.png"],
      ["Прямі скручування з гантеллю на прес", "dumbbell-crunch.png"],
      ["Бокові скручування з гантеллю на прес", "dumbbell-russian-twist.png"],
      ["Спліт-присідання з піднятою передньою стопою", "front-foot-elevated-split-squat.png"],
      ["Румунська тяга (Romanian Deadlift)", "romanian-deadlift.png"],
      ["Згинання ніг із нижнім блоком", "cable-leg-curl.png"],
      ["Підйом таза зі штангою (Hip Thrust)", "barbell-hip-thrust.png"],
      ["Відведення ноги назад із нижнім блоком", "cable-glute-kickback.png"],
      ["Підйоми на носок стоячи на одній нозі", "single-leg-standing-calf-raise.png"],
      ["Підйоми на носок сидячи", "seated-calf-raise.png"],
      ["Приведення ноги на нижньому блоці", "cable-hip-adduction.png"],
      ["Відведення ноги вбік на нижньому блоці", "cable-hip-abduction.png"],
    ] as const;
    for (const [name, file] of expected) {
      expect(resolveExerciseImageSrc({ catalogName: name })).toBe(`/training/exercises/${file}`);
      expect(resolveExerciseImageSrc({ snapshotExerciseName: name })).toBe(`/training/exercises/${file}`);
      expect(existsSync(join(process.cwd(), "public", "training", "exercises", file))).toBe(true);
    }
  });

  it("has a real image file for every canonical exercise and picker category", () => {
    for (const exercise of CANONICAL_EXERCISE_IDENTITIES) {
      const image = resolveExerciseImageSrc({ stableKey: exercise.stableKey, catalogName: exercise.displayName });
      expect(image, exercise.stableKey).not.toBeNull();
      expect(existsSync(join(process.cwd(), "public", image!.replace(/^\//, ""))), exercise.stableKey).toBe(true);
    }
    for (const category of EXERCISE_PICKER_CATEGORIES) {
      expect(existsSync(join(process.cwd(), "public", category.imageSrc.replace(/^\//, ""))), category.id).toBe(true);
    }
  });
});
