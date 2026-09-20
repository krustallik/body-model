import type { CanonicalExerciseStableKey } from "@/modules/training/canonical-exercise-identity";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";

/**
 * Smallest stable anatomical taxonomy for the current supported exercises.
 * Groups describe local stimulus/coverage only — not body-mass state slots.
 */
export const CANONICAL_MUSCLE_GROUPS_V7 = [
  "chest",
  "deltoids",
  "triceps",
  "back",
  "biceps",
  "forearms",
  "spinal_extensors",
  "hip_extensors",
] as const;

export type CanonicalMuscleGroupV7 = (typeof CANONICAL_MUSCLE_GROUPS_V7)[number];

/** Historical snapshots may retain older versions; new writes use CURRENT. */
export const EXERCISE_MUSCLE_MAPPING_V7_VERSIONS = [
  "bodycast-exercise-muscle-mapping-v7.1",
  "bodycast-exercise-muscle-mapping-v7.2",
] as const;

export type ExerciseMuscleMappingV7Version =
  (typeof EXERCISE_MUSCLE_MAPPING_V7_VERSIONS)[number];

/** Current approved registry version. Existing non-null snapshots are never rewritten. */
export const EXERCISE_MUSCLE_MAPPING_V7_VERSION =
  "bodycast-exercise-muscle-mapping-v7.2" as const satisfies ExerciseMuscleMappingV7Version;

export const EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT =
  "bodycast-exercise-muscle-mapping-snapshot-v7-1" as const;

export type MuscleRoleV7 = "direct" | "indirect";

export type ExerciseMuscleMappingTargetV7 = {
  muscleGroup: CanonicalMuscleGroupV7;
  role: MuscleRoleV7;
};

/**
 * Approved categorical mapping. Roles are anatomical only — never numeric
 * effective-set credits, percentages, or hypertrophy coefficients.
 */
export type ExerciseMuscleMappingV7 = {
  mappingVersion: typeof EXERCISE_MUSCLE_MAPPING_V7_VERSION;
  stableKey: CanonicalExerciseStableKey;
  /** Review-only; never used for scientific lookup. */
  displayName: string;
  targets: readonly ExerciseMuscleMappingTargetV7[];
  rationale: string;
};

export type AvailableExerciseMuscleMappingSnapshotV7 = {
  contractVersion: typeof EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT;
  availability: "available";
  mappingVersion: ExerciseMuscleMappingV7Version;
  stableKey: CanonicalExerciseStableKey;
  provenance: "approved-v7-registry";
  targets: readonly ExerciseMuscleMappingTargetV7[];
};

export type UnavailableExerciseMuscleMappingSnapshotV7 = {
  contractVersion: typeof EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT;
  availability: "unavailable";
  mappingVersion: null;
  stableKey: string | null;
  provenance: null;
  reason: "missing-stable-key" | "unregistered-stable-key";
  targets: readonly [];
};

export type ExerciseMuscleMappingSnapshotV7 =
  | AvailableExerciseMuscleMappingSnapshotV7
  | UnavailableExerciseMuscleMappingSnapshotV7;

type RegistryEntry = Omit<ExerciseMuscleMappingV7, "mappingVersion"> & {
  mappingVersion?: typeof EXERCISE_MUSCLE_MAPPING_V7_VERSION;
};

function targets(
  direct: readonly CanonicalMuscleGroupV7[],
  indirect: readonly CanonicalMuscleGroupV7[] = [],
): ExerciseMuscleMappingTargetV7[] {
  return [
    ...direct.map((muscleGroup) => ({ muscleGroup, role: "direct" as const })),
    ...indirect.map((muscleGroup) => ({ muscleGroup, role: "indirect" as const })),
  ];
}

/**
 * Version-controlled registry keyed ONLY by stableKey.
 * Display names are documentation for review; lookup never uses them.
 */
