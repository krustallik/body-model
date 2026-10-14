import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, it } from "vitest";
import { captureForensicReport } from "../../scripts/production-v4-fingerprint-forensics.mjs";

it("captures PostgreSQL 17 table and sequence digests in a read-only repeatable snapshot", async () => {
  const databaseUrl = process.env.BODYCAST_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  expect(databaseUrl).toBeTruthy();

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl! });
  const sequence = `bodycast_v4_forensics_unused_${process.pid}`;
  let report;
  try {
    await prisma.$executeRawUnsafe(`CREATE SEQUENCE public."${sequence}" START WITH 7`);
    report = await captureForensicReport("test-url", databaseUrl!);
  } finally {
    await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS public."${sequence}"`);
    await prisma.$disconnect();
  }

  expect(report.schemaVersion).toBe(1);
  expect(report.captureMethod).toBe("repeatable-read-read-only-row-json-v1");
  expect(report.identity.serverVersion).toMatch(/^17\./);
  expect(report.identity.database).toBe("bodycast_training_history_stage01_test");
  expect(report.identity.transactionReadOnly).toBe("on");
  expect(report.tables.length).toBeGreaterThan(0);
  expect(report.tables.every(({ digest }) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
  expect(report.sequences.every(({ digest, legacyDigest }) =>
    /^[a-f0-9]{64}$/.test(digest) && /^[a-f0-9]{64}$/.test(legacyDigest))).toBe(true);
  const unused = report.sequences.find(({ name }) => name === `public.${sequence}`);
  expect(unused).toBeTruthy();
  expect(unused!.legacyDigest).toBe(createHash("sha256").update(`public.${sequence}:null`).digest("hex"));
  expect(unused!.digest).toBe(createHash("sha256").update(`public.${sequence}:null:7:false`).digest("hex"));
  expect(report.logicalDataFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(report.v4ReplayInputFingerprintV2).toMatch(/^[a-f0-9]{64}$/);
  expect(report.v4ReplayInputFingerprintV3).toMatch(/^[a-f0-9]{64}$/);
  expect(report.replayInputFingerprintVersions).toEqual({
    signedBaseline: "bodycast-v4-replay-source-fingerprint-v2",
    rawParity: "bodycast-v4-replay-source-fingerprint-v3",
  });
  expect(JSON.stringify(report)).not.toContain("integration_test_password");
});
