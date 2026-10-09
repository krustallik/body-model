import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
} from "@/model/unified-experimental-physiology-v1/contracts";
import { UnifiedExperimentalPhysiologySourceLoaderV1 } from "@/model/unified-experimental-physiology-v1/source-loader";
import {
  buildTransientEpisodePartitionsV2,
  transientEpisodeTimeForInstantV2,
} from "./transient-exercise-water-episode-time-v2";
import { addCalendarDays } from "./model-calendar";
import { localDateTimeToInstant } from "@/model/time-zone";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { calculateGlycogenAssociatedWaterKg } from "@/model/body-composition/state";
import { physicalGlycogenWaterDeltaV4 } from "@/model/body-composition/physical-glycogen-water-v4";
import { PhysiologyV7ConcurrentSourceChangeError, PhysiologyV7PersistenceRepository } from "./physiology-v7-persistence.repository";
import {
  buildUnifiedRangeCandidatesV1,
  rebuildUnifiedExperimentalPhysiologyStateV1,
  sourceLineage,
  unifiedRangeToken,
} from "./unified-experimental-physiology-state.service";

type DbClient = PrismaClient | Prisma.TransactionClient;
type RolloutRevision = typeof UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION | typeof UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function canonicalJsonEquivalent(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return left === right || (Number.isFinite(left) && Number.isFinite(right)
      && Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 4);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => canonicalJsonEquivalent(value, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index]
        && canonicalJsonEquivalent(leftRecord[key], rightRecord[key]));
  }
  return left === right;
}

function jsonDifferencePaths(left: unknown, right: unknown, path = "$", limit = 12): string[] {
  if (stableSha256(left) === stableSha256(right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const differences: string[] = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length && differences.length < limit; index += 1) {
      differences.push(...jsonDifferencePaths(left[index], right[index], `${path}[${index}]`, limit - differences.length));
    }
    return differences.length > 0 ? differences : [path];
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    const differences: string[] = [];
    for (const key of keys) {
      if (differences.length >= limit) break;
      differences.push(...jsonDifferencePaths(leftRecord[key], rightRecord[key], `${path}.${key}`, limit - differences.length));
    }
    return differences.length > 0 ? differences : [path];
  }
  return [path];
}

async function expectedRange(client: DbClient, profileId: number) {
  const episodes = await client.modelEpisode.findMany({
    where: { profileId },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, startDate: true, timezone: true, active: true, deactivatedAt: true },
  });
  if (episodes.length === 0) throw new Error("postflight refuses an empty episode inventory");
  const partitions = buildTransientEpisodePartitionsV2(episodes);
  const first = partitions[0];
  const last = partitions.at(-1);
  if (!first || !last || !first.startInstant) throw new Error("postflight refuses missing episode boundaries");
  const [latestDurable, completedSessions] = await Promise.all([
    client.dailyHealthData.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    client.strengthDiarySession.findMany({
      where: { profileId, status: "COMPLETED" },
      select: {
        effectiveAccountingAt: true, webStartedAt: true, createdAt: true,
        matchedWorkout: { select: { startAt: true } },
      },
    }),
  ]);
  const latestSessionModelDate = completedSessions
    .map((session) => transientEpisodeTimeForInstantV2(
      partitions,
      session.matchedWorkout?.startAt ?? session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt,
    )?.modelDate ?? null)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1) ?? null;
  const throughDate = [latestDurable?.date, latestSessionModelDate, first.episode.startDate, last.episode.startDate]
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1)!;
  const throughInstant = localDateTimeToInstant(
    addCalendarDays(throughDate, 1),
    "00:00",
    last.episode.timezone,
  );
  if (throughInstant.getTime() <= first.startInstant.getTime()) throw new Error("postflight range has no episode boundary");
  const range = await new UnifiedExperimentalPhysiologySourceLoaderV1(client as PrismaClient).loadRange({
    profileId,
    fromInstant: first.startInstant,
    throughInstant,
  });
  if (range.days.length === 0 || range.days[0]?.boundaryAt !== first.startInstant.toISOString()) {
    throw new Error("postflight expected range is empty or does not start at the episode boundary");
  }
  return range;
}

