import type { Prisma, PrismaClient } from "@prisma/client";
import type { RollbackJournalEntryV1, VisibilitySnapshotV1, VisibilityStoreV1 } from "./activation-rollback-v1";

type StoreClient = PrismaClient | Prisma.TransactionClient;

/** Persists exact visibility changes. It does not activate a production episode. */
export function prismaVisibilityStoreV1(client: StoreClient): VisibilityStoreV1 {
  return {
    async read(recordId) {
      const row = await client.workout.findUnique({
        where: { id: recordId },
        select: {
          id: true,
          hiddenFromHistory: true,
          syncProtected: true,
          supersededByWorkoutId: true,
          supersessionReason: true,
          updatedAt: true,
        },
      });
      if (row === null) return null;
      const snapshot: VisibilitySnapshotV1 = {
        recordId: row.id,
        hiddenFromHistory: row.hiddenFromHistory,
        syncProtected: row.syncProtected,
        supersededByWorkoutId: row.supersededByWorkoutId,
        supersessionReason: row.supersessionReason,
        // Flag identity only. Including updatedAt would false-conflict after our own write.
        revision: [
          row.hiddenFromHistory ? "1" : "0",
          row.syncProtected ? "1" : "0",
          String(row.supersededByWorkoutId ?? "null"),
          row.supersessionReason ?? "null",
        ].join("|"),
      };
      return snapshot;
    },
    async write(next) {
      await client.workout.update({
        where: { id: next.recordId },
        data: {
          hiddenFromHistory: next.hiddenFromHistory,
          syncProtected: next.syncProtected,
          supersededByWorkoutId: next.supersededByWorkoutId,
          supersessionReason: next.supersessionReason,
          supersededAt: next.supersededByWorkoutId === null ? null : new Date(),
        },
      });
    },
    async appendJournal(generationId, journal) {
      if (journal.length === 0) return;
      await client.activationRollbackEntry.createMany({
        data: journal.map((row) => ({
          generationId,
          recordKind: row.recordKind,
          recordId: row.recordId,
          field: row.field,
          previousValue: row.previousValue as Prisma.InputJsonValue,
          newValue: row.newValue as Prisma.InputJsonValue,
          sourceRevision: row.sourceRevision,
        })),
      });
    },
    async readJournal(generationId) {
      const rows = await client.activationRollbackEntry.findMany({
        where: { generationId },
        orderBy: { id: "asc" },
      });
      return rows.map((row): RollbackJournalEntryV1 => ({
        recordKind: row.recordKind,
        recordId: row.recordId,
        field: row.field,
        previousValue: row.previousValue,
        newValue: row.newValue,
        sourceRevision: row.sourceRevision,
      }));
    },
  };
}
