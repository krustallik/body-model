import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { PhysiologyDayResultV7 } from "@/model/physiology-v7/daily-runtime-v7";
import {
  currentPhysiologyV7Versions,
  deserializePhysiologyDayResultV7,
  mergeEarliestStaleDate,
  persistedResultFingerprint,
  serializePhysiologyDayResultV7,
  versionsAreCurrent,
} from "./physiology-v7-persistence";
import { addCalendarDays } from "./model-calendar";

type DbClient = PrismaClient | Prisma.TransactionClient;
type LifecycleInvalidationState = {
  profileId: number;
  staleFromDate: string | null;
  invalidationGeneration: number;
  currentThroughDate: string | null;
  productionStaleFromDate: string | null;
  productionPublishedGeneration: number | null;
  unifiedPublishedGeneration: number | null;
};

function isPrismaClient(client: DbClient): client is PrismaClient {
  return "$transaction" in client;
}

export class PhysiologyV7ConcurrentSourceChangeError extends Error {
  constructor() {
    super("v7 durable sources changed during rebuild; result remains stale");
  }
}

export class PhysiologyV7PersistenceRepository {
  constructor(private readonly client: DbClient = prisma) {}

  async lockProfile(profileId: number): Promise<void> {
    await this.client.$executeRaw`SELECT pg_advisory_xact_lock(927001, CAST(${profileId} AS integer))`;
  }

  async ensureLifecycle(profileId: number, requestedFromDate: string) {
    const current = await this.client.physiologyV7Lifecycle.upsert({
      where: { profileId },
      create: {
        profileId,
        staleFromDate: requestedFromDate,
        productionStaleFromDate: requestedFromDate,
        ...currentPhysiologyV7Versions,
      },
      update: {},
    });
    if (versionsAreCurrent(current)) return current;
    const earliest = await this.client.physiologyV7DailyResult.findFirst({
      where: { profileId }, orderBy: { date: "asc" }, select: { date: true },
    });
    return this.client.physiologyV7Lifecycle.update({
      where: { profileId },
      data: {
        staleFromDate: mergeEarliestStaleDate(current.staleFromDate, earliest?.date ?? requestedFromDate),
        invalidationGeneration: { increment: 1 },
        ...currentPhysiologyV7Versions,
      },
    });
  }

  async invalidate(profileId: number, affectedDate: string): Promise<LifecycleInvalidationState> {
    if (isPrismaClient(this.client)) {
      return this.client.$transaction((transaction) =>
        new PhysiologyV7PersistenceRepository(transaction).invalidate(profileId, affectedDate));
    }

    // The lifecycle bootstrap/version check and the invalidation update share
    // the caller's source transaction. The profile lock also serializes that
    // bootstrap with concurrent rebuild preparation; the date merge itself is
    // still performed atomically by PostgreSQL below.
    await this.lockProfile(profileId);
    await this.ensureLifecycle(profileId, affectedDate);

    const earliestDirtyDate = Prisma.sql`
      CASE
        WHEN "staleFromDate" IS NULL THEN ${affectedDate}
        ELSE LEAST("staleFromDate", ${affectedDate})
      END
    `;
    const earliestProductionDirtyDate = Prisma.sql`
      CASE
        WHEN "productionStaleFromDate" IS NULL THEN ${affectedDate}
        ELSE LEAST("productionStaleFromDate", ${affectedDate})
      END
    `;
    const updated = await this.client.$queryRaw<LifecycleInvalidationState[]>`
      UPDATE "PhysiologyV7Lifecycle"
      SET
        "staleFromDate" = ${earliestDirtyDate},
        "productionStaleFromDate" = ${earliestProductionDirtyDate},
        "currentThroughDate" = CASE
          WHEN "currentThroughDate" IS NOT NULL
            AND "currentThroughDate" >= ${earliestDirtyDate}
          THEN TO_CHAR((${earliestDirtyDate})::date - 1, 'YYYY-MM-DD')
          ELSE "currentThroughDate"
        END,
        "invalidationGeneration" = "invalidationGeneration" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "profileId" = ${profileId}
      RETURNING "profileId", "staleFromDate", "invalidationGeneration", "currentThroughDate",
        "productionStaleFromDate", "productionPublishedGeneration", "unifiedPublishedGeneration"
    `;
    const lifecycle = updated[0];
    if (lifecycle === undefined) {
      throw new Error(`physiology lifecycle missing for profile ${profileId} during invalidation`);
    }
    return lifecycle;
  }

