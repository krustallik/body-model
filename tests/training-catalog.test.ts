import { describe, expect, it } from "vitest";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import { SEEDED_EXERCISE_NAMES } from "@/modules/training/training.constants";

describe("SEEDED_EXERCISE_NAMES", () => {
  it("matches the supported Ukrainian names in the canonical catalog", () => {
    expect(SEEDED_EXERCISE_NAMES).toHaveLength(27);
    expect([...SEEDED_EXERCISE_NAMES]).toEqual([
      "Жим гантелей на похилій лаві вгору (30°)",
      "Розведення гантелей на горизонтальній лаві",
      "Віджимання від ручок",
      "Жим гантелей сидячи",
      "Махи гантеллю однією рукою вбік",
      "Розгинання однієї руки в блоці",
      "Розгинання однієї руки з гантеллю в нахилі",
      "Тяга горизонтального блоку сидячи однією рукою",
      "Підтягування на перекладині",
      "Гіперекстензія",
      "Згинання однієї руки від коліна",
      "Згинання рук з розворотом сидячи на похилій лаві",
      "Згинання кисті з гантеллю в упорі",
      "Болгарські присідання з упором задньої ноги на лаву",
      "Випади вперед",
      "Присідання з гантеллю в руках",
      "Прямі скручування з гантеллю на прес",
      "Бокові скручування з гантеллю на прес",
      "Спліт-присідання з піднятою передньою стопою",
      "Румунська тяга (Romanian Deadlift)",
      "Згинання ніг із нижнім блоком",
      "Підйом таза зі штангою (Hip Thrust)",
      "Відведення ноги назад із нижнім блоком",
      "Підйоми на носок стоячи на одній нозі",
      "Підйоми на носок сидячи",
      "Приведення ноги на нижньому блоці",
      "Відведення ноги вбік на нижньому блоці",
    ]);
  });

  it("assigns every supported exercise an explicit immutable ASCII stable key", () => {
    expect(CANONICAL_EXERCISE_IDENTITIES).toHaveLength(27);
    expect(CANONICAL_EXERCISE_IDENTITIES.map((exercise) => exercise.displayName))
      .toEqual([...SEEDED_EXERCISE_NAMES]);

    const stableKeys = CANONICAL_EXERCISE_IDENTITIES.map((exercise) => exercise.stableKey);
    expect(new Set(stableKeys)).toHaveLength(27);
    expect(stableKeys.every((stableKey) => /^[a-z0-9_]+$/.test(stableKey))).toBe(true);
  });

  it("keeps portable identity independent from database numeric ids and display-name changes", () => {
    const canonical = CANONICAL_EXERCISE_IDENTITIES[0]!;
    const firstDatabase = { id: 7, name: canonical.displayName, stableKey: canonical.stableKey };
    const secondDatabase = { id: 91, name: "Renamed locally", stableKey: canonical.stableKey };

    expect(firstDatabase.id).not.toBe(secondDatabase.id);
    expect(firstDatabase.name).not.toBe(secondDatabase.name);
    expect(firstDatabase.stableKey).toBe(secondDatabase.stableKey);
  });
});
