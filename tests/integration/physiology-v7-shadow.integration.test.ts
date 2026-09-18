import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { PhysiologyV7ShadowService } from "@/modules/model-episodes/physiology-v7-shadow.service";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const dates = ["2051-05-01", "2051-05-02"];
const request = { profileId: 1, fromDate: dates[0], toDate: dates[1], timeZone: "Europe/Bratislava" };
const persistence = new PhysiologyV7PersistenceRepository(prisma);

async function clean() {
  await prisma.physiologyV7ShadowDiagnostic.deleteMany({ where: { profileId: 1, date: { in: dates } } });
  await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId: 1, date: { in: dates } } });
  await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId: 1 } });
  await deleteDailyHealthRows(prisma, dates);
}
async function seed() {
  await prisma.dailyHealthData.createMany({ data: dates.map((date, index) => ({
    date, weightKg: 80 - index, bodyFatPercent: 20, caloriesKcal: 2300, proteinG: 150,
    fatG: 75, carbsG: 250, steps: 7000, walkingDistanceKm: 5, workoutFeedObserved: true, rawPayload: {},
  })) });
}
describe("v7 shadow diagnostics with PostgreSQL", () => {
  beforeEach(async () => { await clean(); await seed(); });
  afterAll(async () => { await clean(); await prisma.$disconnect(); });

  it("records successful unavailable v7 output without mutating durable sources", async () => {
    const before = await prisma.dailyHealthData.findMany({ where: { date: { in: dates } }, orderBy: { date: "asc" } });
    await new PhysiologyV7ShadowService().run(request);
    const rows = await prisma.physiologyV7ShadowDiagnostic.findMany({ where: { profileId: 1, date: { in: dates } }, orderBy: { date: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.executionStatus === "success")).toBe(true);
    expect(rows[0]!.reasonCodes).toEqual(expect.arrayContaining(["v7-unavailable-compartments"]));
    expect(rows[0]!.comparison).toMatchObject({ availability: "unavailable" });
    expect(await prisma.dailyHealthData.findMany({ where: { date: { in: dates } }, orderBy: { date: "asc" } })).toEqual(before);
  });

  it("is idempotent on retry and diagnoses stale and missing reads", async () => {
    const shadow = new PhysiologyV7ShadowService();
    await shadow.run(request); await shadow.run(request);
    expect(await prisma.physiologyV7ShadowDiagnostic.count({ where: { profileId: 1, date: { in: dates } } })).toBe(2);
    await persistence.invalidate(1, dates[1]);
    await shadow.run({ ...request, rebuild: false });
    expect((await prisma.physiologyV7ShadowDiagnostic.findUniqueOrThrow({ where: { profileId_date: { profileId: 1, date: dates[1] } } })).reasonCodes)
      .toEqual(expect.arrayContaining(["v7-stale-cache"]));
    await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId: 1, date: dates[0] } });
    await shadow.run({ ...request, rebuild: false });
    expect((await prisma.physiologyV7ShadowDiagnostic.findUniqueOrThrow({ where: { profileId_date: { profileId: 1, date: dates[0] } } })).reasonCodes)
      .toEqual(expect.arrayContaining(["v7-missing-result"]));
  });

  it("isolates a rebuild failure in diagnostics and leaves sources unchanged", async () => {
    const before = await prisma.dailyHealthData.findMany({ where: { date: { in: dates } }, orderBy: { date: "asc" } });
    const failing = new PhysiologyV7ShadowService(prisma, { rebuild: async () => { throw new Error("shadow-test-failure"); } }, persistence);
    await failing.run(request);
    const rows = await prisma.physiologyV7ShadowDiagnostic.findMany({ where: { profileId: 1, date: { in: dates } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.executionStatus === "failure" && row.errorCode === "Error")).toBe(true);
    expect(await prisma.dailyHealthData.findMany({ where: { date: { in: dates } }, orderBy: { date: "asc" } })).toEqual(before);
  });
});
