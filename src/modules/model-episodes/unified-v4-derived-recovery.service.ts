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

async function readConsistentRecoveryEvidenceV1(client: PrismaClient, profileId: number) {
  return client.$transaction(async (tx) => {
    const lifecycle = await tx.physiologyV7Lifecycle.findUnique({ where: { profileId } });
    if (!lifecycle) throw new Error("Persisted-source V4 recovery has no lifecycle row");
    const blocks = await tx.unifiedPublicationBlock.findMany({
      where: { profileId },
      orderBy: [{ source: "asc" }, { sourceKey: "asc" }],
      select: { source: true, sourceKey: true, fromDate: true, revision: true },
    });
    const raw = await inventoryV4RecoveryRawSourcesV1(tx as unknown as PrismaClient);
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

function assertSupportedBlockSet(blocks: readonly PublicationBlock[]): {
  health: PublicationBlock[];
  training: PublicationBlock[];
} {
  const health = blocks.filter((block) => block.source === "health");
  const training = blocks.filter((block) => block.source === "training")
    .sort((left, right) => Number(left.sourceKey) - Number(right.sourceKey));
  const identities = new Set(blocks.map((block) => `${block.source}\0${block.sourceKey}`));
  if (health.length + training.length !== blocks.length
      || identities.size !== blocks.length
      || health.some((block) => block.sourceKey !== block.fromDate || !validDate(block.fromDate))
      || blocks.some((block) => !Number.isSafeInteger(block.revision) || block.revision < 1)
      || training.some((block) => !/^[1-9]\d*$/.test(block.sourceKey)
        || !Number.isSafeInteger(Number(block.sourceKey)) || !validDate(block.fromDate))) {
    throw new Error("V4 derived recovery found an unsupported publication block set");
  }
  return { health, training };
}

/** Hash exact persisted JSONB rows. Unlike the full-history inventory this does
 * not omit, coalesce, or normalize any stored source field. */
export async function inventoryV4RecoveryRawSourcesV1(client: PrismaClient): Promise<{
  fingerprint: string;
  tables: Record<string, string>;
}> {
  const digest = createHash("sha256").update("bodycast-v4-recovery-raw-sources-v2\0");
  const tables: Record<string, string> = {};
  const immutableTables = [
    ...FULL_HISTORY_RAW_INPUT_TABLES,
    // Recovery must consume, never rematerialize, persisted Training accounting.
    "StrengthSessionAccountingSnapshot",
    "StrengthSessionAccountingOperation",
  ] as const;
  for (const table of immutableTables) {
    const rawRowExpression = table === "ModelEpisode"
      ? `to_jsonb(source_row) - ARRAY['personalOffsetKcalPerDay', 'activityCalibration', 'calibrationStatus', 'calibrationDiagnostics', 'latestModeledDate', 'updatedAt']::text[]`
      : "to_jsonb(source_row)";
    const rows = await client.$queryRawUnsafe<Array<{ id: number; raw_row: string }>>(
      `SELECT source_row.id, (${rawRowExpression})::text AS raw_row
       FROM public."${table}" AS source_row
       ORDER BY source_row.id`,
    );
    const tableDigest = createHash("sha256").update(`${table}\0${rows.length}\0`);
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || typeof row.raw_row !== "string") {
        throw new Error(`V4 strict source fingerprint returned invalid ${table} row`);
      }
      tableDigest.update(`${row.id}:${Buffer.byteLength(row.raw_row, "utf8")}:${row.raw_row}\n`);
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
  for (const block of supported.training) {
    const sessionId = Number(block.sourceKey);
    await assertPersistedTrainingSessionRecoveryReadyV1({ sessionId, profileId });
    const currentBlock = await client.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: block.sourceKey } },
      select: { revision: true, fromDate: true },
    });
    if (currentBlock === null || currentBlock.revision !== block.revision || currentBlock.fromDate !== block.fromDate) {
      throw new Error(`Training source fence changed during recovery preflight (${block.sourceKey}); recovery stopped`);
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
  for (const block of supported.training) {
    const sessionId = Number(block.sourceKey);
    await assertPersistedTrainingSessionRecoveryReadyV1({ sessionId, profileId });
    const currentBlock = await client.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "training", sourceKey: block.sourceKey } },
      select: { revision: true, fromDate: true },
    });
    if (currentBlock === null || currentBlock.revision !== block.revision || currentBlock.fromDate !== block.fromDate) {
      throw new Error("Training publication fence changed before dependent refresh; recovery stopped");
    }
    await refreshPersistedTrainingSessionDependenciesV1({
      sessionId, profileId,
      expectedTrainingFence: { revision: block.revision, fromDate: block.fromDate },
    });
    refreshedSessionIds.push(sessionId);
  }

  await recalculateActiveEnergyChangesV1({ skipTrainingAccountingMaterialization: true });
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
