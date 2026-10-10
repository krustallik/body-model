import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { recalculateModelEpisode, getModelStatus } from "./model-episode.service";
import { PhysiologyV7PersistenceRepository } from "./physiology-v7-persistence.repository";
import {
  isProductionGenerationCurrentV1,
  isUnifiedGenerationCurrentV1,
} from "./publication-generation-v1";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "./unified-experimental-physiology-state.service";

/**
 * Durable primary source records/configuration, user decisions, and provenance
 * that a full-history calculation must leave unchanged at the row-value level.
 * Rebuildable accounting journals, shadows, and canonical Active Energy
 * materializations are intentionally excluded; their source records remain in
 * this inventory and publication/currentness is checked separately.
 */
export const FULL_HISTORY_RAW_INPUT_TABLES = [
  "Profile",
  "ModelEpisode",
  "StepperEquipmentAssignment",
  "DailyHealthData",
  "HealthMetricSample",
  "HeartRateSample",
  "RestingHeartRateSample",
  "SleepSegment",
  "HealthSyncSnapshot",
  "HealthSyncAudit",
  "HealthActivityInterval",
  "Workout",
  "ExerciseCatalog",
  "ExerciseLoadConfiguration",
  "TrainingProgram",
  "TrainingProgramVersion",
  "ProgramExercise",
  "StrengthDiarySession",
  "StrengthDiaryProgramChange",
  "StrengthSessionExercise",
  "StrengthSet",
  "WorkInterval",
  "StepperReconciliationGroup",
  "StepperReconciliationCandidate",
] as const;

/**
 * These rows are outputs of the replay's own materialization path, not primary
 * user observations. They may be appended or refreshed during replay; source
 * values remain protected through Workout, Strength, Health, and reconciliation
 * rows in FULL_HISTORY_RAW_INPUT_TABLES.
 */
export const FULL_HISTORY_REBUILT_DERIVED_TABLES = [
  "StrengthSessionAccountingSnapshot",
  "StrengthSessionAccountingOperation",
  "ActiveEnergyCanonicalEvent",
  "ActiveEnergyEventAlias",
  "ActiveEnergyCandidate",
  "ActiveEnergyResolutionRevision",
] as const;

/**
 * Recalculation persists only these ModelEpisode outputs. Every other episode
 * field (including its frozen initialization inputs and provenance) remains in
 * the raw-source fingerprint. Keep this list aligned with
 * ModelEpisodeRepository.persistCalculation.
 */
const MODEL_EPISODE_RECALCULATION_OUTPUT_FIELDS = [
  "personalOffsetKcalPerDay",
  "activityCalibration",
  "calibrationStatus",
  "calibrationDiagnostics",
  "latestModeledDate",
  "updatedAt",
] as const;

/**
 * Materialization-owned StrengthDiarySession fields. Preserve the semantic
 * accounting instant and timezone in the inventory, but normalize legacy nulls
 * to the same fallback values materializeAccounting writes. The pointer and
 * updatedAt are derived bookkeeping, not user-entered session data.
 */
const STRENGTH_SESSION_RECALCULATION_OUTPUT_FIELDS = [
  "currentSnapshotRevision",
  "updatedAt",
  "effectiveAccountingAt",
  "accountingTimeZone",
  "accountingTimeZoneProvenance",
] as const;

const RAW_INPUT_INVENTORY_PAGE_SIZE = 250;

export type FullHistoryRawInputInventory = {
  fingerprint: string;
  tables: Array<{
    table: (typeof FULL_HISTORY_RAW_INPUT_TABLES)[number];
    rowCount: number;
    contentSha256: string;
  }>;
};

export type FullHistoryRecalculationResult = {
  profileId: number;
  episodeId: number;
  episodeStartDate: string;
  modelVersion: string;
  daysPersisted: number;
  completeDays: number;
  latestModeledDate: string | null;
  invalidationGeneration: number;
  productionPublishedGeneration: number;
  unifiedPublishedGeneration: number;
  unifiedTargetRevision: typeof UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION;
  unifiedRolloutEpoch: number;
  rawInputFingerprint: string;
  recalculation: Awaited<ReturnType<typeof recalculateModelEpisode>>;
};

