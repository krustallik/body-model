import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";

requireIsolatedStage01Database(process.env.DATABASE_URL, process.env.BODYCAST_STAGE01_MODE, "test");

const { PrismaClient } = await import("@prisma/client");
const { afterAll, afterEach, beforeEach, describe, expect, it } = await import("vitest");
const { prisma: applicationPrisma } = await import("@/lib/db/prisma");
const { PhysiologyV7PersistenceRepository } = await import("@/modules/model-episodes/physiology-v7-persistence.repository");
const { PhysiologyV7ShadowService } = await import("@/modules/model-episodes/physiology-v7-shadow.service");
const { deleteDailyHealthRows } = await import("../helpers/delete-daily-health");

const prisma = new PrismaClient();
const profileId = 991307;
const dates = ["2051-05-01", "2051-05-02"];
const request = { profileId, fromDate: dates[0], toDate: dates[1], timeZone: "Europe/Bratislava" };
const persistence = new PhysiologyV7PersistenceRepository(prisma);
let profileOneLifecycleSnapshot: Awaited<ReturnType<typeof prisma.physiologyV7Lifecycle.findUnique>> | null = null;
let profileOneLifecycleSnapshotCaptured = false;

async function restoreProfileOneLifecycle() {
  if (!profileOneLifecycleSnapshotCaptured) return;
  const snapshot = profileOneLifecycleSnapshot;
  if (!snapshot) {
    await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId: 1 } });
    return;
  }

  const { profileId: snapshotProfileId, ...data } = snapshot;
  await prisma.physiologyV7Lifecycle.upsert({
    where: { profileId: snapshotProfileId },
    create: snapshot,
    update: data,
  });
}

// DailyHealthData triggers invalidate profile 1; the integration config serializes files on an isolated *_test database.
async function clean() {
  await prisma.physiologyV7ShadowDiagnostic.deleteMany({ where: { profileId } });
  await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId } });
  await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId } });
  await deleteDailyHealthRows(prisma, dates);
}
async function seed() {
  await prisma.dailyHealthData.createMany({ data: dates.map((date, index) => ({
    profileId,
    date, weightKg: 80 - index, bodyFatPercent: 20, caloriesKcal: 2300, proteinG: 150,
    fatG: 75, carbsG: 250, steps: 7000, walkingDistanceKm: 5, workoutFeedObserved: true, rawPayload: {},
  })) });
}
describe("v7 shadow diagnostics with PostgreSQL", () => {
  beforeEach(async () => {
    profileOneLifecycleSnapshot = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId: 1 } });
    profileOneLifecycleSnapshotCaptured = true;
    await clean();
    await seed();
  });
  afterEach(async () => {
    if (!profileOneLifecycleSnapshotCaptured) return;
    const expected = profileOneLifecycleSnapshot;
    await restoreProfileOneLifecycle();
    expect(await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId: 1 } })).toEqual(expected);
    profileOneLifecycleSnapshot = null;
    profileOneLifecycleSnapshotCaptured = false;
  });
  afterAll(async () => {
    try {
      if (!profileOneLifecycleSnapshotCaptured) {
        profileOneLifecycleSnapshot = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId: 1 } });
        profileOneLifecycleSnapshotCaptured = true;
      }
      await clean();
    } finally {
      try {
        await restoreProfileOneLifecycle();
      } finally {
        profileOneLifecycleSnapshot = null;
        profileOneLifecycleSnapshotCaptured = false;
        await Promise.all([prisma.$disconnect(), applicationPrisma.$disconnect()]);
      }
    }
  });

  it("records successful unavailable v7 output without mutating durable sources", async () => {
    const before = await prisma.dailyHealthData.findMany({ where: { date: { in: dates } }, orderBy: { date: "asc" } });
    await new PhysiologyV7ShadowService().run(request);
    const rows = await prisma.physiologyV7ShadowDiagnostic.findMany({ where: { profileId, date: { in: dates } }, orderBy: { date: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.executionStatus === "success")).toBe(true);
    expect(rows[0]!.reasonCodes).toEqual(expect.arrayContaining(["v7-unavailable-compartments"]));
    expect(rows[0]!.comparison).toMatchObject({ availability: "unavailable" });
    expect(await prisma.dailyHealthData.findMany({ where: { date: { in: dates } }, orderBy: { date: "asc" } })).toEqual(before);
  });

  it("is idempotent on retry and diagnoses stale and missing reads", async () => {
    const shadow = new PhysiologyV7ShadowService();
    await shadow.run(request); await shadow.run(request);
    expect(await prisma.physiologyV7ShadowDiagnostic.count({ where: { profileId, date: { in: dates } } })).toBe(2);
    await persistence.invalidate(profileId, dates[1]);
    await shadow.run({  ...request, rebuild: false });
    expect((await prisma.physiologyV7ShadowDiagnostic.findUniqueOrThrow({ where: { profileId_date: { profileId, date: dates[1] } } })).reasonCodes)
      .toEqual(expect.arrayContaining(["v7-stale-cache"]));
    await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId, date: dates[0] } });
    await shadow.run({  ...request, rebuild: false });
    expect((await prisma.physiologyV7ShadowDiagnostic.findUniqueOrThrow({ where: { profileId_date: { profileId, date: dates[0] } } })).reasonCodes)
      .toEqual(expect.arrayContaining(["v7-missing-result"]));
  });

  it("isolates a rebuild failure in diagnostics and leaves sources unchanged", async () => {
    const before = await prisma.dailyHealthData.findMany({ where: { date: { in: dates } }, orderBy: { date: "asc" } });
    const failing = new PhysiologyV7ShadowService(prisma, { rebuild: async () => { throw new Error("shadow-test-failure"); } }, persistence);
    await failing.run(request);
    const rows = await prisma.physiologyV7ShadowDiagnostic.findMany({ where: { profileId, date: { in: dates } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.executionStatus === "failure" && row.errorCode === "Error")).toBe(true);
    expect(await prisma.dailyHealthData.findMany({ where: { date: { in: dates } }, orderBy: { date: "asc" } })).toEqual(before);
  });
});
