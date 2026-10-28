import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";
import type { ResistanceType } from "@/modules/training/training.constants";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
process.env.DATABASE_URL = databaseUrl;
vi.mock("@/modules/auth/access", async () => (await import("../helpers/mock-verified-profile-auth")).mockProfileAuth);
const profileId = 1;
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const { GET, PATCH } = await import("@/app/api/v1/training/sessions/[id]/sets/[setId]/route");
const { ENTRY_MODE, RESISTANCE, SESSION_STATUS } = await import("@/modules/training/training.constants");
const { trainingRepository } = await import("@/modules/training/training.repository");
const { trainingService } = await import("@/modules/training/training.service");
const { UpdateSetSchema } = await import("@/modules/training/training.schema");
const { validateSetFields } = await import("@/modules/training/training.set-validation");

const createdSessionIds: number[] = [];
let priorQueue: Awaited<ReturnType<typeof prisma.trainingRefreshJob.findUnique>> = null;
let priorSourceChanges: Awaited<ReturnType<typeof prisma.trainingSourceChange.findMany>> = [];

async function createSyntheticSession(input: {
  name: string;
  resistanceType: ResistanceType;
  status: "ACTIVE" | "COMPLETED";
  date: string;
}) {
  const session = await trainingRepository.createSessionSnapshot({
    profileId,
    programId: null,
    programVersionId: null,
    status: input.status,
    entryMode: input.status === "ACTIVE" ? ENTRY_MODE.LIVE : ENTRY_MODE.RETROSPECTIVE,
    webStartedAt: input.status === "ACTIVE" ? new Date(`${input.date}T14:00:00.000Z`) : null,
    webEndedAt: null,
    effectiveAccountingAt: new Date(`${input.date}T14:00:00.000Z`),
    accountingTimeZone: "Europe/Bratislava",
    accountingTimeZoneProvenance: "synthetic-http-400-reproduction",
    exercises: [{
      sourceExerciseCatalogId: null,
      snapshotExerciseName: input.name,
      sortOrder: 0,
      plannedSets: 0,
      resistanceType: input.resistanceType,
      origin: "EXTRA",
      muscleMappingSnapshot: Prisma.JsonNull,
      loadAccountingConfigSnapshot: null,
    }],
  });
  createdSessionIds.push(session.id);
  return { session, exercise: session.exercises[0]! };
}

