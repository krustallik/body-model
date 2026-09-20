/**
 * Version-controlled portable identities for the original supported catalog.
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
] as const;

export type CanonicalExerciseStableKey = (typeof CANONICAL_EXERCISE_IDENTITIES)[number]["stableKey"];