async function assertRevisionCoverage(input: {
  client: DbClient;
  profileId: number;
  revision: RolloutRevision;
  range: Awaited<ReturnType<typeof expectedRange>>;
}): Promise<void> {
  const { client, profileId, revision, range } = input;
  const rows = await client.unifiedExperimentalPhysiologyStateV2.findMany({
    where: {
      profileId,
      boundaryAt: { gte: new Date(range.fromInstant), lt: new Date(range.throughInstant) },
    },
    orderBy: { boundaryAt: "asc" },
    select: {
      modelEpisodeId: true, date: true, boundaryAt: true, modelRevision: true,
      priorStateFingerprint: true, resultFingerprint: true, sourceFingerprint: true,
      state: true, deltas: true, uncertainty: true, reconciliation: true,
      energyLedger: true, sourceLineage: true, diagnostics: true,
      qualityStatus: true, gapSeverity: true,
    },
  });
  if (rows.length !== range.days.length) {
    throw new Error(`postflight coverage mismatch: expected ${range.days.length}, found ${rows.length}`);
  }
  const expectedResults = buildUnifiedRangeCandidatesV1({ profileId, days: range.days, targetRevision: revision });
  for (let index = 0; index < range.days.length; index += 1) {
    const day = range.days[index]!;
    const row = rows[index]!;
    const expected = expectedResults[index]!;
    const mismatchFields: string[] = [];
    if (row.modelRevision !== revision) mismatchFields.push("revision");
    if (row.modelEpisodeId !== day.modelEpisodeId) mismatchFields.push("episode");
    if (row.date !== day.date) mismatchFields.push("date");
    if (row.boundaryAt.toISOString() !== new Date(day.boundaryAt).toISOString()) mismatchFields.push("boundary");
    if (row.priorStateFingerprint !== expected.priorStateFingerprint) mismatchFields.push("predecessor");
    if (row.sourceFingerprint !== expected.sourceFingerprint) mismatchFields.push("source-fingerprint");
    if (row.resultFingerprint !== expected.resultFingerprint) mismatchFields.push("result-fingerprint");
    if (row.qualityStatus !== expected.quality.availability) mismatchFields.push("quality");
    if (row.gapSeverity !== expected.quality.gapSeverity) mismatchFields.push("gap-severity");
    if (!canonicalJsonEquivalent(row.state, expected.state)) {
      mismatchFields.push(`state:${jsonDifferencePaths(row.state, expected.state).join("|")}`);
    }
    if (!canonicalJsonEquivalent(row.deltas, expected.deltas)) {
      mismatchFields.push(`deltas:${jsonDifferencePaths(row.deltas, expected.deltas).join("|")}`);
    }
    if (!canonicalJsonEquivalent(row.uncertainty, expected.uncertainty)) mismatchFields.push("uncertainty");
    if (!canonicalJsonEquivalent(row.reconciliation, expected.reconciliation)) mismatchFields.push("reconciliation");
    if (!canonicalJsonEquivalent(row.energyLedger, expected.energyLedger)) mismatchFields.push("energy-ledger");
    if (stableSha256(row.sourceLineage) !== stableSha256(expected.sourceLineage)
        || stableSha256(row.sourceLineage) !== stableSha256(sourceLineage(day))) mismatchFields.push("source-lineage");
    if (!canonicalJsonEquivalent(row.diagnostics, expected.diagnostics)) mismatchFields.push("diagnostics");
    if (mismatchFields.length > 0) {
      throw new Error(`postflight mismatch at ${day.modelEpisodeId}/${day.date}: ${mismatchFields.join(",")}`);
    }
    if (revision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION) {
      const state = object(row.state);
      const glycogen = object(state.glycogen);
      const water = object(state.glycogenWater);
      const glycogenKg = glycogen.physicalKg;
      const waterKg = water.physicalKg;
      const deltas = object(row.deltas);
      const deltaGEnvelope = deltas.glycogenKg;
      const deltaWaterEnvelope = deltas.glycogenWaterKg;
      const deltaG = deltaGEnvelope === null ? null : object(deltaGEnvelope).point;
      const deltaWater = deltaWaterEnvelope === null ? null : object(deltaWaterEnvelope).point;
      if (glycogen.physicalAvailability === "available") {
        if (!finite(glycogenKg) || glycogenKg < 0 || !finite(waterKg) || Math.abs(waterKg - calculateGlycogenAssociatedWaterKg(glycogenKg)) > 1e-9) {
          throw new Error(`postflight physical glycogen/water mismatch at ${day.modelEpisodeId}/${day.date}`);
        }
      } else if (glycogenKg !== null || waterKg !== null) {
        throw new Error(`postflight unavailable physical glycogen has a numeric value at ${day.modelEpisodeId}/${day.date}`);
      }
      if (deltaG === null || deltaWater === null) {
        if (deltaG !== null || deltaWater !== null) throw new Error(`postflight partial glycogen transition at ${day.modelEpisodeId}/${day.date}`);
      } else if (!finite(deltaG) || !finite(deltaWater) || Math.abs(deltaWater - physicalGlycogenWaterDeltaV4(deltaG)!) > 1e-9) {
        throw new Error(`postflight noncanonical glycogen transition at ${day.modelEpisodeId}/${day.date}`);
      }
    }
  }
}

