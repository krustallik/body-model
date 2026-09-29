import { createHash } from "node:crypto";
import { z } from "zod";
import { LOAD_ACCOUNTING_METHOD_V1 } from "./load-accounting-v1";

export const PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1 = "bodycast-persisted-load-accounting-v1" as const;

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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function persistedPayloadFromUnknown(value: unknown): PersistedLoadAccountingPayloadV1 | null {
  const parsed = persistedLoadAccountingPayloadV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function buildMassResolutionIdentity(input: {
  localDate: string;
  timeZone: string;
  methodVersion: string;
  reference: z.infer<typeof bodyweightSchema>;
}): string {
  return sha256Canonical(input);
}