async function patchSet(sessionId: number, setId: number, payload: Record<string, unknown>) {
  const request = new Request(`http://localhost/api/v1/training/sessions/${sessionId}/sets/${setId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const response = await PATCH(request, { params: Promise.resolve({ id: String(sessionId), setId: String(setId) }) });
  return { status: response.status, body: await response.json() as unknown };
}

describe("synthetic Training HTTP 400 incident reproductions on isolated PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const actualDatabase = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    if (actualDatabase[0]?.current_database !== decodeURIComponent(new URL(databaseUrl).pathname.slice(1))) {
      throw new Error("The reproduction fixture is not connected to the guarded isolated database.");
    }
    const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } });
    if (!profile) throw new Error("The isolated integration profile must exist before this reproduction.");
    priorQueue = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
    priorSourceChanges = await prisma.trainingSourceChange.findMany({ where: { profileId } });
  });

  afterAll(async () => {
    for (const sessionId of createdSessionIds) {
      const sets = await prisma.strengthSet.findMany({ where: { sessionExercise: { sessionId } }, select: { id: true } });
      await prisma.trainingSetCreateOperation.deleteMany({ where: { profileId, canonicalSetId: { in: sets.map(({ id }) => id) } } });
      await prisma.strengthDiarySession.deleteMany({ where: { id: sessionId, profileId } });
    }
    await prisma.trainingSourceChange.deleteMany({ where: { profileId } });
    await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
    if (priorSourceChanges.length > 0) await prisma.trainingSourceChange.createMany({ data: priorSourceChanges.map((row) => ({
      ...row,
      oldSourceIdentity: row.oldSourceIdentity === null ? Prisma.DbNull : row.oldSourceIdentity as Prisma.InputJsonValue,
      newSourceIdentity: row.newSourceIdentity === null ? Prisma.DbNull : row.newSourceIdentity as Prisma.InputJsonValue,
      oldEventInstants: row.oldEventInstants === null ? Prisma.DbNull : row.oldEventInstants as Prisma.InputJsonValue,
      newEventInstants: row.newEventInstants === null ? Prisma.DbNull : row.newEventInstants as Prisma.InputJsonValue,
    })) });
    if (priorQueue) await prisma.trainingRefreshJob.create({ data: priorQueue });
    await prisma.$disconnect();
  });

  it("captures actual API results for bodyweight history, band history, and an ACTIVE programless session", async () => {
    const bodyweightFixture = await createSyntheticSession({
      name: "Synthetic historical bodyweight press",
      resistanceType: RESISTANCE.BODYWEIGHT,
      status: SESSION_STATUS.COMPLETED,
      date: "2025-04-01",
    });
    const bodyweightSet = await trainingService.createSet(
      bodyweightFixture.session.id,
      bodyweightFixture.exercise.id,
      { reps: 10 },
      profileId,
    );
    const bodyweightPayload = { reps: 2, comment: null, rir: null };
    const bodyweightSchema = UpdateSetSchema.safeParse(bodyweightPayload);
    const bodyweightDomain = validateSetFields(RESISTANCE.BODYWEIGHT, { reps: 2, rir: null });
    expect(bodyweightSchema.success).toBe(true);
    expect(bodyweightDomain).toMatchObject({ ok: true, reps: 2, weightKg: null, bandNominalResistanceKg: null });
    const bodyweightResponse = await patchSet(bodyweightFixture.session.id, bodyweightSet.id, bodyweightPayload);
    const bodyweightStored = await prisma.strengthSet.findUniqueOrThrow({ where: { id: bodyweightSet.id } });
    const bodyweightReadResponse = await GET(
      new Request(`http://localhost/api/v1/training/sessions/${bodyweightFixture.session.id}/sets/${bodyweightSet.id}`),
      { params: Promise.resolve({ id: String(bodyweightFixture.session.id), setId: String(bodyweightSet.id) }) },
    );
    const bodyweightDto = await bodyweightReadResponse.json() as unknown;
    console.info("synthetic-bodyweight-http-reproduction", JSON.stringify({
      request: { method: "PATCH", path: `/api/v1/training/sessions/${bodyweightFixture.session.id}/sets/${bodyweightSet.id}`, payload: bodyweightPayload },
      response: bodyweightResponse,
      schemaValidation: bodyweightSchema.success,
      domainValidation: bodyweightDomain,
      ownership: { profileId, sessionId: bodyweightFixture.session.id, exerciseId: bodyweightFixture.exercise.id },
      sessionStatus: bodyweightFixture.session.status,
      programId: bodyweightFixture.session.programId,
      resistanceType: bodyweightFixture.exercise.resistanceType,
      stored: {
        setId: bodyweightStored.id,
        sessionId: bodyweightFixture.session.id,
        exerciseId: bodyweightFixture.exercise.id,
        resistanceType: bodyweightFixture.exercise.resistanceType,
        reps: bodyweightStored.reps,
        weightKg: bodyweightStored.weightKg?.toString() ?? null,
        bandNominalResistanceKg: bodyweightStored.bandNominalResistanceKg?.toString() ?? null,
        loadAccountingOverride: bodyweightStored.loadAccountingOverride,
      },
      readDtoStatus: bodyweightReadResponse.status,
      readDto: bodyweightDto,
    }));
    expect(bodyweightResponse.status).toBe(200);
    expect(bodyweightStored.reps).toBe(2);
    expect(bodyweightStored.weightKg).toBeNull();
    expect(bodyweightStored.bandNominalResistanceKg).toBeNull();

    const bandFixture = await createSyntheticSession({
      name: "Synthetic historical resistance band row",
      resistanceType: RESISTANCE.RESISTANCE_BAND,
      status: SESSION_STATUS.COMPLETED,
      date: "2025-04-02",
    });
    const bandSet = await trainingService.createSet(
      bandFixture.session.id,
      bandFixture.exercise.id,
      { reps: 1, bandNominalResistanceKg: 22, rir: 3 },
      profileId,
    );
    const bandPayload = { reps: 2, comment: null, rir: 3, bandNominalResistanceKg: 22 };
    const bandSchema = UpdateSetSchema.safeParse(bandPayload);
    const bandDomain = validateSetFields(RESISTANCE.RESISTANCE_BAND, {
      reps: 2, rir: 3, bandNominalResistanceKg: 22,
    });
    expect(bandSchema.success).toBe(true);
    expect(bandDomain).toMatchObject({ ok: true, reps: 2, rir: 3, weightKg: null, bandNominalResistanceKg: 22 });
    const bandResponse = await patchSet(bandFixture.session.id, bandSet.id, bandPayload);
    const bandStored = await prisma.strengthSet.findUniqueOrThrow({ where: { id: bandSet.id } });
    const bandReadResponse = await GET(
      new Request(`http://localhost/api/v1/training/sessions/${bandFixture.session.id}/sets/${bandSet.id}`),
      { params: Promise.resolve({ id: String(bandFixture.session.id), setId: String(bandSet.id) }) },
    );
    const bandDto = await bandReadResponse.json() as unknown;
    console.info("synthetic-resistance-band-http-reproduction", JSON.stringify({
      request: { method: "PATCH", path: `/api/v1/training/sessions/${bandFixture.session.id}/sets/${bandSet.id}`, payload: bandPayload },
      response: bandResponse,
      schemaValidation: bandSchema.success,
      domainValidation: bandDomain,
      ownership: { profileId, sessionId: bandFixture.session.id, exerciseId: bandFixture.exercise.id },
      resistanceType: bandFixture.exercise.resistanceType,
      stored: {
        setId: bandStored.id,
        reps: bandStored.reps,
        weightKg: bandStored.weightKg?.toString() ?? null,
        bandNominalResistanceKg: bandStored.bandNominalResistanceKg?.toString() ?? null,
        rir: bandStored.rir,
        loadAccountingOverride: bandStored.loadAccountingOverride,
      },
      readDtoStatus: bandReadResponse.status,
      readDto: bandDto,
    }));
    expect(bandResponse.status).toBe(200);
    expect(bandStored).toMatchObject({ reps: 2, rir: 3, loadAccountingOverride: null });
    expect(bandStored.bandNominalResistanceKg?.toNumber()).toBe(22);
    expect(bandStored.weightKg).toBeNull();

    const activeFixture = await createSyntheticSession({
      name: "Synthetic ACTIVE no-program bodyweight press",
      resistanceType: RESISTANCE.BODYWEIGHT,
      status: SESSION_STATUS.ACTIVE,
      date: "2026-10-01",
    });
    const activeSet = await trainingService.createSet(
      activeFixture.session.id,
      activeFixture.exercise.id,
      { reps: 10 },
      profileId,
    );
    const activePayload = { reps: 2, comment: null, rir: null };
    const activeSchema = UpdateSetSchema.safeParse(activePayload);
    const activeDomain = validateSetFields(RESISTANCE.BODYWEIGHT, { reps: 2, rir: null });
    expect(activeSchema.success).toBe(true);
    expect(activeDomain).toMatchObject({ ok: true, reps: 2, weightKg: null, bandNominalResistanceKg: null });
    const activeResponse = await patchSet(activeFixture.session.id, activeSet.id, activePayload);
    const activeStored = await prisma.strengthSet.findUniqueOrThrow({ where: { id: activeSet.id } });
    console.info("synthetic-active-programless-http-reproduction", JSON.stringify({
      request: { method: "PATCH", path: `/api/v1/training/sessions/${activeFixture.session.id}/sets/${activeSet.id}`, payload: activePayload },
      response: activeResponse,
      schemaValidation: activeSchema.success,
      domainValidation: activeDomain,
      ownership: { profileId, sessionId: activeFixture.session.id, exerciseId: activeFixture.exercise.id },
      sessionStatus: activeFixture.session.status,
      programId: activeFixture.session.programId,
      resistanceType: activeFixture.exercise.resistanceType,
      stored: {
        setId: activeStored.id,
        reps: activeStored.reps,
        weightKg: activeStored.weightKg?.toString() ?? null,
        bandNominalResistanceKg: activeStored.bandNominalResistanceKg?.toString() ?? null,
        loadAccountingOverride: activeStored.loadAccountingOverride,
      },
    }));
    expect(activeResponse.status).toBe(200);
    expect(activeStored.reps).toBe(2);
  });
});
