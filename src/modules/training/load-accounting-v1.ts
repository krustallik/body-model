import { z } from "zod";
import type { CanonicalExerciseStableKey } from "./canonical-exercise-identity";
import { CANONICAL_EXERCISE_IDENTITIES } from "./canonical-exercise-identity";

export const LOAD_ACCOUNTING_METHOD_V1 = "bodycast-load-accounting-v1" as const;
export const LEGACY_LOAD_INTERPRETATION_V1 = "bodycast-historical-load-entry-v1" as const;
export const CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1 = 0.7 as const;
export const CANONICAL_PUSH_UP_CONFIG_VERSION_V1 = "bodycast-push-up-load-approx-v1" as const;

const baseShape = {
  schemaVersion: z.literal(1),
  configVersion: z.string().trim().min(1).max(80),
  inventoryCount: z.union([z.literal(1), z.literal(2)]),
  loadedSides: z.union([z.literal(1), z.literal(2)]),
  execution: z.enum(["simultaneous", "alternating", "unilateral"]),
  equipment: z.object({
    equipmentId: z.string().trim().min(1).max(80),
    setupId: z.string().trim().min(1).max(80),
  }).strict(),
};

const perSideExternalSchema = z.object({
  ...baseShape,
  accountingKind: z.literal("external-per-implement-per-side"),
  resistanceType: z.literal("external"),
  loadInput: z.literal("per-implement-kg"),
  repsMeaning: z.literal("per-side"),
}).strict().superRefine((config, context) => {
  if (config.execution === "simultaneous"
      && config.loadedSides > config.inventoryCount) {
    context.addIssue({
      code: "custom",
      path: ["inventoryCount"],
      message: "simultaneous per-side loading requires one implement per loaded side",
    });
  }
});

const perMovementPerImplementSchema = z.object({
  ...baseShape,
  accountingKind: z.literal("external-per-implement-per-movement"),
  resistanceType: z.literal("external"),
  loadInput: z.literal("per-implement-kg"),
  repsMeaning: z.literal("per-movement"),
  implementsPerMovement: z.union([z.literal(1), z.literal(2)]),
}).strict().superRefine((config, context) => {
  if (config.implementsPerMovement > config.inventoryCount) {
    context.addIssue({
      code: "custom",
      path: ["implementsPerMovement"],
      message: "implementsPerMovement cannot exceed inventoryCount",
    });
  }
  if (config.execution !== "simultaneous" && config.implementsPerMovement !== 1) {
    context.addIssue({
      code: "custom",
      path: ["implementsPerMovement"],
      message: "alternating and unilateral movements load one implement at a time",
    });
  }
});

const completeSetupSchema = z.object({
  ...baseShape,
  accountingKind: z.literal("external-complete-setup-per-movement"),
  resistanceType: z.literal("external"),
  loadInput: z.literal("complete-setup-kg"),
  repsMeaning: z.literal("per-movement"),
}).strict();

const bandLoggedSideSchema = z.object({
  ...baseShape,
  accountingKind: z.literal("band-nominal-per-logged-side"),
  resistanceType: z.literal("band-nominal"),
  loadInput: z.literal("nominal-kg-per-logged-side"),
  repsMeaning: z.literal("per-logged-side"),
}).strict();

const bandPerSideSchema = z.object({
  ...baseShape,
  accountingKind: z.literal("band-nominal-per-side"),
  resistanceType: z.literal("band-nominal"),
  loadInput: z.literal("nominal-kg-per-logged-side"),
  repsMeaning: z.literal("per-side"),
}).strict();

const bodyweightMovementSchema = z.object({
  ...baseShape,
  accountingKind: z.literal("bodyweight-reference-per-movement"),
  resistanceType: z.literal("bodyweight"),
  loadInput: z.literal("bodyweight-reference"),
  repsMeaning: z.literal("per-movement"),
  bodyweightFraction: z.number().finite().gt(0).max(1),
}).strict();

const bodyweightPerSideSchema = z.object({
  ...baseShape,
  accountingKind: z.literal("bodyweight-reference-per-side"),
  resistanceType: z.literal("bodyweight"),
  loadInput: z.literal("bodyweight-reference"),
  repsMeaning: z.literal("per-side"),
  bodyweightFraction: z.number().finite().gt(0).max(1),
}).strict();

export const loadConfigV1Schema = z.discriminatedUnion("accountingKind", [
  perSideExternalSchema,
  perMovementPerImplementSchema,
  completeSetupSchema,
  bandLoggedSideSchema,
  bandPerSideSchema,
  bodyweightMovementSchema,
  bodyweightPerSideSchema,
]);

export type LoadConfigV1 = z.infer<typeof loadConfigV1Schema>;
export type ResistanceTypeV1 = LoadConfigV1["resistanceType"];

const asymmetricRepsSchema = z.object({
  kind: z.literal("asymmetric-per-side"),
  left: z.number().int().nonnegative(),
  right: z.number().int().nonnegative(),
}).strict().refine((value) => value.left + value.right > 0, {
  message: "at least one side must have a positive repetition count",
});

