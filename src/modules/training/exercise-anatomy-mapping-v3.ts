import {
  CANONICAL_EXERCISE_IDENTITIES,
  type CanonicalExerciseStableKey,
} from "./canonical-exercise-identity";
import type { AnatomyIdV2 } from "./body-map-catalog-v2";

/** Current qualitative exercise-to-anatomy crosswalk; it is not a muscle-dose model. */
export const EXERCISE_ANATOMY_MAPPING_V3_VERSION = "bodycast-exercise-anatomy-mapping-v3.0.0" as const;
export const EXERCISE_ANATOMY_TAXONOMY_V3_VERSION = "bodycast-anatomy-taxonomy-v2" as const;
export const EXERCISE_ANATOMY_SNAPSHOT_V3_CONTRACT = "bodycast-exercise-anatomy-snapshot-v3" as const;
export const EXERCISE_ANATOMY_SNAPSHOT_V3_PROPERTY = "anatomyMappingSnapshotV3" as const;

export type ExerciseAnatomyRoleV3 = "primary-mover" | "secondary-mover";
export type ExerciseAnatomyMappingV3Target = {
  anatomyId: AnatomyIdV2;
  role: ExerciseAnatomyRoleV3;
  /** Targets are broad and technique-specific contributions are not logged. */
  coverage: "partial";
};
export type ExerciseAnatomyMappingV3 = {
  mappingVersion: typeof EXERCISE_ANATOMY_MAPPING_V3_VERSION;
  taxonomyVersion: typeof EXERCISE_ANATOMY_TAXONOMY_V3_VERSION;
  stableKey: CanonicalExerciseStableKey;
  coverage: "partial";
  movementConvention: { known: readonly string[]; notRecorded: readonly string[] };
  targets: readonly ExerciseAnatomyMappingV3Target[];
};
export type ExerciseAnatomySnapshotV3 = {
  contractVersion: typeof EXERCISE_ANATOMY_SNAPSHOT_V3_CONTRACT;
  mappingVersion: typeof EXERCISE_ANATOMY_MAPPING_V3_VERSION;
  taxonomyVersion: typeof EXERCISE_ANATOMY_TAXONOMY_V3_VERSION;
  stableKey: CanonicalExerciseStableKey;
  availability: "available";
  coverage: "partial";
  movementConvention: ExerciseAnatomyMappingV3["movementConvention"];
  targets: readonly ExerciseAnatomyMappingV3Target[];
};

type MappingDefinition = {
  stableKey: CanonicalExerciseStableKey;
  primary: readonly AnatomyIdV2[];
  secondary?: readonly AnatomyIdV2[];
};

