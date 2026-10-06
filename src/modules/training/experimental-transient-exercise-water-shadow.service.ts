import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  buildTransientExerciseWaterImpulseV2,
  EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
  EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REPLAY_REVISION,
  resolveTransientWaterV2Exposure,
  transientExerciseWaterV2Fingerprint,
  type TransientExerciseWaterImpulseV2,
} from "@/model/physiology-v7/experimental-transient-exercise-water-v2";
import {
  buildQualifiedResistanceTrainingDoseV7,
  qualifiedResistanceTrainingDoseV7Fingerprint,
} from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import {
  buildTransientEpisodePartitionsV2,
  transientEpisodeTimeForInstantV2,
  type TransientEpisodePartitionV2,
  type TransientEpisodeTimeRowV2,
} from "@/modules/model-episodes/transient-exercise-water-episode-time-v2";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { TrainingRepository } from "./training.repository";

type DbClient = PrismaClient | Prisma.TransactionClient;
type CompletedSource = Awaited<ReturnType<typeof TrainingRepository.listCompletedTransientWaterSourcesV2FromClient>>[number];
type Episode = TransientEpisodeTimeRowV2 & {
  profileId: number;
  updatedAt: Date;
  modelVersion: string;
};

export class TransientExerciseWaterSourceUnavailableError extends Error {
  constructor(reason: string) {
    super(`transient exercise-water source unavailable: ${reason}`);
  }
}

export class TransientExerciseWaterConcurrentSourceChangeError extends Error {
  constructor() {
    super("Strength or ModelEpisode sources changed during transient-water rebuild");
  }
}

type SourceSnapshot = {
  episodes: Episode[];
  partitions: TransientEpisodePartitionV2<Episode>[];
  sources: CompletedSource[];
  token: string;
};

async function readSourceSnapshot(db: DbClient, profileId: number): Promise<SourceSnapshot> {
  const [episodes, sources] = await Promise.all([
    db.modelEpisode.findMany({
      where: { profileId },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        profileId: true,
        startDate: true,
        timezone: true,
        active: true,
        deactivatedAt: true,
        updatedAt: true,
        modelVersion: true,
      },
    }),
    TrainingRepository.listCompletedTransientWaterSourcesV2FromClient(db, profileId),
  ]);
  const partitions = buildTransientEpisodePartitionsV2(episodes);
  const resolved = sources.map((source) => {
    const eventInstant = source.canonicalEventInstant;
    const resolvedTime = transientEpisodeTimeForInstantV2(partitions, eventInstant);
    if (resolvedTime === null) {
      throw new TransientExerciseWaterSourceUnavailableError(`session ${source.session.id} has no unambiguous episode partition`);
    }
    return {
      id: source.session.id,
      instant: eventInstant.toISOString(),
      episodeId: resolvedTime.episode.id,
      modelDate: resolvedTime.modelDate,
      source: source.sourceDependencyFingerprint,
    };
  });
  return {
    episodes,
    partitions,
    sources,
    token: transientExerciseWaterV2Fingerprint({
      profileId,
      revision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
      replayRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REPLAY_REVISION,
      partitionContract: "instant-half-open-episode-local-midnight-v2",
      episodes: episodes.map((episode) => ({
        id: episode.id,
        profileId: episode.profileId,
        startDate: episode.startDate,
        timezone: episode.timezone,
        active: episode.active,
        deactivatedAt: episode.deactivatedAt?.toISOString() ?? null,
        updatedAt: episode.updatedAt.toISOString(),
        modelVersion: episode.modelVersion,
      })),
      completedStrengthSources: resolved,
    }),
  };
}

/** Complete source-token read used by Unified's late-writer CAS. */
export async function readTransientExerciseWaterSourceTokenV2(
  db: DbClient,
  profileId: number,
): Promise<string> {
  return (await readSourceSnapshot(db, profileId)).token;
}

