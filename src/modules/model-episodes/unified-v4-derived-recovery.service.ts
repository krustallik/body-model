import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordExperimentalFfmRetentionShadow } from "./experimental-ffm-retention-shadow.service";
import { recordExperimentalLocalHypertrophyResponseShadow } from "./experimental-local-hypertrophy-response-shadow.service";
import { rebuildAuthoritativeRelativeMuscleTrajectory } from "./experimental-cessation-detraining-shadow.service";
import { FULL_HISTORY_RAW_INPUT_TABLES } from "./full-history-recalculation.service";
import { PhysiologyV7PersistenceRepository } from "./physiology-v7-persistence.repository";
import { recordExperimentalGlycogenStateShadow } from "./experimental-glycogen-state-shadow.service";
import { activateAndReplayUnifiedV4 } from "./unified-rollout-v4.service";
import { recordExperimentalStepperActiveEnergyShadowsForLocalDate, recordExperimentalStepperActiveEnergyShadowsForMassWindow } from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import { recordExperimentalStepperGlycogenDemandShadowsForLocalDate } from "@/modules/profile/experimental-stepper-glycogen-demand-shadow.service";
import { recalculateActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";
import {
  assertPersistedTrainingSessionRecoveryReadyV1,
  refreshDeletedCompletedSessionDependenciesForRecoveryV1,
  refreshPersistedTrainingSessionDependenciesV1,
  recordExperimentalStrengthShadowsForWeightDate,
} from "@/modules/training/training.service";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";

type PublicationBlock = {
  source: string;
  sourceKey: string;
  fromDate: string;
  revision: number;
};

type SupportedTrainingBlock = PublicationBlock & {
  sessionId: number;
  identity: "session" | "deleted-session" | "deleted-set" | "deleted-exercise";
};

type RecoveryLifecycleBinding = {
  profileId: number;
  invalidationGeneration: number;
  productionPublishedGeneration: number | null;
  productionStaleFromDate: string | null;
  unifiedTargetRevision: string | null;
  unifiedRolloutEpoch: number | null;
  unifiedPublishedGeneration: number | null;
  unifiedPublishedRolloutEpoch: number | null;
  unifiedPublicationBlockedFromDate: string | null;
  unifiedPublicationBlockedSource: string | null;
};

export type V4RecoveryEvidenceBindingV1 = {
  contract: "bodycast-v4-recovery-evidence-binding-v1";
  rawFingerprint: string;
  fenceDigest: string;
  lifecycleDigest: string;
  bindingDigest: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type RecoveryConvergenceLogFields = Record<string, boolean | number | string | null | undefined>;

function logRecoveryConvergenceEvent(
  level: "info" | "warn",
  event: string,
  fields: RecoveryConvergenceLogFields,
): void {
  // Keep the recovery CLI's stdout reserved for its single machine-readable result.
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
}

function sortedFenceDigest(blocks: readonly PublicationBlock[]): string {
  const sorted = [...blocks].sort((left, right) =>
    `${left.source}\0${left.sourceKey}`.localeCompare(`${right.source}\0${right.sourceKey}`));
  const content = sorted.map((block) => `${block.source}\t${block.sourceKey}\t${block.fromDate}\t${block.revision}\n`).join("");
  return sha256(content);
}

function lifecycleBindingValues(lifecycle: RecoveryLifecycleBinding) {
  return [lifecycle.profileId, lifecycle.invalidationGeneration, lifecycle.productionPublishedGeneration,
    lifecycle.productionStaleFromDate, lifecycle.unifiedTargetRevision, lifecycle.unifiedRolloutEpoch,
    lifecycle.unifiedPublishedGeneration, lifecycle.unifiedPublishedRolloutEpoch,
    lifecycle.unifiedPublicationBlockedFromDate, lifecycle.unifiedPublicationBlockedSource] as const;
}

export function createV4RecoveryEvidenceBindingV1(input: {
  rawFingerprint: string;
  blocks: readonly PublicationBlock[];
  lifecycle: RecoveryLifecycleBinding;
}): V4RecoveryEvidenceBindingV1 {
  if (!/^[a-f0-9]{64}$/.test(input.rawFingerprint)) throw new Error("V4 recovery raw fingerprint is malformed");
  const fenceDigest = sortedFenceDigest(input.blocks);
  const lifecycleDigest = sha256(JSON.stringify(lifecycleBindingValues(input.lifecycle)));
  return {
    contract: "bodycast-v4-recovery-evidence-binding-v1",
    rawFingerprint: input.rawFingerprint,
    fenceDigest,
    lifecycleDigest,
    bindingDigest: sha256(`bodycast-v4-recovery-evidence-binding-v1\n${input.rawFingerprint}\n${fenceDigest}\n${lifecycleDigest}\n`),
  };
}

const V4_RECOVERY_RAW_INVENTORY_PAGE_SIZE = 250;
const V4_RECOVERY_RAW_INVENTORY_MAX_BATCH_BYTES = 8 * 1024 * 1024;
// Bound JSONB values retained together while deriving text-size bounds. A
// single larger row is handled alone, up to the existing per-row ceiling.
const V4_RECOVERY_RAW_INVENTORY_MAX_BOUND_BATCH_JSONB_BYTES = 1024 * 1024;
const V4_RECOVERY_RAW_INVENTORY_CHUNK_CHARACTERS = 1024 * 1024;
// Refuse an unexpectedly large JSON rendering before the text cast. The
// metadata query uses a conservative JSONB/string expansion bound plus each
// numeric's binary weight and scale, so a compact JSONB value cannot evade the
// limit by expanding during PostgreSQL text output.
const V4_RECOVERY_RAW_INVENTORY_MAX_ROW_BYTES = 64 * 1024 * 1024;

type V4RecoveryRawRowMetadata = {
  id: number;
  raw_row_jsonb_bytes: bigint | number | string;
  raw_row_upper_bytes?: bigint | number | string;
  raw_row_bytes?: bigint | number | string | null;
};

function safeNonNegativeInteger(value: bigint | number | string, label: string): number {
  const parsed = typeof value === "bigint" ? Number(value)
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`V4 strict source fingerprint returned an invalid ${label}`);
  }
  return parsed;
}

