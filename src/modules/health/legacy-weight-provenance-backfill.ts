import type { Prisma } from "@prisma/client";
import { invalidateStepperMassDependenciesInTransactionV1 } from "@/modules/activity/active-energy-invalidation";

export const LEGACY_WEIGHT_PROVENANCE_BACKFILL_WHERE = {
  metric: "weight-kg",
  source: null,
} satisfies Prisma.HealthMetricSampleWhereInput;

export const LEGACY_WEIGHT_PROVENANCE_BACKFILL_SOURCE = "apple-health-shortcut" as const;

export type LegacyWeightProvenanceBackfillSummary = {
  count: number;
  minDate: string | null;
  maxDate: string | null;
};

type HealthMetricSampleClient = Pick<Prisma.TransactionClient, "healthMetricSample">;

export async function summarizeLegacyWeightProvenanceBackfill(
  client: HealthMetricSampleClient,
): Promise<LegacyWeightProvenanceBackfillSummary> {
  const aggregate = await client.healthMetricSample.aggregate({
    where: LEGACY_WEIGHT_PROVENANCE_BACKFILL_WHERE,
    _count: { _all: true },
    _min: { date: true },
    _max: { date: true },
  });
  return {
    count: aggregate._count._all,
    minDate: aggregate._min.date,
    maxDate: aggregate._max.date,
  };
}

function sameSummary(
  left: LegacyWeightProvenanceBackfillSummary,
  right: LegacyWeightProvenanceBackfillSummary,
): boolean {
  return left.count === right.count
    && left.minDate === right.minDate
    && left.maxDate === right.maxDate;
}

/** Must be called inside a transaction. Only the source marker is updated. */
export async function backfillLegacyWeightProvenance(
  transaction: HealthMetricSampleClient,
  expected: LegacyWeightProvenanceBackfillSummary,
): Promise<{ before: LegacyWeightProvenanceBackfillSummary; updatedCount: number; remaining: LegacyWeightProvenanceBackfillSummary }> {
  const before = await summarizeLegacyWeightProvenanceBackfill(transaction);
  if (!sameSummary(before, expected)) {
    throw new Error("Legacy weight provenance scope changed since dry-run; no rows were accepted for correction.");
  }
  if (before.count === 0) return { before, updatedCount: 0, remaining: before };

  const measurements = await transaction.healthMetricSample.findMany({
    where: LEGACY_WEIGHT_PROVENANCE_BACKFILL_WHERE,
    select: { timestamp: true },
    orderBy: [{ timestamp: "asc" }, { id: "asc" }],
  });

  const updated = await transaction.healthMetricSample.updateMany({
    where: LEGACY_WEIGHT_PROVENANCE_BACKFILL_WHERE,
    data: { source: LEGACY_WEIGHT_PROVENANCE_BACKFILL_SOURCE },
  });
  const remaining = await summarizeLegacyWeightProvenanceBackfill(transaction);
  if (updated.count !== expected.count || remaining.count !== 0) {
    throw new Error("Legacy weight provenance correction did not match its reviewed scope; transaction must roll back.");
  }
  if ("workout" in transaction && "modelEpisode" in transaction
      && "activeEnergyCanonicalEvent" in transaction && "physiologyV7Lifecycle" in transaction) {
    await invalidateStepperMassDependenciesInTransactionV1({
      tx: transaction as Prisma.TransactionClient,
      profileId: 1,
      measurementDates: [],
      measurementInstants: measurements.map((row) => row.timestamp),
    });
  }
  return { before, updatedCount: updated.count, remaining };
}
