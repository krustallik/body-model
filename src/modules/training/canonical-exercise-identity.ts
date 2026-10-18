/**
 * Version-controlled portable identities for the supported catalog.
 * Display names participate only in the one-time database migration; model
 * code must use stableKey once it has been persisted.
 */
export const CANONICAL_EXERCISE_IDENTITIES = [
  { stableKey: "incline_dumbbell_press_30deg", displayName: "Жим гантелей на похилій лаві вгору (30°)" },
  { stableKey: "flat_dumbbell_fly", displayName: "Розведення гантелей на горизонтальній лаві" },
  { stableKey: "pushup_handles", displayName: "Віджимання від ручок" },
  { stableKey: "seated_dumbbell_press", displayName: "Жим гантелей сидячи" },
  { stableKey: "one_arm_lateral_raise", displayName: "Махи гантеллю однією рукою вбік" },
  { stableKey: "one_arm_cable_triceps_extension", displayName: "Розгинання однієї руки в блоці" },
  { stableKey: "bent_over_one_arm_dumbbell_triceps_extension", displayName: "Розгинання однієї руки з гантеллю в нахилі" },
  { stableKey: "one_arm_seated_cable_row", displayName: "Тяга горизонтального блоку сидячи однією рукою" },
  { stableKey: "pull_up", displayName: "Підтягування на перекладині" },
  { stableKey: "hyperextension", displayName: "Гіперекстензія" },
  { stableKey: "one_arm_concentration_curl", displayName: "Згинання однієї руки від коліна" },
  { stableKey: "incline_seated_rotating_dumbbell_curl", displayName: "Згинання рук з розворотом сидячи на похилій лаві" },
  { stableKey: "supported_dumbbell_wrist_curl", displayName: "Згинання кисті з гантеллю в упорі" },
  { stableKey: "bulgarian_split_squat", displayName: "Болгарські присідання з упором задньої ноги на лаву" },
  { stableKey: "forward_dumbbell_lunge", displayName: "Випади вперед" },
  { stableKey: "goblet_squat", displayName: "Присідання з гантеллю в руках" },
  { stableKey: "dumbbell_crunch", displayName: "Прямі скручування з гантеллю на прес" },
  { stableKey: "dumbbell_russian_twist", displayName: "Бокові скручування з гантеллю на прес" },
] as const;

/** New entries whose anatomy is shown as coaching copy but lacks a v7 model group. */
export const CANONICAL_EXERCISES_WITHOUT_V7_MAPPING = [
  "bulgarian_split_squat",
  "forward_dumbbell_lunge",
  "goblet_squat",
  "dumbbell_crunch",
  "dumbbell_russian_twist",
] as const;

export type CanonicalExerciseStableKey = (typeof CANONICAL_EXERCISE_IDENTITIES)[number]["stableKey"];