function unicodeCodePointLength(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff
        && index + 1 < value.length
        && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      index += 1;
    }
    count += 1;
  }
  return count;
}

function updateV4RecoveryRawRowDigest(
  tableDigest: ReturnType<typeof createHash>,
  row: { id: number; raw_row: string },
  expectedBytes: number,
  table: string,
): void {
  if (!Number.isSafeInteger(row.id) || typeof row.raw_row !== "string"
      || Buffer.byteLength(row.raw_row, "utf8") !== expectedBytes) {
    throw new Error(`V4 strict source fingerprint returned an invalid ${table} row`);
  }
  tableDigest.update(`${row.id}:${expectedBytes}:${row.raw_row}\n`);
}

async function runV4RecoveryInventoryQueryV1<T>(table: string, stage: string, query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "unknown database error";
    throw new Error(`V4 strict source fingerprint query failed for ${table} (${stage}): ${detail}`, { cause: error });
  }
}

async function readConsistentRecoveryEvidenceV1(client: PrismaClient, profileId: number) {
  return client.$transaction(async (tx) => {
    const lifecycle = await tx.physiologyV7Lifecycle.findUnique({ where: { profileId } });
    if (!lifecycle) throw new Error("Persisted-source V4 recovery has no lifecycle row");
    const blocks = await tx.unifiedPublicationBlock.findMany({
      where: { profileId },
      orderBy: [{ source: "asc" }, { sourceKey: "asc" }],
      select: { source: true, sourceKey: true, fromDate: true, revision: true },
    });
    const raw = await inventoryV4RecoveryRawSourcesInSnapshotV1(tx as unknown as PrismaClient);
    return { lifecycle, blocks, raw };
  }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 });
}

async function assertExpectedRecoveryEvidenceBindingV1(input: {
  client: PrismaClient;
  profileId: number;
  expected: V4RecoveryEvidenceBindingV1;
}): Promise<{ lifecycle: Awaited<ReturnType<PrismaClient["physiologyV7Lifecycle"]["findUnique"]>>; blocks: PublicationBlock[]; raw: { fingerprint: string; tables: Record<string, string> } }> {
  const current = await readConsistentRecoveryEvidenceV1(input.client, input.profileId);
  const actual = createV4RecoveryEvidenceBindingV1({
    rawFingerprint: current.raw.fingerprint,
    blocks: current.blocks,
    lifecycle: current.lifecycle,
  });
  if (input.expected.contract !== actual.contract
      || input.expected.rawFingerprint !== actual.rawFingerprint
      || input.expected.fenceDigest !== actual.fenceDigest
      || input.expected.lifecycleDigest !== actual.lifecycleDigest
      || input.expected.bindingDigest !== actual.bindingDigest) {
    throw new Error("Persisted source, publication fence, or lifecycle binding changed after exact-image rehearsal; recovery stopped before derived writes");
  }
  return current;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseTrainingBlockIdentity(sourceKey: string): Pick<SupportedTrainingBlock, "sessionId" | "identity"> | null {
  if (/^[1-9]\d*$/.test(sourceKey)) {
    const sessionId = Number(sourceKey);
    return Number.isSafeInteger(sessionId) ? { sessionId, identity: "session" } : null;
  }
  const deletedSession = /^training-delete-session:([1-9]\d*)$/.exec(sourceKey);
  if (deletedSession) {
    const sessionId = Number(deletedSession[1]);
    return Number.isSafeInteger(sessionId) ? { sessionId, identity: "deleted-session" } : null;
  }
  const childDelete = /^training-delete-(set|exercise):([1-9]\d*):([1-9]\d*)$/.exec(sourceKey);
  if (!childDelete) return null;
  const sessionId = Number(childDelete[2]);
  const childId = Number(childDelete[3]);
  if (!Number.isSafeInteger(sessionId) || !Number.isSafeInteger(childId)) return null;
  return { sessionId, identity: childDelete[1] === "set" ? "deleted-set" : "deleted-exercise" };
}

function assertSupportedBlockSet(blocks: readonly PublicationBlock[]): {
  health: PublicationBlock[];
  training: SupportedTrainingBlock[];
} {
  const health = blocks.filter((block) => block.source === "health");
  const training = blocks.filter((block) => block.source === "training").map((block) => {
    const identity = parseTrainingBlockIdentity(block.sourceKey);
    return identity === null ? null : { ...block, ...identity };
  });
  const identities = new Set(blocks.map((block) => `${block.source}\0${block.sourceKey}`));
  if (health.length + training.filter((block) => block !== null).length !== blocks.length
      || identities.size !== blocks.length
      || health.some((block) => block.sourceKey !== block.fromDate || !validDate(block.fromDate))
      || blocks.some((block) => !Number.isSafeInteger(block.revision) || block.revision < 1)
      || training.some((block) => block === null || !validDate(block.fromDate))) {
    throw new Error("V4 derived recovery found an unsupported publication block set");
  }
  return {
    health,
    training: (training as SupportedTrainingBlock[]).sort((left, right) =>
      left.sessionId - right.sessionId || left.sourceKey.localeCompare(right.sourceKey)),
  };
}

function groupTrainingBlocks(blocks: readonly SupportedTrainingBlock[]) {
  const groups = new Map<number, SupportedTrainingBlock[]>();
  for (const block of blocks) {
    const group = groups.get(block.sessionId) ?? [];
    group.push(block);
    groups.set(block.sessionId, group);
  }
  return [...groups.entries()].map(([sessionId, sessionBlocks]) => ({ sessionId, blocks: sessionBlocks }));
}

/** Hash exact persisted JSONB rows. Unlike the full-history inventory this does
 * not omit, coalesce, or normalize any stored source field. */
export async function inventoryV4RecoveryRawSourcesV1(client: PrismaClient): Promise<{
  fingerprint: string;
  tables: Record<string, string>;
}> {
  return client.$transaction(
    (tx) => inventoryV4RecoveryRawSourcesInSnapshotV1(tx as unknown as PrismaClient),
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 },
  );
}