type LifecycleSnapshot = {
  invalidationGeneration: number;
  productionStaleFromDate: string | null;
  productionPublishedGeneration: number | null;
  unifiedPublishedGeneration: number | null;
  unifiedTargetRevision: string;
  unifiedRolloutEpoch: number;
  unifiedPublishedRolloutEpoch: number | null;
};

async function inventoryRawInputs(client: PrismaClient): Promise<FullHistoryRawInputInventory> {
  const tables: FullHistoryRawInputInventory["tables"] = [];
  for (const table of FULL_HISTORY_RAW_INPUT_TABLES) {
    // Identifiers come only from the fixed allowlist. Page canonical JSONB
    // rows so large histories are fingerprinted without loading a whole table.
    // ModelEpisode also stores frozen episode inputs/provenance alongside
    // recalculated outputs, so remove only fields written by persistCalculation.
    const canonicalRowExpression = table === "ModelEpisode"
      ? `to_jsonb(source_row) - ARRAY[${MODEL_EPISODE_RECALCULATION_OUTPUT_FIELDS.map((field) => `'${field}'`).join(", ")}]::text[]`
      : table === "StrengthDiarySession"
        ? `(to_jsonb(source_row) - ARRAY[${STRENGTH_SESSION_RECALCULATION_OUTPUT_FIELDS.map((field) => `'${field}'`).join(", ")}]::text[])
           || jsonb_build_object(
             'effectiveAccountingAt', COALESCE(source_row."effectiveAccountingAt", matched_workout."startAt", source_row."webStartedAt", source_row."createdAt"),
             'accountingTimeZone', COALESCE(source_row."accountingTimeZone", $3::text),
             'accountingTimeZoneProvenance', COALESCE(source_row."accountingTimeZoneProvenance", 'legacy-default')
           )`
        : "to_jsonb(source_row)";
    const sourceJoins = table === "StrengthDiarySession"
      ? `LEFT JOIN public."Workout" AS matched_workout ON matched_workout."id" = source_row."matchedWorkoutId"`
      : "";
    const tableHash = createHash("sha256").update(`bodycast-raw-source-table-v3\0${table}\0`);
    let afterId = -2_147_483_649;
    let rowCount = 0;
    while (true) {
      const queryParameters = table === "StrengthDiarySession"
        ? [afterId, RAW_INPUT_INVENTORY_PAGE_SIZE, DEFAULT_TIME_ZONE]
        : [afterId, RAW_INPUT_INVENTORY_PAGE_SIZE];
      const rows = await client.$queryRawUnsafe<Array<{ id: number; canonical_row: string }>>(
        `SELECT source_row.id, (${canonicalRowExpression})::text AS canonical_row
         FROM public."${table}" AS source_row
         ${sourceJoins}
         WHERE source_row.id > $1::bigint
         ORDER BY source_row.id
         LIMIT $2::integer`,
        ...queryParameters,
      );
      if (rows.length > RAW_INPUT_INVENTORY_PAGE_SIZE) {
        throw new Error(`Raw input inventory returned an oversized page for ${table}`);
      }
      for (const row of rows) {
        if (!Number.isSafeInteger(row.id) || row.id <= afterId || typeof row.canonical_row !== "string") {
          throw new Error(`Raw input inventory returned an invalid canonical row for ${table}`);
        }
        tableHash.update(String(Buffer.byteLength(row.canonical_row, "utf8")));
        tableHash.update(":");
        tableHash.update(row.canonical_row);
        tableHash.update("\n");
        afterId = row.id;
        rowCount += 1;
      }
      if (rows.length < RAW_INPUT_INVENTORY_PAGE_SIZE) break;
    }
    tables.push({
      table,
      rowCount,
      contentSha256: tableHash.digest("hex"),
    });
  }
  const fingerprint = createHash("sha256")
    .update("bodycast-full-history-raw-input-inventory-v3\0")
    .update(JSON.stringify(tables))
    .digest("hex");
  return { fingerprint, tables };
}

