import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
} from "@/model/unified-experimental-physiology-v1/contracts";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import {
  verifyUnifiedV4ReadyForTraffic,
} from "@/modules/model-episodes/unified-rollout-v4.service";
import {
  PhysiologyV7ConcurrentSourceChangeError,
  PhysiologyV7PersistenceRepository,
  readUnifiedSourceFenceV1,
  persistUnifiedShadowCandidateV1,
} from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { currentPhysiologyV7Versions } from "@/modules/model-episodes/physiology-v7-persistence";

const databaseUrl = process.env.BODYCAST_GLYCOGEN_TEST_DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
if (!parsedDatabaseUrl
    || !["127.0.0.1", "localhost", "::1"].includes(parsedDatabaseUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase())
    || !decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, "")).endsWith("_test")) {
  throw new Error("Unified glycogen PostgreSQL tests require BODYCAST_GLYCOGEN_TEST_DATABASE_URL to a loopback *_test database.");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const secondClient = new PrismaClient({ datasourceUrl: databaseUrl });
const schema = `glycogen_rollout_${process.pid}_${Math.floor(Math.random() * 1_000_000)}`;
const profileId = 1;
const migration = "20261006130000_unified_v4_glycogen_water_rollout";
const reviewedMigrations = [
  "20261002100000_active_energy_canonical_resolution",
  "20261002150000_add_production_publication_generation",
  "20261003120000_add_episode_aware_unified_experimental_physiology_v2",
  migration,
];
const modelDate = "2071-01-01";
const episodeFixture = {
  profileId,
  startDate: modelDate,
  timezone: "Europe/Bratislava",
  modelVersion: "bodycast-physiology-v6",
  active: true,
  ecfPolicy: "hold-ecf",
  baselineEnergyIntakeKcalPerDay: 2_400,
  baselineCarbIntakeG: 220,
  baselineWindowStartDate: modelDate,
  baselineWindowEndDate: modelDate,
  baselineNutritionDayCount: 1,
  baselineWeightObservationCount: 1,
  baselineWeightTrendKgPerWeek: 0,
  baselineWeightTrendPercentPerWeek: 0,
  baselineDerivationMethod: "glycogen-rollout-v4-integration",
  initialFatMassKg: 16,
  initialLeanTissueKg: 55,
  initialGlycogenKg: 0.5,
  baselineExtracellularFluidLiters: 18,
  initialExtracellularFluidDeviationLiters: 0,
  initialAdaptiveThermogenesisKcalPerDay: 0,
  initialFilteredWeightKg: 80,
  initialWeightFilterVarianceKg2: 1,
  initialRmrKcalPerDay: 1_700,
  dynamicRmrFatCoefficient: 3.2,
  dynamicRmrLeanCoefficient: 22,
  dynamicRmrCalibrationOffsetKcalPerDay: 0,
  adaptiveThermogenesisBeta: 0.14,
  adaptiveThermogenesisTimeConstantDays: 14,
  weightProcessNoiseVarianceKg2PerDay: 0.01,
  weightMeasurementNoiseVarianceKg2: 0.25,
  calibrationDiagnostics: {},
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

let migratorArtifactRoot: string;
let originalProfile: Awaited<ReturnType<typeof prisma.profile.findUnique>>;
let originalLifecycle: Awaited<ReturnType<typeof prisma.physiologyV7Lifecycle.findUnique>>;

function runRolloutTool(script: string, args: string[]): Record<string, unknown> {
  const output = execFileSync(process.execPath, [
    path.join(migratorArtifactRoot, "scripts", `${script}.mjs`),
    ...args,
  ], { cwd: process.cwd(), encoding: "utf8", env: process.env });
  return JSON.parse(output.trim()) as Record<string, unknown>;
}

function compileMigratorTool(input: { source: string; output: string }): void {
  const esbuildBin = path.resolve("node_modules/esbuild/bin/esbuild");
  const compiler = process.platform === "win32" ? process.execPath : esbuildBin;
  const compilerArgs = [
    ...(process.platform === "win32" ? [esbuildBin] : []),
    path.resolve(input.source),
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--packages=external",
    `--tsconfig=${path.resolve("tsconfig.json")}`,
    `--outfile=${path.join(migratorArtifactRoot, "scripts", input.output)}`,
  ];
  execFileSync(compiler, compilerArgs, { cwd: process.cwd(), encoding: "utf8", env: process.env });
}

async function waitForAdvisoryLockWait(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND pid <> pg_backend_pid()
      ) AS blocked
    `;
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("second PostgreSQL client did not reach the advisory-lock wait");
}

async function serializedWriterAndPublisher(firstRole: "writer" | "publisher"): Promise<void> {
  const firstReady = deferred();
  const secondStarted = deferred();
  const releaseFirst = deferred();
  const firstClient = firstRole === "writer" ? prisma : secondClient;
  const nextClient = firstRole === "writer" ? secondClient : prisma;
  const firstTransaction = firstClient.$transaction(async (tx) => {
    await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
    await tx.$queryRawUnsafe(`SELECT "id" FROM "${schema}"."LockSource" WHERE "id" = 1 FOR UPDATE`);
    firstReady.resolve();
    await releaseFirst.promise;
    await tx.$executeRawUnsafe(`UPDATE "${schema}"."LockSource" SET "value" = "value" + 1 WHERE "id" = 1`);
  }, { maxWait: 10_000, timeout: 20_000 });
  await firstReady.promise;
  const secondTransaction = nextClient.$transaction(async (tx) => {
    secondStarted.resolve();
    await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
    await tx.$queryRawUnsafe(`SELECT "id" FROM "${schema}"."LockSource" WHERE "id" = 1 FOR UPDATE`);
    await tx.$executeRawUnsafe(`UPDATE "${schema}"."LockSource" SET "value" = "value" + 1 WHERE "id" = 1`);
  }, { maxWait: 10_000, timeout: 20_000 });
  await secondStarted.promise;
  try {
    await waitForAdvisoryLockWait();
  } catch (error) {
    releaseFirst.resolve();
    await Promise.allSettled([firstTransaction, secondTransaction]);
    throw error;
  }
  releaseFirst.resolve();
  await Promise.all([firstTransaction, secondTransaction]);
  const rows = await prisma.$queryRawUnsafe<Array<{ value: number }>>(
    `SELECT "value" FROM "${schema}"."LockSource" WHERE "id" = 1`,
  );
  expect(rows[0]?.value).toBe(2);
  await prisma.$executeRawUnsafe(`UPDATE "${schema}"."LockSource" SET "value" = 0 WHERE "id" = 1`);
}

describe("Unified V4 rollout on isolated PostgreSQL", () => {
  beforeAll(async () => {
    migratorArtifactRoot = await mkdtemp(path.join(process.cwd(), "node_modules", ".glycogen-migrator-stage-"));
    await mkdir(path.join(migratorArtifactRoot, "scripts"), { recursive: true });
    for (const name of reviewedMigrations) {
      const source = path.join(process.cwd(), "prisma", "migrations", name, "migration.sql");
      const destination = path.join(migratorArtifactRoot, "prisma", "migrations", name, "migration.sql");
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(source));
    }
    compileMigratorTool({ source: "scripts/unified-v3-postflight.ts", output: "unified-v3-postflight.mjs" });
    compileMigratorTool({ source: "scripts/unified-v4-activate-replay.ts", output: "unified-v4-activate-replay.mjs" });
    compileMigratorTool({ source: "scripts/unified-v4-traffic-check.ts", output: "unified-v4-traffic-check.mjs" });
    execFileSync(process.execPath, [
      path.resolve("scripts/production-migration-image-check.mjs"),
      migratorArtifactRoot,
    ], { cwd: process.cwd(), encoding: "utf8", env: process.env });
    await Promise.all([prisma.$connect(), secondClient.$connect()]);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "${schema}"."PhysiologyV7Lifecycle" ("profileId" INTEGER PRIMARY KEY)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "${schema}"."PhysiologyV7Lifecycle" ("profileId") VALUES (7)`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "${schema}"."LockSource" ("id" INTEGER PRIMARY KEY, "value" INTEGER NOT NULL)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "${schema}"."LockSource" ("id", "value") VALUES (1, 0)`);
    originalProfile = await prisma.profile.findUnique({ where: { id: profileId } });
    originalLifecycle = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId } });
    await prisma.profile.upsert({
      where: { id: profileId },
      create: { id: profileId, sex: "male", dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), heightCm: 180 },
      update: { sex: "male", dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), heightCm: 180 },
    });
    const lifecycleFixture = {
        profileId,
        invalidationGeneration: 1,
        productionStaleFromDate: null,
        productionPublishedGeneration: 1,
        unifiedPublishedGeneration: 1,
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
        unifiedRolloutEpoch: 0,
        unifiedPublishedRolloutEpoch: null,
        ...currentPhysiologyV7Versions,
    };
    await prisma.physiologyV7Lifecycle.upsert({
      where: { profileId },
      create: lifecycleFixture,
      update: lifecycleFixture,
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await prisma.unifiedExperimentalPhysiologyStateV2.deleteMany({ where: { profileId } });
      await prisma.dailyModelState.deleteMany({ where: { episode: { profileId } } });
      await prisma.modelEpisode.deleteMany({ where: { profileId } });
      await prisma.dailyHealthData.deleteMany({ where: { date: modelDate } });
      if (originalLifecycle) {
        await prisma.physiologyV7Lifecycle.update({
          where: { profileId },
          data: {
            staleFromDate: originalLifecycle.staleFromDate,
            invalidationGeneration: originalLifecycle.invalidationGeneration,
            currentThroughDate: originalLifecycle.currentThroughDate,
            productionStaleFromDate: originalLifecycle.productionStaleFromDate,
            productionPublishedGeneration: originalLifecycle.productionPublishedGeneration,
            unifiedPublishedGeneration: originalLifecycle.unifiedPublishedGeneration,
            unifiedTargetRevision: originalLifecycle.unifiedTargetRevision,
            unifiedRolloutEpoch: originalLifecycle.unifiedRolloutEpoch,
            unifiedPublishedRolloutEpoch: originalLifecycle.unifiedPublishedRolloutEpoch,
            stateVersion: originalLifecycle.stateVersion,
            sourceNormalizationVersion: originalLifecycle.sourceNormalizationVersion,
            dailyRuntimeVersion: originalLifecycle.dailyRuntimeVersion,
            rangeRebuildVersion: originalLifecycle.rangeRebuildVersion,
            rebuildServiceVersion: originalLifecycle.rebuildServiceVersion,
            createdAt: originalLifecycle.createdAt,
            updatedAt: originalLifecycle.updatedAt,
          },
        });
      } else {
        await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId } });
      }
      if (originalProfile) {
        await prisma.profile.update({
          where: { id: profileId },
          data: {
            sex: originalProfile.sex,
            dateOfBirth: originalProfile.dateOfBirth,
            heightCm: originalProfile.heightCm,
          },
        });
      } else {
        await prisma.profile.deleteMany({ where: { id: profileId } });
      }
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await Promise.all([prisma.$disconnect(), secondClient.$disconnect()]);
      const allowedTempRoot = path.resolve(process.cwd(), "node_modules");
      const resolvedArtifactRoot = path.resolve(migratorArtifactRoot);
      if (resolvedArtifactRoot.startsWith(`${allowedTempRoot}${path.sep}`)) {
        await rm(resolvedArtifactRoot, { recursive: true, force: true });
      }
    }
  });

  it("applies the additive migration to populated lifecycle rows with V3 defaults and fail-closed checks", async () => {
    const migrationText = await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8");
    const qualified = migrationText.replaceAll('"PhysiologyV7Lifecycle"', `"${schema}"."PhysiologyV7Lifecycle"`);
    for (const statement of qualified.split(";").map((value) => value.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
    const rows = await prisma.$queryRawUnsafe<Array<{
      profileId: number; unifiedTargetRevision: string; unifiedRolloutEpoch: number;
      unifiedPublishedRolloutEpoch: number | null;
    }>>(`SELECT * FROM "${schema}"."PhysiologyV7Lifecycle" WHERE "profileId" = 7`);
    expect(rows).toEqual([{
      profileId: 7,
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
      unifiedRolloutEpoch: 0,
      unifiedPublishedRolloutEpoch: null,
    }]);
    await expect(prisma.$executeRawUnsafe(
      `UPDATE "${schema}"."PhysiologyV7Lifecycle" SET "unifiedTargetRevision" = 'unsupported' WHERE "profileId" = 7`,
    )).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(
      `UPDATE "${schema}"."PhysiologyV7Lifecycle" SET "unifiedRolloutEpoch" = -1 WHERE "profileId" = 7`,
    )).rejects.toThrow();
    await prisma.$executeRawUnsafe(
      `UPDATE "${schema}"."PhysiologyV7Lifecycle" SET "unifiedTargetRevision" = '${UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION}', "unifiedRolloutEpoch" = 1 WHERE "profileId" = 7`,
    );
  });

  it.each(["writer", "publisher"] as const)("serializes the %s-first writer/publisher order without deadlock", async (firstRole) => {
    await serializedWriterAndPublisher(firstRole);
  });

  it("requires V3 postflight before explicit V4 replay and serves only exact current physical glycogen evidence", async () => {
    const episode = await prisma.modelEpisode.create({ data: episodeFixture });
    await prisma.dailyHealthData.create({
      data: {
        date: modelDate,
        weightKg: 80,
        bodyFatPercent: 20,
        caloriesKcal: 2_200,
        proteinG: 160,
        fatG: 70,
        carbsG: 200,
        steps: 7_000,
        walkingDistanceKm: 5,
        workoutFeedObserved: true,
        rawPayload: {},
      },
    });
    await prisma.dailyModelState.create({
      data: {
        episodeId: episode.id,
        date: modelDate,
        status: "complete",
        sourceQuality: {},
        missingFields: [],
        modelVersion: "bodycast-physiology-v6",
        glycogenKg: 0.5,
        dynamicRmrKcalPerDay: 1_700,
        tefKcalPerDay: 200,
        activityKcalPerDay: 800,
        adaptiveThermogenesisKcalPerDay: 0,
        energyIntakeKcal: 2_200,
        energyExpenditureKcal: 2_700,
        energyBalanceKcal: -500,
      },
    });

    const seededLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    await prisma.physiologyV7Lifecycle.update({
      where: { profileId },
      data: {
        productionStaleFromDate: null,
        productionPublishedGeneration: seededLifecycle.invalidationGeneration,
        unifiedPublishedGeneration: null,
        unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
        unifiedRolloutEpoch: 0,
        unifiedPublishedRolloutEpoch: null,
      },
    });
    await expect(verifyUnifiedV4ReadyForTraffic({ profileId, client: prisma })).rejects.toThrow(/blocked/);
    await rebuildUnifiedExperimentalPhysiologyStateV1({
      profileId,
      client: prisma,
      targetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
      rolloutEpoch: 0,
    });
    const postflight = runRolloutTool("unified-v3-postflight", ["--profile-id", String(profileId)]);
    expect(postflight).toMatchObject({ command: "unified-v3-postflight", dayCount: 1, publishedEpoch: 0 });
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } })).unifiedPublishedRolloutEpoch).toBe(0);

    const activated = runRolloutTool("unified-v4-activate-replay", ["--activate-v4", "--owner-authorized", "--profile-id", String(profileId)]);
    expect(activated).toMatchObject({ command: "unified-v4-activate-replay", profileId, rolloutEpoch: 1, dayCount: 1, current: true });
    const current = runRolloutTool("unified-v4-traffic-check", ["--profile-id", String(profileId)]);
    expect(current).toMatchObject({ command: "unified-v4-traffic-check", profileId, rolloutEpoch: 1, dayCount: 1, ready: true });
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(lifecycle).toMatchObject({
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 1,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublishedGeneration: lifecycle.invalidationGeneration,
    });
    const row = await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episode.id, date: modelDate } },
    });
    const state = row.state as {
      glycogen: { physicalKg: number; physicalAvailability: string; physicalProvenance: string };
      glycogenWater: { physicalKg: number; deltaKg: unknown; provenance: string; physicalProvenance: string };
    };
    expect(row.modelRevision).toBe(UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION);
    expect(state.glycogen).toMatchObject({ physicalKg: 0.5, physicalAvailability: "available", physicalProvenance: "production-daily-model-state" });
    expect(state.glycogenWater).toMatchObject({ physicalKg: 1.35, provenance: "physical-glycogen-water-v4-2p7", physicalProvenance: "production-daily-model-state" });
    expect(state.glycogenWater.deltaKg).toBeNull();

    const updatedAt = row.updatedAt.toISOString();
    const retry = runRolloutTool("unified-v4-activate-replay", ["--activate-v4", "--owner-authorized", "--profile-id", String(profileId)]);
    expect(retry).toEqual(activated);
    expect((await prisma.unifiedExperimentalPhysiologyStateV2.findUniqueOrThrow({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episode.id, date: modelDate } },
    })).updatedAt.toISOString()).toBe(updatedAt);
  });

  it("aborts a derived candidate whose lifecycle source fence became stale", async () => {
    const expected = await readUnifiedSourceFenceV1(prisma, profileId);
    expect(expected).not.toBeNull();
    await prisma.$executeRaw`
      UPDATE "PhysiologyV7Lifecycle"
      SET "updatedAt" = GREATEST("updatedAt" + INTERVAL '1 millisecond', CURRENT_TIMESTAMP)
      WHERE "profileId" = ${profileId}
    `;
    const persist = async () => true;
    await expect(persistUnifiedShadowCandidateV1({
      client: prisma,
      profileId,
      expectedFence: expected,
      persist,
    })).rejects.toBeInstanceOf(PhysiologyV7ConcurrentSourceChangeError);
  });
});
