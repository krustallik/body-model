import { createHash } from "node:crypto";
import { z } from "zod";
import {
  LOAD_ACCOUNTING_BREAKDOWN_SCHEMA_V1,
  LOAD_ACCOUNTING_METHOD_V1,
  loadConfigV1Schema,
  setExecutionOverrideV1Schema,
  type LoadAccountingBreakdownCategoryV1,
  type LoadAccountingBreakdownBasisV1,
  type LoadAccountingBreakdownUnitV1,
} from "./load-accounting-v1";

export const PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1 = "bodycast-persisted-load-accounting-v1" as const;
export const PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2 = "bodycast-persisted-load-accounting-v2" as const;

const coverageSchema = z.object({
  eligibleRows: z.number().int().nonnegative(),
  accountedRows: z.number().int().nonnegative(),
  omittedRows: z.number().int().nonnegative(),
  omittedReasons: z.record(z.string(), z.number().int().nonnegative()),
}).strict();

const metricSchema = <T extends string>(unit: T) => z.object({
  value: z.number().finite().nullable(),
  unit: z.literal(unit),
  availability: z.enum(["available", "partial", "unavailable"]),
  coverage: coverageSchema,
  provenance: z.array(z.object({
    kind: z.enum([
      "exercise-config", "program-snapshot", "session-snapshot", "legacy-interpretation",
      "set-override", "bodyweight-observation", "bodycast-as-of-model",
    ]), version: z.string().min(1), stableKey: z.string().optional(),
    sourceId: z.string().optional(), localDate: z.string().optional(),
    uncertaintyStatus: z.enum(["reported", "not-reported"]).optional(),
  }).strict()),
}).strict();

const bodyweightSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("observed"), valueKg: z.number().positive().finite(), localDate: z.string(), source: z.literal("apple-health-shortcut"), sourceId: z.string().min(1) }).strict(),
  z.object({ status: z.literal("nearest-observed"), valueKg: z.number().positive().finite(), localDate: z.string(), observationLocalDate: z.string(), dayOffset: z.number().int().refine((value) => value !== 0), approximate: z.literal(true), source: z.literal("apple-health-shortcut"), sourceId: z.string().min(1) }).strict(),
  z.object({ status: z.literal("model-estimated"), valueKg: z.number().positive().finite(), localDate: z.string(), source: z.literal("bodycast-as-of-model"), sourceId: z.string().min(1), modelVersion: z.string().min(1), uncertainty: z.unknown().nullable() }).strict(),
  z.object({ status: z.literal("unavailable"), valueKg: z.null(), localDate: z.string(), source: z.null(), sourceId: z.null() }).strict(),
]);

const breakdownSemanticCombinations: Record<LoadAccountingBreakdownCategoryV1, {
  bases: readonly LoadAccountingBreakdownBasisV1[];
  unit: LoadAccountingBreakdownUnitV1;
}> = {
  externalLoadVolume: {
    bases: ["per-implement-kg", "complete-setup-kg"],
    unit: "kg-repetitions",
  },
  bandNominalPerLoggedSide: {
    bases: ["nominal-kg-per-logged-side"],
    unit: "nominal-kg-repetitions-per-logged-side",
  },
  bandNominalLeftSide: {
    bases: ["nominal-kg-per-logged-side"],
    unit: "nominal-kg-repetitions-per-side",
  },
  bandNominalRightSide: {
    bases: ["nominal-kg-per-logged-side"],
    unit: "nominal-kg-repetitions-per-side",
  },
  bodyweightSets: { bases: ["sets"], unit: "sets" },
  bodyweightRepetitions: { bases: ["repetitions"], unit: "repetitions" },
  bodyweightReferenceVolume: {
    bases: ["bodyweight-reference"],
    unit: "bodyweight-reference-kg-repetitions",
  },
  additionalLoad: { bases: ["additional-load-kg"], unit: "kg-repetitions" },
  assistanceLoad: { bases: ["assistance-load-kg"], unit: "kg-repetitions" },
};

const breakdownBasisUnits: Record<LoadAccountingBreakdownBasisV1, readonly LoadAccountingBreakdownUnitV1[]> = {
  "per-implement-kg": ["kg-repetitions"],
  "complete-setup-kg": ["kg-repetitions"],
  "nominal-kg-per-logged-side": [
    "nominal-kg-repetitions-per-logged-side",
    "nominal-kg-repetitions-per-side",
  ],
  "bodyweight-reference": ["bodyweight-reference-kg-repetitions"],
  sets: ["sets"],
  repetitions: ["repetitions"],
  "additional-load-kg": ["kg-repetitions"],
  "assistance-load-kg": ["kg-repetitions"],
};

