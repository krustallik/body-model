import { describe, expect, it } from "vitest";
import { SEEDED_EXERCISE_NAMES } from "@/modules/training/training.constants";

describe("SEEDED_EXERCISE_NAMES", () => {
  it("matches the 12 Ukrainian names seeded by the strength diary migration", () => {
    expect(SEEDED_EXERCISE_NAMES).toHaveLength(12);
    expect([...SEEDED_EXERCISE_NAMES]).toEqual([
      "Жим гантелей на похилій лаві вгору (30°)",
      "Розведення гантелей на горизонтальній лаві",
      "Віджимання від ручок",
      "Жим гантелей сидячи",
      "Махи гантеллю однією рукою вбік",
      "Розгинання однієї руки в блоці",
      "Розгинання однієї руки з гантеллю в нахилі",
      "Тяга горизонтального блоку сидячи однією рукою",
      "Гіперекстензія",
      "Згинання однієї руки від коліна",
      "Згинання рук з розворотом сидячи на похилій лаві",
      "Згинання кисті з гантеллю в упорі",
    ]);
  });
});
