import { describe, expect, it } from "vitest";
import { resolveExerciseInfo } from "@/app/training/exercise-info";
import { resolveExerciseImageSrc } from "@/app/training/exercise-images";

describe("exercise presentation copy", () => {
  it("resolves muscles and cues by catalog name", () => {
    const info = resolveExerciseInfo({
      snapshotExerciseName: "Жим гантелей на похилій лаві вгору (30°)",
    });
    expect(info?.primaryMusclesUk).toMatch(/груд/i);
    expect(info?.cuesUk.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps image mapping independent of info copy", () => {
    expect(resolveExerciseImageSrc({
      snapshotExerciseName: "Гіперекстензія",
    })).toBe("/training/exercises/hyperextension.jpg");
    expect(resolveExerciseInfo({
      snapshotExerciseName: "Гіперекстензія",
    })?.primaryMusclesEn).toMatch(/erectors|glutes/i);
  });

  it("provides pull-up guidance and the supplied exercise image", () => {
    expect(resolveExerciseImageSrc({
      snapshotExerciseName: "Підтягування на перекладині",
    })).toBe("/training/exercises/pull-up.png");
    expect(resolveExerciseInfo({
      snapshotExerciseName: "Підтягування на перекладині",
    })?.primaryMusclesEn).toMatch(/lats/);
  });
});