export const setExecutionOverrideV1Schema = z.object({
  inventoryCount: z.union([z.literal(1), z.literal(2)]).optional(),
  loadedSides: z.union([z.literal(1), z.literal(2)]).optional(),
  execution: z.enum(["simultaneous", "alternating", "unilateral"]).optional(),
  loadInput: z.enum([
    "per-implement-kg",
    "complete-setup-kg",
    "nominal-kg-per-logged-side",
  ]).optional(),
  repsMeaning: z.enum(["per-side", "per-movement", "per-logged-side"]).optional(),
  implementsPerMovement: z.union([z.literal(1), z.literal(2)]).optional(),
  reps: asymmetricRepsSchema.optional(),
  additionalLoadKg: z.number().finite().nonnegative().optional(),
  assistanceLoadKg: z.number().finite().nonnegative().optional(),
  equipmentSetupId: z.string().trim().min(1).max(80).optional(),
}).strict().superRefine((override, context) => {
  if (override.additionalLoadKg !== undefined
      && override.assistanceLoadKg !== undefined
      && override.additionalLoadKg > 0
      && override.assistanceLoadKg > 0) {
    context.addIssue({
      code: "custom",
      path: ["assistanceLoadKg"],
      message: "a set cannot be both additionally loaded and assisted",
    });
  }
});

export type SetExecutionOverrideV1 = z.infer<typeof setExecutionOverrideV1Schema>;

export type IdentityStatusV1 =
  | "canonical-snapshot"
  | "known-legacy"
  | "custom"
  | "ambiguous"
  | "unverified";

export type IdentityEvidenceV1 = {
  status: IdentityStatusV1;
  stableKey: string | null;
};

export type IdentityInventoryEvidenceV1 = {
  sourceExerciseCatalogId: number | null;
  snapshotStableKey: string | null;
  catalogStableKey: string | null;
};

export type IdentityInventoryClassV1 = "canonical" | "legacy" | "custom" | "ambiguous";

const canonicalKeys = new Set<string>(
  CANONICAL_EXERCISE_IDENTITIES.map(({ stableKey }) => stableKey),
);

/** Classifies persisted identity only; display names are deliberately absent. */
export function classifyPersistedExerciseIdentityV1(
  evidence: IdentityInventoryEvidenceV1,
): IdentityInventoryClassV1 {
  const snapshotKey = evidence.snapshotStableKey?.trim() || null;
  const catalogKey = evidence.catalogStableKey?.trim() || null;
  if (snapshotKey && catalogKey && snapshotKey !== catalogKey) return "ambiguous";
  if (snapshotKey) {
    if (canonicalKeys.has(snapshotKey)) return "canonical";
    return "custom";
  }
  if (catalogKey && canonicalKeys.has(catalogKey)) return "legacy";
  if (evidence.sourceExerciseCatalogId !== null) return "custom";
  return "ambiguous";
}

export function summarizePersistedExerciseIdentityV1(
  evidence: readonly IdentityInventoryEvidenceV1[],
): Record<IdentityInventoryClassV1, number> {
  const result: Record<IdentityInventoryClassV1, number> = {
    canonical: 0,
    legacy: 0,
    custom: 0,
    ambiguous: 0,
  };
  for (const row of evidence) result[classifyPersistedExerciseIdentityV1(row)] += 1;
  return result;
}

const legacyConfigVersion = LEGACY_LOAD_INTERPRETATION_V1;

function common(
  inventoryCount: 1 | 2,
  loadedSides: 1 | 2,
  execution: LoadConfigV1["execution"],
  equipmentId: string,
  setupId: string,
) {
  return {
    schemaVersion: 1 as const,
    configVersion: legacyConfigVersion,
    inventoryCount,
    loadedSides,
    execution,
    equipment: { equipmentId, setupId },
  };
}

function legacyPerSide(equipmentId = "dumbbell", setupId = "single-dumbbell"): LoadConfigV1 {
  return {
    ...common(1, 2, "unilateral", equipmentId, setupId),
    accountingKind: "external-per-implement-per-side",
    resistanceType: "external",
    loadInput: "per-implement-kg",
    repsMeaning: "per-side",
  };
}

function legacyDumbbellPair(execution: "simultaneous" | "alternating" = "simultaneous"): LoadConfigV1 {
  return {
    ...common(2, 2, execution, "dumbbell", "pair"),
    accountingKind: "external-per-implement-per-side",
    resistanceType: "external",
    loadInput: "per-implement-kg",
    repsMeaning: "per-side",
  };
}

function legacyBand(setupId: string): LoadConfigV1 {
  return {
    ...common(1, 2, "unilateral", "resistance-band", setupId),
    accountingKind: "band-nominal-per-logged-side",
    resistanceType: "band-nominal",
    loadInput: "nominal-kg-per-logged-side",
    repsMeaning: "per-logged-side",
  };
}

function legacyBodyweight(
  equipmentId: string,
  setupId: string,
  assumption?: { bodyweightFraction: number; configVersion: string },
): LoadConfigV1 {
  return {
    ...common(1, 2, "simultaneous", equipmentId, setupId),
    ...(assumption ? { configVersion: assumption.configVersion } : {}),
    accountingKind: "bodyweight-reference-per-movement",
    resistanceType: "bodyweight",
    loadInput: "bodyweight-reference",
    repsMeaning: "per-movement",
    bodyweightFraction: assumption?.bodyweightFraction ?? 1,
  };
}

function immutableConfig<T extends LoadConfigV1>(config: T): Readonly<T> {
  Object.freeze(config.equipment);
  return Object.freeze(config);
}

/** Frozen identity-to-config map for the thirteen canonical historical exercises. */
export const LEGACY_LOAD_CONFIGS_V1: Readonly<Record<
  CanonicalExerciseStableKey,
  Readonly<LoadConfigV1>
