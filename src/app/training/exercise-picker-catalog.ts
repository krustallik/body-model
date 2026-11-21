import type { ExerciseCatalogDto } from "@/modules/training/training.types";

export type ExercisePickerCategoryId = "chest" | "back" | "legs" | "glutes" | "shoulders" | "arms" | "abs";
export type ExercisePickerEquipment = "dumbbells" | "barbell" | "ez-bar" | "cable" | "bodyweight" | "bench" | "handles" | "pull-up-bar" | "machine" | "other";
export type ExercisePickerSubcategory = "biceps" | "triceps" | "forearms";

export type ExercisePickerMetadata = {
  category: ExercisePickerCategoryId;
  equipment: readonly ExercisePickerEquipment[];
  aliases?: readonly string[];
  subcategory?: ExercisePickerSubcategory;
  execution?: "simultaneous" | "alternating" | "unilateral" | "bodyweight";
  repsPerSide?: boolean;
  requiresBodyweightSetup?: boolean;
  noteUk?: string;
  noteEn?: string;
};

export const EXERCISE_PICKER_CATEGORIES: readonly {
  id: ExercisePickerCategoryId;
  nameUk: string;
  nameEn: string;
  imageSrc: string;
}[] = [
  { id: "chest", nameUk: "Груди", nameEn: "Chest", imageSrc: "/training/categories/chest.webp" },
  { id: "back", nameUk: "Спина", nameEn: "Back", imageSrc: "/training/categories/back.webp" },
  { id: "legs", nameUk: "Ноги", nameEn: "Legs", imageSrc: "/training/categories/legs.webp" },
  { id: "glutes", nameUk: "Сідниці", nameEn: "Glutes", imageSrc: "/training/categories/glutes.webp" },
  { id: "shoulders", nameUk: "Плечі", nameEn: "Shoulders", imageSrc: "/training/categories/shoulders.webp" },
  { id: "arms", nameUk: "Руки", nameEn: "Arms", imageSrc: "/training/categories/arms.webp" },
  { id: "abs", nameUk: "Прес", nameEn: "Abs", imageSrc: "/training/categories/abs.webp" },
];

const metadata = (category: ExercisePickerCategoryId, equipment: readonly ExercisePickerEquipment[], extra: Omit<ExercisePickerMetadata, "category" | "equipment"> = {}): ExercisePickerMetadata => ({
  category,
  equipment,
  ...extra,
});