const metricRecord = z.object({
  methodVersion: z.literal(LOAD_ACCOUNTING_METHOD_V1),
  externalLoadVolume: metricSchema("kg-repetitions"),
  bandNominalIndex: z.object({
    perLoggedSide: metricSchema("nominal-kg-repetitions-per-logged-side"),
    leftSide: metricSchema("nominal-kg-repetitions-per-side"),
    rightSide: metricSchema("nominal-kg-repetitions-per-side"),
  }).strict(),
  bodyweight: z.object({
    sets: metricSchema("sets"), repetitions: metricSchema("repetitions"), reference: bodyweightSchema,
    referenceVolume: metricSchema("bodyweight-reference-kg-repetitions"),
  }).strict(),
  additionalLoad: metricSchema("kg-repetitions"),
  assistanceLoad: metricSchema("kg-repetitions"),
  identityCoverage: z.object({ customExercises: z.number().int().nonnegative(), ambiguousExercises: z.number().int().nonnegative(), unverifiedExercises: z.number().int().nonnegative() }).strict(),
}).strict();

export const persistedLoadAccountingPayloadV1Schema = z.object({
  schemaVersion: z.literal(PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1),
  sessionId: z.number().int().positive(),
  snapshotRevision: z.number().int().positive(),
  accountingInputRevision: z.number().int().positive(),
  effectiveAccountingAt: z.string().datetime({ offset: true }),
  effectiveLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().min(1),
  timeZoneProvenance: z.string().min(1),
  inputFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  accountingMethodVersion: z.literal(LOAD_ACCOUNTING_METHOD_V1),
  massResolutionMethodVersion: z.string().min(1),
  massResolutionIdentity: z.string().min(1),
  massReference: bodyweightSchema,
  result: metricRecord,
}).strict();

export type PersistedLoadAccountingPayloadV1 = z.infer<typeof persistedLoadAccountingPayloadV1Schema>;

const breakdownContributionSchema = z.object({
  category: z.enum([
    "externalLoadVolume",
    "bandNominalPerLoggedSide",
    "bandNominalLeftSide",
    "bandNominalRightSide",
    "bodyweightSets",
    "bodyweightRepetitions",
    "bodyweightReferenceVolume",
    "additionalLoad",
    "assistanceLoad",
  ]),
  basis: z.enum([
    "per-implement-kg",
    "complete-setup-kg",
    "nominal-kg-per-logged-side",
    "bodyweight-reference",
    "sets",
    "repetitions",
    "additional-load-kg",
    "assistance-load-kg",
  ]),
  unit: z.enum([
    "kg-repetitions",
    "nominal-kg-repetitions-per-logged-side",
    "nominal-kg-repetitions-per-side",
    "sets",
    "repetitions",
    "bodyweight-reference-kg-repetitions",
  ]),
  value: z.number().finite().nullable(),
  effectiveMultiplier: z.number().positive().finite().nullable(),
  availability: z.enum(["available", "unavailable"]),
  unavailableReason: z.enum([
    "unknown-identity",
    "ambiguous-identity",
    "unverified-identity",
    "invalid-configuration",
    "invalid-set-override",
    "missing-load",
    "invalid-load",
    "missing-repetitions",
    "missing-bodyweight-reference",
    "asymmetric-side-breakdown",
  ]).nullable(),
  provenance: z.array(z.object({
    kind: z.enum([
      "exercise-config", "program-snapshot", "session-snapshot", "legacy-interpretation",
      "set-override", "bodyweight-observation", "bodycast-as-of-model",
    ]),
    version: z.string().min(1),
    stableKey: z.string().optional(),
    sourceId: z.string().optional(),
    localDate: z.string().optional(),
    uncertaintyStatus: z.enum(["reported", "not-reported"]).optional(),
  }).strict()),
}).strict().superRefine((contribution, context) => {
  const categorySemantics = breakdownSemanticCombinations[contribution.category];
  if (!categorySemantics.bases.includes(contribution.basis)) {
    context.addIssue({
      code: "custom",
      path: ["basis"],
      message: "contribution basis is not valid for its accounting category",
    });
  }
  if (categorySemantics.unit !== contribution.unit) {
    context.addIssue({
      code: "custom",
      path: ["unit"],
      message: "contribution unit is not valid for its accounting category",
    });
  }
  if (!breakdownBasisUnits[contribution.basis].includes(contribution.unit)) {
    context.addIssue({
      code: "custom",
      path: ["unit"],
      message: "contribution unit is not valid for its accounting basis",
    });
  }
  if (contribution.availability === "available"
      && (contribution.value === null || contribution.unavailableReason !== null)) {
    context.addIssue({ code: "custom", message: "available contribution requires a value and no reason" });
  }
  if (contribution.availability === "unavailable"
      && (contribution.value !== null || contribution.unavailableReason === null)) {
    context.addIssue({ code: "custom", message: "unavailable contribution requires a reason and no value" });
  }
});

