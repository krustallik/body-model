import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { requireIsolatedStage01Database } from "../../src/modules/training/testing/require-isolated-database";
import {
  backfillLegacyWeightProvenance,
  summarizeLegacyWeightProvenanceBackfill,
} from "../../src/modules/health/legacy-weight-provenance-backfill";

describe("legacy Apple weight provenance PostgreSQL correction", () => {
  let db: PrismaClient | undefined;

  beforeAll(async () => {
    requireIsolatedStage01Database(process.env.DATABASE_URL, process.env.BODYCAST_STAGE01_MODE, "test");
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    await db.$connect();
  }, 60_000);

  afterAll(async () => {
    await db?.$disconnect();
  }, 60_000);

  it("updates only reviewed legacy weight rows, keeps frozen snapshots immutable, and is idempotent", async () => {
    const client = db!;
    const { TrainingService } = await import("../../src/modules/training/training.service");
    const service = new TrainingService(client);
    const profileId = 1;
    const catalog = await client.exerciseCatalog.findUniqueOrThrow({
      where: { profileId_stableKey: { profileId, stableKey: "pull_up" } },
      select: { id: true },
    });
    const program = await service.createProgram({
      name: `provenance-backfill-${Date.now()}`,
      exercises: [{ catalogId: catalog.id, plannedSets: 1, resistanceType: "BODYWEIGHT" }],
    }, profileId);
    let sessionId: number | null = null;
    const sampleIds: number[] = [];
    try {
      const session = await service.startSession(program.id, profileId, "Europe/Bratislava");
      sessionId = session.id;
      const localDate = "2010-01-15";
      await client.strengthDiarySession.update({
        where: { id: session.id },
        data: {
          effectiveAccountingAt: new Date("2010-01-15T11:00:00.000Z"),
          accountingTimeZone: "Europe/Bratislava",
          accountingTimeZoneProvenance: "integration-fixture",
        },
      });
      await service.createSet(session.id, session.exercises[0]!.id, { reps: 18 }, profileId);

      const original = await service.materializeSessionAccounting(session.id, profileId);
      expect(original.loadAccountingV1?.bodyweight.reference.status).toBe("unavailable");
      const originalSnapshot = await client.strengthSessionAccountingSnapshot.findUniqueOrThrow({
        where: { sessionId_snapshotRevision: { sessionId: session.id, snapshotRevision: original.snapshotRevision! } },
        select: { snapshotRevision: true, accountingInputRevision: true, inputFingerprint: true, payload: true, createdAt: true },
      });
      const originalPointer = (await client.strengthDiarySession.findUniqueOrThrow({
        where: { id: session.id },
        select: { currentSnapshotRevision: true },
      })).currentSnapshotRevision;

      const legacy = await client.healthMetricSample.create({
        data: {
          date: localDate,
          metric: "weight-kg",
          source: null,
          timestamp: new Date("2010-01-15T10:00:00.000Z"),
          value: 89.8,
          createdAt: new Date("2010-01-15T10:05:00.000Z"),
        },
      });
      sampleIds.push(legacy.id);
      const alreadyMarked = await client.healthMetricSample.create({
        data: {
          date: "2010-02-01",
          metric: "weight-kg",
          source: "apple-health-shortcut",
          timestamp: new Date("2010-02-01T10:00:00.000Z"),
          value: 91.2,
        },
      });
      sampleIds.push(alreadyMarked.id);
      const nonWeight = await client.healthMetricSample.create({
        data: {
          date: localDate,
          metric: "step-count",
          source: null,
          timestamp: new Date("2010-01-15T10:00:00.000Z"),
          value: 500,
        },
      });
      sampleIds.push(nonWeight.id);
      const legacyCreatedAt = legacy.createdAt;

      const reviewed = await summarizeLegacyWeightProvenanceBackfill(client);
      expect(reviewed).toEqual({ count: 1, minDate: localDate, maxDate: localDate });
      const result = await client.$transaction(
        (transaction: Prisma.TransactionClient) => backfillLegacyWeightProvenance(transaction, reviewed),
        { isolationLevel: "Serializable" },
      );
      expect(result.updatedCount).toBe(1);
      expect(result.remaining).toEqual({ count: 0, minDate: null, maxDate: null });

      const correctedLegacy = await client.healthMetricSample.findUniqueOrThrow({ where: { id: legacy.id } });
      expect(correctedLegacy).toMatchObject({
        id: legacy.id,
        date: legacy.date,
        metric: "weight-kg",
        source: "apple-health-shortcut",
        timestamp: legacy.timestamp,
        value: legacy.value,
        createdAt: legacyCreatedAt,
      });
      expect(await client.healthMetricSample.findUniqueOrThrow({ where: { id: alreadyMarked.id } })).toEqual(alreadyMarked);
      expect(await client.healthMetricSample.findUniqueOrThrow({ where: { id: nonWeight.id } })).toEqual(nonWeight);
      expect((await client.strengthDiarySession.findUniqueOrThrow({
        where: { id: session.id }, select: { currentSnapshotRevision: true },
      })).currentSnapshotRevision).toBe(originalPointer);
      expect(await client.strengthSessionAccountingSnapshot.findUniqueOrThrow({
        where: { sessionId_snapshotRevision: { sessionId: session.id, snapshotRevision: originalSnapshot.snapshotRevision } },
        select: { snapshotRevision: true, accountingInputRevision: true, inputFingerprint: true, payload: true, createdAt: true },
      })).toEqual(originalSnapshot);

      const noOpScope = await summarizeLegacyWeightProvenanceBackfill(client);
      expect(noOpScope).toEqual({ count: 0, minDate: null, maxDate: null });
      const repeated = await client.$transaction(
        (transaction: Prisma.TransactionClient) => backfillLegacyWeightProvenance(transaction, noOpScope),
        { isolationLevel: "Serializable" },
      );
      expect(repeated.updatedCount).toBe(0);

      const refreshed = await service.refreshSessionAccounting(session.id, profileId, `legacy-weight-backfill-${session.id}`);
      expect(refreshed.loadAccountingV1?.bodyweight.reference).toMatchObject({
        status: "observed", valueKg: 89.8, localDate, source: "apple-health-shortcut", sourceId: String(legacy.id),
      });
      const historicalAfterRefresh = await client.strengthSessionAccountingSnapshot.findUniqueOrThrow({
        where: { sessionId_snapshotRevision: { sessionId: session.id, snapshotRevision: originalSnapshot.snapshotRevision } },
        select: { snapshotRevision: true, accountingInputRevision: true, inputFingerprint: true, payload: true, createdAt: true },
      });
      expect(historicalAfterRefresh).toEqual(originalSnapshot);
      expect((await client.strengthDiarySession.findUniqueOrThrow({
        where: { id: session.id }, select: { currentSnapshotRevision: true },
      })).currentSnapshotRevision).toBe(refreshed.snapshotRevision);
    } finally {
      if (sampleIds.length > 0) await client.healthMetricSample.deleteMany({ where: { id: { in: sampleIds } } });
      if (sessionId !== null) await client.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      await client.trainingProgram.deleteMany({ where: { id: program.id } });
    }
  }, 60_000);
});