async function readLifecycle(client: PrismaClient, profileId: number): Promise<LifecycleSnapshot> {
  const lifecycle = await client.physiologyV7Lifecycle.findUnique({
    where: { profileId },
    select: {
      invalidationGeneration: true,
      productionStaleFromDate: true,
      productionPublishedGeneration: true,
      unifiedPublishedGeneration: true,
      unifiedTargetRevision: true,
      unifiedRolloutEpoch: true,
      unifiedPublishedRolloutEpoch: true,
    },
  });
  if (!lifecycle) {
    throw new Error(`Physiology lifecycle is missing for profile ${profileId}`);
  }
  return lifecycle;
}

function assertV3PreActivationLifecycle(lifecycle: LifecycleSnapshot, profileId: number): void {
  if (lifecycle.unifiedTargetRevision !== UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION
      || lifecycle.unifiedRolloutEpoch !== 0) {
    throw new Error(
      `Full-history recalculation requires Unified V3 epoch 0 before V4 activation (profile ${profileId})`,
    );
  }
}

/**
 * Owner-authorized full production history rebuild for one profile.
 * Forces replay from the active episode start, republishes production, rebuilds
 * Unified V3, and fail-closes if raw observation inputs change.
 */
export async function runOwnerAuthorizedFullHistoryRecalculation(input: {
  profileId: number;
  ownerAuthorized: true;
  client?: PrismaClient;
}): Promise<FullHistoryRecalculationResult> {
  if (input.ownerAuthorized !== true) {
    throw new Error("Full-history recalculation requires explicit owner authorization");
  }
  if (!Number.isInteger(input.profileId) || input.profileId <= 0) {
    throw new Error("profileId must be a positive integer");
  }

  const client = input.client ?? prisma;
  const profileId = input.profileId;
  const beforeRaw = await inventoryRawInputs(client);
  const status = await getModelStatus(undefined, client);
  const episode = await client.modelEpisode.findUnique({
    where: { id: status.episodeId },
    select: { id: true, profileId: true, startDate: true, modelVersion: true, active: true },
  });
  if (!episode || episode.profileId !== profileId || episode.active !== true) {
    throw new Error(`Active model episode for profile ${profileId} is unavailable`);
  }

  const beforeLifecycle = await readLifecycle(client, profileId);
  assertV3PreActivationLifecycle(beforeLifecycle, profileId);

  await new PhysiologyV7PersistenceRepository(client).invalidate(profileId, episode.startDate);
  const recalculation = await recalculateModelEpisode({ episodeId: episode.id }, client);
  await rebuildUnifiedExperimentalPhysiologyStateV1({
    profileId,
    client,
    targetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
    rolloutEpoch: 0,
  });

  const afterLifecycle = await readLifecycle(client, profileId);
  assertV3PreActivationLifecycle(afterLifecycle, profileId);
  if (!isProductionGenerationCurrentV1(afterLifecycle)
      || !isUnifiedGenerationCurrentV1(afterLifecycle)
      || afterLifecycle.unifiedPublishedRolloutEpoch !== 0) {
    throw new Error("Full-history recalculation did not leave production and Unified V3 publications current");
  }

  const afterRaw = await inventoryRawInputs(client);
  if (afterRaw.fingerprint !== beforeRaw.fingerprint) {
    throw new Error("Full-history recalculation mutated raw observation inputs or provenance");
  }

  return {
    profileId,
    episodeId: episode.id,
    episodeStartDate: episode.startDate,
    modelVersion: episode.modelVersion,
    daysPersisted: recalculation.daysPersisted,
    completeDays: recalculation.completeDays,
    latestModeledDate: recalculation.latestModeledDate,
    invalidationGeneration: afterLifecycle.invalidationGeneration,
    productionPublishedGeneration: afterLifecycle.productionPublishedGeneration!,
    unifiedPublishedGeneration: afterLifecycle.unifiedPublishedGeneration!,
    unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
    unifiedRolloutEpoch: 0,
    rawInputFingerprint: afterRaw.fingerprint,
    recalculation,
  };
}

export async function inventoryFullHistoryRawInputs(client: PrismaClient = prisma): Promise<FullHistoryRawInputInventory> {
  return inventoryRawInputs(client);
}
