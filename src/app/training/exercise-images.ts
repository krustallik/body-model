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
  "Жим гантелей лежачи на горизонтальній лаві (0°)": "/training/exercises/flat-dumbbell-bench-press.webp",
  "Махи гантелями перед собою (обидві руки)": "/training/exercises/dumbbell-front-raise-bilateral.webp",
  "Махи гантелями перед собою (почергово)": "/training/exercises/dumbbell-front-raise-alternating.webp",
  "Махи гантелями в боки (обидві руки)": "/training/exercises/dumbbell-lateral-raise-bilateral.webp",
  "Тяга прямого грифа до підборіддя стоячи (Barbell Upright Row)": "/training/exercises/barbell-upright-row.webp",
  "Молоткові згинання стоячи (обидві руки)": "/training/exercises/dumbbell-hammer-curl-bilateral.webp",
  "Молоткові згинання стоячи (почергово)": "/training/exercises/dumbbell-hammer-curl-alternating.webp",
  "Згинання гантелей із супінацією (обидві руки)": "/training/exercises/dumbbell-supinated-curl-bilateral.webp",
  "Згинання гантелей із супінацією (почергово)": "/training/exercises/dumbbell-supinated-curl-alternating.webp",
  "Віджимання з колін від підлоги": "/training/exercises/knee-push-up-floor.webp",
  "Віджимання з колін, руки на лаві": "/training/exercises/knee-push-up-bench.webp",
  "Віджимання від лави з прямими ногами": "/training/exercises/incline-push-up-bench.webp",
  "Тяга гантелі однією рукою з упором на лаву": "/training/exercises/one-arm-dumbbell-row-bench-supported.webp",
  "Французький жим однією рукою лежачи на горизонтальній лаві (0°)": "/training/exercises/lying-single-arm-dumbbell-triceps-extension-flat.webp",
  "Французький жим однією гантеллю двома руками лежачи на горизонтальній лаві (0°)": "/training/exercises/lying-two-hand-dumbbell-triceps-extension-flat.webp",
  "Французький жим однією рукою з-за голови на похилій лаві (30°)": "/training/exercises/overhead-single-arm-dumbbell-triceps-extension-incline-30.webp",
  "Французький жим однією гантеллю двома руками з-за голови на похилій лаві (30°)": "/training/exercises/overhead-two-hand-dumbbell-triceps-extension-incline-30.webp",
  "Французький жим однією рукою з-за голови сидячи, спинка 90°": "/training/exercises/overhead-single-arm-dumbbell-triceps-extension-seated-90.webp",
  "Французький жим однією гантеллю двома руками з-за голови сидячи, спинка 90°": "/training/exercises/overhead-two-hand-dumbbell-triceps-extension-seated-90.webp",
  "Французький жим з EZ-грифом лежачи на горизонтальній лаві (0°)": "/training/exercises/lying-ez-bar-triceps-extension-flat.webp",
  "Французький жим з EZ-грифом лежачи на похилій лаві (30°)": "/training/exercises/lying-ez-bar-triceps-extension-incline-30.webp",
  "Французький жим з EZ-грифом з-за голови сидячи, спинка 90°": "/training/exercises/overhead-ez-bar-triceps-extension-seated-90.webp",
  "Французький жим з EZ-грифом з-за голови сидячи, спинка 30°": "/training/exercises/overhead-ez-bar-triceps-extension-seated-30.webp",
};

