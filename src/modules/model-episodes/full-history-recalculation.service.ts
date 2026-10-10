import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { recalculateModelEpisode, getModelStatus } from "./model-episode.service";
import { PhysiologyV7PersistenceRepository } from "./physiology-v7-persistence.repository";
import {
  isProductionGenerationCurrentV1,
  isUnifiedGenerationCurrentV1,
} from "./publication-generation-v1";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "./unified-experimental-physiology-state.service";

/** Raw observation tables that production recalculation must not rewrite. */
export const FULL_HISTORY_RAW_INPUT_INVENTORY_SQL = [
  {
    table: "DailyHealthData",
    sql: `SELECT COUNT(*)::bigint AS row_count,
                 MAX("updatedAt") AS max_marker,
                 COALESCE(md5(string_agg(id::text || ':' || "updatedAt"::text, ',' ORDER BY id)), md5('')) AS id_checksum
          FROM public."DailyHealthData"`,
  },
  {
    table: "HealthSyncSnapshot",
    sql: `SELECT COUNT(*)::bigint AS row_count,
                 MAX("receivedAt") AS max_marker,
                 COALESCE(md5(string_agg(id::text || ':' || "receivedAt"::text, ',' ORDER BY id)), md5('')) AS id_checksum
          FROM public."HealthSyncSnapshot"`,
  },
  {
    table: "HealthActivityInterval",
    sql: `SELECT COUNT(*)::bigint AS row_count,
                 MAX("createdAt") AS max_marker,
                 COALESCE(md5(string_agg(id::text || ':' || "sourceFingerprint", ',' ORDER BY id)), md5('')) AS id_checksum
          FROM public."HealthActivityInterval"`,
  },
  {
    table: "WorkInterval",
    sql: `SELECT COUNT(*)::bigint AS row_count,
                 MAX("updatedAt") AS max_marker,
                 COALESCE(md5(string_agg(id::text || ':' || "updatedAt"::text, ',' ORDER BY id)), md5('')) AS id_checksum
          FROM public."WorkInterval"`,
  },
  {
    table: "Workout",
    sql: `SELECT COUNT(*)::bigint AS row_count,
                 MAX("updatedAt") AS max_marker,
                 COALESCE(md5(string_agg(id::text || ':' || "updatedAt"::text, ',' ORDER BY id)), md5('')) AS id_checksum
          FROM public."Workout"`,
  },
  {
    table: "HeartRateSample",
    // Large HR histories must not string_agg; use bounded aggregates instead.
    sql: `SELECT COUNT(*)::bigint AS row_count,
                 MAX("updatedAt") AS max_marker,
                 md5(
                   COUNT(*)::text || ':' ||
                   COALESCE(MIN(id)::text, '') || ':' ||
                   COALESCE(MAX(id)::text, '') || ':' ||
                   COALESCE(SUM(hashtextextended(id::text || ':' || "updatedAt"::text, 0)), 0)::text
                 ) AS id_checksum
          FROM public."HeartRateSample"`,
  },
  {
    table: "StrengthDiarySession",
    sql: `SELECT COUNT(*)::bigint AS row_count,
                 MAX("updatedAt") AS max_marker,
                 COALESCE(md5(string_agg(id::text || ':' || "updatedAt"::text, ',' ORDER BY id)), md5('')) AS id_checksum
          FROM public."StrengthDiarySession"`,
  },
] as const;

export const FULL_HISTORY_RAW_INPUT_TABLES = FULL_HISTORY_RAW_INPUT_INVENTORY_SQL.map((entry) => entry.table);

export type FullHistoryRawInputInventory = {
  fingerprint: string;
  tables: Array<{
    table: (typeof FULL_HISTORY_RAW_INPUT_INVENTORY_SQL)[number]["table"];
    rowCount: number;
    maxMarker: string | null;
    idChecksum: string;
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
  const tables = [];
  for (const entry of FULL_HISTORY_RAW_INPUT_INVENTORY_SQL) {
    const rows = await client.$queryRawUnsafe<Array<{
      row_count: bigint | number;
      max_marker: Date | string | null;
      id_checksum: string | null;
    }>>(entry.sql);
    const row = rows[0];
    if (!row) throw new Error(`Raw input inventory failed for ${entry.table}`);
    tables.push({
      table: entry.table,
      rowCount: Number(row.row_count),
      maxMarker: row.max_marker === null
        ? null
        : row.max_marker instanceof Date
          ? row.max_marker.toISOString()
          : new Date(row.max_marker).toISOString(),
      idChecksum: row.id_checksum ?? "",
    });
  }
  return { fingerprint: stableSha256(tables), tables };
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
