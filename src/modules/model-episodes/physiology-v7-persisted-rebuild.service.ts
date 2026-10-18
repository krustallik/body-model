import { prisma } from "@/lib/db/prisma";
import { addCalendarDays } from "./model-calendar";
import {
  PhysiologyV7RuntimeService,
} from "./physiology-v7-runtime.service";
import { physiologyV7RuntimeRepository } from "./physiology-v7-runtime.repository";
import {
  PhysiologyV7PersistenceRepository,
  physiologyV7PersistenceRepository,
} from "./physiology-v7-persistence.repository";
import { createUnavailablePhysiologyRuntimeStateV7, type PhysiologyRuntimeStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import { assertTrainingRefreshWorkerLeaseInTransaction } from "@/modules/training/training-refresh-worker-context";

export const PHYSIOLOGY_V7_PERSISTED_REBUILD_VERSION =
  "bodycast-physiology-v7-persisted-rebuild-1" as const;

export class PhysiologyV7PersistedRebuildService {
  constructor(
    private readonly runtime = new PhysiologyV7RuntimeService(physiologyV7RuntimeRepository),
    private readonly persistence = physiologyV7PersistenceRepository,
  ) {}

  async rebuild(input: {
    profileId?: number;
    fromDate: string;
    toDate: string;
    timeZone: string;
    historyFromDate?: string;
    initialState?: PhysiologyRuntimeStateV7;
    beforePromotion?: () => Promise<void>;
    onProgress?: () => Promise<void> | void;
  }) {
    const profileId = input.profileId ?? 1;
    const prepared = await prisma.$transaction(async (tx) => {
      const repository = new PhysiologyV7PersistenceRepository(tx);
      await repository.lockProfile(profileId);
      return repository.ensureLifecycle(profileId, input.fromDate);
    });
    const effectiveFromDate = prepared.staleFromDate !== null
      && prepared.staleFromDate <= input.toDate
      ? prepared.staleFromDate
      : input.fromDate;
    let initialState = input.initialState ?? createUnavailablePhysiologyRuntimeStateV7();
    if (effectiveFromDate !== input.fromDate) {
      const predecessor = await this.persistence.readDay(
        profileId,
        addCalendarDays(effectiveFromDate, -1),
      );
      if (predecessor.status !== "current" || predecessor.result === null) {
        // Some callers deliberately provide a new explicit origin state
        // (notably the diagnostic V7 shadow rebuild). If the stale cache
        // starts before their requested range and no predecessor is current,
        // replay from that stale boundary with the caller's seed. Never infer
        // a predecessor or silently do this when the caller supplied none.
        if (input.initialState === undefined) {
          throw new Error("v7 rebuild has no compatible current predecessor");
        }
        initialState = input.initialState;
      } else {
        initialState = predecessor.result.resultingState;
      }
    }
    const rebuild = await this.runtime.rebuildProfileRange({
      profileId,
      fromDate: effectiveFromDate,
      toDate: input.toDate,
      historyFromDate: input.historyFromDate !== undefined
        && input.historyFromDate < effectiveFromDate
        ? input.historyFromDate
        : effectiveFromDate,
      timeZone: input.timeZone,
      initialState,
      onProgress: input.onProgress,
    });
    await input.beforePromotion?.();
    await prisma.$transaction(async (tx) => {
      const repository = new PhysiologyV7PersistenceRepository(tx);
      // The generation remains unpublished while candidate rows are written.
      // Acquire the source/worker fence only after these private upserts, so a
      // large range cannot hold up Training CRUD or block worker heartbeats.
      const { firstRebuiltDate } = await repository.persistRangeCandidates({
        profileId,
        expectedGeneration: prepared.invalidationGeneration,
        rebuiltThroughDate: input.toDate,
        days: rebuild.days,
      });
      await repository.lockProfile(profileId);
      await assertTrainingRefreshWorkerLeaseInTransaction(tx, profileId);
      await repository.promotePersistedRange({
        profileId,
        expectedGeneration: prepared.invalidationGeneration,
        rebuiltThroughDate: input.toDate,
        firstRebuiltDate,
      });
      await assertTrainingRefreshWorkerLeaseInTransaction(tx, profileId);
    }, { maxWait: 10_000, timeout: 30_000 });
    return {
      persistedRebuildVersion: PHYSIOLOGY_V7_PERSISTED_REBUILD_VERSION,
      effectiveFromDate,
      persistedDayCount: rebuild.days.length,
      invalidationGeneration: prepared.invalidationGeneration,
      fingerprint: rebuild.fingerprint,
      days: rebuild.days,
    };
  }
}

export const physiologyV7PersistedRebuildService = new PhysiologyV7PersistedRebuildService();

export function rebuildAndPersistPhysiologyForProfileRangeV7(input: Parameters<PhysiologyV7PersistedRebuildService["rebuild"]>[0]) {
  return physiologyV7PersistedRebuildService.rebuild(input);
}