>> = Object.freeze({
  incline_dumbbell_press_30deg: immutableConfig(legacyDumbbellPair()),
  flat_dumbbell_fly: immutableConfig(legacyDumbbellPair()),
  pushup_handles: immutableConfig(legacyBodyweight("push-up-handles", "pair", {
    bodyweightFraction: CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1,
    configVersion: CANONICAL_PUSH_UP_CONFIG_VERSION_V1,
  })),
  seated_dumbbell_press: immutableConfig(legacyDumbbellPair()),
  one_arm_lateral_raise: immutableConfig(legacyPerSide()),
  one_arm_cable_triceps_extension: immutableConfig(legacyBand("one-arm-cable-extension")),
  bent_over_one_arm_dumbbell_triceps_extension: immutableConfig(legacyPerSide()),
  one_arm_seated_cable_row: immutableConfig(legacyBand("one-arm-seated-cable-row")),
  pull_up: immutableConfig(legacyBodyweight("pull-up-bar", "bodyweight")),
  hyperextension: immutableConfig({
    ...common(1, 2, "simultaneous", "dumbbell", "hyperextension-bench"),
    accountingKind: "external-per-implement-per-movement",
    resistanceType: "external",
    loadInput: "per-implement-kg",
    repsMeaning: "per-movement",
    implementsPerMovement: 1,
  }),
  one_arm_concentration_curl: immutableConfig(legacyPerSide()),
  incline_seated_rotating_dumbbell_curl: immutableConfig(legacyDumbbellPair("alternating")),
  supported_dumbbell_wrist_curl: immutableConfig(legacyPerSide()),
});

export type ConfigProvenanceV1 = {
  kind: "exercise-config" | "program-snapshot" | "session-snapshot"
    | "legacy-interpretation" | "set-override" | "bodyweight-observation"
    | "bodycast-as-of-model";
  version: string;
  stableKey?: string;
  sourceId?: string;
  localDate?: string;
  uncertaintyStatus?: "reported" | "not-reported";
};

export type BodyweightReferenceV1 =
  | {
      status: "observed";
      valueKg: number;
      localDate: string;
      source: "apple-health-shortcut";
      sourceId: string;
    }
  | {
      status: "nearest-observed";
      valueKg: number;
      /** Requested session local date; observationLocalDate is the actual sample date. */
      localDate: string;
      observationLocalDate: string;
      dayOffset: number;
      approximate: true;
      source: "apple-health-shortcut";
      sourceId: string;
    }
  | {
      status: "model-estimated";
      valueKg: number;
      localDate: string;
      source: "bodycast-as-of-model";
      sourceId: string;
      modelVersion: string;
      uncertainty: unknown | null;
    }
  | {
      status: "unavailable";
      valueKg: null;
      localDate: string;
      source: null;
      sourceId: null;
    };

export type LoadMetricV1<Unit extends string> = {
  value: number | null;
  unit: Unit;
  availability: "available" | "partial" | "unavailable";
  coverage: {
    eligibleRows: number;
    accountedRows: number;
    omittedRows: number;
    omittedReasons: Readonly<Record<string, number>>;
  };
  provenance: readonly ConfigProvenanceV1[];
};

export type LoadAccountingOutputV1 = {
  methodVersion: typeof LOAD_ACCOUNTING_METHOD_V1;
  externalLoadVolume: LoadMetricV1<"kg-repetitions">;
  bandNominalIndex: {
    perLoggedSide: LoadMetricV1<"nominal-kg-repetitions-per-logged-side">;
    leftSide: LoadMetricV1<"nominal-kg-repetitions-per-side">;
    rightSide: LoadMetricV1<"nominal-kg-repetitions-per-side">;
  };
  bodyweight: {
    sets: LoadMetricV1<"sets">;
    repetitions: LoadMetricV1<"repetitions">;
    reference: BodyweightReferenceV1;
    referenceVolume: LoadMetricV1<"bodyweight-reference-kg-repetitions">;
  };
  additionalLoad: LoadMetricV1<"kg-repetitions">;
  assistanceLoad: LoadMetricV1<"kg-repetitions">;
  identityCoverage: {
    customExercises: number;
    ambiguousExercises: number;
    unverifiedExercises: number;
  };
};

export type LoadAccountingSetInputV1 = {
  reps: number | null;
  weightKg: number | null;
  bandNominalResistanceKg: number | null;
  override?: unknown;
};

export type LoadAccountingExerciseInputV1 = {
  identity: IdentityEvidenceV1;
  resistanceHint?: ResistanceTypeV1 | null;
  configSnapshot?: unknown | null;
  configProvenance?: ConfigProvenanceV1;
  sets: readonly LoadAccountingSetInputV1[];
};

export type LoadAccountingSessionInputV1 = {
  localDate: string;
  exercises: readonly LoadAccountingExerciseInputV1[];
  bodyweightReference?: BodyweightReferenceV1;
};

export const LOAD_ACCOUNTING_BREAKDOWN_SCHEMA_V1 = "bodycast-load-accounting-breakdown-v1" as const;

export type LoadAccountingBreakdownCategoryV1 =
  | "externalLoadVolume"
  | "bandNominalPerLoggedSide"
  | "bandNominalLeftSide"
  | "bandNominalRightSide"
  | "bodyweightSets"
  | "bodyweightRepetitions"
  | "bodyweightReferenceVolume"
  | "additionalLoad"
  | "assistanceLoad";

export type LoadAccountingBreakdownBasisV1 =
  | "per-implement-kg"
  | "complete-setup-kg"
  | "nominal-kg-per-logged-side"
  | "bodyweight-reference"
  | "sets"
  | "repetitions"
  | "additional-load-kg"
  | "assistance-load-kg";

export type LoadAccountingBreakdownUnitV1 =
  | "kg-repetitions"
  | "nominal-kg-repetitions-per-logged-side"
  | "nominal-kg-repetitions-per-side"
  | "sets"
  | "repetitions"
  | "bodyweight-reference-kg-repetitions";