const definitions = [
  { stableKey: "incline_dumbbell_press_30deg", primary: ["pectoralis_major_clavicular_head", "deltoid_anterior"], secondary: ["triceps_brachii"] },
  { stableKey: "flat_dumbbell_fly", primary: ["pectoralis_major"], secondary: ["deltoid_anterior"] },
  { stableKey: "pushup_handles", primary: ["pectoralis_major", "triceps_brachii"], secondary: ["deltoid_anterior"] },
  { stableKey: "seated_dumbbell_press", primary: ["deltoid"], secondary: ["triceps_brachii", "pectoralis_major_clavicular_head"] },
  { stableKey: "one_arm_lateral_raise", primary: ["deltoid_middle"] },
  { stableKey: "one_arm_cable_triceps_extension", primary: ["triceps_brachii"] },
  { stableKey: "bent_over_one_arm_dumbbell_triceps_extension", primary: ["triceps_brachii"] },
  { stableKey: "one_arm_seated_cable_row", primary: ["latissimus_dorsi", "trapezius_middle", "rhomboid_region"], secondary: ["biceps_brachii", "deltoid_posterior"] },
  { stableKey: "pull_up", primary: ["latissimus_dorsi", "trapezius_middle"], secondary: ["biceps_brachii", "brachialis", "brachioradialis", "forearm_flexor_region"] },
  { stableKey: "hyperextension", primary: ["erector_spinae", "gluteus_maximus", "hamstrings"] },
  { stableKey: "one_arm_concentration_curl", primary: ["biceps_brachii"], secondary: ["brachialis", "brachioradialis"] },
  { stableKey: "incline_seated_rotating_dumbbell_curl", primary: ["biceps_brachii"], secondary: ["brachialis"] },
  { stableKey: "supported_dumbbell_wrist_curl", primary: ["forearm_flexor_region"] },
  { stableKey: "bulgarian_split_squat", primary: ["quadriceps_femoris", "gluteus_maximus"], secondary: ["posterior_thigh", "calf_complex", "abdominal_wall"] },
  { stableKey: "forward_dumbbell_lunge", primary: ["quadriceps_femoris", "gluteus_maximus"], secondary: ["posterior_thigh", "calf_complex", "abdominal_wall"] },
  { stableKey: "goblet_squat", primary: ["quadriceps_femoris", "gluteus_maximus"], secondary: ["adductor_region", "abdominal_wall"] },
  { stableKey: "dumbbell_crunch", primary: ["rectus_abdominis"], secondary: ["external_oblique", "internal_oblique"] },
  { stableKey: "dumbbell_russian_twist", primary: ["external_oblique", "internal_oblique"], secondary: ["rectus_abdominis"] },
  { stableKey: "front_foot_elevated_split_squat", primary: ["quadriceps_femoris", "gluteus_maximus"], secondary: ["posterior_thigh", "calf_complex"] },
  { stableKey: "romanian_deadlift", primary: ["hamstrings", "gluteus_maximus"], secondary: ["erector_spinae"] },
  { stableKey: "cable_leg_curl", primary: ["hamstrings"], secondary: ["calf_complex"] },
  { stableKey: "barbell_hip_thrust", primary: ["gluteus_maximus"], secondary: ["hamstrings"] },
  { stableKey: "cable_glute_kickback", primary: ["gluteus_maximus"] },
  { stableKey: "single_leg_standing_calf_raise", primary: ["calf_complex"] },
  { stableKey: "seated_calf_raise", primary: ["calf_complex"] },
  { stableKey: "cable_hip_adduction", primary: ["adductor_region"] },
  { stableKey: "cable_hip_abduction", primary: ["gluteus_medius", "gluteus_minimus", "tensor_fasciae_latae"] },
  { stableKey: "flat_dumbbell_bench_press", primary: ["pectoralis_major"], secondary: ["deltoid_anterior", "triceps_brachii"] },
  { stableKey: "dumbbell_front_raise_bilateral", primary: ["deltoid_anterior"], secondary: ["pectoralis_major_clavicular_head"] },
  { stableKey: "dumbbell_front_raise_alternating", primary: ["deltoid_anterior"], secondary: ["pectoralis_major_clavicular_head"] },
  { stableKey: "dumbbell_lateral_raise_bilateral", primary: ["deltoid_middle"], secondary: ["trapezius_upper"] },
  { stableKey: "barbell_upright_row", primary: ["deltoid_middle", "trapezius_upper"], secondary: ["biceps_brachii"] },
  { stableKey: "dumbbell_hammer_curl_bilateral", primary: ["brachialis", "biceps_brachii"], secondary: ["brachioradialis"] },
  { stableKey: "dumbbell_hammer_curl_alternating", primary: ["brachialis", "biceps_brachii"], secondary: ["brachioradialis"] },
  { stableKey: "dumbbell_supinated_curl_bilateral", primary: ["biceps_brachii"], secondary: ["brachialis", "brachioradialis"] },
  { stableKey: "dumbbell_supinated_curl_alternating", primary: ["biceps_brachii"], secondary: ["brachialis", "brachioradialis"] },
  { stableKey: "knee_push_up_floor", primary: ["pectoralis_major"], secondary: ["triceps_brachii", "deltoid_anterior"] },
  { stableKey: "knee_push_up_hands_bench", primary: ["pectoralis_major"], secondary: ["triceps_brachii", "deltoid_anterior"] },
  { stableKey: "incline_push_up_hands_bench", primary: ["pectoralis_major"], secondary: ["triceps_brachii", "deltoid_anterior"] },
  { stableKey: "one_arm_dumbbell_row_bench_supported", primary: ["latissimus_dorsi", "trapezius_middle", "rhomboid_region"], secondary: ["biceps_brachii", "deltoid_posterior"] },
  { stableKey: "lying_single_arm_dumbbell_triceps_extension_flat", primary: ["triceps_brachii"] },
  { stableKey: "lying_two_hand_dumbbell_triceps_extension_flat", primary: ["triceps_brachii"] },
  { stableKey: "overhead_single_arm_dumbbell_triceps_extension_incline_30", primary: ["triceps_brachii"] },
  { stableKey: "overhead_two_hand_dumbbell_triceps_extension_incline_30", primary: ["triceps_brachii"] },
  { stableKey: "overhead_single_arm_dumbbell_triceps_extension_seated_90", primary: ["triceps_brachii"] },
  { stableKey: "overhead_two_hand_dumbbell_triceps_extension_seated_90", primary: ["triceps_brachii"] },
  { stableKey: "lying_ez_bar_triceps_extension_flat_0", primary: ["triceps_brachii"] },
  { stableKey: "lying_ez_bar_triceps_extension_incline_30", primary: ["triceps_brachii"] },
  { stableKey: "overhead_ez_bar_triceps_extension_seated_90", primary: ["triceps_brachii"] },
  { stableKey: "overhead_ez_bar_triceps_extension_seated_30", primary: ["triceps_brachii"] },
] as const satisfies readonly MappingDefinition[];

