import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";

const databaseUrl = process.env.DATABASE_URL;
requireIsolatedStage01Database(databaseUrl, process.env.BODYCAST_STAGE01_MODE, "test");
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const schemaName = `relative_muscle_migration_${randomBytes(8).toString("hex")}`;
const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20261005120000_episode_relative_muscle_core/migration.sql",
);

describe("Relative Muscle episode migration on populated isolated PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
      await tx.$executeRawUnsafe(`
        CREATE TABLE "ModelEpisode" (
          "id" INTEGER PRIMARY KEY,
          "profileId" INTEGER NOT NULL,
          CONSTRAINT "ModelEpisode_id_key" UNIQUE ("id")
        )
      `);
      for (const table of ["ExperimentalSkeletalMuscleDeltaShadow", "ExperimentalCessationDetrainingShadow"]) {
        await tx.$executeRawUnsafe(`
          CREATE TABLE "${table}" (
            "id" SERIAL PRIMARY KEY,
            "profileId" INTEGER NOT NULL DEFAULT 1,
            "date" VARCHAR(10) NOT NULL,
            "sourceFingerprint" VARCHAR(64) NOT NULL,
            "modelRevision" VARCHAR(100) NOT NULL,
            "features" JSONB NOT NULL,
            "result" JSONB NOT NULL,
            "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await tx.$executeRawUnsafe(`
          CREATE UNIQUE INDEX "${table}_profileId_date_key" ON "${table}"("profileId", "date")
        `);
        await tx.$executeRawUnsafe(`
          CREATE INDEX "${table}_profileId_updatedAt_idx" ON "${table}"("profileId", "updatedAt")
        `);
      }
      await tx.$executeRawUnsafe(`INSERT INTO "ModelEpisode" ("id", "profileId") VALUES (1, 77)`);
      await tx.$executeRawUnsafe(`
        INSERT INTO "ExperimentalSkeletalMuscleDeltaShadow"
          ("profileId", "date", "sourceFingerprint", "modelRevision", "features", "result")
        VALUES (77, '2088-01-01', 'legacy-sm', 'old-relative-muscle', '{"legacy":true}', '{"kg":0.25}')
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "ExperimentalCessationDetrainingShadow"
          ("profileId", "date", "sourceFingerprint", "modelRevision", "features", "result")
        VALUES (77, '2088-01-01', 'legacy-cessation', 'old-cessation', '{"legacy":true}', '{"kg":0.25}')
      `);

      const migration = await readFile(migrationPath, "utf8");
      for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) {
        await tx.$executeRawUnsafe(statement);
      }
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await prisma.$disconnect();
  });

  it("preserves legacy evidence, marks it stale, and enforces episode-scoped identity", async () => {
    const qualifiedDelta = `"${schemaName}"."ExperimentalSkeletalMuscleDeltaShadow"`;
    const qualifiedCessation = `"${schemaName}"."ExperimentalCessationDetrainingShadow"`;
    const legacyDelta = await prisma.$queryRawUnsafe<Array<{
      modelEpisodeId: number | null; isStale: boolean; sourceFingerprint: string; result: unknown;
    }>>(`SELECT "modelEpisodeId", "isStale", "sourceFingerprint", "result" FROM ${qualifiedDelta} WHERE "profileId" = 77`);
    const legacyCessation = await prisma.$queryRawUnsafe<Array<{
      modelEpisodeId: number | null; isStale: boolean; sourceFingerprint: string; result: unknown;
    }>>(`SELECT "modelEpisodeId", "isStale", "sourceFingerprint", "result" FROM ${qualifiedCessation} WHERE "profileId" = 77`);

    expect(legacyDelta).toEqual([expect.objectContaining({
      modelEpisodeId: null, isStale: true, sourceFingerprint: "legacy-sm", result: { kg: 0.25 },
    })]);
    expect(legacyCessation).toEqual([expect.objectContaining({
      modelEpisodeId: null, isStale: true, sourceFingerprint: "legacy-cessation", result: { kg: 0.25 },
    })]);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schemaName}"."ModelEpisode" ("id", "profileId") VALUES (2, 77), (3, 77)
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO ${qualifiedDelta}
        ("profileId", "modelEpisodeId", "date", "sourceFingerprint", "modelRevision", "features", "result")
      VALUES
        (77, 2, '2088-01-01', 'episode-a', 'v2', '{}', '{"cumulative":0}'),
        (77, 3, '2088-01-01', 'episode-b', 'v2', '{}', '{"cumulative":0}')
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO ${qualifiedCessation}
        ("profileId", "modelEpisodeId", "date", "sourceFingerprint", "modelRevision", "features", "result")
      VALUES
        (77, 2, '2088-01-01', 'episode-a', 'v2', '{}', '{"cumulative":0}'),
        (77, 3, '2088-01-01', 'episode-b', 'v2', '{}', '{"cumulative":0}')
    `);

    const sameDateRows = await prisma.$queryRawUnsafe<Array<{ modelEpisodeId: number }>>(
      `SELECT "modelEpisodeId" FROM ${qualifiedDelta} WHERE "profileId" = 77 AND "date" = '2088-01-01' AND "modelEpisodeId" IS NOT NULL ORDER BY "modelEpisodeId"`,
    );
    expect(sameDateRows.map(({ modelEpisodeId }) => modelEpisodeId)).toEqual([2, 3]);
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO ${qualifiedDelta}
        ("profileId", "modelEpisodeId", "date", "sourceFingerprint", "modelRevision", "features", "result")
      VALUES (77, 2, '2088-01-01', 'duplicate', 'v2', '{}', '{}')
    `)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO ${qualifiedDelta}
        ("profileId", "modelEpisodeId", "date", "sourceFingerprint", "modelRevision", "features", "result")
      VALUES (88, 2, '2088-01-02', 'wrong-owner', 'v2', '{}', '{}')
    `)).rejects.toThrow();

    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = '${schemaName}'`,
    );
    expect(indexes.map(({ indexname }) => indexname)).toContain(
      "RelMuscleDelta_episode_date_key",
    );
    expect(indexes.map(({ indexname }) => indexname)).toContain(
      "RelMuscleCessation_episode_date_key",
    );
    expect(indexes.map(({ indexname }) => indexname)).not.toContain(
      "ExperimentalSkeletalMuscleDeltaShadow_profileId_date_key",
    );
    expect(indexes.map(({ indexname }) => indexname)).not.toContain(
      "ExperimentalCessationDetrainingShadow_profileId_date_key",
    );
    const sameDateCessationRows = await prisma.$queryRawUnsafe<Array<{ modelEpisodeId: number }>>(
      `SELECT "modelEpisodeId" FROM ${qualifiedCessation} WHERE "profileId" = 77 AND "date" = '2088-01-01' AND "modelEpisodeId" IS NOT NULL ORDER BY "modelEpisodeId"`,
    );
    expect(sameDateCessationRows.map(({ modelEpisodeId }) => modelEpisodeId)).toEqual([2, 3]);
    const constraints = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
      `SELECT conname FROM pg_constraint WHERE connamespace = (SELECT oid FROM pg_namespace WHERE nspname = '${schemaName}')`,
    );
    expect(constraints.map(({ conname }) => conname)).toContain(
      "RelMuscleDelta_episode_profile_fkey",
    );
    expect(constraints.map(({ conname }) => conname)).toContain(
      "RelMuscleCessation_episode_profile_fkey",
    );
  });
});
