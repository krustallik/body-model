import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ModelDatabaseClient } from "@/modules/model-episodes/model-episode.repository";
import type { RecoveryConfig, TrajectoryRecoveryResult } from "./recovery.types";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const statusSelect = {
  id: true,
  episodeId: true,
  algorithmVersion: true,
  seed: true,
  config: true,
  configFingerprint: true,
  sourceFingerprint: true,
  status: true,
  firstUnknownDate: true,
  latestRecoveredDate: true,
  observationCount: true,
  generatedParticleCount: true,
  validParticleCount: true,
  invalidParticleCount: true,
  effectiveSampleSize: true,
  normalizedEffectiveSampleSize: true,
  maximumWeight: true,
  diagnostics: true,
  posteriorSummary: true,
  staleAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ModelRecoveryRunSelect;

type StatusRecord = Prisma.ModelRecoveryRunGetPayload<{ select: typeof statusSelect }>;

function statusDto(record: StatusRecord) {
  return {
    ...record,
    stale: record.staleAt !== null,
    staleAt: record.staleAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class ModelRecoveryRepository {
  constructor(private readonly client: ModelDatabaseClient = prisma) {}

  async markAllStale(episodeId: number, at = new Date()): Promise<void> {
    await this.client.modelRecoveryRun.updateMany({
      where: { episodeId, staleAt: null },
      data: { staleAt: at },
    });
  }

  async persist(input: {
    episodeId: number;
    firstUnknownDate: string;
    latestRecoveredDate: string;
    config: RecoveryConfig;
    configFingerprint: string;
    sourceFingerprint: string;
    result: TrajectoryRecoveryResult;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.client.modelRecoveryRun.updateMany({
      where: {
        episodeId: input.episodeId,
        staleAt: null,
        NOT: {
          algorithmVersion: input.result.algorithmVersion,
          seed: input.result.seed,
          configFingerprint: input.configFingerprint,
          sourceFingerprint: input.sourceFingerprint,
        },
      },
      data: { staleAt: now },
    });
    const record = await this.client.modelRecoveryRun.upsert({
      where: {
        episodeId_algorithmVersion_seed_configFingerprint_sourceFingerprint: {
          episodeId: input.episodeId,
          algorithmVersion: input.result.algorithmVersion,
          seed: input.result.seed,
          configFingerprint: input.configFingerprint,
          sourceFingerprint: input.sourceFingerprint,
        },
      },
      create: {
        episodeId: input.episodeId,
        algorithmVersion: input.result.algorithmVersion,
        seed: input.result.seed,
        config: jsonValue(input.config),
        configFingerprint: input.configFingerprint,
        sourceFingerprint: input.sourceFingerprint,
        status: input.result.status,
        firstUnknownDate: input.firstUnknownDate,
        latestRecoveredDate: input.latestRecoveredDate,
        observationCount: input.result.observationCount,
        generatedParticleCount: input.result.generatedParticleCount,
        validParticleCount: input.result.validParticleCount,
        invalidParticleCount: input.result.invalidParticleCount,
        effectiveSampleSize: input.result.effectiveSampleSize,
        normalizedEffectiveSampleSize: input.result.normalizedEffectiveSampleSize,
        maximumWeight: input.result.maximumWeight,
        diagnostics: jsonValue(input.result.diagnostics),
        posteriorSummary: jsonValue(input.result.posteriorSummary),
        ensemble: jsonValue(input.result.ensemble),
      },
      update: {
        status: input.result.status,
        observationCount: input.result.observationCount,
        generatedParticleCount: input.result.generatedParticleCount,
        validParticleCount: input.result.validParticleCount,
        invalidParticleCount: input.result.invalidParticleCount,
        effectiveSampleSize: input.result.effectiveSampleSize,
        normalizedEffectiveSampleSize: input.result.normalizedEffectiveSampleSize,
        maximumWeight: input.result.maximumWeight,
        diagnostics: jsonValue(input.result.diagnostics),
        posteriorSummary: jsonValue(input.result.posteriorSummary),
        ensemble: jsonValue(input.result.ensemble),
        staleAt: null,
      },
      select: statusSelect,
    });
    return statusDto(record);
  }

  async latestStatus(episodeId: number) {
    const record = await this.client.modelRecoveryRun.findFirst({
      where: { episodeId },
      orderBy: [
        { staleAt: { sort: "desc", nulls: "first" } },
        { updatedAt: "desc" },
        { id: "desc" },
      ],
      select: statusSelect,
    });
    return record ? statusDto(record) : null;
  }

  /** Internal Phase 14B hook; the public status endpoint intentionally omits particles. */
  async loadCurrentEnsemble(episodeId: number) {
    return this.client.modelRecoveryRun.findFirst({
      where: { episodeId, staleAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        algorithmVersion: true,
        status: true,
        latestRecoveredDate: true,
        config: true,
        sourceFingerprint: true,
        configFingerprint: true,
        ensemble: true,
        posteriorSummary: true,
      },
    });
  }
}

export const modelRecoveryRepository = new ModelRecoveryRepository();