export type LoadAccountingBreakdownContributionV1 = {
  category: LoadAccountingBreakdownCategoryV1;
  basis: LoadAccountingBreakdownBasisV1;
  unit: LoadAccountingBreakdownUnitV1;
  value: number | null;
  effectiveMultiplier: number | null;
  availability: "available" | "unavailable";
  unavailableReason: OmitReason | null;
  provenance: ConfigProvenanceV1[];
};

export type LoadAccountingBreakdownRowV1 = {
  accountingMethodVersion: typeof LOAD_ACCOUNTING_METHOD_V1;
  sessionId: number;
  sessionExerciseId: number;
  exerciseOrder: number;
  exerciseName: string;
  stableKey: string | null;
  identityStatus: IdentityStatusV1;
  strengthSetId: number;
  setNumber: number;
  scalarReps: number | null;
  effectiveReps: number | null;
  asymmetricReps: { left: number; right: number } | null;
  enteredLoad: { externalKg: number | null; bandNominalKg: number | null };
  config: {
    sourceSnapshot: LoadConfigV1 | null;
    resolved: LoadConfigV1 | null;
    effective: LoadConfigV1 | null;
    provenance: ConfigProvenanceV1 | null;
    resolution: "resolved" | "unresolved";
    unavailableReason: OmitReason | null;
  };
  override: {
    snapshot: SetExecutionOverrideV1 | null;
    status: "absent" | "valid" | "invalid";
  };
  mechanics: {
    inventoryCount: 1 | 2;
    loadedSides: 1 | 2;
    execution: LoadConfigV1["execution"];
    implementsPerMovement: 1 | 2 | null;
    effectiveMultiplier: number;
  } | null;
  contributions: LoadAccountingBreakdownContributionV1[];
};

export type LoadAccountingBreakdownV1 = {
  schemaVersion: typeof LOAD_ACCOUNTING_BREAKDOWN_SCHEMA_V1;
  accountingMethodVersion: typeof LOAD_ACCOUNTING_METHOD_V1;
  rows: LoadAccountingBreakdownRowV1[];
};

type LoadAccountingBreakdownInputV1 = Omit<LoadAccountingSessionInputV1, "exercises"> & {
  sessionId: number;
  exercises: readonly (Omit<LoadAccountingExerciseInputV1, "sets"> & {
    sessionExerciseId: number;
    exerciseOrder: number;
    exerciseName: string;
    sets: readonly (LoadAccountingSetInputV1 & {
      strengthSetId: number;
      setNumber: number;
    })[];
  })[];
};

type OmitReason =
  | "unknown-identity"
  | "ambiguous-identity"
  | "unverified-identity"
  | "invalid-configuration"
  | "invalid-set-override"
  | "missing-load"
  | "invalid-load"
  | "missing-repetitions"
  | "missing-bodyweight-reference"
  | "asymmetric-side-breakdown";

type MetricAccumulator = {
  eligible: number;
  accounted: number;
  total: number;
  omitted: Map<OmitReason, number>;
  provenance: Map<string, ConfigProvenanceV1>;
};

function accumulator(): MetricAccumulator {
  return {
    eligible: 0,
    accounted: 0,
    total: 0,
    omitted: new Map(),
    provenance: new Map(),
  };
}

function addProvenance(target: MetricAccumulator, provenance: ConfigProvenanceV1): void {
  const key = provenance.kind + ":" + provenance.version + ":" + (provenance.stableKey ?? "")
    + ":" + (provenance.localDate ?? "") + ":" + (provenance.sourceId ?? "");
  target.provenance.set(key, provenance);
}

function omit(target: MetricAccumulator, reason: OmitReason): void {
  target.eligible += 1;
  target.omitted.set(reason, (target.omitted.get(reason) ?? 0) + 1);
}

function contribute(
  target: MetricAccumulator,
  value: number,
  provenance: ConfigProvenanceV1,
): void {
  target.eligible += 1;
  target.accounted += 1;
  target.total += value;
  addProvenance(target, provenance);
}