const breakdownRowSchema = z.object({
  accountingMethodVersion: z.literal(LOAD_ACCOUNTING_METHOD_V1),
  sessionId: z.number().int().positive(),
  sessionExerciseId: z.number().int().positive(),
  exerciseOrder: z.number().int().nonnegative(),
  exerciseName: z.string().min(1),
  stableKey: z.string().nullable(),
  identityStatus: z.enum([
    "canonical-snapshot", "known-legacy", "custom", "ambiguous", "unverified",
  ]),
  strengthSetId: z.number().int().positive(),
  setNumber: z.number().int().positive(),
  scalarReps: z.number().int().nonnegative().nullable(),
  effectiveReps: z.number().int().nonnegative().nullable(),
  asymmetricReps: z.object({
    left: z.number().int().nonnegative(),
    right: z.number().int().nonnegative(),
  }).strict().nullable(),
  enteredLoad: z.object({
    externalKg: z.number().finite().nullable(),
    bandNominalKg: z.number().finite().nullable(),
  }).strict(),
  config: z.object({
    sourceSnapshot: loadConfigV1Schema.nullable(),
    resolved: loadConfigV1Schema.nullable(),
    effective: loadConfigV1Schema.nullable(),
    provenance: z.object({
      kind: z.enum([
        "exercise-config", "program-snapshot", "session-snapshot", "legacy-interpretation",
        "set-override", "bodyweight-observation", "bodycast-as-of-model",
      ]),
      version: z.string().min(1),
      stableKey: z.string().optional(),
      sourceId: z.string().optional(),
      localDate: z.string().optional(),
      uncertaintyStatus: z.enum(["reported", "not-reported"]).optional(),
    }).strict().nullable(),
    resolution: z.enum(["resolved", "unresolved"]),
    unavailableReason: z.enum([
      "unknown-identity",
      "ambiguous-identity",
      "unverified-identity",
      "invalid-configuration",
      "invalid-set-override",
      "missing-load",
      "invalid-load",
      "missing-repetitions",
      "missing-bodyweight-reference",
      "asymmetric-side-breakdown",
    ]).nullable(),
  }).strict(),
  override: z.object({
    snapshot: setExecutionOverrideV1Schema.nullable(),
    status: z.enum(["absent", "valid", "invalid"]),
  }).strict(),
  mechanics: z.object({
    inventoryCount: z.union([z.literal(1), z.literal(2)]),
    loadedSides: z.union([z.literal(1), z.literal(2)]),
    execution: z.enum(["simultaneous", "alternating", "unilateral"]),
    implementsPerMovement: z.union([z.literal(1), z.literal(2)]).nullable(),
    effectiveMultiplier: z.number().positive().finite(),
  }).strict().nullable(),
  contributions: z.array(breakdownContributionSchema),
}).strict().superRefine((row, context) => {
  if (row.asymmetricReps
      && row.effectiveReps !== row.asymmetricReps.left + row.asymmetricReps.right) {
    context.addIssue({ code: "custom", path: ["effectiveReps"], message: "effective reps must match asymmetric reps" });
  }
  const categories = row.contributions.map(({ category }) => category);
  if (new Set(categories).size !== categories.length) {
    context.addIssue({ code: "custom", path: ["contributions"], message: "each category may appear once per set" });
  }
});

const metricForBreakdownCategory = (
  result: z.infer<typeof metricRecord>,
  category: LoadAccountingBreakdownCategoryV1,
) => {
  switch (category) {
    case "externalLoadVolume": return result.externalLoadVolume;
    case "bandNominalPerLoggedSide": return result.bandNominalIndex.perLoggedSide;
    case "bandNominalLeftSide": return result.bandNominalIndex.leftSide;
    case "bandNominalRightSide": return result.bandNominalIndex.rightSide;
    case "bodyweightSets": return result.bodyweight.sets;
    case "bodyweightRepetitions": return result.bodyweight.repetitions;
    case "bodyweightReferenceVolume": return result.bodyweight.referenceVolume;
    case "additionalLoad": return result.additionalLoad;
    case "assistanceLoad": return result.assistanceLoad;
  }
};

const breakdownUnits: Record<LoadAccountingBreakdownCategoryV1, string> = {
  externalLoadVolume: "kg-repetitions",
  bandNominalPerLoggedSide: "nominal-kg-repetitions-per-logged-side",
  bandNominalLeftSide: "nominal-kg-repetitions-per-side",
  bandNominalRightSide: "nominal-kg-repetitions-per-side",
  bodyweightSets: "sets",
  bodyweightRepetitions: "repetitions",
  bodyweightReferenceVolume: "bodyweight-reference-kg-repetitions",
  additionalLoad: "kg-repetitions",
  assistanceLoad: "kg-repetitions",
};

