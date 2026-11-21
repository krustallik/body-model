import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";
import {
  ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES,
  CANONICAL_EXERCISE_IDENTITIES,
} from "@/modules/training/canonical-exercise-identity";
import { TrainingRepository } from "@/modules/training/training.repository";

requireIsolatedStage01Database(process.env.DATABASE_URL, process.env.BODYCAST_STAGE01_MODE, "test");

const prisma = new PrismaClient();
const trainingRepository = new TrainingRepository(prisma);
const profileA = 991001;
const profileB = 991002;
const profileSeed = 991003;
const profileFixtures = [profileA, profileB, profileSeed, profileSeed + 1];
const profilesCreatedBySuite: number[] = [];

async function clean(profileIds: number[] = profileFixtures): Promise<void> {
  await prisma.exerciseCatalog.deleteMany({ where: { profileId: { in: profileIds } } });
}

describe("ExerciseCatalog stable identity with PostgreSQL", () => {
  beforeAll(async () => {
    for (const id of profileFixtures) {
      if (await prisma.profile.findUnique({ where: { id }, select: { id: true } })) continue;
      await prisma.profile.create({ data: { id } });
      profilesCreatedBySuite.push(id);
    }
  });

  afterAll(async () => {
    try {
      await clean();
      if (profilesCreatedBySuite.length > 0) {
        await prisma.profile.deleteMany({ where: { id: { in: profilesCreatedBySuite } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it("exposes all fifty canonical rows through the catalog repository surface", async () => {
    const existing = await prisma.exerciseCatalog.findMany({
      where: {
        profileId: 1,
        OR: [
          { stableKey: { in: ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES.map(({ stableKey }) => stableKey) } },
          { name: { in: ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES.map(({ displayName }) => displayName) } },
        ],
      },
      select: { id: true },
    });
    const preexistingIds = new Set(existing.map(({ id }) => id));

    try {
      const rows = (await trainingRepository.listCatalog({ profileId: 1, activeOnly: false }))
        .filter((row) => CANONICAL_EXERCISE_IDENTITIES.some((exercise) => exercise.displayName === row.name));

      expect(rows).toHaveLength(50);
      expect(new Map(rows.map((row) => [row.name, row.stableKey]))).toEqual(new Map(
        CANONICAL_EXERCISE_IDENTITIES.map((exercise) => [exercise.displayName, exercise.stableKey]),
      ));
      expect(rows.every((row) => row.stableKey != null)).toBe(true);
      const repeated = (await trainingRepository.listCatalog({ profileId: 1, activeOnly: false }))
        .filter((row) => CANONICAL_EXERCISE_IDENTITIES.some((exercise) => exercise.displayName === row.name));
      expect(repeated.map(({ id, stableKey }) => [id, stableKey])).toEqual(rows.map(({ id, stableKey }) => [id, stableKey]));
    } finally {
      const insertedIds = (await prisma.exerciseCatalog.findMany({
        where: {
          profileId: 1,
          OR: [
            { stableKey: { in: ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES.map(({ stableKey }) => stableKey) } },
            { name: { in: ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES.map(({ displayName }) => displayName) } },
          ],
        },
        select: { id: true },
      })).map(({ id }) => id).filter((id) => !preexistingIds.has(id));
      if (insertedIds.length > 0) {
        await prisma.exerciseCatalog.deleteMany({ where: { profileId: 1, id: { in: insertedIds } } });
      }
    }
  });

  it("fails closed when a Profile 1 catalog name conflicts with a new stable identity", async () => {
    const identity = ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES[0]!;
    const relatedBefore = await prisma.exerciseCatalog.findMany({
      where: {
        profileId: 1,
        OR: [
          { stableKey: { in: ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES.map(({ stableKey }) => stableKey) } },
          { name: { in: ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES.map(({ displayName }) => displayName) } },
        ],
      },
      select: { id: true, name: true, stableKey: true },
    });
    const byName = relatedBefore.find(({ name }) => name === identity.displayName);
    const byKey = relatedBefore.find(({ stableKey }) => stableKey === identity.stableKey);
    const existing = byName ?? byKey;
    const wrongStableKey = `profile_one_conflict_${Date.now()}`;
    let conflictId: number;

    if (existing) {
      const conflict = await prisma.exerciseCatalog.update({
        where: { id: existing.id },
        data: { name: identity.displayName, stableKey: wrongStableKey },
        select: { id: true },
      });
      conflictId = conflict.id;
    } else {
      const conflict = await prisma.exerciseCatalog.create({
        data: { profileId: 1, name: identity.displayName, stableKey: wrongStableKey },
        select: { id: true },
      });
      conflictId = conflict.id;
    }

    try {
      await expect(trainingRepository.listCatalog({ profileId: 1, activeOnly: false }))
        .rejects.toThrow(/ExerciseCatalog conflict for front_foot_elevated_split_squat/);
      const relatedRows = await prisma.exerciseCatalog.findMany({
        where: {
          profileId: 1,
          OR: [
            { stableKey: { in: ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES.map(({ stableKey }) => stableKey) } },
            { name: { in: ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES.map(({ displayName }) => displayName) } },
          ],
        },
        select: { id: true, name: true, stableKey: true },
        orderBy: { id: "asc" },
      });
      expect(relatedRows).toEqual([
        ...relatedBefore.filter(({ id }) => id !== existing?.id),
        { id: conflictId, name: identity.displayName, stableKey: wrongStableKey },
      ].sort((left, right) => left.id - right.id));
    } finally {
      if (existing) {
        await prisma.exerciseCatalog.update({
          where: { id: existing.id },
          data: { name: existing.name, stableKey: existing.stableKey },
        });
      } else {
        await prisma.exerciseCatalog.delete({ where: { id: conflictId } });
      }
    }
  });

  it("allows null custom identity, scopes non-null uniqueness by profile, and preserves keys on rename", async () => {
    await clean([profileA, profileB]);
    const custom = await prisma.exerciseCatalog.create({
      data: { profileId: profileA, name: "custom-unmapped", stableKey: null },
    });
    expect(custom.stableKey).toBeNull();

    const first = await prisma.exerciseCatalog.create({
      data: { profileId: profileA, name: "canonical-a", stableKey: "portable_test_key" },
    });
    const renamed = await prisma.exerciseCatalog.update({
      where: { id: first.id },
      data: { name: "renamed-canonical-a" },
      select: { id: true, name: true, stableKey: true },
    });
    expect(renamed).toEqual({ id: first.id, name: "renamed-canonical-a", stableKey: "portable_test_key" });

    await expect(prisma.exerciseCatalog.create({
      data: { profileId: profileA, name: "canonical-conflict", stableKey: "portable_test_key" },
    })).rejects.toMatchObject({ code: "P2002" });

    const otherProfile = await prisma.exerciseCatalog.create({
      data: { profileId: profileB, name: "canonical-b", stableKey: "portable_test_key" },
    });
    expect(otherProfile.stableKey).toBe("portable_test_key");
  });

  it("upserts the same portable keys regardless of insertion order and numeric ids", async () => {
    await clean([profileSeed]);
    const reversed = [...CANONICAL_EXERCISE_IDENTITIES].reverse();
    for (const exercise of reversed) {
      await prisma.exerciseCatalog.create({
        data: {
          profileId: profileSeed,
          name: exercise.displayName,
          stableKey: null,
        },
      });
    }

    const ensured = await trainingRepository.ensureCanonicalExerciseCatalog(profileSeed);
    const keyed = ensured.filter((row) => row.stableKey != null);
    expect(keyed).toHaveLength(50);
    expect(new Map(keyed.map((row) => [row.stableKey, row.name]))).toEqual(new Map(
      CANONICAL_EXERCISE_IDENTITIES.map((exercise) => [exercise.stableKey, exercise.displayName]),
    ));

    const secondProfile = profileSeed + 1;
    await clean([secondProfile]);
    await trainingRepository.ensureCanonicalExerciseCatalog(secondProfile);
    await trainingRepository.ensureCanonicalExerciseCatalog(secondProfile);
    const fresh = await trainingRepository.listCatalog({ profileId: secondProfile, activeOnly: false });
    expect(fresh).toHaveLength(50);
    expect(new Set(fresh.map((row) => row.stableKey))).toEqual(
      new Set(CANONICAL_EXERCISE_IDENTITIES.map((exercise) => exercise.stableKey)),
    );
    expect(fresh.map((row) => row.id).sort((a, b) => a - b)).not.toEqual(
      keyed.map((row) => row.id).sort((a, b) => a - b),
    );
    await clean([secondProfile]);
  });

  it("refuses to silently overwrite a conflicting non-null stableKey during upsert", async () => {
    await clean([profileA]);
    const conflicted = CANONICAL_EXERCISE_IDENTITIES[0]!;
    await prisma.exerciseCatalog.create({
      data: {
        profileId: profileA,
        name: conflicted.displayName,
        stableKey: "conflicting_preexisting_key",
      },
    });

    await expect(trainingRepository.ensureCanonicalExerciseCatalog(profileA))
      .rejects.toThrow(/stableKey conflict/);
  });

  it("leaves historical session FKs and muscleMappingSnapshot untouched when re-ensuring profile 1", async () => {
    const beforeExercises = await prisma.strengthSessionExercise.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        sourceExerciseCatalogId: true,
        muscleMappingSnapshot: true,
        snapshotExerciseName: true,
      },
    });
    const beforeCatalog = await prisma.exerciseCatalog.findMany({
      where: { profileId: 1, stableKey: { not: null } },
      orderBy: { id: "asc" },
      select: { id: true, name: true, stableKey: true },
    });
    const beforeSessions = await prisma.strengthDiarySession.count();
    const beforePrograms = await prisma.trainingProgram.count();
    const beforeProgramExercises = await prisma.programExercise.count();
    const beforeSets = await prisma.strengthSet.count();

    const beforeCatalogIds = new Set(beforeCatalog.map(({ id }) => id));
    try {
      await trainingRepository.ensureCanonicalExerciseCatalog(1);

      const afterExercises = await prisma.strengthSessionExercise.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          sourceExerciseCatalogId: true,
          muscleMappingSnapshot: true,
          snapshotExerciseName: true,
        },
      });
      const afterCatalog = await prisma.exerciseCatalog.findMany({
        where: { profileId: 1, stableKey: { not: null } },
        orderBy: { id: "asc" },
        select: { id: true, name: true, stableKey: true },
      });

      expect(afterExercises).toEqual(beforeExercises);
      expect(afterCatalog.filter(({ id }) => beforeCatalogIds.has(id))).toEqual(beforeCatalog);
      const afterCatalogByKey = new Map(afterCatalog.map(({ stableKey, name }) => [stableKey, name]));
      for (const identity of ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES) {
        expect(afterCatalogByKey.get(identity.stableKey)).toBe(identity.displayName);
      }
      expect(await prisma.strengthDiarySession.count()).toBe(beforeSessions);
      expect(await prisma.trainingProgram.count()).toBe(beforePrograms);
      expect(await prisma.programExercise.count()).toBe(beforeProgramExercises);
      expect(await prisma.strengthSet.count()).toBe(beforeSets);
      expect(afterCatalog.length).toBeGreaterThanOrEqual(beforeCatalog.length);
    } finally {
      const insertedIds = (await prisma.exerciseCatalog.findMany({
        where: {
          profileId: 1,
          stableKey: { in: ADDITIONAL_CANONICAL_EXERCISE_IDENTITIES.map(({ stableKey }) => stableKey) },
        },
        select: { id: true },
      })).map(({ id }) => id).filter((id) => !beforeCatalogIds.has(id));
      if (insertedIds.length > 0) {
        await prisma.exerciseCatalog.deleteMany({ where: { profileId: 1, id: { in: insertedIds } } });
      }
    }
  });
});
