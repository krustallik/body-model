import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
process.env.DATABASE_URL = databaseUrl;

const { prisma } = await import("@/lib/db/prisma");
const { TrainingService } = await import("@/modules/training/training.service");
const { LEGACY_LOAD_CONFIGS_V1, calculateLoadAccountingV1 } = await import("@/modules/training/load-accounting-v1");
const { CANONICAL_EXERCISE_IDENTITIES } = await import("@/modules/training/canonical-exercise-identity");

const profileId = 1;
const newKeys = [
  "bulgarian_split_squat",
  "forward_dumbbell_lunge",
  "goblet_squat",
  "dumbbell_crunch",
  "dumbbell_russian_twist",
] as const;
const newKeySet = new Set<string>(newKeys);
const service = new TrainingService(prisma);
const migrationSql = readFileSync(
  "prisma/migrations/20261017120000_add_five_training_exercises/migration.sql",
  "utf8",
);
const createdProgramIds: number[] = [];

describe("five-exercise additive catalog migration on isolated PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const identity = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const expected = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (identity[0]?.current_database !== expected) throw new Error("Prisma is not connected to the guarded test database.");
  });

  afterAll(async () => {
    if (createdProgramIds.length > 0) {
      await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds }, profileId } });
    }
    await prisma.$disconnect();
  });

  it("reapplies the exact SQL twice, adds exactly five stable rows, and preserves prior catalog rows", async () => {
    const before = await prisma.exerciseCatalog.findMany({
      where: { profileId },
      orderBy: { id: "asc" },
      select: { id: true, name: true, stableKey: true, isActive: true },
    });
    const beforeExisting = before.filter((row) => !newKeySet.has(row.stableKey ?? ""));

    await prisma.$executeRawUnsafe(migrationSql);
    await prisma.$executeRawUnsafe(migrationSql);

    const after = await prisma.exerciseCatalog.findMany({
      where: { profileId },
      orderBy: { id: "asc" },
      select: { id: true, name: true, stableKey: true, isActive: true },
    });
    const additions = after.filter((row) => newKeySet.has(row.stableKey ?? ""));
    expect(additions).toHaveLength(5);
    expect(new Set(additions.map(({ stableKey }) => stableKey))).toEqual(newKeySet);
    expect(additions.every((row) => row.isActive)).toBe(true);
    expect(after.filter((row) => !newKeySet.has(row.stableKey ?? ""))).toEqual(beforeExisting);
    expect(new Set(after.map(({ stableKey }) => stableKey).filter((key): key is string => key !== null)).size)
      .toBe(after.filter(({ stableKey }) => stableKey !== null).length);
    expect(after.length).toBe(before.length + newKeys.filter((key) => !before.some((row) => row.stableKey === key)).length);
  });

  it("creates and edits a program with immutable unilateral load snapshots", async () => {
    const rows = await prisma.exerciseCatalog.findMany({
      where: { profileId, stableKey: { in: [...newKeys] } },
      select: { id: true, stableKey: true },
    });
    const idByKey = new Map(rows.map(({ id, stableKey }) => [stableKey!, id]));
    expect(idByKey.size).toBe(5);
    const createInput = {
      name: "Synthetic five exercise integration program",
      exercises: newKeys.map((key, order) => ({
        catalogId: idByKey.get(key)!,
        plannedSets: 3,
        resistanceType: "EXTERNAL_WEIGHT" as const,
        order,
      })),
    };
    const created = await service.createProgram(createInput, profileId);
    createdProgramIds.push(created.id);
    expect(created.exercises).toHaveLength(5);
    for (const exercise of created.exercises) {
      const stableKey = rows.find(({ id }) => id === exercise.catalogId)?.stableKey;
      expect(exercise.loadAccountingConfigSnapshot).toEqual(LEGACY_LOAD_CONFIGS_V1[stableKey as typeof newKeys[number]]);
    }

    const edited = await service.updateProgram(created.id, {
      name: "Synthetic edited five exercise integration program",
      exercises: [...createInput.exercises].reverse().map((exercise, order) => ({ ...exercise, order })),
    }, profileId);
    expect(edited.name).toBe("Synthetic edited five exercise integration program");
    expect(created.currentVersionNumber).toBe(1);
    expect(edited.currentVersionNumber).toBe(2);
    expect(edited.exercises).toHaveLength(5);
    const unilateral = edited.exercises.filter((exercise) => {
      const key = rows.find(({ id }) => id === exercise.catalogId)?.stableKey;
      return key === "bulgarian_split_squat" || key === "forward_dumbbell_lunge";
    });
    expect(unilateral).toHaveLength(2);
    for (const exercise of unilateral) {
      expect(exercise.loadAccountingConfigSnapshot).toMatchObject({
        accountingKind: "external-per-implement-pair-per-side",
        inventoryCount: 2,
        loadedSides: 2,
        execution: "unilateral",
        repsMeaning: "per-side",
      });
    }
    const load = calculateLoadAccountingV1({
      localDate: "2042-03-15",
      exercises: unilateral.map((exercise) => ({
        identity: { status: "canonical-snapshot" as const, stableKey: rows.find(({ id }) => id === exercise.catalogId)!.stableKey },
        configSnapshot: exercise.loadAccountingConfigSnapshot as typeof LEGACY_LOAD_CONFIGS_V1["bulgarian_split_squat"],
        resistanceHint: "external",
        sets: [{ reps: 6, weightKg: 11, bandNominalResistanceKg: null }],
      })),
    });
    expect(load.externalLoadVolume.value).toBe(528);
    expect(CANONICAL_EXERCISE_IDENTITIES.filter(({ stableKey }) => newKeySet.has(stableKey))).toHaveLength(5);
  });
});