// Session snapshots can contain a localized exercise name. Resolve persisted
// illustrations by the linked catalog identity first, then retain the exact
// name lookup for older snapshots and program previews.
const EXERCISE_IMAGE_BY_STABLE_KEY: Record<string, string> = {
  dumbbell_russian_twist: "/training/exercises/dumbbell-russian-twist.png",
  bulgarian_split_squat: "/training/exercises/bulgarian-split-squat.png",
  forward_dumbbell_lunge: "/training/exercises/forward-dumbbell-lunge.png",
  cable_hip_abduction: "/training/exercises/cable-hip-abduction.png",
  flat_dumbbell_bench_press: "/training/exercises/flat-dumbbell-bench-press.webp",
  dumbbell_front_raise_bilateral: "/training/exercises/dumbbell-front-raise-bilateral.webp",
  dumbbell_front_raise_alternating: "/training/exercises/dumbbell-front-raise-alternating.webp",
  dumbbell_lateral_raise_bilateral: "/training/exercises/dumbbell-lateral-raise-bilateral.webp",
  barbell_upright_row: "/training/exercises/barbell-upright-row.webp",
  dumbbell_hammer_curl_bilateral: "/training/exercises/dumbbell-hammer-curl-bilateral.webp",
  dumbbell_hammer_curl_alternating: "/training/exercises/dumbbell-hammer-curl-alternating.webp",
  dumbbell_supinated_curl_bilateral: "/training/exercises/dumbbell-supinated-curl-bilateral.webp",
  dumbbell_supinated_curl_alternating: "/training/exercises/dumbbell-supinated-curl-alternating.webp",
  knee_push_up_floor: "/training/exercises/knee-push-up-floor.webp",
  knee_push_up_hands_bench: "/training/exercises/knee-push-up-bench.webp",
  incline_push_up_hands_bench: "/training/exercises/incline-push-up-bench.webp",
  one_arm_dumbbell_row_bench_supported: "/training/exercises/one-arm-dumbbell-row-bench-supported.webp",
  lying_single_arm_dumbbell_triceps_extension_flat: "/training/exercises/lying-single-arm-dumbbell-triceps-extension-flat.webp",
  lying_two_hand_dumbbell_triceps_extension_flat: "/training/exercises/lying-two-hand-dumbbell-triceps-extension-flat.webp",
  overhead_single_arm_dumbbell_triceps_extension_incline_30: "/training/exercises/overhead-single-arm-dumbbell-triceps-extension-incline-30.webp",
  overhead_two_hand_dumbbell_triceps_extension_incline_30: "/training/exercises/overhead-two-hand-dumbbell-triceps-extension-incline-30.webp",
  overhead_single_arm_dumbbell_triceps_extension_seated_90: "/training/exercises/overhead-single-arm-dumbbell-triceps-extension-seated-90.webp",
  overhead_two_hand_dumbbell_triceps_extension_seated_90: "/training/exercises/overhead-two-hand-dumbbell-triceps-extension-seated-90.webp",
  lying_ez_bar_triceps_extension_flat_0: "/training/exercises/lying-ez-bar-triceps-extension-flat.webp",
  lying_ez_bar_triceps_extension_incline_30: "/training/exercises/lying-ez-bar-triceps-extension-incline-30.webp",
  overhead_ez_bar_triceps_extension_seated_90: "/training/exercises/overhead-ez-bar-triceps-extension-seated-90.webp",
  overhead_ez_bar_triceps_extension_seated_30: "/training/exercises/overhead-ez-bar-triceps-extension-seated-30.webp",
  cable_glute_kickback: "/training/exercises/cable-glute-kickback.png",
  pushup_handles: "/training/exercises/push-up-on-handles.jpg",
  hyperextension: "/training/exercises/hyperextension.jpg",
  incline_dumbbell_press_30deg: "/training/exercises/incline-dumbbell-press-30.jpg",
  seated_dumbbell_press: "/training/exercises/seated-dumbbell-shoulder-press.jpg",
  supported_dumbbell_wrist_curl: "/training/exercises/wrist-curl-on-bench.jpg",
  cable_leg_curl: "/training/exercises/cable-leg-curl.png",
  one_arm_concentration_curl: "/training/exercises/one-arm-curl-from-knee.jpg",
  incline_seated_rotating_dumbbell_curl: "/training/exercises/incline-dumbbell-curl.jpg",
  one_arm_lateral_raise: "/training/exercises/one-arm-lateral-raise.jpg",
  cable_hip_adduction: "/training/exercises/cable-hip-adduction.png",
  goblet_squat: "/training/exercises/goblet-squat.png",
  dumbbell_crunch: "/training/exercises/dumbbell-crunch.png",
  barbell_hip_thrust: "/training/exercises/barbell-hip-thrust.png",
  seated_calf_raise: "/training/exercises/seated-calf-raise.png",
  single_leg_standing_calf_raise: "/training/exercises/single-leg-standing-calf-raise.png",
  pull_up: "/training/exercises/pull-up.png",
  flat_dumbbell_fly: "/training/exercises/flat-dumbbell-fly.jpg",
  one_arm_cable_triceps_extension: "/training/exercises/one-arm-cable-pushdown.jpg",
  bent_over_one_arm_dumbbell_triceps_extension: "/training/exercises/dumbbell-triceps-kickback.jpg",
  romanian_deadlift: "/training/exercises/romanian-deadlift.png",
  front_foot_elevated_split_squat: "/training/exercises/front-foot-elevated-split-squat.png",
  one_arm_seated_cable_row: "/training/exercises/seated-one-arm-cable-row.jpg",
};

export function resolveExerciseImageSrc(input: {
  stableKey?: string | null;
  catalogName?: string | null;
  snapshotExerciseName?: string | null;
}): string | null {
  const stableKey = input.stableKey?.trim();
  if (stableKey) {
    const stableImage = EXERCISE_IMAGE_BY_STABLE_KEY[stableKey];
    if (stableImage) return stableImage;
  }

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
