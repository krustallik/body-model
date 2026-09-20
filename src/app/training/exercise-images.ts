/**
 * Presentation mapping: ExerciseCatalog.name → static illustration.
 * Keys are the exact seeded catalog names (stable unique with profileId).
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