export async function verifyPublishedV4Current(client: PrismaClient, profileId: number, rolloutEpoch: number): Promise<number> {
  const captured = await expectedRange(client, profileId);
  const capturedToken = unifiedRangeToken(profileId, captured.fromInstant, captured.throughInstant, captured.days);
  await client.$transaction(async (tx) => {
    await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
    const lifecycle = await tx.physiologyV7Lifecycle.findUnique({ where: { profileId } });
    if (!lifecycle || lifecycle.unifiedTargetRevision !== UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION
        || lifecycle.unifiedRolloutEpoch !== rolloutEpoch
        || lifecycle.unifiedPublishedRolloutEpoch !== rolloutEpoch
        || lifecycle.productionStaleFromDate !== null
        || lifecycle.productionPublishedGeneration !== lifecycle.invalidationGeneration
        || lifecycle.unifiedPublishedGeneration !== lifecycle.invalidationGeneration) {
      throw new PhysiologyV7ConcurrentSourceChangeError();
    }
    const finalRange = await expectedRange(tx, profileId);
    if (unifiedRangeToken(profileId, finalRange.fromInstant, finalRange.throughInstant, finalRange.days) !== capturedToken) {
      throw new PhysiologyV7ConcurrentSourceChangeError();
    }
    await assertRevisionCoverage({ client: tx, profileId, revision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION, range: finalRange });
  });
  return captured.days.length;
}

export async function verifyUnifiedV4ReadyForTraffic(input: {
  profileId?: number;
  client?: PrismaClient;
} = {}): Promise<{ profileId: number; rolloutEpoch: number; dayCount: number }> {
  const client = input.client ?? prisma;
  const profileId = input.profileId ?? 1;
  const lifecycle = await client.physiologyV7Lifecycle.findUnique({ where: { profileId } });
  if (!lifecycle || lifecycle.unifiedTargetRevision !== UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION
      || lifecycle.unifiedRolloutEpoch < 1
      || lifecycle.unifiedPublishedRolloutEpoch !== lifecycle.unifiedRolloutEpoch
      || lifecycle.unifiedPublishedGeneration !== lifecycle.invalidationGeneration
      || lifecycle.productionPublishedGeneration !== lifecycle.invalidationGeneration
      || lifecycle.productionStaleFromDate !== null) {
    throw new Error("Forecast V2 serving is blocked until Unified V4 is current");
  }
  const dayCount = await verifyPublishedV4Current(client, profileId, lifecycle.unifiedRolloutEpoch);
  return { profileId, rolloutEpoch: lifecycle.unifiedRolloutEpoch, dayCount };
}

function sameLifecycle(left: {
  invalidationGeneration: number;
  productionStaleFromDate: string | null;
  productionPublishedGeneration: number | null;
  unifiedPublishedGeneration: number | null;
  unifiedTargetRevision: string;
  unifiedRolloutEpoch: number;
  unifiedPublishedRolloutEpoch: number | null;
  updatedAt: Date;
}, right: typeof left): boolean {
  return left.invalidationGeneration === right.invalidationGeneration
    && left.productionStaleFromDate === right.productionStaleFromDate
    && left.productionPublishedGeneration === right.productionPublishedGeneration
    && left.unifiedPublishedGeneration === right.unifiedPublishedGeneration
    && left.unifiedTargetRevision === right.unifiedTargetRevision
    && left.unifiedRolloutEpoch === right.unifiedRolloutEpoch
    && left.unifiedPublishedRolloutEpoch === right.unifiedPublishedRolloutEpoch
    && left.updatedAt.toISOString() === right.updatedAt.toISOString();
}