const REGISTRY_ENTRIES: readonly RegistryEntry[] = [
  {
    stableKey: "incline_dumbbell_press_30deg",
    displayName: "Жим гантелей на похилій лаві вгору (30°)",
    targets: targets(["chest", "deltoids"], ["triceps"]),
    rationale: "Incline press loads chest and anterior deltoids; triceps assist elbow extension.",
  },
  {
    stableKey: "flat_dumbbell_fly",
    displayName: "Розведення гантелей на горизонтальній лаві",
    targets: targets(["chest"], ["deltoids"]),
    rationale: "Flat fly is a chest isolation pattern; deltoids stabilize the shoulder.",
  },
  {
    stableKey: "pushup_handles",
    displayName: "Віджимання від ручок",
    targets: targets(["chest", "triceps"], ["deltoids"]),
    rationale: "Handle push-up is a compound press; chest and triceps are primary movers.",
  },
  {
    stableKey: "seated_dumbbell_press",
    displayName: "Жим гантелей сидячи",
    targets: targets(["deltoids"], ["triceps"]),
    rationale: "Seated overhead press loads deltoids; triceps assist lockout.",
  },
  {
    stableKey: "one_arm_lateral_raise",
    displayName: "Махи гантеллю однією рукою вбік",
    targets: targets(["deltoids"]),
    rationale: "Lateral raise is a deltoid isolation pattern with no separate secondary mover claimed.",
  },
  {
    stableKey: "one_arm_cable_triceps_extension",
    displayName: "Розгинання однієї руки в блоці",
    targets: targets(["triceps"]),
    rationale: "Single-arm cable extension isolates the triceps.",
  },
  {
    stableKey: "bent_over_one_arm_dumbbell_triceps_extension",
    displayName: "Розгинання однієї руки з гантеллю в нахилі",
    targets: targets(["triceps"]),
    rationale: "Kickback-style extension isolates the triceps; no second muscle credit is claimed.",
  },
  {
    stableKey: "one_arm_seated_cable_row",
    displayName: "Тяга горизонтального блоку сидячи однією рукою",
    targets: targets(["back"], ["biceps"]),
    rationale: "Seated horizontal row loads the back; biceps assist elbow flexion.",
  },
  {
    stableKey: "pull_up",
    displayName: "Підтягування на перекладині",
    targets: targets(["back"], ["biceps", "forearms"]),
    rationale: "Standard pull-up loads the back; biceps and forearms assist elbow flexion and grip.",
  },
  {
    stableKey: "hyperextension",
    displayName: "Гіперекстензія",
    targets: targets(["spinal_extensors", "hip_extensors"]),
    rationale:
      "Hyperextension materially loads spinal extensors and hip extensors (glute/hamstring complex) as direct movers; finer glute/hamstring splits are not required for this catalog.",
  },
  {
    stableKey: "one_arm_concentration_curl",
    displayName: "Згинання однієї руки від коліна",
    targets: targets(["biceps"], ["forearms"]),
    rationale: "Concentration curl loads the biceps; forearm flexors stabilize grip.",
  },
  {
    stableKey: "incline_seated_rotating_dumbbell_curl",
    displayName: "Згинання рук з розворотом сидячи на похилій лаві",
    targets: targets(["biceps"], ["forearms"]),
    rationale: "Incline rotating curl loads the biceps; forearms participate in grip and rotation control.",
  },
  {
    stableKey: "supported_dumbbell_wrist_curl",
    displayName: "Згинання кисті з гантеллю в упорі",
    targets: targets(["forearms"]),
    rationale: "Supported wrist curl isolates the forearms.",
  },
] as const;

function assertCanonicalMuscleGroup(value: string): asserts value is CanonicalMuscleGroupV7 {
  if (!(CANONICAL_MUSCLE_GROUPS_V7 as readonly string[]).includes(value)) {
    throw new Error(`Unknown CanonicalMuscleGroupV7: ${value}`);
  }
}

