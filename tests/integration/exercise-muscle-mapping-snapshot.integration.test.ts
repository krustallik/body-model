import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildExerciseMuscleMappingSnapshotV7,
  parseExerciseMuscleMappingSnapshotV7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  applyNullMuscleMappingSnapshotBackfill,
  reportNullMuscleMappingSnapshotBackfill,
} from "@/modules/training/exercise-mapping-snapshot";
import {
  parseExerciseAnatomySnapshotFromCombinedV1,
  resolveStoredExerciseAnatomySnapshotV1,
} from "@/modules/training/exercise-anatomy-mapping-v1";
import { TrainingRepository } from "@/modules/training/training.repository";
import { TrainingService } from "@/modules/training/training.service";
import { RESISTANCE } from "@/modules/training/training.constants";

const prisma = new PrismaClient();
const repo = new TrainingRepository(prisma);
const service = new TrainingService(prisma, repo);
const profileId = 991101;

async function clean(): Promise<void> {
  await prisma.strengthSet.deleteMany({
    where: { sessionExercise: { session: { profileId } } },
  });
  await prisma.strengthSessionExercise.deleteMany({
    where: { session: { profileId } },
  });
  await prisma.strengthDiarySession.deleteMany({ where: { profileId } });
  await prisma.programExercise.deleteMany({
    where: { programVersion: { program: { profileId } } },
  });
  await prisma.trainingProgramVersion.deleteMany({
    where: { program: { profileId } },
  });
  await prisma.trainingProgram.deleteMany({ where: { profileId } });
  await prisma.exerciseCatalog.deleteMany({ where: { profileId } });
}

