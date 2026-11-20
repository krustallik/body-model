/**
 * Presentation mapping: ExerciseCatalog.name → static illustration.
 * Keys are exact canonical catalog names (stable unique with profileId).
 * Lookup never uses program/session index.
 */
const EXERCISE_IMAGE_BY_CATALOG_NAME: Record<string, string> = {
  "Жим гантелей на похилій лаві вгору (30°)": "/training/exercises/incline-dumbbell-press-30.jpg",
  "Розведення гантелей на горизонтальній лаві": "/training/exercises/flat-dumbbell-fly.jpg",
  "Віджимання від ручок": "/training/exercises/push-up-on-handles.jpg",
  "Жим гантелей сидячи": "/training/exercises/seated-dumbbell-shoulder-press.jpg",
  "Махи гантеллю однією рукою вбік": "/training/exercises/one-arm-lateral-raise.jpg",
  "Розгинання однієї руки в блоці": "/training/exercises/one-arm-cable-pushdown.jpg",
  "Розгинання однієї руки з гантеллю в нахилі": "/training/exercises/dumbbell-triceps-kickback.jpg",
  "Тяга горизонтального блоку сидячи однією рукою": "/training/exercises/seated-one-arm-cable-row.jpg",
  "Підтягування на перекладині": "/training/exercises/pull-up.png",
  "Гіперекстензія": "/training/exercises/hyperextension.jpg",
  "Згинання однієї руки від коліна": "/training/exercises/one-arm-curl-from-knee.jpg",
  "Згинання рук з розворотом сидячи на похилій лаві": "/training/exercises/incline-dumbbell-curl.jpg",
  "Згинання кисті з гантеллю в упорі": "/training/exercises/wrist-curl-on-bench.jpg",
  "Болгарські присідання з упором задньої ноги на лаву": "/training/exercises/bulgarian-split-squat.png",
  "Випади вперед": "/training/exercises/forward-dumbbell-lunge.png",
  "Присідання з гантеллю в руках": "/training/exercises/goblet-squat.png",
  "Прямі скручування з гантеллю на прес": "/training/exercises/dumbbell-crunch.png",
  "Бокові скручування з гантеллю на прес": "/training/exercises/dumbbell-russian-twist.png",
  "Спліт-присідання з піднятою передньою стопою": "/training/exercises/front-foot-elevated-split-squat.png",
  "Румунська тяга (Romanian Deadlift)": "/training/exercises/romanian-deadlift.png",
  "Згинання ніг із нижнім блоком": "/training/exercises/cable-leg-curl.png",
  "Підйом таза зі штангою (Hip Thrust)": "/training/exercises/barbell-hip-thrust.png",
  "Відведення ноги назад із нижнім блоком": "/training/exercises/cable-glute-kickback.png",
  "Підйоми на носок стоячи на одній нозі": "/training/exercises/single-leg-standing-calf-raise.png",
  "Підйоми на носок сидячи": "/training/exercises/seated-calf-raise.png",
  "Приведення ноги на нижньому блоці": "/training/exercises/cable-hip-adduction.png",
  "Відведення ноги вбік на нижньому блоці": "/training/exercises/cable-hip-abduction.png",
};

export function resolveExerciseImageSrc(input: {
  catalogName?: string | null;
  snapshotExerciseName?: string | null;
}): string | null {
  const candidates = [input.catalogName, input.snapshotExerciseName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  for (const name of candidates) {
    const exact = EXERCISE_IMAGE_BY_CATALOG_NAME[name];
    if (exact) return exact;
  }
  return null;
}

export function knownExerciseImageCatalogNames(): string[] {
  return Object.keys(EXERCISE_IMAGE_BY_CATALOG_NAME);
}
