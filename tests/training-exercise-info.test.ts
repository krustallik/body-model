import { describe, expect, it } from "vitest";
import { resolveExerciseInfo } from "@/app/training/exercise-info";
import { resolveExerciseImageSrc } from "@/app/training/exercise-images";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";

describe("exercise presentation copy", () => {
  it("keeps the owner-approved muscle-label delta exact in Ukrainian and English", () => {
    const expected = [
      ["Жим гантелей на похилій лаві вгору (30°)", "груди (акцент на верхню частину)", "chest (upper-chest emphasis)", "передні дельти, трицепси", "front delts, triceps"],
      ["Віджимання від ручок", "груди", "chest", "трицепси, передні дельти, передній зубчастий м’яз", "triceps, front delts, serratus anterior"],
      ["Жим гантелей сидячи", "передні та середні дельти", "front and middle delts", "трицепси, трапеції, передній зубчастий м’яз", "triceps, trapezius, serratus anterior"],
      ["Махи гантеллю однією рукою вбік", "середні дельти", "side delts", "надостьові м’язи, трапеції", "supraspinatus, trapezius"],
      ["Махи гантелями в боки (обидві руки)", "середні дельти", "middle delts", "надостьові м’язи, трапеції", "supraspinatus, trapezius"],
      ["Згинання рук з розворотом сидячи на похилій лаві", "біцепс", "biceps", "плечовий, плечопроменевий м’язи", "brachialis, brachioradialis"],
      ["Згинання однієї руки від коліна", "біцепс", "biceps", "плечовий, плечопроменевий м’язи", "brachialis, brachioradialis"],
      ["Молоткові згинання стоячи (обидві руки)", "плечовий, плечопроменевий м’язи, біцепси", "brachialis, brachioradialis, biceps", undefined, undefined],
      ["Молоткові згинання стоячи (почергово)", "плечовий, плечопроменевий м’язи, біцепси", "brachialis, brachioradialis, biceps", undefined, undefined],
      ["Тяга гантелі однією рукою з упором на лаву", "найширші, ромбоподібні, середні трапеції", "lats, rhomboids, middle traps", "біцепс, задні дельти", "biceps, rear delts"],
      ["Тяга горизонтального блоку сидячи однією рукою", "найширші, ромбоподібні, середні трапеції", "lats, rhomboids, middle traps", "біцепс, задні дельти", "biceps, rear delts"],
      ["Підтягування на перекладині", "найширші, середня спина, великі круглі м’язи", "lats, mid-back, teres major", "біцепси, плечовий м’яз, передпліччя", "biceps, brachialis, forearms"],
      ["Тяга прямого грифа до підборіддя стоячи (Barbell Upright Row)", "середні дельти, верхні трапеції", "middle delts, upper traps", "біцепси, плечові та плечопроменеві м’язи", "biceps, brachialis, brachioradialis"],
      ["Болгарські присідання з упором задньої ноги на лаву", "квадрицепси, сідничні м’язи", "quadriceps, glutes", "задня поверхня стегна, привідні м’язи стегна, литкові м’язи, м’язи корпуса", "hamstrings, hip adductors, calves, core"],
      ["Випади вперед", "квадрицепси, сідничні м’язи", "quadriceps, glutes", "задня поверхня стегна, привідні м’язи стегна, литкові м’язи, м’язи корпуса", "hamstrings, hip adductors, calves, core"],
      ["Спліт-присідання з піднятою передньою стопою", "квадрицепси, сідничні м’язи", "quadriceps, glutes", "задня поверхня стегна, привідні м’язи стегна, литкові м’язи", "hamstrings, hip adductors, calves"],
      ["Румунська тяга (Romanian Deadlift)", "задня поверхня стегна, великий сідничний м’яз", "hamstrings, gluteus maximus", "розгиначі спини, великий привідний м’яз", "spinal erectors, adductor magnus"],
      ["Підйом таза зі штангою (Hip Thrust)", "великий сідничний м’яз", "gluteus maximus", "задня поверхня стегна", "hamstrings"],
      ["Відведення ноги назад із нижнім блоком", "сідничні м’язи", "glutes", "задня поверхня стегна", "hamstrings"],
      ["Підйоми на носок стоячи на одній нозі", "литковий і камбалоподібний м’язи", "gastrocnemius and soleus", undefined, undefined],
      ["Підйоми на носок сидячи", "камбалоподібний м’яз", "soleus", "литковий м’яз", "gastrocnemius"],
      ["Відведення ноги вбік на нижньому блоці", "середній і малий сідничні м’язи", "gluteus medius and minimus", "напружувач широкої фасції стегна", "tensor fasciae latae"],
      ["Віджимання з колін від підлоги", "груди", "chest", "трицепси, передні дельти, передній зубчастий м’яз", "triceps, front delts, serratus anterior"],
      ["Віджимання з колін, руки на лаві", "груди", "chest", "трицепси, передні дельти, передній зубчастий м’яз", "triceps, front delts, serratus anterior"],
      ["Віджимання від лави з прямими ногами", "груди", "chest", "трицепси, передні дельти, передній зубчастий м’яз", "triceps, front delts, serratus anterior"],
    ] as const;

    for (const [name, primaryUk, primaryEn, secondaryUk, secondaryEn] of expected) {
      const info = resolveExerciseInfo({ catalogName: name });
      expect(info, name).toMatchObject({
        primaryMusclesUk: primaryUk,
        primaryMusclesEn: primaryEn,
        ...(secondaryUk === undefined ? {} : { secondaryMusclesUk: secondaryUk, secondaryMusclesEn: secondaryEn }),
      });
      if (secondaryUk === undefined) {
        expect(info, name).not.toHaveProperty("secondaryMusclesUk");
      }
    }
  });

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

  it("provides bilingual muscle labels and cues for every canonical exercise", () => {
    for (const exercise of CANONICAL_EXERCISE_IDENTITIES) {
      const info = resolveExerciseInfo({ catalogName: exercise.displayName });
      expect(info, exercise.stableKey).not.toBeNull();
      expect(info?.primaryMusclesUk, exercise.stableKey).toBeTruthy();
      expect(info?.primaryMusclesEn, exercise.stableKey).toBeTruthy();
      expect(info?.cuesUk.length, exercise.stableKey).toBeGreaterThan(0);
      expect(info?.cuesEn.length, exercise.stableKey).toBeGreaterThan(0);
    }
  });
});
