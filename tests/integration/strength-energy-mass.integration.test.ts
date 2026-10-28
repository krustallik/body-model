import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";
import { clearUnifiedPublicationBlockFixtures } from "../helpers/clear-unified-publication-blocks";
import { TrainingRepository } from "@/modules/training/training.repository";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { recordExperimentalStrengthEnergyShadow, recordExperimentalStrengthEnergyShadowBySessionId } from "@/modules/training/experimental-strength-energy-shadow.service";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { STRENGTH_ENERGY_MASS_RESOLUTION_V1 } from "@/modules/training/session-mass-reference";
import { StaleStrengthEnergySourceError } from "@/modules/training/training.errors";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const training = new TrainingRepository(prisma);
const sessionIds: number[] = [];
const sampleIds: number[] = [];
const date = "2094-10-22";
const started = new Date("2094-10-22T12:40:00.000Z");

async function sample(value = 81, timestamp = new Date("2094-10-22T05:00:00.000Z")) {
  const row = await prisma.healthMetricSample.create({
    data: { profileId: 1, date, metric: "weight-kg", source: "apple-health-shortcut", timestamp, value },
  });
  sampleIds.push(row.id);
  return row;
}

async function session(options: { ended?: boolean; completedSets?: boolean; withBodyweightRows?: boolean; onlyExternal?: boolean } = {}) {
  const row = await prisma.strengthDiarySession.create({
    data: {
      profileId: 1,
      status: "COMPLETED",
      entryMode: "LIVE",
      effectiveAccountingAt: started,
      accountingTimeZone: "Europe/Bratislava",
      accountingTimeZoneProvenance: "client-session",
      webStartedAt: started,
      webEndedAt: options.ended === false ? null : new Date("2094-10-22T13:40:00.000Z"),
      exercises: { create: [
        {
          sortOrder: 0, snapshotExerciseName: "P1 mass external", resistanceType: "EXTERNAL_WEIGHT", plannedSets: 1,
          ...(options.completedSets === false ? {} : { sets: { create: [{ setNumber: 1, reps: 8, weightKg: 40,
            completedAt: new Date("2094-10-22T13:00:00.000Z") }] } }),
        },
        ...(options.onlyExternal ? [] : [{
          sortOrder: 1, snapshotExerciseName: "P1 mass bodyweight", resistanceType: "BODYWEIGHT", plannedSets: 1,
          ...(options.withBodyweightRows ? { sets: { create: [{ setNumber: 1, reps: 5,
            completedAt: new Date("2094-10-22T13:10:00.000Z") }] } } : {}),
        }]),
      ] },
    },
  });
  sessionIds.push(row.id);
  await training.materializeAccounting({ sessionId: row.id, profileId: 1 });
  return row;
}

async function accountingRows(sessionId: number) {
  return prisma.strengthSessionAccountingSnapshot.findMany({
    where: { sessionId }, orderBy: { snapshotRevision: "asc" },
  });
}

async function sourceRows(sessionId: number) {
  return {
    session: await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: sessionId }, select: {
        status: true, entryMode: true, revision: true, accountingInputRevision: true,
        webStartedAt: true, webEndedAt: true, createdAt: true, matchedWorkoutId: true,
        effectiveAccountingAt: true, accountingTimeZone: true, accountingTimeZoneProvenance: true,
        exercises: { orderBy: { sortOrder: "asc" }, select: {
          resistanceType: true, loadAccountingConfigSnapshot: true,
          sets: { orderBy: { setNumber: "asc" }, select: {
            id: true, reps: true, weightKg: true, bandNominalResistanceKg: true, rir: true, completedAt: true, createdAt: true,
          } },
        } },
      },
    }),
    samples: await prisma.healthMetricSample.findMany({ where: { id: { in: sampleIds } }, orderBy: { id: "asc" } }),
  };
}

async function eventFor(sessionId: number) {
  return prisma.activeEnergyCanonicalEvent.findFirstOrThrow({
    where: { profileId: 1, aliases: { some: { sourceType: "strength-session", sourceId: String(sessionId) } } },
    include: { aliases: true, candidates: true, resolutions: true },
  });
}