async function inventoryV4RecoveryRawSourcesInSnapshotV1(client: PrismaClient): Promise<{
  fingerprint: string;
  tables: Record<string, string>;
}> {
  const digest = createHash("sha256").update("bodycast-v4-recovery-raw-sources-v3\0");
  const tables: Record<string, string> = {};
  const immutableTables = [
    // HealthSyncAudit is a 30-day operational log, not a V4 calculation input.
    ...FULL_HISTORY_RAW_INPUT_TABLES.filter((table) => table !== "HealthSyncAudit"),
    // Recovery must consume, never rematerialize, persisted Training accounting.
    "StrengthSessionAccountingSnapshot",
    "StrengthSessionAccountingOperation",
  ] as const;
  for (const table of immutableTables) {
    const rawRowExpression = table === "ModelEpisode"
      ? `to_jsonb(source_row) - ARRAY['personalOffsetKcalPerDay', 'activityCalibration', 'calibrationStatus', 'calibrationDiagnostics', 'latestModeledDate', 'updatedAt']::text[]`
      : "to_jsonb(source_row)";
    const [countRow] = await runV4RecoveryInventoryQueryV1(table, "row-count", () =>
      client.$queryRawUnsafe<Array<{ row_count: bigint | number | string }>>(
        `SELECT COUNT(*)::bigint AS row_count FROM public."${table}" AS source_row`,
      ));
    if (!countRow) throw new Error(`V4 strict source fingerprint could not count ${table} rows`);
    const expectedRowCount = safeNonNegativeInteger(countRow.row_count, `${table} row count`);
    const tableDigest = createHash("sha256").update(`${table}\0${expectedRowCount}\0`);
    let scannedRowCount = 0;
    let afterId = -2_147_483_649;
    let pendingRows: V4RecoveryRawRowMetadata[] = [];

    while (true) {
      if (pendingRows.length === 0) {
        pendingRows = await runV4RecoveryInventoryQueryV1(table, `metadata-page-after-${afterId}`, () =>
          client.$queryRawUnsafe<V4RecoveryRawRowMetadata[]>(
            // Keep only ids and scalar sizes in the 250-row page. Full JSONB
            // values are loaded for a separately bounded set below.
            `SELECT source_row.id,
               pg_column_size((${rawRowExpression})::jsonb)::bigint AS raw_row_jsonb_bytes
             FROM public."${table}" AS source_row
             WHERE source_row.id > $1::bigint
             ORDER BY source_row.id
             LIMIT $2::integer`,
            afterId,
            V4_RECOVERY_RAW_INVENTORY_PAGE_SIZE,
          ));
        if (pendingRows.length > V4_RECOVERY_RAW_INVENTORY_PAGE_SIZE) {
          throw new Error(`V4 strict source fingerprint returned an oversized ${table} metadata page`);
        }
        if (pendingRows.length === 0) break;
      }

      if (pendingRows[0]!.raw_row_upper_bytes === undefined) {
        const boundBatch: V4RecoveryRawRowMetadata[] = [];
        let boundBatchJsonbBytes = 0;
        for (const candidate of pendingRows) {
          if (!Number.isSafeInteger(candidate.id) || candidate.id <= afterId) {
            throw new Error(`V4 strict source fingerprint returned invalid ${table} row ordering`);
          }
          const candidateJsonbBytes = safeNonNegativeInteger(candidate.raw_row_jsonb_bytes, `${table} JSONB row byte length`);
          if (candidateJsonbBytes > V4_RECOVERY_RAW_INVENTORY_MAX_ROW_BYTES) {
            throw new Error(`V4 strict source fingerprint found a row whose JSONB size exceeds its limit ${table} row id=${candidate.id} bytes=${candidateJsonbBytes}`);
          }
          if (boundBatch.length > 0
              && boundBatchJsonbBytes + candidateJsonbBytes > V4_RECOVERY_RAW_INVENTORY_MAX_BOUND_BATCH_JSONB_BYTES) break;
          boundBatch.push(candidate);
          boundBatchJsonbBytes += candidateJsonbBytes;
          if (boundBatchJsonbBytes >= V4_RECOVERY_RAW_INVENTORY_MAX_BOUND_BATCH_JSONB_BYTES) break;
        }
        if (boundBatch.length === 0) throw new Error(`V4 strict source fingerprint could not form a bounded ${table} size-check batch`);

        // JSON strings may expand to six ASCII bytes per UTF-8 byte. JSONB
        // numeric storage omits display zeroes, so add a conservative text
        // bound derived from numeric_send weight and scale before the CASE
        // permits any whole-row ::text conversion. This query retains at most
        // 1 MiB of JSONB inputs, except one individually bounded large row.
        const boundedRows = await runV4RecoveryInventoryQueryV1(table, `size-bounds-through-${boundBatch.at(-1)!.id}`, () =>
          client.$queryRawUnsafe<Array<Omit<V4RecoveryRawRowMetadata, "raw_row_jsonb_bytes">>>(
            `WITH RECURSIVE raw_rows AS MATERIALIZED (
               SELECT source_row.id, (${rawRowExpression}) AS raw_row_jsonb
               FROM public."${table}" AS source_row
               WHERE source_row.id > $1::bigint AND source_row.id <= $2::bigint
             ), nodes(id, value) AS (
               SELECT raw_rows.id, raw_rows.raw_row_jsonb FROM raw_rows
               UNION ALL
               SELECT nodes.id, nested.value
               FROM nodes
               CROSS JOIN LATERAL (
                 SELECT item.value
                 FROM jsonb_each(CASE WHEN jsonb_typeof(nodes.value) = 'object' THEN nodes.value ELSE '{}'::jsonb END) AS item(key, value)
                 UNION ALL
                 SELECT item.value
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value) = 'array' THEN nodes.value ELSE '[]'::jsonb END) AS item(value)
               ) AS nested
             ), numeric_values AS MATERIALIZED (
               SELECT nodes.id, nodes.value::numeric AS numeric_value,
                 pg_catalog.numeric_send(nodes.value::numeric) AS numeric_wire
               FROM nodes
               WHERE jsonb_typeof(nodes.value) = 'number'
             ), numeric_sizes AS (
               SELECT id,
                 CASE WHEN (get_byte(numeric_wire, 2)::bigint * 256 + get_byte(numeric_wire, 3)::bigint) >= 32768
                   THEN (get_byte(numeric_wire, 2)::bigint * 256 + get_byte(numeric_wire, 3)::bigint) - 65536
                   ELSE (get_byte(numeric_wire, 2)::bigint * 256 + get_byte(numeric_wire, 3)::bigint) END AS weight,
                 scale(numeric_value) AS decimal_scale
               FROM numeric_values
             ), numeric_bounds AS (
               SELECT id, sum(
                 (CASE WHEN weight >= 0 THEN (weight + 1) * 4 ELSE 1 END)
                 + decimal_scale + CASE WHEN decimal_scale > 0 THEN 1 ELSE 0 END + 1
               )::bigint AS numeric_text_upper_bytes
               FROM numeric_sizes
               GROUP BY id
             ), row_bounds AS MATERIALIZED (
               SELECT raw_rows.id, raw_rows.raw_row_jsonb,
                 (pg_column_size(raw_rows.raw_row_jsonb)::bigint * 6
                   + COALESCE(numeric_bounds.numeric_text_upper_bytes, 0)) AS raw_row_upper_bytes
               FROM raw_rows
               LEFT JOIN numeric_bounds ON numeric_bounds.id = raw_rows.id
             )
             SELECT id, raw_row_upper_bytes,
               CASE WHEN raw_row_upper_bytes <= $3::bigint
                 THEN octet_length(raw_row_jsonb::text)::bigint
                 ELSE NULL
               END AS raw_row_bytes
             FROM row_bounds
             ORDER BY id`,
            afterId,
            boundBatch.at(-1)!.id,
            V4_RECOVERY_RAW_INVENTORY_MAX_ROW_BYTES,
          ));
        if (boundedRows.length !== boundBatch.length || boundedRows.some((row, index) => row.id !== boundBatch[index]?.id)) {
          throw new Error(`V4 strict source fingerprint returned incomplete ${table} size bounds`);
        }
        for (let index = 0; index < boundBatch.length; index += 1) {
          pendingRows[index] = { ...boundBatch[index]!, ...boundedRows[index]! };
        }
        continue;
      }

      const first = pendingRows[0]!;
      if (!Number.isSafeInteger(first.id) || first.id <= afterId) {
        throw new Error(`V4 strict source fingerprint returned invalid ${table} row ordering`);
      }
      if (first.raw_row_upper_bytes === undefined) {
        throw new Error(`V4 strict source fingerprint is missing the ${table} row size bound`);
      }
      const firstUpperBytes = safeNonNegativeInteger(first.raw_row_upper_bytes, `${table} row serialized-size upper bound`);
      if (firstUpperBytes > V4_RECOVERY_RAW_INVENTORY_MAX_ROW_BYTES) {
        throw new Error(`V4 strict source fingerprint found a row whose serialized-size upper bound exceeds its limit ${table} row id=${first.id} upperBytes=${firstUpperBytes}`);
      }
      if (first.raw_row_bytes == null) {
        throw new Error(`V4 strict source fingerprint could not verify bounded ${table} row serialization id=${first.id}`);
      }
      const firstBytes = safeNonNegativeInteger(first.raw_row_bytes, `${table} row byte length`);
      if (firstBytes > V4_RECOVERY_RAW_INVENTORY_MAX_ROW_BYTES || firstBytes > firstUpperBytes) {
        throw new Error(`V4 strict source fingerprint found invalid bounded ${table} row length id=${first.id} bytes=${firstBytes} upperBytes=${firstUpperBytes}`);
      }

      if (firstBytes > V4_RECOVERY_RAW_INVENTORY_MAX_BATCH_BYTES) {
        const chunksDigestPrefix = `${first.id}:${firstBytes}:`;
        tableDigest.update(chunksDigestPrefix);
        let observedBytes = 0;
        const chunks = await runV4RecoveryInventoryQueryV1(table, `row-${first.id}-bounded-chunks`, () =>
          client.$queryRawUnsafe<Array<{ chunk_index: number; raw_row_chunk: string }>>(
            `WITH rendered_row AS MATERIALIZED (
               SELECT source_row.id, (${rawRowExpression})::text AS raw_row
               FROM public."${table}" AS source_row
               WHERE source_row.id = $1::integer
             )
             SELECT chunks.chunk_index::integer AS chunk_index,
               substring(rendered_row.raw_row
                 FROM (chunks.chunk_index * $2::integer + 1)::integer FOR $2::integer) AS raw_row_chunk
             FROM rendered_row
             CROSS JOIN LATERAL generate_series(
               0,
               (char_length(rendered_row.raw_row) - 1) / $2::integer
             ) AS chunks(chunk_index)
             ORDER BY chunks.chunk_index`,
            first.id,
            V4_RECOVERY_RAW_INVENTORY_CHUNK_CHARACTERS,
          ));
        if (chunks.length === 0 || chunks.length > Math.ceil(V4_RECOVERY_RAW_INVENTORY_MAX_ROW_BYTES
          / V4_RECOVERY_RAW_INVENTORY_CHUNK_CHARACTERS)) {
          throw new Error(`V4 strict source fingerprint returned invalid ${table} chunk count`);
        }
        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index]!;
          const chunkCharacters = typeof chunk.raw_row_chunk === "string"
            ? unicodeCodePointLength(chunk.raw_row_chunk)
            : 0;
          if (chunk.chunk_index !== index || typeof chunk.raw_row_chunk !== "string"
              || chunkCharacters === 0
              || chunkCharacters > V4_RECOVERY_RAW_INVENTORY_CHUNK_CHARACTERS
              || (index < chunks.length - 1 && chunkCharacters !== V4_RECOVERY_RAW_INVENTORY_CHUNK_CHARACTERS)) {
            throw new Error(`V4 strict source fingerprint returned invalid ${table} row chunk ordering`);
          }
          observedBytes += Buffer.byteLength(chunk.raw_row_chunk, "utf8");
          tableDigest.update(chunk.raw_row_chunk);
        }
        if (observedBytes !== firstBytes) {
          throw new Error(`V4 strict source fingerprint found a changed ${table} row length`);
        }
        tableDigest.update("\n");
        pendingRows.shift();
        afterId = first.id;
        scannedRowCount += 1;
        continue;
      }

      const batch: V4RecoveryRawRowMetadata[] = [];
      let batchBytes = 0;
      for (const candidate of pendingRows) {
        if (candidate.raw_row_upper_bytes === undefined || candidate.raw_row_bytes === undefined
            || candidate.raw_row_bytes === null) break;
        const candidateUpperBytes = safeNonNegativeInteger(candidate.raw_row_upper_bytes, `${table} row serialized-size upper bound`);
        if (candidateUpperBytes > V4_RECOVERY_RAW_INVENTORY_MAX_ROW_BYTES) break;
        const candidateBytes = safeNonNegativeInteger(candidate.raw_row_bytes, `${table} row byte length`);
        if (candidateBytes > candidateUpperBytes || candidateBytes > V4_RECOVERY_RAW_INVENTORY_MAX_BATCH_BYTES
            || batchBytes + candidateBytes > V4_RECOVERY_RAW_INVENTORY_MAX_BATCH_BYTES) break;
        batch.push(candidate);
        batchBytes += candidateBytes;
      }
      if (batch.length === 0) throw new Error(`V4 strict source fingerprint could not form a bounded ${table} batch`);

      const batchThroughId = batch.at(-1)!.id;
      const rows = await runV4RecoveryInventoryQueryV1(table, `data-batch-through-${batchThroughId}`, () =>
        client.$queryRawUnsafe<Array<{ id: number; raw_row: string }>>(
          `SELECT source_row.id, (${rawRowExpression})::text AS raw_row
           FROM public."${table}" AS source_row
           WHERE source_row.id > $1::bigint AND source_row.id <= $2::bigint
           ORDER BY source_row.id`,
          afterId,
          batchThroughId,
        ));
      if (rows.length !== batch.length) {
        throw new Error(`V4 strict source fingerprint found a changed ${table} batch`);
      }
      for (let index = 0; index < batch.length; index += 1) {
        const metadata = batch[index]!;
        const row = rows[index]!;
        if (row.id !== metadata.id || row.id <= afterId) {
          throw new Error(`V4 strict source fingerprint returned invalid ${table} row ordering`);
        }
        if (metadata.raw_row_bytes == null) {
          throw new Error(`V4 strict source fingerprint is missing the ${table} row byte length`);
        }
        updateV4RecoveryRawRowDigest(
          tableDigest,
          row,
          safeNonNegativeInteger(metadata.raw_row_bytes, `${table} row byte length`),
          table,
        );
        afterId = row.id;
        scannedRowCount += 1;
      }
      pendingRows.splice(0, batch.length);
    }

    if (scannedRowCount !== expectedRowCount) {
      throw new Error(`V4 strict source fingerprint row count changed for ${table}`);
    }
    tables[table] = tableDigest.digest("hex");
    digest.update(`${table}\0${tables[table]}\0`);
  }
  return { fingerprint: digest.digest("hex"), tables };
}

