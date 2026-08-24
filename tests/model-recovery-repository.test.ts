import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ModelRecoveryRepository } from "@/modules/model-recovery/model-recovery.repository";
import { DEFAULT_RECOVERY_CONFIG, RECOVERY_ALGORITHM_VERSION } from "@/modules/model-recovery/recovery.types";

const db = {
  modelRecoveryRun: {
    updateMany: vi.fn(),
    upsert: vi.fn(),
    findFirst: vi.fn(),
  },
};
const client = db as unknown as PrismaClient;
const timestamp = new Date("2026-08-24T10:00:00.000Z");

function record() {
  return {
    id: 5,
    episodeId: 2,
    algorithmVersion: RECOVERY_ALGORITHM_VERSION,
    seed: 10,
    config: DEFAULT_RECOVERY_CONFIG,
    configFingerprint: "c".repeat(64),
    sourceFingerprint: "s".repeat(64),
    status: "recovered",
    firstUnknownDate: "2026-08-01",
    latestRecoveredDate: "2026-08-20",
    observationCount: 3,
    generatedParticleCount: 32,
    validParticleCount: 32,
    invalidParticleCount: 0,
    effectiveSampleSize: 20,
    normalizedEffectiveSampleSize: 0.625,
    maximumWeight: 0.1,
    diagnostics: {},
    posteriorSummary: {},
    staleAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("model recovery persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.modelRecoveryRun.updateMany.mockResolvedValue({ count: 1 });
    db.modelRecoveryRun.upsert.mockResolvedValue(record());
  });

  it("invalidates competing fingerprints and idempotently upserts the exact run", async () => {
    const repository = new ModelRecoveryRepository(client);
    const output = await repository.persist({
      episodeId: 2,
      firstUnknownDate: "2026-08-01",
      latestRecoveredDate: "2026-08-20",
      config: { ...DEFAULT_RECOVERY_CONFIG, particleCount: 32 },
      configFingerprint: "c".repeat(64),
      sourceFingerprint: "s".repeat(64),
      now: timestamp,
      result: {
        algorithmVersion: RECOVERY_ALGORITHM_VERSION,
        seed: 10,
        status: "recovered",
        generatedParticleCount: 32,
        validParticleCount: 32,
        invalidParticleCount: 0,
        observationCount: 3,
        observationDates: ["2026-08-20"],
        effectiveSampleSize: 20,
        normalizedEffectiveSampleSize: 0.625,
        maximumWeight: 0.1,
        posteriorSummary: {} as never,
        ensemble: [],
        diagnostics: {
          donorDayCount: 10, unknownDayCount: 7, invalidProposalReasons: {},
          likelihood: "student-t-physiological-end-weight", biaUsed: false,
          observationAssimilationInsideSimulator: false, resamplingUsed: false,
          importanceSampling: {
            target: "posterior-over-unknown-histories",
            proposal: "defensive-adaptive-regime-mixture",
            priorProposalCorrectionApplied: true,
            logWeightEquation: "log_likelihood+log_prior-log_proposal",
          },
          pilot: {
            generatedParticleCount: 32, validParticleCount: 32,
            invalidParticleCount: 0,
            normalizedEffectiveSampleSize: 0.5, maximumWeight: 0.1,
          },
          logWeightDistribution: {
            minimum: -10, median: -5, maximum: -1, standardDeviation: 2,
          },
          topParticleOrigins: [],
          downstreamQualityContract: {
            forecastInitialization: "allowed-with-quality-label",
            posteriorIntervalsTrustworthy: true,
          },
          observationResidualVarianceKg2: 0.25,
          observationResidualVarianceRole: "effective-scale-to-physiology-residual",
          auxiliaryWeightFilterSemantics:
            "separate-observation-replay-after-physiological-inference",
          validParticleFraction: 1,
          qualityReasons: [],
          supportWarnings: [],
          ecfPolicyLimitation: null,
        },
      },
    });
    expect(db.modelRecoveryRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ episodeId: 2, staleAt: null, NOT: expect.any(Object) }),
      data: { staleAt: timestamp },
    }));
    expect(db.modelRecoveryRun.upsert.mock.calls[0][0]).toMatchObject({
      where: {
        episodeId_algorithmVersion_seed_configFingerprint_sourceFingerprint: {
          episodeId: 2,
          algorithmVersion: RECOVERY_ALGORITHM_VERSION,
          seed: 10,
          configFingerprint: "c".repeat(64),
          sourceFingerprint: "s".repeat(64),
        },
      },
      update: { staleAt: null },
    });
    expect(output).toMatchObject({ id: 5, stale: false, staleAt: null });
  });

  it("exposes the ensemble only through the internal Phase 14B hook", async () => {
    db.modelRecoveryRun.findFirst.mockResolvedValueOnce(record());
    const repository = new ModelRecoveryRepository(client);
    await expect(repository.latestStatus(2)).resolves.not.toHaveProperty("ensemble");
    db.modelRecoveryRun.findFirst.mockResolvedValueOnce({ id: 5, ensemble: [{ normalizedWeight: 1 }] });
    await expect(repository.loadCurrentEnsemble(2)).resolves.toMatchObject({
      ensemble: [{ normalizedWeight: 1 }],
    });
  });

  it("marks all current runs stale at the supplied instant", async () => {
    const repository = new ModelRecoveryRepository(client);
    await repository.markAllStale(2, timestamp);
    expect(db.modelRecoveryRun.updateMany).toHaveBeenCalledWith({
      where: { episodeId: 2, staleAt: null }, data: { staleAt: timestamp },
    });
  });

  it("returns null when there is no status or current ensemble", async () => {
    db.modelRecoveryRun.findFirst.mockResolvedValue(null);
    const repository = new ModelRecoveryRepository(client);
    await expect(repository.latestStatus(2)).resolves.toBeNull();
    await expect(repository.loadCurrentEnsemble(2)).resolves.toBeNull();
  });

  it("serializes stale status timestamps without exposing an ensemble", async () => {
    db.modelRecoveryRun.findFirst.mockResolvedValue({ ...record(), staleAt: timestamp });
    const repository = new ModelRecoveryRepository(client);
    await expect(repository.latestStatus(2)).resolves.toMatchObject({
      stale: true, staleAt: timestamp.toISOString(),
      createdAt: timestamp.toISOString(), updatedAt: timestamp.toISOString(),
    });
    expect(db.modelRecoveryRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { staleAt: { sort: "desc", nulls: "first" } },
        { updatedAt: "desc" },
        { id: "desc" },
      ],
    }));
  });
});