  async publishProduction(input: {
    profileId: number;
    expectedGeneration: number;
  }): Promise<void> {
    const result = await this.client.physiologyV7Lifecycle.updateMany({
      where: { profileId: input.profileId, invalidationGeneration: input.expectedGeneration },
      data: {
        productionStaleFromDate: null,
        productionPublishedGeneration: input.expectedGeneration,
      },
    });
    if (result.count !== 1) throw new PhysiologyV7ConcurrentSourceChangeError();
  }

  async readRange(profileId: number, fromDate: string, toDate: string) {
    const [lifecycle, rows] = await Promise.all([
      this.client.physiologyV7Lifecycle.findUnique({ where: { profileId } }),
      this.client.physiologyV7DailyResult.findMany({
        where: { profileId, date: { gte: fromDate, lte: toDate } },
        orderBy: { date: "asc" },
      }),
    ]);
    const lifecycleCompatible = lifecycle === null || versionsAreCurrent(lifecycle);
    return rows.map((row) => {
      const compatible = versionsAreCurrent(row);
      const stale = !compatible || !lifecycleCompatible || (lifecycle?.staleFromDate !== null
        && lifecycle?.staleFromDate !== undefined && row.date >= lifecycle.staleFromDate);
      return {
        status: stale ? "stale" as const : "current" as const,
        date: row.date,
        resultFingerprint: row.resultFingerprint,
        result: deserializePhysiologyDayResultV7(row.result),
      };
    });
  }

  async readDay(profileId: number, date: string) {
    const rows = await this.readRange(profileId, date, date);
    return rows[0] ?? { status: "missing" as const, date, resultFingerprint: null, result: null };
  }

  async persistRange(input: {
    profileId: number;
    expectedGeneration: number;
    rebuiltThroughDate: string;
    days: readonly PhysiologyDayResultV7[];
  }): Promise<void> {
    const lifecycle = await this.client.physiologyV7Lifecycle.findUniqueOrThrow({
      where: { profileId: input.profileId },
    });
    if (lifecycle.invalidationGeneration !== input.expectedGeneration) {
      throw new PhysiologyV7ConcurrentSourceChangeError();
    }
    for (const day of input.days) {
      const resultFingerprint = persistedResultFingerprint(day);
      const data = {
        sourceFingerprint: day.inputSourceFingerprint,
        priorStateFingerprint: day.priorStateFingerprint,
        resultFingerprint,
        ...currentPhysiologyV7Versions,
        result: serializePhysiologyDayResultV7(day) as Prisma.InputJsonValue,
        computedAt: new Date(),
      };
      await this.client.physiologyV7DailyResult.upsert({
        where: { profileId_date: { profileId: input.profileId, date: day.date } },
        create: { profileId: input.profileId, date: day.date, ...data },
        update: data,
      });
    }
    const firstRebuiltDate = input.days[0]?.date;
    if (firstRebuiltDate === undefined || firstRebuiltDate > input.rebuiltThroughDate) {
      throw new RangeError("persisted v7 rebuild must contain its rebuilt range");
    }
    const staleWasRebuilt = lifecycle.staleFromDate !== null && lifecycle.staleFromDate >= firstRebuiltDate
      && lifecycle.staleFromDate <= input.rebuiltThroughDate;
    // Partial replay at the stale point leaves its dependent suffix stale.
    const staleFromDate = staleWasRebuilt && lifecycle.currentThroughDate !== null
      && lifecycle.currentThroughDate > input.rebuiltThroughDate
      ? addCalendarDays(input.rebuiltThroughDate, 1)
      : lifecycle.staleFromDate !== null && lifecycle.staleFromDate > input.rebuiltThroughDate
        ? lifecycle.staleFromDate
        : null;
    const currentThroughDate = staleFromDate === null
      ? input.rebuiltThroughDate
      : input.rebuiltThroughDate;
    const promoted = await this.client.physiologyV7Lifecycle.updateMany({
      where: { profileId: input.profileId, invalidationGeneration: input.expectedGeneration },
      data: {
        staleFromDate,
        currentThroughDate,
        ...currentPhysiologyV7Versions,
      },
    });
    if (promoted.count !== 1) throw new PhysiologyV7ConcurrentSourceChangeError();
  }
}

export const physiologyV7PersistenceRepository = new PhysiologyV7PersistenceRepository();