function finalizeEntry(entry: RegistryEntry): ExerciseMuscleMappingV7 {
  for (const target of entry.targets) {
    assertCanonicalMuscleGroup(target.muscleGroup);
    if (target.role !== "direct" && target.role !== "indirect") {
      throw new Error(`Invalid muscle role for ${entry.stableKey}`);
    }
  }
  return {
    mappingVersion: EXERCISE_MUSCLE_MAPPING_V7_VERSION,
    stableKey: entry.stableKey,
    displayName: entry.displayName,
    targets: entry.targets,
    rationale: entry.rationale,
  };
}

export const EXERCISE_MUSCLE_MAPPING_REGISTRY_V7: ReadonlyMap<
  CanonicalExerciseStableKey,
  ExerciseMuscleMappingV7
> = new Map(
  REGISTRY_ENTRIES.map((entry) => {
    const finalized = finalizeEntry(entry);
    return [finalized.stableKey, finalized] as const;
  }),
);

export function isCanonicalMuscleGroupV7(value: string): value is CanonicalMuscleGroupV7 {
  return (CANONICAL_MUSCLE_GROUPS_V7 as readonly string[]).includes(value);
}

/** Scientific lookup — stableKey only. Never resolves by display name or SERIAL id. */
export function lookupExerciseMuscleMappingV7(
  stableKey: string | null | undefined,
): ExerciseMuscleMappingV7 | null {
  if (stableKey == null || stableKey === "") return null;
  return EXERCISE_MUSCLE_MAPPING_REGISTRY_V7.get(stableKey as CanonicalExerciseStableKey) ?? null;
}

export function approvedExerciseMuscleMappingCoverageV7(): {
  expected: number;
  mapped: number;
  missingStableKeys: CanonicalExerciseStableKey[];
} {
  const missingStableKeys = CANONICAL_EXERCISE_IDENTITIES
    .map((exercise) => exercise.stableKey)
    .filter((stableKey) => !EXERCISE_MUSCLE_MAPPING_REGISTRY_V7.has(stableKey));
  return {
    expected: CANONICAL_EXERCISE_IDENTITIES.length,
    mapped: EXERCISE_MUSCLE_MAPPING_REGISTRY_V7.size,
    missingStableKeys,
  };
}

export function buildExerciseMuscleMappingSnapshotV7(
  stableKey: string | null | undefined,
): ExerciseMuscleMappingSnapshotV7 {
  if (stableKey == null || stableKey === "") {
    return {
      contractVersion: EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT,
      availability: "unavailable",
      mappingVersion: null,
      stableKey: null,
      provenance: null,
      reason: "missing-stable-key",
      targets: [],
    };
  }

  const mapping = lookupExerciseMuscleMappingV7(stableKey);
  if (!mapping) {
    return {
      contractVersion: EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT,
      availability: "unavailable",
      mappingVersion: null,
      stableKey,
      provenance: null,
      reason: "unregistered-stable-key",
      targets: [],
    };
  }

  return {
    contractVersion: EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT,
    availability: "available",
    mappingVersion: mapping.mappingVersion,
    stableKey: mapping.stableKey,
    provenance: "approved-v7-registry",
    // Deterministic order: direct first (registry order), then indirect.
    targets: mapping.targets.map((target) => ({
      muscleGroup: target.muscleGroup,
      role: target.role,
    })),
  };
}

export type ExerciseMuscleMappingDiagnosticsV7 = {
  mappingAvailability: "available" | "unavailable";
  mappingVersion: string | null;
  mappingProvenance: "approved-v7-registry" | null;
  stableKey: string | null;
  directTargets: CanonicalMuscleGroupV7[];
  indirectTargets: CanonicalMuscleGroupV7[];
  mappedTargetCount: number;
  /** Structural only — never a physiological confidence/multiplier. */
  reason: "missing-stable-key" | "unregistered-stable-key" | null;
};