const movementNotRecorded = Object.freeze([
  "Exact repetition technique, range of motion, and effort by individual muscle are not recorded.",
  "Targets are qualitative exercise associations; they do not represent a measured dose or muscle growth.",
]);

function freezeMapping(definition: MappingDefinition): ExerciseAnatomyMappingV3 {
  const identity = CANONICAL_EXERCISE_IDENTITIES.find(({ stableKey }) => stableKey === definition.stableKey);
  if (!identity) throw new Error(`Unknown canonical exercise ${definition.stableKey}`);
  const targets: ExerciseAnatomyMappingV3Target[] = [
    ...definition.primary.map((anatomyId) => ({ anatomyId, role: "primary-mover" as const, coverage: "partial" as const })),
    ...(definition.secondary ?? []).map((anatomyId) => ({ anatomyId, role: "secondary-mover" as const, coverage: "partial" as const })),
  ];
  return Object.freeze({
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V3_VERSION,
    taxonomyVersion: EXERCISE_ANATOMY_TAXONOMY_V3_VERSION,
    stableKey: definition.stableKey,
    coverage: "partial",
    movementConvention: Object.freeze({ known: Object.freeze([identity.displayName]), notRecorded: movementNotRecorded }),
    targets: Object.freeze(targets.map((target) => Object.freeze(target))),
  });
}

const mutableRegistry = new Map(definitions.map((definition) => [definition.stableKey, freezeMapping(definition)] as const));
export const EXERCISE_ANATOMY_MAPPING_REGISTRY_V3: ReadonlyMap<CanonicalExerciseStableKey, ExerciseAnatomyMappingV3> = Object.freeze({
  get size() { return mutableRegistry.size; },
  get(key: CanonicalExerciseStableKey) { return mutableRegistry.get(key); },
  has(key: CanonicalExerciseStableKey) { return mutableRegistry.has(key); },
  entries() { return mutableRegistry.entries(); },
  keys() { return mutableRegistry.keys(); },
  values() { return mutableRegistry.values(); },
  forEach(callbackfn: (value: ExerciseAnatomyMappingV3, key: CanonicalExerciseStableKey, map: ReadonlyMap<CanonicalExerciseStableKey, ExerciseAnatomyMappingV3>) => void, thisArg?: unknown) {
    mutableRegistry.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  },
  [Symbol.iterator]() { return mutableRegistry[Symbol.iterator](); },
});

