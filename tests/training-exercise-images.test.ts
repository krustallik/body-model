import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  knownExerciseImageCatalogNames,
  resolveExerciseImageSrc,
} from "@/app/training/exercise-images";

describe("exercise image catalog mapping", () => {
  it("maps by stable ExerciseCatalog name, not index", () => {
    expect(resolveExerciseImageSrc({
      catalogName: "Жим гантелей на похилій лаві вгору (30°)",
    })).toBe("/training/exercises/incline-dumbbell-press-30.jpg");

    expect(resolveExerciseImageSrc({
      snapshotExerciseName: "Гіперекстензія",
    })).toBe("/training/exercises/hyperextension.jpg");
  });

  it("returns null when no image exists (no broken placeholder)", () => {
    expect(resolveExerciseImageSrc({
      snapshotExerciseName: "Unknown custom lift",
    })).toBeNull();
  });

  it("covers all eighteen catalog exercises and resolves the five supplied images", () => {
    expect(knownExerciseImageCatalogNames()).toHaveLength(18);
    const expected = [
      ["Болгарські присідання з упором задньої ноги на лаву", "bulgarian-split-squat.png"],
      ["Випади вперед", "forward-dumbbell-lunge.png"],
      ["Присідання з гантеллю в руках", "goblet-squat.png"],
      ["Прямі скручування з гантеллю на прес", "dumbbell-crunch.png"],
      ["Бокові скручування з гантеллю на прес", "dumbbell-russian-twist.png"],
    ] as const;
    for (const [name, file] of expected) {
      expect(resolveExerciseImageSrc({ catalogName: name })).toBe(`/training/exercises/${file}`);
      expect(resolveExerciseImageSrc({ snapshotExerciseName: name })).toBe(`/training/exercises/${file}`);
      expect(existsSync(join(process.cwd(), "public", "training", "exercises", file))).toBe(true);
    }
  });
});