/**
 * Refresh only dependencies of the currently persisted Health and Training
 * rows, then replay the already activated V4 epoch. No Health sync, workout
 * reconciliation, source write, or schema change is performed here.
 */
export async function recoverUnifiedV4FromPersistedSourcesV1(input: {
  profileId: number;
  ownerAuthorized: true;
  expectedEvidenceBinding: V4RecoveryEvidenceBindingV1;
}): Promise<{
  profileId: number;
  rolloutEpoch: number;
  dayCount: number;
  healthDatesRefreshed: string[];
  trainingSessionIdsRefreshed: number[];
  deletedTrainingSessionIdsReconciled: number[];
  rawInputFingerprint: string;
}> {
  if (input.ownerAuthorized !== true) throw new Error("V4 derived recovery requires explicit owner authorization");
  if (!Number.isSafeInteger(input.profileId) || input.profileId !== 1) {
    throw new Error("Persisted-source V4 recovery currently supports only the production profile 1");
  }
  const client: PrismaClient = prisma;
  const { profileId } = input;
  if (!input.expectedEvidenceBinding || input.expectedEvidenceBinding.contract !== "bodycast-v4-recovery-evidence-binding-v1") {
    throw new Error("V4 derived recovery requires the exact rehearsal evidence binding");
  }
  const initialEvidence = await assertExpectedRecoveryEvidenceBindingV1({
    client, profileId, expected: input.expectedEvidenceBinding,
  });
  const lifecycle = initialEvidence.lifecycle;
  if (!lifecycle
      || lifecycle.unifiedTargetRevision !== UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION
      || lifecycle.unifiedRolloutEpoch !== 1) {
    throw new Error("Persisted-source V4 recovery requires the existing V4 epoch 1");
  }

  const beforeRaw = initialEvidence.raw;
  try {
  const repository = new PhysiologyV7PersistenceRepository(client);
  const initialBlocks = initialEvidence.blocks;
  const supported = assertSupportedBlockSet(initialBlocks);
  const trainingGroups = groupTrainingBlocks(supported.training);
  const deletedTrainingSessionIds = new Set<number>();
  for (const group of trainingGroups) {
    const persistedIdentity = await client.strengthDiarySession.findUnique({
      where: { id: group.sessionId }, select: { profileId: true },
    });
    if (persistedIdentity === null) {
      // The explicit deletion tombstone is written in the same source
      // transaction as the hard delete. Numeric-only fences are also used for
      // ordinary edits and cannot prove that a missing session was intentional.
      const sessionFence = group.blocks.find((block) => block.identity === "session");
      const deletionFence = group.blocks.find((block) => block.identity === "deleted-session");
      const childDeletionFences = group.blocks.filter((block) => block.identity === "deleted-set"
        || block.identity === "deleted-exercise");
      if (sessionFence === undefined || deletionFence === undefined
          || sessionFence.fromDate !== deletionFence.fromDate
          || group.blocks.some((block) => block.identity !== "session" && block.identity !== "deleted-session"
            && block.identity !== "deleted-set" && block.identity !== "deleted-exercise")) {
        throw new Error(`Missing Training session has no exact numeric fence plus committed deletion tombstone (${group.sessionId})`);
      }
      for (const block of childDeletionFences) {
        const match = /^training-delete-(set|exercise):([1-9]\d*):([1-9]\d*)$/.exec(block.sourceKey);
        if (match === null || Number(match[2]) !== group.sessionId) {
          throw new Error(`Missing Training session has a malformed child deletion identity (${block.sourceKey})`);
        }
        const childId = Number(match[3]);
        const child = match[1] === "set"
          ? await client.strengthSet.findUnique({ where: { id: childId }, select: { id: true } })
          : await client.strengthSessionExercise.findUnique({ where: { id: childId }, select: { id: true } });
        if (child !== null) throw new Error(`Deleted Training session retains a child named by a deletion fence (${block.sourceKey})`);
      }
      deletedTrainingSessionIds.add(group.sessionId);
    } else {
      if (persistedIdentity.profileId !== profileId) {
        throw new Error(`Training source fence belongs to a different profile (${group.sessionId})`);
      }
      if (group.blocks.some((block) => block.identity === "deleted-session")) {
        throw new Error(`Training session deletion tombstone still has a persisted parent (${group.sessionId})`);
      }
      const childDeleteSourceKeys = group.blocks
        .filter((block) => block.identity !== "session")
        .map((block) => block.sourceKey);
      const hasChildDeleteFence = childDeleteSourceKeys.length > 0;
      await assertPersistedTrainingSessionRecoveryReadyV1({
        sessionId: group.sessionId,
        profileId,
        ...(hasChildDeleteFence ? { recoveryTrainingSourceKeys: group.blocks.map((block) => block.sourceKey) } : {}),
      });
    }
    for (const block of group.blocks) {
      const currentBlock = await client.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: block.sourceKey } },
        select: { revision: true, fromDate: true },
      });
      if (currentBlock === null || currentBlock.revision !== block.revision || currentBlock.fromDate !== block.fromDate) {
        throw new Error(`Training source fence changed during recovery preflight (${block.sourceKey}); recovery stopped`);
      }
    }
  }
  if (supported.health.length > 0) {
    const dates = supported.health.map((block) => block.sourceKey).sort();
    const persistedDays = await client.dailyHealthData.findMany({
      where: { date: { in: dates } },
      select: { date: true, weightKg: true },
      orderBy: { date: "asc" },
    });
    if (persistedDays.length !== dates.length) {
      throw new Error("A Health publication block has no corresponding persisted Health day");
    }

    // Re-read all immutable sources, the full fence set, and lifecycle from a
    // single PostgreSQL snapshot immediately before the first dependent write.
    await assertExpectedRecoveryEvidenceBindingV1({
      client, profileId, expected: input.expectedEvidenceBinding,
    });

    for (const date of dates) {
      await recordExperimentalStepperActiveEnergyShadowsForLocalDate({ date, profileId });
      await recordExperimentalStrengthShadowsForWeightDate({
        date, profileId,
        skipAccountingMaterialization: true,
        clearTrainingFenceAfterDependencyRefresh: false,
        deferProductionRefresh: true,
      });
      await recordExperimentalStepperGlycogenDemandShadowsForLocalDate({ date, profileId });
      await recordExperimentalFfmRetentionShadow({ date, profileId });
      await recordExperimentalLocalHypertrophyResponseShadow({ date, profileId });
    }

    const measurementDates = persistedDays
      .filter((day) => day.weightKg !== null)
      .map((day) => day.date);
    const metricSamples = await client.healthMetricSample.findMany({
      where: { date: { in: dates }, metric: "weight-kg" },
      select: { timestamp: true },
      orderBy: { timestamp: "asc" },
    });
    await recordExperimentalStepperActiveEnergyShadowsForMassWindow({
      measurementDates,
      measurementInstants: metricSamples.map((sample) => sample.timestamp),
      profileId,
    });
    await recordExperimentalGlycogenStateShadow({ date: dates[0]!, profileId });
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: dates[0]!, profileId });

  }

  const refreshedSessionIds: number[] = [];
  if (supported.health.length === 0 && supported.training.length > 0) {
    await assertExpectedRecoveryEvidenceBindingV1({
      client, profileId, expected: input.expectedEvidenceBinding,
    });
  }
  for (const group of trainingGroups) {
    if (deletedTrainingSessionIds.has(group.sessionId)) continue;
    for (const block of group.blocks) {
      const currentBlock = await client.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: block.sourceKey } },
        select: { revision: true, fromDate: true },
      });
      if (currentBlock === null || currentBlock.revision !== block.revision || currentBlock.fromDate !== block.fromDate) {
        throw new Error("Training publication fence changed before dependent refresh; recovery stopped");
      }
    }
    const sessionBlock = group.blocks.find((block) => block.identity === "session");
    const childBlockKeys = group.blocks.filter((block) => block.identity !== "session").map((block) => block.sourceKey);
    const hasChildDeleteFence = childBlockKeys.length > 0;
    await refreshPersistedTrainingSessionDependenciesV1({
      sessionId: group.sessionId,
      profileId,
      ...(sessionBlock === undefined ? {} : {
        expectedTrainingFence: { revision: sessionBlock.revision, fromDate: sessionBlock.fromDate },
      }),
      ...(childBlockKeys.length === 0 ? {} : { publicationBlockSourceKeys: childBlockKeys }),
      ...(hasChildDeleteFence ? { recoveryTrainingSourceKeys: group.blocks.map((block) => block.sourceKey) } : {}),
    });
    refreshedSessionIds.push(group.sessionId);
  }
  if (deletedTrainingSessionIds.size > 0) {
    const deletedBlocks = supported.training.filter((block) => deletedTrainingSessionIds.has(block.sessionId));
    for (const block of deletedBlocks) {
      const currentBlock = await client.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: block.sourceKey } },
        select: { revision: true, fromDate: true },
      });
      if (currentBlock === null || currentBlock.revision !== block.revision || currentBlock.fromDate !== block.fromDate) {
        throw new Error("Deleted Training source fence changed before dependency refresh; recovery stopped");
      }
    }
    const earliestDeletedDate = deletedBlocks.map((block) => block.fromDate).sort()[0];
    if (earliestDeletedDate === undefined) throw new Error("Deleted Training recovery lost its durable dirty date");
    await refreshDeletedCompletedSessionDependenciesForRecoveryV1({ profileId, fromDate: earliestDeletedDate });
  }

  const maxDetailedConvergencePassLogs = 63;
  let detailedConvergencePassLogs = 0;
  let omittedConvergencePassCount = 0;
  let omittedConvergencePassDigest = "0".repeat(64);
  let omittedPassSummary: {
    firstPass: number;
    lastPass: number;
    maxPasses: number;
    effectiveReplayFromDate: string;
    lastStateBefore: string;
    lastStateAfter: string;
    repeatedStateFromPass: number | null;
    oscillationDetected: boolean;
    lifecycleAfterInvalidationJson: string;
  } | null = null;
  const logOmittedConvergenceSummary = () => {
    if (omittedConvergencePassCount === 0 || omittedPassSummary === null) return;
    logRecoveryConvergenceEvent(omittedPassSummary.oscillationDetected ? "warn" : "info", "v4_recovery_stepper_convergence_summary", {
      omittedPassCount: omittedConvergencePassCount,
      omittedPassDiagnosticsDigest: omittedConvergencePassDigest,
      ...omittedPassSummary,
    });
  };
  try {
    await recalculateActiveEnergyChangesV1({
      skipTrainingAccountingMaterialization: true,
      onConvergenceDiagnostic: (diagnostic) => {
        if (detailedConvergencePassLogs < maxDetailedConvergencePassLogs) {
          detailedConvergencePassLogs += 1;
          logRecoveryConvergenceEvent(diagnostic.oscillationDetected ? "warn" : "info", "v4_recovery_stepper_convergence_pass", {
            pass: diagnostic.pass,
            maxPasses: diagnostic.maxPasses,
            effectiveReplayFromDate: diagnostic.effectiveReplayFromDate,
            changedEventCount: diagnostic.changedEventCount,
            omittedEventCount: diagnostic.omittedEventCount,
            changedEventsDigest: diagnostic.changedEventsDigest,
            changedEventsJson: JSON.stringify(diagnostic.changedEvents),
            canonicalChangedDateCount: diagnostic.canonicalChangedDateCount,
            omittedCanonicalDates: Math.max(0, diagnostic.canonicalChangedDateCount - diagnostic.canonicalChangedDates.length),
            canonicalChangedDatesDigest: diagnostic.canonicalChangedDatesDigest,
            canonicalChangedDatesJson: JSON.stringify(diagnostic.canonicalChangedDates),
            resolutionStateFingerprintBefore: diagnostic.resolutionStateFingerprintBefore,
            resolutionStateFingerprintAfter: diagnostic.resolutionStateFingerprintAfter,
            repeatedStateFromPass: diagnostic.repeatedStateFromPass,
            oscillationDetected: diagnostic.oscillationDetected,
            lifecycleBeforeReplayJson: JSON.stringify(diagnostic.lifecycleBeforeReplay),
            lifecycleAfterReplayJson: JSON.stringify(diagnostic.lifecycleAfterReplay),
            lifecycleAfterRefreshJson: JSON.stringify(diagnostic.lifecycleAfterRefresh),
            lifecycleAfterInvalidationJson: JSON.stringify(diagnostic.lifecycleAfterInvalidation),
          });
          return;
        }
        omittedConvergencePassCount += 1;
        omittedConvergencePassDigest = sha256(`${omittedConvergencePassDigest}\n${JSON.stringify(diagnostic)}`);
        omittedPassSummary = {
          firstPass: omittedPassSummary?.firstPass ?? diagnostic.pass,
          lastPass: diagnostic.pass,
          maxPasses: diagnostic.maxPasses,
          effectiveReplayFromDate: diagnostic.effectiveReplayFromDate,
          lastStateBefore: diagnostic.resolutionStateFingerprintBefore,
          lastStateAfter: diagnostic.resolutionStateFingerprintAfter,
          repeatedStateFromPass: diagnostic.repeatedStateFromPass,
          oscillationDetected: diagnostic.oscillationDetected,
          lifecycleAfterInvalidationJson: JSON.stringify(diagnostic.lifecycleAfterInvalidation),
        };
      },
    });
  } catch (error) {
    logOmittedConvergenceSummary();
    throw error;
  }
  logOmittedConvergenceSummary();
  const currentLifecycle = await client.physiologyV7Lifecycle.findUnique({ where: { profileId } });
  if (!currentLifecycle || currentLifecycle.productionStaleFromDate !== null
      || currentLifecycle.productionPublishedGeneration !== currentLifecycle.invalidationGeneration) {
    throw new Error("Production generation remains stale after derived refresh; Unified publication is withheld");
  }
  const beforePublicationRaw = await inventoryV4RecoveryRawSourcesV1(client);
  if (beforePublicationRaw.fingerprint !== beforeRaw.fingerprint) {
    throw new Error("Persisted raw sources changed during dependency refresh; publication remains blocked");
  }

  // Training and Health fences clear only after every dependent shadow and the
  // final production generation have succeeded. Revision/fromDate CAS fails closed.
  await repository.clearUnifiedPublicationBlocks({
    profileId,
    blocks: [...supported.training, ...supported.health].map((block) => ({
      source: block.source as "health" | "training",
      sourceKey: block.sourceKey,
      expectedRevision: block.revision,
      expectedFromDate: block.fromDate,
    })),
  });
  const remainingBlocks = await client.unifiedPublicationBlock.count({ where: { profileId } });
  if (remainingBlocks !== 0) throw new Error("Unrefreshed source blocks remain; V4 publication is withheld");

  const replay = await activateAndReplayUnifiedV4({ profileId, client });
  if (replay.rolloutEpoch !== 1) throw new Error("V4 recovery changed the existing rollout epoch");
  const afterRaw = await inventoryV4RecoveryRawSourcesV1(client);
  if (afterRaw.fingerprint !== beforeRaw.fingerprint) {
    throw new Error("Persisted-source V4 recovery mutated raw Health/Training inputs or provenance");
  }
  return {
    profileId,
    rolloutEpoch: replay.rolloutEpoch,
    dayCount: replay.dayCount,
    healthDatesRefreshed: supported.health.map((block) => block.sourceKey).sort(),
    trainingSessionIdsRefreshed: refreshedSessionIds,
    deletedTrainingSessionIdsReconciled: [...deletedTrainingSessionIds].sort((left, right) => left - right),
    rawInputFingerprint: afterRaw.fingerprint,
  };
  } catch (error) {
    const afterFailureRaw = await inventoryV4RecoveryRawSourcesV1(client);
    if (afterFailureRaw.fingerprint !== beforeRaw.fingerprint) {
      throw new AggregateError(
        [error, new Error(`Strict source table hashes changed: ${Object.keys(beforeRaw.tables).filter((table) => afterFailureRaw.tables[table] !== beforeRaw.tables[table]).join(", ")}`)],
        "V4 recovery failed and its raw-source preservation check detected a change",
      );
    }
    throw error;
  }
}
