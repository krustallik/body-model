import { describe, expect, it } from "vitest";
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

  it("covers all twelve catalog exercises", () => {
    expect(knownExerciseImageCatalogNames()).toHaveLength(12);
  });
});
