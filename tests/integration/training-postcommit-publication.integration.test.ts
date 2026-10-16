import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";

// Guard before importing modules that initialize the application Prisma singleton.
const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
process.env.DATABASE_URL = databaseUrl;

const { prisma } = await import("@/lib/db/prisma");
const { TrainingRepository } = await import("@/modules/training/training.repository");
const { TrainingService } = await import("@/modules/training/training.service");
const profileId = 1;
const repository = new TrainingRepository(prisma);
const failedPublication = vi.fn(async () => { throw new Error("injected dependent refresh failure"); });
const training = new TrainingService(prisma, repository, failedPublication);
let sessionId: number | null = null;
let profileCreated = false;

describe("Training post-commit publication recovery on isolated PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const databaseIdentity = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const expectedDatabase = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (databaseIdentity[0]?.current_database !== expectedDatabase) {
      throw new Error("Application Prisma singleton is not connected to the guarded test database.");
    }
    const existingProfile = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } });
    if (!existingProfile) {
      await prisma.profile.create({
        data: {
          id: profileId,
          sex: "female",
          dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
          heightCm: 170,
        },
      });
      profileCreated = true;
    } else if (await prisma.strengthDiarySession.count({ where: { profileId, status: "ACTIVE" } }) > 0) {
      throw new Error("The isolated test database has an active profile session; refusing to mutate it.");
    }
  });

  afterAll(async () => {
    if (sessionId !== null) {
      await prisma.strengthDiarySession.deleteMany({ where: { id: sessionId, profileId } });
    }
    if (profileCreated) await prisma.profile.deleteMany({ where: { id: profileId } });
    await prisma.$disconnect();
  });

  it("keeps finish and completed-set edits committed and reports stale dependent publication", async () => {
    const session = await training.startDynamicSession(profileId, "Europe/Bratislava");
    sessionId = session.id;
    const exercise = await prisma.strengthSessionExercise.create({
      data: {
        sessionId: session.id,
        snapshotExerciseName: "Synthetic pull-up",
        sortOrder: 0,
        plannedSets: 0,
        resistanceType: "BODYWEIGHT",
        origin: "EXTRA",
      },
    });
    const created = await training.createSet(session.id, exercise.id, {
      reps: 10,
      loadAccountingOverride: { additionalLoadKg: 15 },
    }, profileId);
    const original = await prisma.strengthSet.findUniqueOrThrow({ where: { id: created.id } });

    const finished = await training.finishSession(session.id, profileId);
    expect(finished.status).toBe("COMPLETED");
    expect(finished.modelPublicationStatus).toBe("stale");
    expect(await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: session.id }, select: { status: true, webEndedAt: true },
    })).toMatchObject({ status: "COMPLETED" });
    const persistedAfterFinish = await prisma.strengthSet.findUniqueOrThrow({ where: { id: created.id } });
    expect(persistedAfterFinish.loadAccountingOverride).toEqual({ additionalLoadKg: 15 });
    expect(persistedAfterFinish.completedAt).toEqual(original.completedAt);
    expect(await prisma.strengthSessionAccountingOperation.count({ where: { sessionId: session.id } })).toBeGreaterThan(0);

    failedPublication.mockClear();
    const edited = await training.updateSet(session.id, created.id, {
      reps: 11,
      rir: 3,
      comment: "synthetic edit",
    }, profileId);
    expect(edited).toMatchObject({
      reps: 11,
      rir: 3,
      comment: "synthetic edit",
      loadAccountingOverride: { additionalLoadKg: 15 },
      completedAt: original.completedAt?.toISOString() ?? null,
      modelPublicationStatus: "stale",
    });
    const persistedAfterEdit = await prisma.strengthSet.findUniqueOrThrow({ where: { id: created.id } });
    expect(persistedAfterEdit).toMatchObject({ reps: 11, rir: 3, comment: "synthetic edit" });
    expect(persistedAfterEdit.loadAccountingOverride).toEqual({ additionalLoadKg: 15 });
    expect(persistedAfterEdit.completedAt).toEqual(original.completedAt);
    expect(failedPublication).toHaveBeenCalledOnce();
  });

  it("serializes concurrent independent set edits without losing either write", async () => {
    if (sessionId === null) throw new Error("The preceding isolated session fixture is required.");
    const set = await prisma.strengthSet.findFirstOrThrow({
      where: { sessionExercise: { sessionId } },
      orderBy: { id: "asc" },
    });
    const [repsEdit, noteEdit] = await Promise.all([
      training.updateSet(sessionId, set.id, { reps: 12 }, profileId),
      training.updateSet(sessionId, set.id, { rir: 4, comment: "concurrent edit" }, profileId),
    ]);
    expect([repsEdit.reps, noteEdit.reps]).toContain(12);
    const final = await prisma.strengthSet.findUniqueOrThrow({ where: { id: set.id } });
    expect(final).toMatchObject({ reps: 12, rir: 4, comment: "concurrent edit" });
    expect(final.loadAccountingOverride).toEqual({ additionalLoadKg: 15 });
  });
});