function finishMetric<Unit extends string>(
  target: MetricAccumulator,
  unit: Unit,
): LoadMetricV1<Unit> {
  const omittedReasons = Object.fromEntries(
    [...target.omitted.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  const availability = target.eligible === 0 || target.accounted === target.eligible
    ? "available"
    : target.accounted === 0 ? "unavailable" : "partial";
  return {
    value: target.accounted === 0 && target.eligible > 0 ? null : target.total,
    unit,
    availability,
    coverage: {
      eligibleRows: target.eligible,
      accountedRows: target.accounted,
      omittedRows: target.eligible - target.accounted,
      omittedReasons,
    },
    provenance: [...target.provenance.values()],
  };
}

function stableKeyIsCanonical(stableKey: string): stableKey is CanonicalExerciseStableKey {
  return canonicalKeys.has(stableKey);
}

export function legacyLoadConfigForIdentityV1(input: IdentityEvidenceV1): {
  config: Readonly<LoadConfigV1> | null;
  provenance: ConfigProvenanceV1 | null;
} {
  if (input.status !== "canonical-snapshot" && input.status !== "known-legacy") {
    return { config: null, provenance: null };
  }
  if (!input.stableKey || !stableKeyIsCanonical(input.stableKey)) {
    return { config: null, provenance: null };
  }
  return {
    config: LEGACY_LOAD_CONFIGS_V1[input.stableKey],
    provenance: {
      kind: "legacy-interpretation",
      version: LEGACY_LOAD_INTERPRETATION_V1,
      stableKey: input.stableKey,
    },
  };
}

function parsedOverride(value: unknown): SetExecutionOverrideV1 | null | "invalid" {
  if (value == null) return null;
  const result = setExecutionOverrideV1Schema.safeParse(value);
  return result.success ? result.data : "invalid";
}

function repsForSet(
  reps: number | null,
  meaning: "per-side" | "per-movement" | "per-logged-side",
  loadedSides: 1 | 2,
  override: SetExecutionOverrideV1 | null,
): { total: number; left?: number; right?: number } | null {
  if (override?.reps) {
    if (meaning !== "per-side") return null;
    return {
      left: override.reps.left,
      right: override.reps.right,
      total: override.reps.left + override.reps.right,
    };
  }
  if (reps === null || !Number.isInteger(reps) || reps < 0) return null;
  if (meaning === "per-side") return { total: reps * loadedSides };
  return { total: reps };
}

function emptyReference(localDate: string): BodyweightReferenceV1 {
  return {
    status: "unavailable",
    valueKg: null,
    localDate,
    source: null,
    sourceId: null,
  };
}

function validReferenceForDate(
  reference: BodyweightReferenceV1 | undefined,
  localDate: string,
): reference is Exclude<BodyweightReferenceV1, { status: "unavailable" }> {
  return reference !== undefined
    && reference.status !== "unavailable"
    && reference.localDate === localDate
    && Number.isFinite(reference.valueKg)
    && reference.valueKg > 0;
}

type ResolvedExercise = {
  config: LoadConfigV1 | null;
  provenance: ConfigProvenanceV1 | null;
  omittedReason: OmitReason | null;
};

function resolveExercise(input: LoadAccountingExerciseInputV1): ResolvedExercise {
  if (input.configSnapshot !== undefined && input.configSnapshot !== null) {
    const parsed = loadConfigV1Schema.safeParse(input.configSnapshot);
    if (!parsed.success) {
      return { config: null, provenance: null, omittedReason: "invalid-configuration" };
    }
    const provenance = input.configProvenance ?? {
      kind: "session-snapshot" as const,
      version: parsed.data.configVersion,
      stableKey: input.identity.stableKey ?? undefined,
    };
    return { config: parsed.data, provenance, omittedReason: null };
  }
  const legacy = legacyLoadConfigForIdentityV1(input.identity);
  if (legacy.config && legacy.provenance) {
    return { config: legacy.config, provenance: legacy.provenance, omittedReason: null };
  }
  const reason: OmitReason = input.identity.status === "ambiguous"
    ? "ambiguous-identity"
    : input.identity.status === "unverified" ? "unverified-identity" : "unknown-identity";
  return { config: null, provenance: null, omittedReason: reason };
}

function effectiveConfig(
  config: LoadConfigV1,
  override: SetExecutionOverrideV1 | null,
): LoadConfigV1 | null {
  if (!override) return config;
  const merged: Record<string, unknown> = {
    ...config,
    inventoryCount: override.inventoryCount ?? config.inventoryCount,
    loadedSides: override.loadedSides ?? config.loadedSides,
    execution: override.execution ?? config.execution,
    loadInput: override.loadInput ?? config.loadInput,
    repsMeaning: override.repsMeaning ?? config.repsMeaning,
    equipment: {
      ...config.equipment,
      setupId: override.equipmentSetupId ?? config.equipment.setupId,
    },
  };
  if ("implementsPerMovement" in config || override.implementsPerMovement !== undefined) {
    merged.implementsPerMovement = override.implementsPerMovement
      ?? ("implementsPerMovement" in config ? config.implementsPerMovement : undefined);
  }
  if (config.resistanceType === "external") {
    merged.accountingKind = merged.loadInput === "complete-setup-kg"
      ? "external-complete-setup-per-movement"
      : merged.repsMeaning === "per-side"
        ? "external-per-implement-per-side"
        : "external-per-implement-per-movement";
  } else if (config.resistanceType === "band-nominal") {
    merged.accountingKind = merged.repsMeaning === "per-side"
      ? "band-nominal-per-side"
      : "band-nominal-per-logged-side";
  } else {
    merged.accountingKind = merged.repsMeaning === "per-side"
      ? "bodyweight-reference-per-side"
      : "bodyweight-reference-per-movement";
  }
  const parsed = loadConfigV1Schema.safeParse(merged);
  return parsed.success ? parsed.data : null;
}

function configMatchesResistanceHint(
  config: LoadConfigV1 | null,
  hint: ResistanceTypeV1 | null | undefined,
): boolean {
  return config === null || hint == null || config.resistanceType === hint;
}

function appendIdentityIssue(
  counts: LoadAccountingOutputV1["identityCoverage"],
  status: IdentityStatusV1,
): void {
  if (status === "custom") counts.customExercises += 1;
  if (status === "ambiguous") counts.ambiguousExercises += 1;
  if (status === "unverified") counts.unverifiedExercises += 1;
}

/**
 * Pure calculator. StrengthSet.reps remains intact for old consumers; an
 * asymmetric override replaces it completely for this method version.
 */
function implementsPerMovementForBreakdown(
  config: LoadConfigV1,
): 1 | 2 | null {
  return config.accountingKind === "external-per-implement-per-movement"
    ? config.implementsPerMovement
    : null;
}

type BreakdownTarget = {
  accumulator: MetricAccumulator;
  category: LoadAccountingBreakdownCategoryV1;
  unit: LoadAccountingBreakdownUnitV1;
  fallbackBasis: LoadAccountingBreakdownBasisV1;
};

function calculateLoadAccountingCoreV1(
  input: LoadAccountingSessionInputV1,
  captureBreakdown: boolean,
): { result: LoadAccountingOutputV1; rows: LoadAccountingBreakdownRowV1[] } {
  const external = accumulator();
  const bandLoggedSide = accumulator();
  const bandLeft = accumulator();
  const bandRight = accumulator();
  const bodyweightSets = accumulator();
  const bodyweightReps = accumulator();
  const bodyweightReferenceVolume = accumulator();
  const additional = accumulator();
  const assistance = accumulator();
  const identityCoverage = {
    customExercises: 0,
    ambiguousExercises: 0,
    unverifiedExercises: 0,
  };
  const reference = validReferenceForDate(input.bodyweightReference, input.localDate)
    ? input.bodyweightReference
    : emptyReference(input.localDate);
  const rows: LoadAccountingBreakdownRowV1[] = [];
  const breakdownInput = input as Partial<LoadAccountingBreakdownInputV1>;

  function targetFor(target: MetricAccumulator): BreakdownTarget {
    if (target === external) return {
      accumulator: target, category: "externalLoadVolume", unit: "kg-repetitions",
      fallbackBasis: "per-implement-kg",
    };
    if (target === bandLoggedSide) return {
      accumulator: target, category: "bandNominalPerLoggedSide",
      unit: "nominal-kg-repetitions-per-logged-side",
      fallbackBasis: "nominal-kg-per-logged-side",
    };
    if (target === bandLeft) return {
      accumulator: target, category: "bandNominalLeftSide",
      unit: "nominal-kg-repetitions-per-side", fallbackBasis: "nominal-kg-per-logged-side",
    };
    if (target === bandRight) return {
      accumulator: target, category: "bandNominalRightSide",
      unit: "nominal-kg-repetitions-per-side", fallbackBasis: "nominal-kg-per-logged-side",
    };
    if (target === bodyweightSets) return {
      accumulator: target, category: "bodyweightSets", unit: "sets", fallbackBasis: "sets",
    };
    if (target === bodyweightReps) return {
      accumulator: target, category: "bodyweightRepetitions", unit: "repetitions",
      fallbackBasis: "repetitions",
    };
    if (target === bodyweightReferenceVolume) return {
      accumulator: target, category: "bodyweightReferenceVolume",
      unit: "bodyweight-reference-kg-repetitions", fallbackBasis: "bodyweight-reference",
    };
    if (target === additional) return {
      accumulator: target, category: "additionalLoad", unit: "kg-repetitions",
      fallbackBasis: "additional-load-kg",
    };
    return {
      accumulator: target, category: "assistanceLoad", unit: "kg-repetitions",
      fallbackBasis: "assistance-load-kg",
    };
  }

  function emit(
    row: LoadAccountingBreakdownRowV1 | null,
    target: MetricAccumulator,
    state: {
      value: number | null;
      reason: OmitReason | null;
      config: LoadConfigV1 | null;
      effectiveMultiplier: number | null;
      provenance: ConfigProvenanceV1 | null;
      additionalProvenance?: ConfigProvenanceV1;
    },
  ): void {
    if (!row) return;
    const targetInfo = targetFor(target);
    const provenance = [
      ...(state.provenance ? [state.provenance] : []),
      ...(state.additionalProvenance ? [state.additionalProvenance] : []),
    ];
    const basis = targetInfo.category === "additionalLoad" || targetInfo.category === "assistanceLoad"
      || targetInfo.category === "bodyweightSets" || targetInfo.category === "bodyweightRepetitions"
      ? targetInfo.fallbackBasis
      : state.config?.loadInput ?? targetInfo.fallbackBasis;
    row.contributions.push({
      category: targetInfo.category,
      basis,
      unit: targetInfo.unit,
      value: state.value,
      effectiveMultiplier: state.effectiveMultiplier,
      availability: state.reason === null ? "available" : "unavailable",
      unavailableReason: state.reason,
      provenance,
    });
  }

  function omitWithBreakdown(
    target: MetricAccumulator,
    reason: OmitReason,
    row: LoadAccountingBreakdownRowV1 | null,
    config: LoadConfigV1 | null,
    provenance: ConfigProvenanceV1 | null,
  ): void {
    omit(target, reason);
    emit(row, target, {
      value: null, reason, config,
      effectiveMultiplier: row?.mechanics?.effectiveMultiplier ?? null,
      provenance,
    });
  }

  function contributeWithBreakdown(
    target: MetricAccumulator,
    value: number,
    provenance: ConfigProvenanceV1,
    row: LoadAccountingBreakdownRowV1 | null,
    config: LoadConfigV1,
    effectiveMultiplier: number,
    additionalProvenance?: ConfigProvenanceV1,
  ): void {
    contribute(target, value, provenance);
    emit(row, target, {
      value, reason: null, config, effectiveMultiplier, provenance, additionalProvenance,
    });
  }

  for (const exercise of input.exercises) {
    appendIdentityIssue(identityCoverage, exercise.identity.status);
    const resolved = resolveExercise(exercise);
    const hint = exercise.resistanceHint ?? null;
    const candidateResistance = resolved.config?.resistanceType ?? hint;
    if (!resolved.config && candidateResistance === null) continue;

    const sourceConfig = exercise.configSnapshot == null
      ? null
      : loadConfigV1Schema.safeParse(exercise.configSnapshot);
    const sourceSnapshot = sourceConfig?.success ? sourceConfig.data : null;

    for (const set of exercise.sets) {
      let row: LoadAccountingBreakdownRowV1 | null = null;
      if (captureBreakdown) {
        const breakdownExercise = exercise as LoadAccountingBreakdownInputV1["exercises"][number];
        const breakdownSet = set as LoadAccountingBreakdownInputV1["exercises"][number]["sets"][number];
        row = {
          accountingMethodVersion: LOAD_ACCOUNTING_METHOD_V1,
          sessionId: breakdownInput.sessionId!,
          sessionExerciseId: breakdownExercise.sessionExerciseId,
          exerciseOrder: breakdownExercise.exerciseOrder,
          exerciseName: breakdownExercise.exerciseName,
          stableKey: exercise.identity.stableKey,
          identityStatus: exercise.identity.status,
          strengthSetId: breakdownSet.strengthSetId,
          setNumber: breakdownSet.setNumber,
          scalarReps: set.reps,
          effectiveReps: null,
          asymmetricReps: null,
          enteredLoad: {
            externalKg: set.weightKg,
            bandNominalKg: set.bandNominalResistanceKg,
          },
          config: {
            sourceSnapshot,
            resolved: resolved.config,
            effective: null,
            provenance: resolved.provenance,
            resolution: resolved.config ? "resolved" : "unresolved",
            unavailableReason: resolved.omittedReason,
          },
          override: { snapshot: null, status: "absent" },
          mechanics: null,
          contributions: [],
        };
        rows.push(row);
      }

      const candidate = candidateResistance;
      const targets = candidate === "external" ? [external]
        : candidate === "band-nominal" ? [bandLoggedSide]
          : candidate === "bodyweight"
            ? [bodyweightSets, bodyweightReps, bodyweightReferenceVolume, additional, assistance]
            : [];

      if (!resolved.config || !resolved.provenance) {
        const reason = resolved.omittedReason ?? "unknown-identity";
        for (const target of targets) omitWithBreakdown(target, reason, row, null, null);
        continue;
      }
      if (!configMatchesResistanceHint(resolved.config, hint)) {
        for (const target of targets) omitWithBreakdown(target, "invalid-configuration", row, resolved.config, resolved.provenance);
        continue;
      }
      const parsed = parsedOverride(set.override);
      if (row) row.override = {
        snapshot: parsed === "invalid" ? null : parsed,
        status: parsed === "invalid" ? "invalid" : parsed ? "valid" : "absent",
      };
      if (parsed === "invalid") {
        for (const target of targets) omitWithBreakdown(target, "invalid-set-override", row, resolved.config, resolved.provenance);
        continue;
      }
      const override = parsed;
      const config = effectiveConfig(resolved.config, override);
      if (!config) {
        for (const target of targets) omitWithBreakdown(target, "invalid-set-override", row, resolved.config, resolved.provenance);
        continue;
      }
      if (row) row.config.effective = config;

      const reps = repsForSet(set.reps, config.repsMeaning, config.loadedSides, override);
      if (reps === null) {
        const reason = override?.reps ? "invalid-set-override" : "missing-repetitions";
        for (const target of targets) omitWithBreakdown(target, reason, row, config, resolved.provenance);
        continue;
      }
      if (row) {
        row.effectiveReps = reps.total;
        row.asymmetricReps = reps.left === undefined || reps.right === undefined
          ? null : { left: reps.left, right: reps.right };
      }
      const provenance: ConfigProvenanceV1 = override
        ? { kind: "set-override", version: config.configVersion, stableKey: exercise.identity.stableKey ?? undefined }
        : resolved.provenance;
      const actualReps = reps.total;

      if (config.resistanceType === "external") {
        const multiplier = config.loadInput === "complete-setup-kg"
          ? 1
          : config.repsMeaning === "per-movement" && "implementsPerMovement" in config
            ? config.implementsPerMovement
            : 1;
        if (row) row.mechanics = {
          inventoryCount: config.inventoryCount,
          loadedSides: config.loadedSides,
          execution: config.execution,
          implementsPerMovement: implementsPerMovementForBreakdown(config),
          effectiveMultiplier: multiplier,
        };
        if (set.weightKg === null || !Number.isFinite(set.weightKg)) {
          omitWithBreakdown(external, "missing-load", row, config, provenance);
          continue;
        }
        if (set.weightKg <= 0) {
          omitWithBreakdown(external, "invalid-load", row, config, provenance);
          continue;
        }
        contributeWithBreakdown(
          external, set.weightKg * actualReps * multiplier, provenance, row, config, multiplier,
        );
      } else if (config.resistanceType === "band-nominal") {
        if (row) row.mechanics = {
          inventoryCount: config.inventoryCount,
          loadedSides: config.loadedSides,
          execution: config.execution,
          implementsPerMovement: implementsPerMovementForBreakdown(config),
          effectiveMultiplier: 1,
        };
        const bandLoadTargets = config.repsMeaning === "per-side"
          ? [bandLeft, bandRight]
          : [bandLoggedSide];
        if (set.bandNominalResistanceKg === null
            || !Number.isFinite(set.bandNominalResistanceKg)) {
          for (const target of bandLoadTargets) {
            omitWithBreakdown(target, "missing-load", row, config, provenance);
          }
          continue;
        }
        if (set.bandNominalResistanceKg < 0) {
          for (const target of bandLoadTargets) {
            omitWithBreakdown(target, "invalid-load", row, config, provenance);
          }
          continue;
        }
        if (override?.reps) {
          if (config.repsMeaning !== "per-side") {
            omitWithBreakdown(bandLoggedSide, "asymmetric-side-breakdown", row, config, provenance);
            continue;
          }
          omitWithBreakdown(bandLoggedSide, "asymmetric-side-breakdown", row, config, provenance);
          contributeWithBreakdown(
            bandLeft, set.bandNominalResistanceKg * override.reps.left,
            provenance, row, config, 1,
          );
          contributeWithBreakdown(
            bandRight, set.bandNominalResistanceKg * override.reps.right,
            provenance, row, config, 1,
          );
        } else {
          if (set.reps === null || !Number.isInteger(set.reps) || set.reps < 0) {
            for (const target of bandLoadTargets) {
              omitWithBreakdown(target, "missing-repetitions", row, config, provenance);
            }
            continue;
          }
          if (config.repsMeaning === "per-side") {
            // Scalar reps mean the same count on both loaded sides. Keep each
            // side as a separate nominal-band category, while the session UI
            // may display their sum as the two-sided total.
            contributeWithBreakdown(
              bandLeft, set.bandNominalResistanceKg * set.reps, provenance, row, config, 1,
            );
            contributeWithBreakdown(
              bandRight, set.bandNominalResistanceKg * set.reps, provenance, row, config, 1,
            );
          } else {
            omitWithBreakdown(bandLeft, "asymmetric-side-breakdown", row, config, provenance);
            omitWithBreakdown(bandRight, "asymmetric-side-breakdown", row, config, provenance);
            contributeWithBreakdown(
              bandLoggedSide, set.bandNominalResistanceKg * set.reps, provenance, row, config, 1,
            );
          }
        }
      } else {
        const referenceMultiplier = config.bodyweightFraction;
        if (row) row.mechanics = {
          inventoryCount: config.inventoryCount,
          loadedSides: config.loadedSides,
          execution: config.execution,
          implementsPerMovement: implementsPerMovementForBreakdown(config),
          effectiveMultiplier: referenceMultiplier,
        };
        contributeWithBreakdown(bodyweightSets, 1, provenance, row, config, 1);
        contributeWithBreakdown(bodyweightReps, actualReps, provenance, row, config, 1);
        if (validReferenceForDate(reference, input.localDate)) {
          const referenceProvenance: ConfigProvenanceV1 = reference.status === "observed"
            || reference.status === "nearest-observed"
            ? {
              kind: "bodyweight-observation",
              version: reference.status === "nearest-observed"
                ? "apple-health-shortcut-nearest-v2" : reference.source,
              sourceId: reference.sourceId,
              localDate: reference.status === "nearest-observed"
                ? reference.observationLocalDate : reference.localDate,
              stableKey: exercise.identity.stableKey ?? undefined,
            }
            : {
              kind: "bodycast-as-of-model",
              version: reference.modelVersion,
              sourceId: reference.sourceId,
              localDate: reference.localDate,
              uncertaintyStatus: reference.uncertainty === null ? "not-reported" : "reported",
              stableKey: exercise.identity.stableKey ?? undefined,
            };
          contributeWithBreakdown(
            bodyweightReferenceVolume,
            reference.valueKg * config.bodyweightFraction * actualReps,
            provenance, row, config, referenceMultiplier, referenceProvenance,
          );
          addProvenance(bodyweightReferenceVolume, referenceProvenance);
        } else {
          omitWithBreakdown(
            bodyweightReferenceVolume, "missing-bodyweight-reference", row, config, provenance,
          );
        }
        const additionalLoadKg = override?.additionalLoadKg ?? 0;
        const assistanceLoadKg = override?.assistanceLoadKg ?? 0;
        contributeWithBreakdown(additional, additionalLoadKg * actualReps, provenance, row, config, 1);
        contributeWithBreakdown(assistance, assistanceLoadKg * actualReps, provenance, row, config, 1);
      }
    }
  }

  return {
    result: {
      methodVersion: LOAD_ACCOUNTING_METHOD_V1,
      externalLoadVolume: finishMetric(external, "kg-repetitions"),
      bandNominalIndex: {
        perLoggedSide: finishMetric(bandLoggedSide, "nominal-kg-repetitions-per-logged-side"),
        leftSide: finishMetric(bandLeft, "nominal-kg-repetitions-per-side"),
        rightSide: finishMetric(bandRight, "nominal-kg-repetitions-per-side"),
      },
      bodyweight: {
        sets: finishMetric(bodyweightSets, "sets"),
        repetitions: finishMetric(bodyweightReps, "repetitions"),
        reference,
        referenceVolume: finishMetric(
          bodyweightReferenceVolume,
          "bodyweight-reference-kg-repetitions",
        ),
      },
      additionalLoad: finishMetric(additional, "kg-repetitions"),
      assistanceLoad: finishMetric(assistance, "kg-repetitions"),
      identityCoverage,
    },
    rows,
  };
}

/**
 * Pure aggregate calculator. StrengthSet.reps remains intact for old consumers;
 * an asymmetric override replaces it completely for this method version.
 */
export function calculateLoadAccountingV1(
  input: LoadAccountingSessionInputV1,
): LoadAccountingOutputV1 {
  return calculateLoadAccountingCoreV1(input, false).result;
}

export function calculateLoadAccountingWithBreakdownV1(
  input: LoadAccountingBreakdownInputV1,
): { result: LoadAccountingOutputV1; breakdown: LoadAccountingBreakdownV1 } {
  if (!Number.isInteger(input.sessionId) || input.sessionId <= 0) {
    throw new Error("Stage 02 breakdown requires a persisted session id");
  }
  for (const exercise of input.exercises) {
    if (!Number.isInteger(exercise.sessionExerciseId) || exercise.sessionExerciseId <= 0
        || !Number.isInteger(exercise.exerciseOrder) || exercise.exerciseOrder < 0
        || !exercise.exerciseName.trim()) {
      throw new Error("Stage 02 breakdown requires persisted exercise identity and order");
    }
    for (const set of exercise.sets) {
      if (!Number.isInteger(set.strengthSetId) || set.strengthSetId <= 0
          || !Number.isInteger(set.setNumber) || set.setNumber <= 0) {
        throw new Error("Stage 02 breakdown requires persisted set identity and order");
      }
    }
  }
  const calculated = calculateLoadAccountingCoreV1(input, true);
  return {
    result: calculated.result,
    breakdown: {
      schemaVersion: LOAD_ACCOUNTING_BREAKDOWN_SCHEMA_V1,
      accountingMethodVersion: LOAD_ACCOUNTING_METHOD_V1,
      rows: calculated.rows,
    },
  };
}