export async function verifyAndPublishUnifiedV3Postflight(input: {
  profileId?: number;
  client?: PrismaClient;
} = {}): Promise<{ profileId: number; dayCount: number; rangeToken: string }> {
  const client = input.client ?? prisma;
  const profileId = input.profileId ?? 1;
  const lifecycle = await client.physiologyV7Lifecycle.findUnique({ where: { profileId } });
  if (!lifecycle || lifecycle.unifiedTargetRevision !== UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION
      || lifecycle.unifiedRolloutEpoch !== 0 || lifecycle.productionStaleFromDate !== null
      || lifecycle.productionPublishedGeneration !== lifecycle.invalidationGeneration
      || lifecycle.unifiedPublishedGeneration !== lifecycle.invalidationGeneration) {
    throw new Error("V3 postflight lifecycle/generation is not current");
  }
  const range = await expectedRange(client, profileId);
  const capturedToken = unifiedRangeToken(profileId, range.fromInstant, range.throughInstant, range.days);
  await assertRevisionCoverage({ client, profileId, revision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION, range });
  await client.$transaction(async (tx) => {
    await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
    const current = await tx.physiologyV7Lifecycle.findUnique({ where: { profileId } });
    if (!current || !sameLifecycle(lifecycle, current)
        || current.unifiedTargetRevision !== UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION
        || current.unifiedRolloutEpoch !== 0) throw new PhysiologyV7ConcurrentSourceChangeError();
    const finalRange = await expectedRange(tx, profileId);
    if (unifiedRangeToken(profileId, finalRange.fromInstant, finalRange.throughInstant, finalRange.days) !== capturedToken) {
      throw new PhysiologyV7ConcurrentSourceChangeError();
    }
    await assertRevisionCoverage({ client: tx, profileId, revision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION, range: finalRange });
    const published = await tx.physiologyV7Lifecycle.updateMany({
      where: {
        profileId,
        invalidationGeneration: current.invalidationGeneration,
        productionPublishedGeneration: current.invalidationGeneration,
        productionStaleFromDate: null,
        unifiedPublishedGeneration: current.invalidationGeneration,
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
        unifiedRolloutEpoch: 0,
      },
      data: { unifiedPublishedRolloutEpoch: 0 },
    });
    if (published.count !== 1) throw new PhysiologyV7ConcurrentSourceChangeError();
  });
  return { profileId, dayCount: range.days.length, rangeToken: capturedToken };
}

export async function activateAndReplayUnifiedV4(input: {
  profileId?: number;
  client?: PrismaClient;
} = {}): Promise<{ profileId: number; rolloutEpoch: number; dayCount: number }> {
  const client = input.client ?? prisma;
  const profileId = input.profileId ?? 1;
  const rollout = await client.$transaction(async (tx) => {
    await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
    const lifecycle = await tx.physiologyV7Lifecycle.findUnique({ where: { profileId } });
    if (!lifecycle || lifecycle.productionStaleFromDate !== null
        || lifecycle.productionPublishedGeneration !== lifecycle.invalidationGeneration) {
      throw new Error("V4 activation requires current production state");
    }
    if (lifecycle.unifiedTargetRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION
        && lifecycle.unifiedRolloutEpoch > 0
        && lifecycle.unifiedPublishedRolloutEpoch === lifecycle.unifiedRolloutEpoch
        && lifecycle.unifiedPublishedGeneration === lifecycle.invalidationGeneration) {
      return { epoch: lifecycle.unifiedRolloutEpoch, alreadyCurrent: true };
    }
    if (lifecycle.unifiedTargetRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION) {
      if (lifecycle.unifiedRolloutEpoch !== 0 || lifecycle.unifiedPublishedRolloutEpoch !== 0
          || lifecycle.unifiedPublishedGeneration !== lifecycle.invalidationGeneration) {
        throw new Error("V4 activation requires a successfully published V3 postflight epoch 0");
      }
      const changed = await tx.physiologyV7Lifecycle.updateMany({
        where: {
          profileId,
          invalidationGeneration: lifecycle.invalidationGeneration,
          unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
          unifiedRolloutEpoch: 0,
          unifiedPublishedRolloutEpoch: 0,
        },
        data: {
          unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
          unifiedRolloutEpoch: { increment: 1 },
          unifiedPublishedRolloutEpoch: null,
          unifiedPublishedGeneration: null,
        },
      });
      if (changed.count !== 1) throw new PhysiologyV7ConcurrentSourceChangeError();
      return { epoch: 1, alreadyCurrent: false };
    }
    if (lifecycle.unifiedTargetRevision !== UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION
        || lifecycle.unifiedRolloutEpoch < 1 || lifecycle.unifiedPublishedRolloutEpoch !== null) {
      throw new Error("V4 lifecycle is not in an explicitly replayable state");
    }
    return { epoch: lifecycle.unifiedRolloutEpoch, alreadyCurrent: false };
  });
  if (rollout.alreadyCurrent) {
    const dayCount = await verifyPublishedV4Current(client, profileId, rollout.epoch);
    return { profileId, rolloutEpoch: rollout.epoch, dayCount };
  }
  await rebuildUnifiedExperimentalPhysiologyStateV1({
    profileId,
    client,
    targetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
    rolloutEpoch: rollout.epoch,
  });
  const dayCount = await verifyPublishedV4Current(client, profileId, rollout.epoch);
  return { profileId, rolloutEpoch: rollout.epoch, dayCount };
}
