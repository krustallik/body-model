import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import { TrainingRepository } from "@/modules/training/training.repository";

const prisma = new PrismaClient();
const trainingRepository = new TrainingRepository(prisma);
const profileA = 991001;
const profileB = 991002;
const profileSeed = 991003;

async function clean(profileIds: number[] = [profileA, profileB, profileSeed]): Promise<void> {
  await prisma.exerciseCatalog.deleteMany({ where: { profileId: { in: profileIds } } });
}

describe("ExerciseCatalog stable identity with PostgreSQL", () => {
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("exposes all thirteen migrated canonical rows through the catalog repository surface", async () => {
    const rows = (await trainingRepository.listCatalog({ profileId: 1, activeOnly: false }))
      .filter((row) => CANONICAL_EXERCISE_IDENTITIES.some((exercise) => exercise.displayName === row.name));

    expect(rows).toHaveLength(13);
    expect(new Map(rows.map((row) => [row.name, row.stableKey]))).toEqual(new Map(
      CANONICAL_EXERCISE_IDENTITIES.map((exercise) => [exercise.displayName, exercise.stableKey]),
    ));
    expect(rows.every((row) => row.stableKey != null)).toBe(true);
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
    expect(keyed).toHaveLength(13);
    expect(new Map(keyed.map((row) => [row.stableKey, row.name]))).toEqual(new Map(
      CANONICAL_EXERCISE_IDENTITIES.map((exercise) => [exercise.stableKey, exercise.displayName]),
    ));

    const secondProfile = profileSeed + 1;
    await clean([secondProfile]);
    await trainingRepository.ensureCanonicalExerciseCatalog(secondProfile);
    const fresh = await trainingRepository.listCatalog({ profileId: secondProfile, activeOnly: false });
    expect(fresh).toHaveLength(13);
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
    expect(afterCatalog).toEqual(beforeCatalog);
    expect(await prisma.strengthDiarySession.count()).toBe(beforeSessions);
    expect(await prisma.trainingProgram.count()).toBe(beforePrograms);
    expect(await prisma.programExercise.count()).toBe(beforeProgramExercises);
    expect(await prisma.strengthSet.count()).toBe(beforeSets);
    expect(beforeCatalog).toHaveLength(13);
  });
});