const breakdownCategories: LoadAccountingBreakdownCategoryV1[] = [
  "externalLoadVolume",
  "bandNominalPerLoggedSide",
  "bandNominalLeftSide",
  "bandNominalRightSide",
  "bodyweightSets",
  "bodyweightRepetitions",
  "bodyweightReferenceVolume",
  "additionalLoad",
  "assistanceLoad",
];

export const persistedLoadAccountingPayloadV2Schema = persistedLoadAccountingPayloadV1Schema
  .extend({
    schemaVersion: z.literal(PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2),
    breakdown: z.object({
      schemaVersion: z.literal(LOAD_ACCOUNTING_BREAKDOWN_SCHEMA_V1),
      accountingMethodVersion: z.literal(LOAD_ACCOUNTING_METHOD_V1),
      rows: z.array(breakdownRowSchema),
    }).strict(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.breakdown.accountingMethodVersion !== payload.accountingMethodVersion) {
      context.addIssue({ code: "custom", path: ["breakdown", "accountingMethodVersion"], message: "breakdown method must match snapshot method" });
    }
    const stableSetIdentities = new Set<string>();
    for (const row of payload.breakdown.rows) {
      const stableSetIdentity = String(row.sessionExerciseId) + ":" + String(row.strengthSetId);
      if (stableSetIdentities.has(stableSetIdentity)) {
        context.addIssue({ code: "custom", path: ["breakdown", "rows"], message: "a persisted set may appear only once" });
      }
      stableSetIdentities.add(stableSetIdentity);
      if (row.sessionId !== payload.sessionId) {
        context.addIssue({ code: "custom", path: ["breakdown", "rows"], message: "row session identity must match payload" });
      }
    }
    for (const category of breakdownCategories) {
      const contributions = payload.breakdown.rows.flatMap((row) =>
        row.contributions.filter((contribution) => contribution.category === category));
      const metric = metricForBreakdownCategory(payload.result, category);
      const eligibleRows = contributions.length;
      const accountedRows = contributions.filter(({ availability }) => availability === "available").length;
      const omittedRows = eligibleRows - accountedRows;
      const total = contributions.reduce((sum, contribution) => sum + (contribution.value ?? 0), 0);
      const omittedReasons: Record<string, number> = {};
      for (const contribution of contributions) {
        if (contribution.unavailableReason) {
          omittedReasons[contribution.unavailableReason] = (omittedReasons[contribution.unavailableReason] ?? 0) + 1;
        }
      }
      const availability = eligibleRows === 0 || accountedRows === eligibleRows
        ? "available" : accountedRows === 0 ? "unavailable" : "partial";
      const expectedValue = accountedRows === 0 && eligibleRows > 0 ? null : total;
      const sameReasons = JSON.stringify(Object.fromEntries(Object.entries(omittedReasons).sort()))
        === JSON.stringify(Object.fromEntries(Object.entries(metric.coverage.omittedReasons).sort()));
      if (metric.unit !== breakdownUnits[category]
          || metric.coverage.eligibleRows !== eligibleRows
          || metric.coverage.accountedRows !== accountedRows
          || metric.coverage.omittedRows !== omittedRows
          || !sameReasons
          || metric.availability !== availability
          || (expectedValue === null ? metric.value !== null
            : metric.value === null || Math.abs(metric.value - expectedValue) > 1e-9)) {
        context.addIssue({
          code: "custom",
          path: ["breakdown", "rows"],
          message: "persisted row contributions must reconcile with their category aggregate",
        });
      }
    }
  });

export type PersistedLoadAccountingPayloadV2 = z.infer<typeof persistedLoadAccountingPayloadV2Schema>;
export type PersistedLoadAccountingPayload = PersistedLoadAccountingPayloadV1 | PersistedLoadAccountingPayloadV2;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function isPersistedLoadAccountingPayloadVersion(
  value: string,
): value is typeof PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1 | typeof PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2 {
  return value === PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1
    || value === PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2;
}

export function persistedPayloadFromUnknown(value: unknown): PersistedLoadAccountingPayload | null {
  const v2 = persistedLoadAccountingPayloadV2Schema.safeParse(value);
  if (v2.success) return v2.data;
  const v1 = persistedLoadAccountingPayloadV1Schema.safeParse(value);
  return v1.success ? v1.data : null;
}

export function buildMassResolutionIdentity(input: {
  localDate: string;
  timeZone: string;
  methodVersion: string;
  reference: z.infer<typeof bodyweightSchema>;
}): string {
  return sha256Canonical(input);
}