export function describeExerciseMuscleMappingSnapshotV7(
  snapshot: unknown,
): ExerciseMuscleMappingDiagnosticsV7 {
  const parsed = parseExerciseMuscleMappingSnapshotV7(snapshot);
  if (!parsed || parsed.availability === "unavailable") {
    return {
      mappingAvailability: "unavailable",
      mappingVersion: null,
      mappingProvenance: null,
      stableKey: parsed?.stableKey ?? null,
      directTargets: [],
      indirectTargets: [],
      mappedTargetCount: 0,
      reason: parsed?.reason ?? (snapshot == null ? "missing-stable-key" : "unregistered-stable-key"),
    };
  }

  const directTargets = parsed.targets
    .filter((target) => target.role === "direct")
    .map((target) => target.muscleGroup);
  const indirectTargets = parsed.targets
    .filter((target) => target.role === "indirect")
    .map((target) => target.muscleGroup);

  return {
    mappingAvailability: "available",
    mappingVersion: parsed.mappingVersion,
    mappingProvenance: parsed.provenance,
    stableKey: parsed.stableKey,
    directTargets,
    indirectTargets,
    mappedTargetCount: parsed.targets.length,
    reason: null,
  };
}

export function parseExerciseMuscleMappingSnapshotV7(
  snapshot: unknown,
): ExerciseMuscleMappingSnapshotV7 | null {
  if (snapshot == null || typeof snapshot !== "object") return null;
  const record = snapshot as Record<string, unknown>;
  if (record.contractVersion !== EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT) return null;
  if (record.availability === "unavailable") {
    return {
      contractVersion: EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT,
      availability: "unavailable",
      mappingVersion: null,
      stableKey: typeof record.stableKey === "string" ? record.stableKey : null,
      provenance: null,
      reason: record.reason === "unregistered-stable-key"
        ? "unregistered-stable-key"
        : "missing-stable-key",
      targets: [],
    };
  }
  if (record.availability !== "available") return null;
  if (
    typeof record.mappingVersion !== "string"
    || !(EXERCISE_MUSCLE_MAPPING_V7_VERSIONS as readonly string[]).includes(record.mappingVersion)
  ) {
    return null;
  }
  if (record.provenance !== "approved-v7-registry") return null;
  if (typeof record.stableKey !== "string") return null;
  if (!Array.isArray(record.targets)) return null;

  const targetsParsed: ExerciseMuscleMappingTargetV7[] = [];
  for (const raw of record.targets) {
    if (!raw || typeof raw !== "object") return null;
    const target = raw as Record<string, unknown>;
    if (typeof target.muscleGroup !== "string" || !isCanonicalMuscleGroupV7(target.muscleGroup)) {
      return null;
    }
    if (target.role !== "direct" && target.role !== "indirect") return null;
    targetsParsed.push({ muscleGroup: target.muscleGroup, role: target.role });
  }

  return {
    contractVersion: EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT,
    availability: "available",
    mappingVersion: record.mappingVersion as ExerciseMuscleMappingV7Version,
    stableKey: record.stableKey as CanonicalExerciseStableKey,
    provenance: "approved-v7-registry",
    targets: targetsParsed,
  };
}

/** Reject accidental numeric weights in registry payloads. */
export function assertMappingHasNoNumericWeights(mapping: ExerciseMuscleMappingV7): void {
  const serialized = JSON.stringify(mapping);
  if (/"weight"\s*:|"coefficient"\s*:|"percent"\s*:|"credit"\s*:/i.test(serialized)) {
    throw new Error(`Numeric mapping weights are not allowed for ${mapping.stableKey}`);
  }
  for (const target of mapping.targets) {
    const keys = Object.keys(target).sort();
    if (keys.join(",") !== "muscleGroup,role") {
      throw new Error(`Unexpected target fields for ${mapping.stableKey}: ${keys.join(",")}`);
    }
  }
}