/** UI-only metadata keyed by portable exercise identity; it never changes training records. */
export const EXERCISE_PICKER_METADATA_BY_STABLE_KEY: Readonly<Record<string, ExercisePickerMetadata>> = {
  incline_dumbbell_press_30deg: metadata("chest", ["dumbbells", "bench"], { aliases: ["incline dumbbell press", "30 degree chest press"] }),
  flat_dumbbell_fly: metadata("chest", ["dumbbells", "bench"], { aliases: ["dumbbell fly", "chest fly"] }),
  pushup_handles: metadata("chest", ["bodyweight", "handles"], { aliases: ["push up handles", "pushup bars"], execution: "bodyweight" }),
  flat_dumbbell_bench_press: metadata("chest", ["dumbbells", "bench"], { aliases: ["flat dumbbell bench press", "0 degree dumbbell bench press"] }),
  knee_push_up_floor: metadata("chest", ["bodyweight"], { aliases: ["knee push up floor", "modified push up"], execution: "bodyweight", requiresBodyweightSetup: true, noteUk: "Коліна та долоні на підлозі", noteEn: "Knees and hands on floor" }),
  knee_push_up_hands_bench: metadata("chest", ["bodyweight", "bench"], { aliases: ["kneeling incline push up", "knee push up bench"], execution: "bodyweight", requiresBodyweightSetup: true, noteUk: "Коліна на підлозі, долоні на лаві", noteEn: "Knees on floor, hands on bench" }),
  incline_push_up_hands_bench: metadata("chest", ["bodyweight", "bench"], { aliases: ["incline push up", "straight leg bench push up"], execution: "bodyweight", requiresBodyweightSetup: true, noteUk: "Прямі ноги, стопи на підлозі", noteEn: "Straight legs, feet on floor" }),

  one_arm_seated_cable_row: metadata("back", ["cable"], { aliases: ["single arm cable row", "seated cable row"] }),
  pull_up: metadata("back", ["bodyweight", "pull-up-bar"], { aliases: ["pull up", "chin up"], execution: "bodyweight" }),
  hyperextension: metadata("back", ["bench"], { aliases: ["back extension", "roman chair"] }),
  one_arm_dumbbell_row_bench_supported: metadata("back", ["dumbbells", "bench"], { aliases: ["one arm dumbbell row", "supported dumbbell row"], execution: "unilateral", repsPerSide: true, noteUk: "Одна рука й одне коліно спираються на лаву", noteEn: "One hand and one knee supported on bench" }),

  bulgarian_split_squat: metadata("legs", ["dumbbells", "bench"], { aliases: ["bulgarian split squat"] }),
  forward_dumbbell_lunge: metadata("legs", ["dumbbells"], { aliases: ["forward lunge"] }),
  goblet_squat: metadata("legs", ["dumbbells"], { aliases: ["goblet squat"] }),
  front_foot_elevated_split_squat: metadata("legs", ["dumbbells", "bench"], { aliases: ["front foot elevated split squat", "ffess"] }),
  romanian_deadlift: metadata("legs", ["barbell"], { aliases: ["romanian deadlift", "rdl"] }),
  cable_leg_curl: metadata("legs", ["cable"], { aliases: ["cable leg curl", "ankle cuff leg curl"] }),
  single_leg_standing_calf_raise: metadata("legs", ["bodyweight", "dumbbells"], { aliases: ["single leg calf raise"], execution: "unilateral", repsPerSide: true }),
  seated_calf_raise: metadata("legs", ["dumbbells", "bench"], { aliases: ["seated calf raise"] }),
  cable_hip_adduction: metadata("legs", ["cable"], { aliases: ["cable hip adduction", "hip adductor cable"] , execution: "unilateral", repsPerSide: true }),

  barbell_hip_thrust: metadata("glutes", ["barbell", "bench"], { aliases: ["hip thrust"] }),
  cable_glute_kickback: metadata("glutes", ["cable"], { aliases: ["cable glute kickback", "cable kickback"], execution: "unilateral", repsPerSide: true }),
  cable_hip_abduction: metadata("glutes", ["cable"], { aliases: ["cable hip abduction", "hip abductor cable"], execution: "unilateral", repsPerSide: true }),

  seated_dumbbell_press: metadata("shoulders", ["dumbbells", "bench"], { aliases: ["seated dumbbell shoulder press", "shoulder press"] }),
  one_arm_lateral_raise: metadata("shoulders", ["dumbbells"], { aliases: ["single arm lateral raise", "one arm lateral raise"], execution: "unilateral", repsPerSide: true }),
  dumbbell_front_raise_bilateral: metadata("shoulders", ["dumbbells"], { aliases: ["simultaneous dumbbell front raise", "front raise both arms"], execution: "simultaneous" }),
  dumbbell_front_raise_alternating: metadata("shoulders", ["dumbbells"], { aliases: ["alternating dumbbell front raise"], execution: "alternating", repsPerSide: true, noteUk: "По черзі; повтори на кожну руку", noteEn: "Alternating; reps per arm" }),
  dumbbell_lateral_raise_bilateral: metadata("shoulders", ["dumbbells"], { aliases: ["two arm lateral raise", "simultaneous lateral raise"], execution: "simultaneous" }),
  barbell_upright_row: metadata("shoulders", ["barbell"], { aliases: ["barbell upright row", "upright row", "straight bar high pull"] }),

  one_arm_cable_triceps_extension: metadata("arms", ["cable"], { subcategory: "triceps", aliases: ["cable triceps extension", "pushdown"], execution: "unilateral", repsPerSide: true }),
  bent_over_one_arm_dumbbell_triceps_extension: metadata("arms", ["dumbbells"], { subcategory: "triceps", aliases: ["dumbbell triceps kickback", "triceps kickback"], execution: "unilateral", repsPerSide: true }),
  one_arm_concentration_curl: metadata("arms", ["dumbbells", "bench"], { subcategory: "biceps", aliases: ["concentration curl", "single arm curl"], execution: "unilateral", repsPerSide: true }),
  incline_seated_rotating_dumbbell_curl: metadata("arms", ["dumbbells", "bench"], { subcategory: "biceps", aliases: ["incline dumbbell curl", "supinating curl"], execution: "alternating", repsPerSide: true }),
  supported_dumbbell_wrist_curl: metadata("arms", ["dumbbells", "bench"], { subcategory: "forearms", aliases: ["wrist curl", "forearm curl"], execution: "unilateral", repsPerSide: true }),
  dumbbell_hammer_curl_bilateral: metadata("arms", ["dumbbells"], { subcategory: "biceps", aliases: ["hammer curl both arms", "simultaneous hammer curl"], execution: "simultaneous", noteUk: "Нейтральний хват увесь рух", noteEn: "Neutral grip throughout" }),
  dumbbell_hammer_curl_alternating: metadata("arms", ["dumbbells"], { subcategory: "biceps", aliases: ["alternating hammer curl"], execution: "alternating", repsPerSide: true, noteUk: "Нейтральний хват; по черзі, повтори на кожну руку", noteEn: "Neutral grip; alternating, reps per arm" }),
  dumbbell_supinated_curl_bilateral: metadata("arms", ["dumbbells"], { subcategory: "biceps", aliases: ["supinating dumbbell curl both arms", "simultaneous biceps curl"], execution: "simultaneous" }),
  dumbbell_supinated_curl_alternating: metadata("arms", ["dumbbells"], { subcategory: "biceps", aliases: ["alternating supinating dumbbell curl"], execution: "alternating", repsPerSide: true, noteUk: "По черзі; долоня повертається догори", noteEn: "Alternating; rotate palm upward" }),
  lying_single_arm_dumbbell_triceps_extension_flat: metadata("arms", ["dumbbells", "bench"], { subcategory: "triceps", aliases: ["single arm lying triceps extension", "flat bench dumbbell skull crusher"], execution: "unilateral", repsPerSide: true, noteUk: "Лежачи; опускайте гантель згинанням ліктя", noteEn: "Lying; lower the dumbbell by bending the elbow" }),
  lying_two_hand_dumbbell_triceps_extension_flat: metadata("arms", ["dumbbells", "bench"], { subcategory: "triceps", aliases: ["two hand lying dumbbell triceps extension", "flat bench dumbbell french press"], execution: "simultaneous", noteUk: "Одна гантель у двох руках; лежачи", noteEn: "One dumbbell held with both hands; lying" }),
  overhead_single_arm_dumbbell_triceps_extension_incline_30: metadata("arms", ["dumbbells", "bench"], { subcategory: "triceps", aliases: ["single arm overhead triceps extension incline 30"], execution: "unilateral", repsPerSide: true, noteUk: "З-за голови; спинка лави 30°", noteEn: "Overhead; bench backrest at 30°" }),
  overhead_two_hand_dumbbell_triceps_extension_incline_30: metadata("arms", ["dumbbells", "bench"], { subcategory: "triceps", aliases: ["two hand overhead triceps extension incline 30"], execution: "simultaneous", noteUk: "Одна гантель у двох руках; спинка 30°", noteEn: "One dumbbell held with both hands; backrest at 30°" }),
  overhead_single_arm_dumbbell_triceps_extension_seated_90: metadata("arms", ["dumbbells", "bench"], { subcategory: "triceps", aliases: ["single arm seated overhead triceps extension 90"], execution: "unilateral", repsPerSide: true, noteUk: "З-за голови; спинка лави 90°", noteEn: "Overhead; bench backrest at 90°" }),
  overhead_two_hand_dumbbell_triceps_extension_seated_90: metadata("arms", ["dumbbells", "bench"], { subcategory: "triceps", aliases: ["two hand seated overhead triceps extension 90"], execution: "simultaneous", noteUk: "Одна гантель у двох руках; спинка 90°", noteEn: "One dumbbell held with both hands; backrest at 90°" }),
  lying_ez_bar_triceps_extension_flat_0: metadata("arms", ["ez-bar", "bench"], { subcategory: "triceps", aliases: ["ez bar skull crusher flat bench", "lying ez bar triceps extension 0"], execution: "simultaneous", noteUk: "Лежачи на горизонтальній лаві; EZ-гриф", noteEn: "Lying on flat bench; EZ bar" }),
  lying_ez_bar_triceps_extension_incline_30: metadata("arms", ["ez-bar", "bench"], { subcategory: "triceps", aliases: ["ez bar skull crusher incline bench 30", "incline ez bar triceps extension"], execution: "simultaneous", noteUk: "Лежачи; кут спинки 30°", noteEn: "Lying; bench backrest at 30°" }),
  overhead_ez_bar_triceps_extension_seated_90: metadata("arms", ["ez-bar", "bench"], { subcategory: "triceps", aliases: ["seated ez bar overhead extension 90"], execution: "simultaneous", noteUk: "З-за голови; спинка лави 90°", noteEn: "Overhead; bench backrest at 90°" }),
  overhead_ez_bar_triceps_extension_seated_30: metadata("arms", ["ez-bar", "bench"], { subcategory: "triceps", aliases: ["seated ez bar overhead extension 30"], execution: "simultaneous", noteUk: "З-за голови; спинка лави 30°", noteEn: "Overhead; bench backrest at 30°" }),

  dumbbell_crunch: metadata("abs", ["dumbbells"], { aliases: ["weighted crunch", "dumbbell sit up"] }),
  dumbbell_russian_twist: metadata("abs", ["dumbbells"], { aliases: ["russian twist", "weighted russian twist"] }),
};

export function exercisePickerMetadata(exercise: ExerciseCatalogDto): ExercisePickerMetadata | null {
  return exercise.stableKey ? EXERCISE_PICKER_METADATA_BY_STABLE_KEY[exercise.stableKey] ?? null : null;
}

export function normalizeExercisePickerSearch(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}