describe("V7 and anatomy mapping snapshots with PostgreSQL", () => {
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("stores approved immutable mapping snapshots on live start and leaves them after catalog rename", async () => {
    await clean();
    const press = await prisma.exerciseCatalog.create({
      data: {
        profileId,
        name: "slice1-press",
        stableKey: "seated_dumbbell_press",
      },
    });
    const custom = await prisma.exerciseCatalog.create({
      data: {
        profileId,
        name: "slice1-custom",
        stableKey: null,
      },
    });
    const program = await service.createProgram({
      name: "slice1-live",
      exercises: [
        {
          catalogId: press.id,
          plannedSets: 3,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        },
        {
          catalogId: custom.id,
          plannedSets: 2,
          resistanceType: RESISTANCE.BODYWEIGHT,
        },
      ],
    }, profileId);

    const session = await service.startSession(program.id, profileId);
    expect(session.exercises).toHaveLength(2);
    expect(parseExerciseMuscleMappingSnapshotV7(session.exercises[0]?.muscleMappingSnapshot)).toEqual(
      buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press"),
    );
    expect(parseExerciseAnatomySnapshotFromCombinedV1(session.exercises[0]?.muscleMappingSnapshot)).toMatchObject({
      availability: "available",
      stableKey: "seated_dumbbell_press",
      mappingVersion: "bodycast-exercise-anatomy-mapping-v1",
      provenance: "versioned-registry-snapshot",
    });
    expect(parseExerciseMuscleMappingSnapshotV7(session.exercises[1]?.muscleMappingSnapshot)).toEqual(
      buildExerciseMuscleMappingSnapshotV7(null),
    );
    expect(parseExerciseAnatomySnapshotFromCombinedV1(session.exercises[1]?.muscleMappingSnapshot)).toMatchObject({
      availability: "unavailable",
      reason: "missing-stable-key",
    });

    const before = session.exercises[0]?.muscleMappingSnapshot;
    await prisma.exerciseCatalog.update({
      where: { id: press.id },
      data: { name: "slice1-press-renamed" },
    });
    const after = await service.getSession(session.id, profileId);
    expect(after?.exercises[0]?.muscleMappingSnapshot).toEqual(before);
    expect(after?.exercises[0]?.snapshotExerciseName).toBe("slice1-press");
  });

  it("backfills only eligible null snapshots and never overwrites existing ones", async () => {
    await clean();
    const keyed = await prisma.exerciseCatalog.create({
      data: {
        profileId,
        name: "slice1-hyper",
        stableKey: "hyperextension",
      },
    });
    const custom = await prisma.exerciseCatalog.create({
      data: {
        profileId,
        name: "slice1-unmapped",
        stableKey: null,
      },
    });
    const program = await service.createProgram({
      name: "slice1-backfill",
      exercises: [
        {
          catalogId: keyed.id,
          plannedSets: 3,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        },
        {
          catalogId: custom.id,
          plannedSets: 2,
          resistanceType: RESISTANCE.BODYWEIGHT,
        },
      ],
    }, profileId);
    const session = await service.startSession(program.id, profileId);

    // Force one historical-style null while leaving the other snapshot intact.
    await prisma.strengthSessionExercise.update({
      where: { id: session.exercises[0]!.id },
      data: { muscleMappingSnapshot: Prisma.DbNull },
    });
    const preexisting = buildExerciseMuscleMappingSnapshotV7("flat_dumbbell_fly");
    await prisma.strengthSessionExercise.update({
      where: { id: session.exercises[1]!.id },
      data: {
        muscleMappingSnapshot: preexisting,
        sourceExerciseCatalogId: custom.id,
      },
    });

    const dryRun = await reportNullMuscleMappingSnapshotBackfill(prisma, profileId);
    expect(dryRun.totalNullSnapshotRows).toBe(1);
    expect(dryRun.eligibleMappedRows).toBe(1);
    expect(dryRun.stableKeysInvolved).toEqual(["hyperextension"]);

    const applied = await applyNullMuscleMappingSnapshotBackfill(prisma, {
      dryRun: false,
      profileId,
    });
    expect(applied.updatedRows).toBe(1);

    const refreshed = await service.getSession(session.id, profileId);
    expect(refreshed?.exercises[0]?.muscleMappingSnapshot).toEqual(
      buildExerciseMuscleMappingSnapshotV7("hyperextension"),
    );
    expect(refreshed?.exercises[1]?.muscleMappingSnapshot).toEqual(preexisting);
    expect(resolveStoredExerciseAnatomySnapshotV1(refreshed?.exercises[0]?.muscleMappingSnapshot)).toMatchObject({
      availability: "available",
      provenance: "retrospective-interpretation",
      stableKey: "hyperextension",
      sourceSnapshotMappingVersion: "bodycast-exercise-muscle-mapping-v7.2",
    });
  });

  it("preserves snapshots through program reconciliation and exercise editing", async () => {
    await clean();
    const press = await prisma.exerciseCatalog.create({
      data: { profileId, name: "slice1-preserve-press", stableKey: "seated_dumbbell_press" },
    });
    const fly = await prisma.exerciseCatalog.create({
      data: { profileId, name: "slice1-new-fly", stableKey: "flat_dumbbell_fly" },
    });
    const firstProgram = await service.createProgram({
      name: "slice1-preserve-source",
      exercises: [{ catalogId: press.id, plannedSets: 3, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
    }, profileId);
    const nextProgram = await service.createProgram({
      name: "slice1-preserve-target",
      exercises: [
        { catalogId: press.id, plannedSets: 4, resistanceType: RESISTANCE.EXTERNAL_WEIGHT },
        { catalogId: fly.id, plannedSets: 2, resistanceType: RESISTANCE.EXTERNAL_WEIGHT },
      ],
    }, profileId);

    const session = await service.startSession(firstProgram.id, profileId);
    const originalSnapshot = session.exercises[0]?.muscleMappingSnapshot;
    const reconciled = await service.changeSessionProgram(session.id, { programId: nextProgram.id }, profileId);
    expect(reconciled.exercises).toHaveLength(2);
    const kept = reconciled.exercises.find(({ sourceExerciseCatalogId }) => sourceExerciseCatalogId === press.id)!;
    const added = reconciled.exercises.find(({ sourceExerciseCatalogId }) => sourceExerciseCatalogId === fly.id)!;
    expect(kept.muscleMappingSnapshot).toEqual(originalSnapshot);
    expect(parseExerciseAnatomySnapshotFromCombinedV1(added.muscleMappingSnapshot)).toMatchObject({
      availability: "available",
      stableKey: "flat_dumbbell_fly",
      provenance: "versioned-registry-snapshot",
    });

    const edited = await service.updateSessionExercise(session.id, kept.id, { plannedSets: 5 }, profileId);
    expect(edited.exercises.find(({ id }) => id === kept.id)?.muscleMappingSnapshot).toEqual(originalSnapshot);
  });
});
