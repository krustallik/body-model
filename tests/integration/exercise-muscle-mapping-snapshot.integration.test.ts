import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  applyNullMuscleMappingSnapshotBackfill,
  reportNullMuscleMappingSnapshotBackfill,
} from "@/modules/training/exercise-mapping-snapshot";
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

describe("Stage-7 Slice-1 mapping snapshots with PostgreSQL", () => {
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
    expect(session.exercises[0]?.muscleMappingSnapshot).toEqual(
      buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press"),
    );
    expect(session.exercises[1]?.muscleMappingSnapshot).toEqual(
      buildExerciseMuscleMappingSnapshotV7(null),
    );

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
  });
});