describe("independent Strength energy mass on isolated PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.profile.upsert({ where: { id: 1 }, update: {},
      create: { id: 1, sex: "male", dateOfBirth: new Date("1990-01-01"), heightCm: 180 } });
  });
  afterAll(async () => {
    await clearUnifiedPublicationBlockFixtures(prisma, sessionIds.map((id) => ({ profileId: 1, source: "training" as const, sourceKey: String(id) })));
    await prisma.activeEnergyCanonicalEvent.deleteMany({ where: { aliases: { some: { sourceType: "strength-session", sourceId: { in: sessionIds.map(String) } } } } });
    await prisma.strengthDiarySession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.healthMetricSample.deleteMany({ where: { id: { in: sampleIds } } });
    await prisma.$disconnect();
  });

  it("creates unmatched LIVE canonical kcal with a BODYWEIGHT exercise lacking rows, preserving accounting and raw inputs", async () => {
    const observation = await sample(81.12345678901234);
    const row = await session();
    const accountingBefore = await accountingRows(row.id);
    const sourcesBefore = await sourceRows(row.id);
    const dto = await training.getSession(row.id, 1);
    expect(dto?.activeEnergyMassReference?.reference.status).toBe("unavailable");
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: row.id, profileId: 1 });
    const first = await eventFor(row.id);
    expect(first.currentKcal).toBeGreaterThan(0);
    expect(first.currentSource).toBe("bodycast-strength-estimate");
    expect(first.aliases.map(({ sourceType, sourceId }) => [sourceType, sourceId])).toEqual([["strength-session", String(row.id)]]);
    expect(first.candidates.find(({ source }) => source === "bodycast-strength-estimate")?.provenance).toMatchObject({
      stage02MassReference: { status: "unavailable" },
      energyMassReference: { status: "observed", source: "apple-health-shortcut", sourceId: String(observation.id) },
      energyMassResolutionMethodVersion: STRENGTH_ENERGY_MASS_RESOLUTION_V1,
    });
    const firstShadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: row.id } });
    const persistedResult = firstShadow.result as Record<string, unknown>;
    const estimatorResult = Object.fromEntries([
      "contractVersion", "provenance", "supportedDomain", "availability", "estimatedActiveKcal",
      "lowerBoundKcal", "upperBoundKcal", "unavailableReason", "features", "reasons",
      "recoveryEnergy", "garminReferenceKcal",
    ].map((key) => [key, persistedResult[key]]));
    expect(firstShadow.sourceFingerprint).toBe(stableSha256(
      `${stableSha256(estimatorResult)}|${String(persistedResult.inputFingerprint)}`,
    ));
    const sources = await new ModelEpisodeRepository(1, prisma).loadSources(date, date);
    expect(sources.webOnlyStrengthSessions?.find(({ sessionId }) => sessionId === row.id)?.bodyCastEstimateFresh).toBe(true);
    await prisma.experimentalStrengthEnergyShadow.update({
      where: { sessionId: row.id },
      data: { result: {
        ...persistedResult,
        activeEnergyResolution: { availability: "unavailable", estimatedActiveKcal: null, source: null, provenance: null },
      } as Prisma.InputJsonValue },
    });
    expect(await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: row.id } }))
      .toMatchObject({ sourceFingerprint: firstShadow.sourceFingerprint });
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: row.id, profileId: 1 });
    expect(await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: row.id } }))
      .toMatchObject({ sourceFingerprint: firstShadow.sourceFingerprint, result: firstShadow.result });
    const repeated = await eventFor(row.id);
    expect(repeated.id).toBe(first.id);
    expect(repeated.resolutionRevision).toBe(first.resolutionRevision);
    expect(repeated.aliases).toEqual(first.aliases);
    expect(repeated.candidates).toEqual(first.candidates);
    expect(repeated.resolutions).toEqual(first.resolutions);
    expect((await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: row.id } })).sourceFingerprint).toBe(firstShadow.sourceFingerprint);
    expect(await accountingRows(row.id)).toEqual(accountingBefore);
    expect(await sourceRows(row.id)).toEqual(sourcesBefore);
  });

  it("resolves energy mass with no BODYWEIGHT exercise at all", async () => {
    const row = await session({ onlyExternal: true });
    const accountingBefore = await accountingRows(row.id);
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: row.id, profileId: 1 });
    expect((await eventFor(row.id)).currentKcal).toBeGreaterThan(0);
    expect(await accountingRows(row.id)).toEqual(accountingBefore);
  });

  it("rejects a computed candidate when its independently resolved weight changes before commit", async () => {
    const observation = await sample(82, new Date("2094-10-22T06:00:00.000Z"));
    const row = await session();
    const dto = await training.getSession(row.id, 1);
    if (!dto) throw new Error("Missing test session");
    await expect(recordExperimentalStrengthEnergyShadow({ session: dto, profileId: 1,
      onCandidateComputed: async () => {
        await prisma.healthMetricSample.update({ where: { id: observation.id }, data: { value: 83 } });
      },
    })).rejects.toBeInstanceOf(StaleStrengthEnergySourceError);
    expect(await prisma.experimentalStrengthEnergyShadow.findUnique({ where: { sessionId: row.id } })).toBeNull();
    expect(await prisma.activeEnergyEventAlias.count({ where: { sourceType: "strength-session", sourceId: String(row.id) } })).toBe(0);
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: row.id, profileId: 1 });
    expect((await eventFor(row.id)).currentKcal).toBeGreaterThan(0);
  });

  it("retains available Stage 02 snapshot mass after its observation is deleted", async () => {
    const observation = await sample(84, new Date("2094-10-22T07:00:00.000Z"));
    const row = await session({ withBodyweightRows: true });
    const accountingBefore = await accountingRows(row.id);
    const before = await training.getSession(row.id, 1);
    expect(before?.activeEnergyMassReference?.reference).toMatchObject({ status: "observed", sourceId: String(observation.id) });
    await prisma.healthMetricSample.delete({ where: { id: observation.id } });
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: row.id, profileId: 1 });
    expect((await eventFor(row.id)).currentKcal).toBeGreaterThan(0);
    const shadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: row.id } });
    expect(shadow.result).toMatchObject({ energyMassReference: before?.activeEnergyMassReference?.reference, energyMassResolutionMethodVersion: null });
    expect(await accountingRows(row.id)).toEqual(accountingBefore);
  });

  it("preserves missing-duration and missing-completed-sets reasons with available mass", async () => {
    for (const [options, reason] of [
      [{ ended: false }, "missing-elapsed-duration"],
      [{ completedSets: false }, "missing-completed-sets"],
    ] as const) {
      const row = await session(options);
      await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: row.id, profileId: 1 });
      const shadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: row.id } });
      expect(shadow.result).toMatchObject({ availability: "unavailable", unavailableReason: reason });
      expect((await eventFor(row.id)).candidates.some(({ source }) => source === "bodycast-strength-estimate")).toBe(false);
      expect((await eventFor(row.id)).currentKcal).toBeNull();
    }
  });

  it("preserves true missing-mass as unavailable without inventing a candidate", async () => {
    await prisma.healthMetricSample.deleteMany({ where: { id: { in: sampleIds } } });
    const row = await session();
    await recordExperimentalStrengthEnergyShadowBySessionId({ sessionId: row.id, profileId: 1 });
    const shadow = await prisma.experimentalStrengthEnergyShadow.findUniqueOrThrow({ where: { sessionId: row.id } });
    expect(shadow.result).toMatchObject({ availability: "unavailable", unavailableReason: "missing-body-mass" });
    expect((await eventFor(row.id)).currentKcal).toBeNull();
    expect((await eventFor(row.id)).candidates.some(({ source }) => source === "bodycast-strength-estimate")).toBe(false);
  });
});