function candidateImpulses(snapshot: SourceSnapshot): TransientExerciseWaterImpulseV2[] {
  const resolvedSources = snapshot.sources.map((source) => {
    const time = transientEpisodeTimeForInstantV2(snapshot.partitions, source.canonicalEventInstant);
    if (time === null) throw new TransientExerciseWaterSourceUnavailableError(`session ${source.session.id} lost its episode mapping`);
    return { ...source, episode: time.episode, modelDate: time.modelDate };
  });
  const sessionEvents = resolvedSources.map((source) => ({
    strengthDiarySessionId: source.session.id,
    eventInstant: source.canonicalEventInstant,
    sourceFingerprint: source.sourceDependencyFingerprint,
  }));
  return resolvedSources.map((source) => {
    const exposure = resolveTransientWaterV2Exposure({
      event: sessionEvents.find((event) => event.strengthDiarySessionId === source.session.id)!,
      completedEvents: sessionEvents,
    });
    const { exposureClass } = exposure;
    const canonicalInput = buildCanonicalStrengthTrainingInputV7({ session: source.session, heartRateSamples: null });
    const dose = buildQualifiedResistanceTrainingDoseV7(canonicalInput);
    const doseFingerprint = qualifiedResistanceTrainingDoseV7Fingerprint(dose);
    const doseInputFingerprint = transientExerciseWaterV2Fingerprint({ canonicalInput, doseFingerprint });
    const doseAvailable = dose.availability === "available";
    const doseCount = doseAvailable ? dose.qualifiedHardSetCount : 0;
    const dependencyFingerprint = exposure.dependencyFingerprint;
    const sourceFingerprint = transientExerciseWaterV2Fingerprint({
      sessionSource: source.sourceDependencyFingerprint,
      canonicalEventInstant: source.canonicalEventInstant.toISOString(),
      episode: {
        id: source.episode.id,
        startDate: source.episode.startDate,
        timezone: source.episode.timezone,
        updatedAt: source.episode.updatedAt.toISOString(),
      },
      canonicalInput,
      dose,
      dependencyFingerprint,
      exposureClass,
    });
    return buildTransientExerciseWaterImpulseV2({
      strengthDiarySessionId: source.session.id,
      canonicalEventInstant: source.canonicalEventInstant,
      modelEpisodeId: source.episode.id,
      modelDate: source.modelDate,
      sessionRevision: source.session.revision,
      doseInputFingerprint,
      doseAvailability: doseAvailable ? "available" : "unavailable",
      doseProvenance: doseAvailable
        ? `qualified-hard-sets:${dose.qualifiedHardSetCount};fingerprint:${doseFingerprint}`
        : `unavailable:${dose.reason ?? "unknown-dose"};recordedSets:${dose.recordedSetCount}`,
      qualifiedHardSetCount: doseCount,
      exposureClass,
      exposureDependencyFingerprint: dependencyFingerprint,
      exposureDependencies: exposure.dependencies.map((dependency) => ({
        strengthDiarySessionId: dependency.strengthDiarySessionId,
        eventInstant: dependency.eventInstant.toISOString(),
        sourceFingerprint: dependency.sourceFingerprint,
      })),
      sourceFingerprint,
    });
  });
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function sourceRow(impulse: TransientExerciseWaterImpulseV2, profileId: number) {
  const result = {
    contractVersion: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
    replayRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REPLAY_REVISION,
    impulse,
    sourceFingerprint: impulse.sourceFingerprint,
    coverage: "complete-profile-completed-strength-scan-v2",
  };
  return {
    sessionId: impulse.strengthDiarySessionId,
    profileId,
    sourceFingerprint: impulse.sourceFingerprint,
    modelRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
    features: json(impulse),
    result: json(result),
  };
}

export async function rebuildExperimentalTransientExerciseWaterV2(input: {
  profileId?: number;
  client?: PrismaClient;
  onCandidateComputed?: () => Promise<void>;
} = {}): Promise<{ earliestModelDate: string | null; sourceToken: string; impulseCount: number }> {
  const profileId = input.profileId ?? 1;
  const client = input.client ?? prisma;
  const before = await readSourceSnapshot(client, profileId);
  const impulses = candidateImpulses(before);
  await input.onCandidateComputed?.();

  let affectedDates: string[] = [];
  await client.$transaction(async (tx) => {
    const lifecycle = new PhysiologyV7PersistenceRepository(tx);
    await lifecycle.lockProfile(profileId);
    const current = await readSourceSnapshot(tx, profileId);
    if (current.token !== before.token) throw new TransientExerciseWaterConcurrentSourceChangeError();
    const sessionIds = impulses.map((impulse) => impulse.strengthDiarySessionId);
    const existingRows = await tx.experimentalTransientExerciseWaterShadow.findMany({
      where: { profileId, modelRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION },
      select: { sessionId: true, sourceFingerprint: true, result: true },
    });
    const existingBySession = new Map(existingRows.map((row) => [row.sessionId, row]));
    const currentSessionIds = new Set(impulses.map((impulse) => impulse.strengthDiarySessionId));
    const changedDates: string[] = [];
    const addPreviousDate = (value: unknown) => {
      const result = value && typeof value === "object" ? value as { impulse?: { modelDate?: unknown } } : null;
      const date = result?.impulse?.modelDate;
      if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) changedDates.push(date);
    };
    for (const impulse of impulses) {
      const existing = existingBySession.get(impulse.strengthDiarySessionId);
      if (existing?.sourceFingerprint === impulse.sourceFingerprint) continue;
      changedDates.push(impulse.modelDate);
      addPreviousDate(existing?.result);
      const row = sourceRow(impulse, profileId);
      await tx.experimentalTransientExerciseWaterShadow.upsert({
        where: { sessionId: impulse.strengthDiarySessionId },
        create: row,
        update: {
          profileId,
          sourceFingerprint: row.sourceFingerprint,
          modelRevision: row.modelRevision,
          features: row.features,
          result: row.result,
        },
      });
    }
    for (const existing of existingRows) {
      if (!currentSessionIds.has(existing.sessionId)) {
        addPreviousDate(existing.result);
      }
    }
    const deleted = await tx.experimentalTransientExerciseWaterShadow.deleteMany({
      where: {
        profileId,
        modelRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
        ...(sessionIds.length > 0 ? { sessionId: { notIn: sessionIds } } : {}),
      },
    });
    affectedDates = changedDates;
    if (changedDates.length > 0 || deleted.count > 0) {
      await lifecycle.invalidateUnifiedPublication(profileId);
    }
  });
  const earliestModelDate = affectedDates.sort()[0] ?? null;
  return { earliestModelDate, sourceToken: before.token, impulseCount: impulses.length };
}