export function buildExerciseAnatomySnapshotV3(stableKey: string | null | undefined): ExerciseAnatomySnapshotV3 | null {
  if (!stableKey) return null;
  const mapping = EXERCISE_ANATOMY_MAPPING_REGISTRY_V3.get(stableKey as CanonicalExerciseStableKey);
  if (!mapping) return null;
  return {
    contractVersion: EXERCISE_ANATOMY_SNAPSHOT_V3_CONTRACT,
    mappingVersion: mapping.mappingVersion,
    taxonomyVersion: mapping.taxonomyVersion,
    stableKey: mapping.stableKey,
    availability: "available",
    coverage: mapping.coverage,
    movementConvention: { known: [...mapping.movementConvention.known], notRecorded: [...mapping.movementConvention.notRecorded] },
    targets: mapping.targets.map((target) => ({ ...target })),
  };
}

export function parseExerciseAnatomySnapshotV3(value: unknown): ExerciseAnatomySnapshotV3 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.contractVersion !== EXERCISE_ANATOMY_SNAPSHOT_V3_CONTRACT
    || raw.mappingVersion !== EXERCISE_ANATOMY_MAPPING_V3_VERSION
    || raw.taxonomyVersion !== EXERCISE_ANATOMY_TAXONOMY_V3_VERSION
    || raw.availability !== "available"
    || raw.coverage !== "partial"
    || typeof raw.stableKey !== "string") return null;
  const expected = buildExerciseAnatomySnapshotV3(raw.stableKey);
  if (!expected) return null;
  const movement = raw.movementConvention && typeof raw.movementConvention === "object" && !Array.isArray(raw.movementConvention)
    ? raw.movementConvention as Record<string, unknown>
    : null;
  const targets = Array.isArray(raw.targets) ? raw.targets : null;
  if (!movement || JSON.stringify(movement.known) !== JSON.stringify(expected.movementConvention.known)
    || JSON.stringify(movement.notRecorded) !== JSON.stringify(expected.movementConvention.notRecorded)
    || !targets || targets.length !== expected.targets.length
    || !targets.every((entry, index) => {
      const target = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
      const wanted = expected.targets[index];
      return target?.anatomyId === wanted?.anatomyId
        && target?.role === wanted?.role
        && target?.coverage === wanted?.coverage;
    })) return null;
  return expected;
}

export function validateExerciseAnatomyMappingRegistryV3(): string[] {
  const errors: string[] = [];
  const expected = new Set<string>(CANONICAL_EXERCISE_IDENTITIES.map(({ stableKey }) => stableKey));
  for (const [stableKey, mapping] of EXERCISE_ANATOMY_MAPPING_REGISTRY_V3) {
    if (!expected.has(stableKey)) errors.push(`non-canonical exercise mapping ${stableKey}`);
    if (mapping.stableKey !== stableKey) errors.push(`mapping key mismatch ${stableKey}`);
    if (!mapping.targets.some(({ role }) => role === "primary-mover")) errors.push(`missing primary target ${stableKey}`);
    if (mapping.targets.length === 0) errors.push(`missing anatomy targets ${stableKey}`);
    const seen = new Set<string>();
    for (const target of mapping.targets) {
      if (seen.has(target.anatomyId)) errors.push(`duplicate target ${target.anatomyId} in ${stableKey}`);
      seen.add(target.anatomyId);
    }
  }
  for (const stableKey of expected) if (!EXERCISE_ANATOMY_MAPPING_REGISTRY_V3.has(stableKey as CanonicalExerciseStableKey)) errors.push(`missing exercise mapping ${stableKey}`);
  for (const stableKey of EXERCISE_ANATOMY_MAPPING_REGISTRY_V3.keys()) if (!expected.has(stableKey)) errors.push(`unexpected exercise mapping ${stableKey}`);
  if (EXERCISE_ANATOMY_MAPPING_REGISTRY_V3.size !== expected.size) errors.push("mapping count does not match the canonical catalog");
  return errors;
}
