import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FULL_HISTORY_RAW_INPUT_TABLES,
  inventoryFullHistoryRawInputs,
} from "@/modules/model-episodes/full-history-recalculation.service";

const databaseUrl = process.env.BODYCAST_RECOVERY_TEST_DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
if (!parsedDatabaseUrl
    || !["127.0.0.1", "localhost", "::1"].includes(parsedDatabaseUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase())
    || !decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, "")).endsWith("_test")) {
  throw new Error("Full-history raw-input inventory integration requires a loopback *_test database.");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const metric = `full-history-preservation-${process.pid}`;
const sampleTimestamp = new Date("2098-01-01T00:00:00.000Z");

describe("full-history raw-input inventory PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.healthMetricSample.deleteMany({ where: { metric } });
    await prisma.healthMetricSample.create({
      data: {
        date: "2098-01-01",
        metric,
        source: "isolated-preservation-fixture",
        timestamp: sampleTimestamp,
        value: new Prisma.Decimal("71.2500000000"),
      },
    });
  });

  afterAll(async () => {
    await prisma.healthMetricSample.deleteMany({ where: { metric } });
    await prisma.$disconnect();
  });

  it("covers primary health, nutrition, workout, strength, and provenance tables", () => {
    expect(FULL_HISTORY_RAW_INPUT_TABLES).toEqual(expect.arrayContaining([
      "DailyHealthData",
      "HealthMetricSample",
      "HeartRateSample",
      "RestingHeartRateSample",
      "SleepSegment",
      "HealthSyncSnapshot",
      "HealthSyncAudit",
      "HealthActivityInterval",
      "Workout",
      "StrengthDiarySession",
      "StrengthSessionExercise",
      "StrengthSet",
      "WorkInterval",
      "ActiveEnergyCandidate",
      "ActiveEnergyResolutionRevision",
    ]));
  });

  it("detects a source value change even when row identity and timestamps are unchanged", async () => {
    const before = await inventoryFullHistoryRawInputs(prisma);
    const beforeTable = before.tables.find((table) => table.table === "HealthMetricSample");
    expect(beforeTable?.rowCount).toBeGreaterThan(0);

    await prisma.healthMetricSample.updateMany({
      where: { metric },
      data: { value: new Prisma.Decimal("71.2500000001") },
    });

    const after = await inventoryFullHistoryRawInputs(prisma);
    const afterTable = after.tables.find((table) => table.table === "HealthMetricSample");
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(afterTable?.contentSha256).not.toBe(beforeTable?.contentSha256);
  });
});
