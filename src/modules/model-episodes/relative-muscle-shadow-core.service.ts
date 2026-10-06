import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";
import {
  EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1,
  EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
  initialExperimentalCessationStateV1,
  transitionExperimentalCessationDetrainingV1,
  type ExperimentalCessationStateV1,
} from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import {
  ENGINEERING_DAILY_HARD_SET_SCALE_TAU_V1,
  ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1,
  EXPERIMENTAL_MONTHLY_SM_RATE_KG_V1,
  EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
  estimateExperimentalSkeletalMuscleDeltaV1,
  type ExperimentalTrainingExposureKindV1,
  type ExperimentalTrainingStatusV1,
} from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import { classifyExperimentalResistanceExposureV1 } from "@/model/physiology-v7/experimental-resistance-exposure-v1";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { TrainingRepository } from "@/modules/training/training.repository";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { addCalendarDays } from "./model-calendar";

const CORE_FINGERPRINT_VERSION = "relative-muscle-episode-core-input-v1" as const;
export const RELATIVE_MUSCLE_REBUILD_LOCK_NAMESPACE = 1_886_417_000;

type RelativeMuscleDatabaseClient = PrismaClient | Prisma.TransactionClient;

type Episode = {
  id: number;
  profileId: number;
  startDate: string;
  timezone: string;
  active: boolean;
  deactivatedAt: Date | null;
  latestModeledDate: string | null;
};

type EpisodePartition = {
  episode: Episode;
  startAt: Date;
  endAt: Date | null;
};

function buildPartitions(episodes: readonly Episode[]): EpisodePartition[] {
  let partitions = [...episodes]
    .map((episode) => ({
      episode,
      startAt: localDateTimeToInstant(episode.startDate, "00:00", episode.timezone),
      endAt: null as Date | null,
    }))
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime() || left.episode.id - right.episode.id);
  const active = partitions.filter(({ episode }) => episode.active);
  if (active.length > 1) {
    throw new RangeError("Relative Muscle ModelEpisode active partition is ambiguous");
  }
  // A stale inactive row dated after the current active episode cannot own a
  // model interval. Exclude it rather than let malformed history shadow the
  // active episode or receive derived rows.
  if (active.length === 1) {
    const activeStartAt = active[0]!.startAt.getTime();
    partitions = partitions.filter(({ startAt, episode }) => episode.active || startAt.getTime() <= activeStartAt);
  }
  for (let index = 1; index < partitions.length; index += 1) {
    const previous = partitions[index - 1]!;
    const next = partitions[index]!;
    if (next.startAt.getTime() < previous.startAt.getTime()) {
      throw new RangeError("Relative Muscle ModelEpisode boundaries must be increasing");
    }
    if (next.startAt.getTime() === previous.startAt.getTime() && next.episode.id <= previous.episode.id) {
      throw new RangeError("Relative Muscle ModelEpisode boundaries with equal instants must be ordered by episode id");
    }
    // Equal episode-local start instants are deterministic: the earlier
    // episode id has an empty interval at this boundary, and the later id owns
    // dates beginning at that instant. This lets diagnostic baselines reset
    // without carrying state across same-date episode replacement.
    previous.endAt = previous.episode.active
      ? next.startAt
      : previous.episode.deactivatedAt && previous.episode.deactivatedAt < next.startAt
        ? previous.episode.deactivatedAt
        : next.startAt;
  }
  const filteredActive = partitions.filter(({ episode }) => episode.active);
  if (filteredActive.length === 1 && filteredActive[0] !== partitions.at(-1)) {
    throw new RangeError("Relative Muscle ModelEpisode active partition is ambiguous");
  }
  const last = partitions.at(-1);
  if (last && !last.episode.active) {
    last.endAt = last.episode.deactivatedAt && last.episode.deactivatedAt > last.startAt
      ? last.episode.deactivatedAt
      : last.startAt;
  }
  return partitions;
}

function episodeForInstant(partitions: readonly EpisodePartition[], instant: Date) {
  if (!Number.isFinite(instant.getTime())) return null;
  const partition = partitions.find(({ startAt, endAt }) => instant >= startAt && (endAt === null || instant < endAt));
  if (!partition) return null;
  const date = instantToLocalDateTime(instant, partition.episode.timezone).date;
  return date < partition.episode.startDate ? null : { episode: partition.episode, date };
}

function maxDate(values: readonly (string | null | undefined)[]): string | null {
  const dates = values.filter((value): value is string => typeof value === "string");
  return dates.length ? dates.reduce((latest, date) => date > latest ? date : latest) : null;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function currentFormulaFingerprint() {
  return stableSha256({
    core: CORE_FINGERPRINT_VERSION,
    deltaRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
    trainingStatus: "unknown" satisfies ExperimentalTrainingStatusV1,
    monthlyRates: EXPERIMENTAL_MONTHLY_SM_RATE_KG_V1,
    dailyHardSetScaleTau: ENGINEERING_DAILY_HARD_SET_SCALE_TAU_V1,
    maxAbsDailyDeltaKg: ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1,
    cessationRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
    cessationMonthlyEnvelope: EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1,
  });
}

/**
 * Rebuild the isolated Relative Muscle diagnostics from durable, episode-owned
 * history. Date-only nutrition/coverage is accepted only when the latest
 * snapshot proves it used the ModelEpisode timezone. Legacy rows are never
 * adopted into an episode implicitly.
 */
export async function rebuildRelativeMuscleEpisodeTrajectories(input: {
  profileId?: number;
  fromDate?: string;
  fromInstant?: Date;
  client?: PrismaClient;
}): Promise<void> {
  const client = input.client ?? prisma;
  const profileId = input.profileId ?? 1;
  try {
    await client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(CAST(${RELATIVE_MUSCLE_REBUILD_LOCK_NAMESPACE} AS integer), CAST(${profileId} AS integer))
      `;
      await rebuildRelativeMuscleEpisodeTrajectoriesInTransaction({
        ...input,
        profileId,
        client: transaction,
      });
    }, { maxWait: 10_000, timeout: 120_000 });
  } catch (rebuildError) {
    // The rebuild transaction also contains the stale markers. If it aborts,
    // those markers roll back too, so invalidate under the same profile lock
    // before returning the failure to the caller.
    try {
      await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(CAST(${RELATIVE_MUSCLE_REBUILD_LOCK_NAMESPACE} AS integer), CAST(${profileId} AS integer))
        `;
        await Promise.all([
          transaction.experimentalSkeletalMuscleDeltaShadow.updateMany({
            where: { profileId }, data: { isStale: true },
          }),
          transaction.experimentalCessationDetrainingShadow.updateMany({
            where: { profileId }, data: { isStale: true },
          }),
        ]);
      }, { maxWait: 10_000, timeout: 30_000 });
    } catch (invalidationError) {
      throw new AggregateError(
        [rebuildError, invalidationError],
        "Relative Muscle rebuild failed and its persisted candidates could not be invalidated",
      );
    }
    throw rebuildError;
  }
}

async function rebuildRelativeMuscleEpisodeTrajectoriesInTransaction(input: {
  profileId: number;
  fromDate?: string;
  fromInstant?: Date;
  client: RelativeMuscleDatabaseClient;
}): Promise<void> {
  const client = input.client;
  const profileId = input.profileId;
  const episodes = await client.modelEpisode.findMany({
    where: { profileId },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, profileId: true, startDate: true, timezone: true, active: true, deactivatedAt: true, latestModeledDate: true },
  });
  if (episodes.length === 0) return;
  const partitions = buildPartitions(episodes);
  const requestedByEpisode = new Map<number, string>();
  if (input.fromInstant) {
    const mapped = episodeForInstant(partitions, input.fromInstant);
    if (mapped) requestedByEpisode.set(mapped.episode.id, mapped.date);
  } else {
    for (const { episode } of partitions) {
      const date = input.fromDate ?? episode.startDate;
      if (date >= episode.startDate) requestedByEpisode.set(episode.id, date);
    }
  }
  if (requestedByEpisode.size > 0) {
    for (const [modelEpisodeId, date] of requestedByEpisode) {
      await Promise.all([
        client.experimentalSkeletalMuscleDeltaShadow.updateMany({
          where: { profileId, modelEpisodeId, date: { gte: date } }, data: { isStale: true },
        }),
        client.experimentalCessationDetrainingShadow.updateMany({
          where: { profileId, modelEpisodeId, date: { gte: date } }, data: { isStale: true },
        }),
      ]);
    }
  }
  const eventRowsStart = partitions[0]!.startAt;
  const [healthRows, snapshots, dailyStates, workouts, sessions] = await Promise.all([
    client.dailyHealthData.findMany({
      orderBy: { date: "asc" },
      select: { id: true, date: true, updatedAt: true, weightKg: true, proteinG: true, workoutFeedObserved: true },
    }),
    client.healthSyncSnapshot.findMany({
      orderBy: [{ date: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
      select: { id: true, date: true, receivedAt: true, timezone: true },
    }),
    client.dailyModelState.findMany({
      where: { episodeId: { in: episodes.map(({ id }) => id) } },
      orderBy: [{ episodeId: "asc" }, { date: "asc" }],
      select: { id: true, episodeId: true, date: true, status: true, modelVersion: true, energyBalanceKcal: true, updatedAt: true },
    }),
    client.workout.findMany({
      where: { hiddenFromHistory: false, startAt: { gte: eventRowsStart } },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      select: { id: true, type: true, startAt: true, endAt: true, durationMinutes: true, updatedAt: true },
    }),
    client.strengthDiarySession.findMany({
      where: { profileId, status: "COMPLETED" },
      orderBy: [{ id: "asc" }],
      select: {
        id: true, profileId: true, status: true, revision: true, updatedAt: true,
        webStartedAt: true, matchedWorkoutId: true, matchStatus: true, matchMethod: true,
        matchedWorkout: { select: { startAt: true } },
      },
    }),
  ]);

  const latestSnapshotByDate = new Map<string, typeof snapshots[number]>();
  for (const snapshot of snapshots) latestSnapshotByDate.set(snapshot.date, snapshot);
  const healthByDate = new Map(healthRows.map((row) => [row.date, row] as const));
  const stateByEpisodeDate = new Map<string, typeof dailyStates[number]>(dailyStates.map((row) => [`${row.episodeId}|${row.date}`, row] as const));
  const workoutsByEpisodeDate = new Map<string, typeof workouts>();
  const sessionsByEpisodeDate = new Map<string, typeof sessions>();
  for (const workout of workouts) {
    const time = episodeForInstant(partitions, workout.startAt);
    if (!time) continue;
    const key = `${time.episode.id}|${time.date}`;
    workoutsByEpisodeDate.set(key, [...(workoutsByEpisodeDate.get(key) ?? []), workout]);
  }
  for (const session of sessions) {
    const instant = session.matchedWorkout?.startAt ?? session.webStartedAt;
    if (!instant) continue;
    const time = episodeForInstant(partitions, instant);
    if (!time) continue;
    const key = `${time.episode.id}|${time.date}`;
    sessionsByEpisodeDate.set(key, [...(sessionsByEpisodeDate.get(key) ?? []), session]);
  }

  const trainingRepository = new TrainingRepository(client as PrismaClient);
  const formulaFingerprint = currentFormulaFingerprint();
  for (const partition of partitions) {
    const { episode } = partition;
    const episodeLastDate = partition.endAt === null
      ? null
      : instantToLocalDateTime(new Date(partition.endAt.getTime() - 1), episode.timezone).date;
    const episodeEventDates = [
      ...workouts.flatMap((row) => {
        const mapped = episodeForInstant(partitions, row.startAt);
        return mapped?.episode.id === episode.id ? [mapped.date] : [];
      }),
      ...sessions.flatMap((row) => {
        const instant = row.matchedWorkout?.startAt ?? row.webStartedAt;
        const mapped = instant ? episodeForInstant(partitions, instant) : null;
        return mapped?.episode.id === episode.id ? [mapped.date] : [];
      }),
    ];
    const trustedHealthDates = healthRows.flatMap((row) => (
      latestSnapshotByDate.get(row.date)?.timezone === episode.timezone
        && row.date >= episode.startDate
        && (episodeLastDate === null || row.date <= episodeLastDate)
        ? [row.date]
        : []
    ));
    const lastDate = maxDate([
      episode.latestModeledDate,
      ...dailyStates.filter((row) => row.episodeId === episode.id
        && row.date >= episode.startDate
        && (episodeLastDate === null || row.date <= episodeLastDate)).map(({ date }) => date),
      ...episodeEventDates,
      ...trustedHealthDates,
    ]);
    const boundedLastDate = episodeLastDate !== null && lastDate !== null && lastDate > episodeLastDate
      ? episodeLastDate
      : lastDate;
    if (!boundedLastDate || boundedLastDate < episode.startDate) continue;

    const allDates: string[] = [];
    for (let date = episode.startDate; date <= boundedLastDate; date = addCalendarDays(date, 1)) allDates.push(date);
    const dayInputs = [] as Array<{
      date: string;
      sourceFingerprint: string;
      exposureKind: ExperimentalTrainingExposureKindV1;
      hardSets: number | null;
      mappedMuscleGroupCount: number | null;
      proteinGPerKg: number | null;
      energyBalanceKcal: number | null;
      bodyMassKg: number | null;
      sourceLineage: unknown;
    }>;

    for (const date of allDates) {
      const key = `${episode.id}|${date}`;
      const healthRow = healthByDate.get(date) ?? null;
      const snapshot = latestSnapshotByDate.get(date) ?? null;
      const dateOnlySourceCompatible = healthRow !== null && snapshot?.timezone === episode.timezone;
      const health = dateOnlySourceCompatible ? healthRow : null;
      const modelState = stateByEpisodeDate.get(key);
      const dayWorkouts = workoutsByEpisodeDate.get(key) ?? [];
      const daySessions = sessionsByEpisodeDate.get(key) ?? [];

      let qualifiedHardSetCount = 0;
      let mappedMuscleGroupCount = 0;
      let hasMappedDose = false;
      const sessionEvidence: unknown[] = [];
      for (const sessionRow of daySessions) {
        const session = await trainingRepository.getSession(sessionRow.id, profileId);
        if (!session) {
          sessionEvidence.push({ id: sessionRow.id, revision: sessionRow.revision, unavailable: true });
          continue;
        }
        const canonicalInput = buildCanonicalStrengthTrainingInputV7({ session, heartRateSamples: null });
        const dose = buildQualifiedResistanceTrainingDoseV7(canonicalInput);
        if (dose.availability === "available" && dose.qualifiedHardSetCount > 0) {
          hasMappedDose = true;
          qualifiedHardSetCount += dose.qualifiedHardSetCount;
          mappedMuscleGroupCount += dose.muscleGroups.filter(({ directMappedSetCount }) => directMappedSetCount > 0).length;
        }
        sessionEvidence.push({
          id: session.id,
          revision: session.revision,
          status: session.status,
          matchStatus: session.matchStatus,
          matchMethod: session.matchMethod,
          matchedWorkoutId: session.matchedWorkoutId,
          eventAt: session.matchedWorkout?.startAt ?? session.webStartedAt,
          exercises: canonicalInput.exercises.map((exercise) => ({
            id: exercise.strengthDiarySessionExerciseId,
            order: exercise.order,
            resistanceType: exercise.resistanceType,
            mapping: exercise.muscleMappingSnapshot,
            sets: exercise.sets.map((set) => ({
              id: set.strengthSetId,
              setNumber: set.setNumber,
              reps: set.reps,
              weightKg: set.weightKg,
              bandNominalResistanceKg: set.bandNominalResistanceKg,
              rir: set.rir,
              completedAt: set.completedAt,
            })),
          })),
          dose: {
            availability: dose.availability,
            qualifiedHardSetCount: dose.qualifiedHardSetCount,
            muscleGroups: dose.availability === "available" ? dose.muscleGroups : null,
          },
        });
      }
      const canonicalStrengthObserved = dayWorkouts.some((workout) => (
        canonicalizeWorkoutType(workout.type).classification === "traditional-strength-training"
      ));
      const exposure = classifyExperimentalResistanceExposureV1({
        diaryQualifiedMapped: hasMappedDose && qualifiedHardSetCount > 0,
        diaryTrainingObserved: daySessions.length > 0,
        canonicalStrengthObserved,
        workoutFeedObserved: health?.workoutFeedObserved ?? null,
      });
      const rawWeight = health?.weightKg ?? null;
      const weight = rawWeight !== null && Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : null;
      const rawProtein = health?.proteinG ?? null;
      const proteinGPerKg = rawProtein !== null && Number.isFinite(rawProtein) && rawProtein >= 0 && weight !== null
        ? rawProtein / weight
        : null;
      const energyBalanceKcal = modelState?.status === "complete"
        && modelState.energyBalanceKcal !== null
        && Number.isFinite(modelState.energyBalanceKcal)
        ? modelState.energyBalanceKcal
        : null;
      const sourceInput = {
        date,
        episode: { id: episode.id, profileId, timezone: episode.timezone, startDate: episode.startDate },
        dateOnlySnapshot: snapshot === null ? null : {
          id: snapshot.id,
          receivedAt: snapshot.receivedAt.toISOString(),
          timezone: snapshot.timezone,
        },
        health: health === null ? null : {
          id: health.id,
          updatedAt: health.updatedAt.toISOString(),
          weightKg: health.weightKg,
          proteinG: health.proteinG,
          workoutFeedObserved: health.workoutFeedObserved,
        },
        modelState: modelState ? {
          id: modelState.id,
          status: modelState.status,
          modelVersion: modelState.modelVersion,
          energyBalanceKcal: modelState.status === "complete" ? modelState.energyBalanceKcal : null,
          updatedAt: modelState.updatedAt.toISOString(),
        } : null,
        workouts: dayWorkouts.map(({ id, type, startAt, endAt, durationMinutes, updatedAt }) => ({
          id, type, startAt: startAt.toISOString(), endAt: endAt.toISOString(), durationMinutes, updatedAt: updatedAt.toISOString(),
        })),
        sessions: sessionEvidence,
        exposure: exposure.kind,
        trainingStatus: "unknown",
        estimatorInputs: {
          qualifiedHardSetCount: exposure.doseStatus === "mapped" ? qualifiedHardSetCount : exposure.doseStatus === "verified-no-exposure" ? 0 : null,
          mappedMuscleGroupCount: mappedMuscleGroupCount > 0 ? mappedMuscleGroupCount : null,
          proteinGPerKg,
          energyBalanceKcal,
          bodyMassKg: weight,
        },
        formulaFingerprint,
      };
      dayInputs.push({
        date,
        sourceFingerprint: stableSha256({ contract: CORE_FINGERPRINT_VERSION, sourceInput }),
        exposureKind: exposure.kind,
        hardSets: exposure.doseStatus === "mapped" ? qualifiedHardSetCount : exposure.doseStatus === "verified-no-exposure" ? 0 : null,
        mappedMuscleGroupCount: mappedMuscleGroupCount > 0 ? mappedMuscleGroupCount : null,
        proteinGPerKg,
          energyBalanceKcal,
        bodyMassKg: weight,
        sourceLineage: {
          contract: CORE_FINGERPRINT_VERSION,
          episodeId: episode.id,
          modelDate: date,
          episodeTimezone: episode.timezone,
          dateOnlySourceTimezone: snapshot?.timezone ?? null,
          dateOnlySourceCompatible,
          sourceFingerprint: stableSha256({ contract: CORE_FINGERPRINT_VERSION, sourceInput }),
        },
      });
    }

    let requestedDate = input.fromDate ?? episode.startDate;
    if (input.fromInstant) {
      const mapped = episodeForInstant(partitions, input.fromInstant);
      if (mapped?.episode.id === episode.id) requestedDate = mapped.date;
      else continue;
    }
    const startDate = requestedDate < episode.startDate ? episode.startDate : requestedDate;
    const replayStartIndex = dayInputs.findIndex(({ date }) => date >= startDate);
    if (replayStartIndex < 0) continue;
    const formulaAndSourceCompatible = await isExactCompatiblePrefix({
      client,
      profileId,
      episode,
      dayInputs,
      throughIndex: replayStartIndex - 1,
    });
    const effectiveStartIndex = formulaAndSourceCompatible ? replayStartIndex : 0;
    const effectiveStartDate = dayInputs[effectiveStartIndex]!.date;

    // Fail closed before writing candidates: if replay is interrupted, every
    // unrecomputed row in the affected suffix remains explicitly stale.
    await Promise.all([
      client.experimentalSkeletalMuscleDeltaShadow.updateMany({
        where: { profileId, modelEpisodeId: episode.id, date: { gte: effectiveStartDate } },
        data: { isStale: true },
      }),
      client.experimentalCessationDetrainingShadow.updateMany({
        where: { profileId, modelEpisodeId: episode.id, date: { gte: effectiveStartDate } },
        data: { isStale: true },
      }),
    ]);

    let deltaCumulative: number | null = effectiveStartIndex === 0
      ? 0
      : readDeltaCumulative(await client.experimentalSkeletalMuscleDeltaShadow.findUnique({
          where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episode.id, date: dayInputs[effectiveStartIndex - 1]!.date } },
          select: { result: true },
        }));
    let cessationState: ExperimentalCessationStateV1 = effectiveStartIndex === 0
      ? initialExperimentalCessationStateV1(0)
      : readCessationState(await client.experimentalCessationDetrainingShadow.findUnique({
          where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episode.id, date: dayInputs[effectiveStartIndex - 1]!.date } },
          select: { result: true },
        })) ?? initialExperimentalCessationStateV1(0);
    let previousDeltaSourceFingerprint = effectiveStartIndex === 0 ? null : await getDeltaSourceFingerprint(client, profileId, episode.id, dayInputs[effectiveStartIndex - 1]!.date);
    let previousCessationSourceFingerprint = effectiveStartIndex === 0 ? null : await getCessationSourceFingerprint(client, profileId, episode.id, dayInputs[effectiveStartIndex - 1]!.date);

    for (const source of dayInputs.slice(effectiveStartIndex)) {
      const delta = estimateExperimentalSkeletalMuscleDeltaV1({
        qualifiedHardSetCount: source.hardSets,
        mappedMuscleGroupCount: source.mappedMuscleGroupCount,
        trainingExposureKind: source.exposureKind,
        trainingStatus: "unknown",
        proteinGPerKg: source.proteinGPerKg,
        energyBalanceKcal: source.energyBalanceKcal,
        bodyMassKg: source.bodyMassKg,
        priorRelativeCumulativeDeltaKg: deltaCumulative,
      });
      const deltaSourceFingerprint = stableSha256({
        contract: CORE_FINGERPRINT_VERSION,
        kind: "daily-relative-muscle-delta",
        episodeId: episode.id,
        date: source.date,
        timezone: episode.timezone,
        inputs: source.sourceFingerprint,
        formulaFingerprint,
        predecessor: previousDeltaSourceFingerprint,
      });
      const deltaFeatures = {
        ...delta.features,
        lineage: {
          ...source.sourceLineage as object,
          predecessorSourceFingerprint: previousDeltaSourceFingerprint,
          resultFingerprint: stableSha256(delta),
        },
      };

      const cessation = transitionExperimentalCessationDetrainingV1({
        exposureKind: source.exposureKind,
        prior: cessationState,
        trainingSkeletalMuscleDeltaKg: source.exposureKind === "qualified-mapped-training"
          ? delta.availability === "available" ? delta.estimatedSkeletalMuscleDeltaKg : null
          : null,
      });
      const cessationSourceFingerprint = stableSha256({
        contract: CORE_FINGERPRINT_VERSION,
        kind: "episode-relative-muscle-state",
        episodeId: episode.id,
        date: source.date,
        timezone: episode.timezone,
        inputs: source.sourceFingerprint,
        dailyDelta: deltaSourceFingerprint,
        formulaFingerprint,
        predecessor: previousCessationSourceFingerprint,
      });
      const cessationFeatures = {
        ...cessation.features,
        lineage: {
          ...source.sourceLineage as object,
          predecessorSourceFingerprint: previousCessationSourceFingerprint,
          dailyDeltaSourceFingerprint: deltaSourceFingerprint,
          resultFingerprint: stableSha256(cessation),
        },
      };

      await client.experimentalSkeletalMuscleDeltaShadow.upsert({
          where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episode.id, date: source.date } },
          create: {
            profileId, modelEpisodeId: episode.id, date: source.date, sourceFingerprint: deltaSourceFingerprint,
            modelRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION, isStale: false,
            features: json(deltaFeatures), result: json(delta),
          },
          update: {
            sourceFingerprint: deltaSourceFingerprint, modelRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
            isStale: false, features: json(deltaFeatures), result: json(delta),
          },
        });
      await client.experimentalCessationDetrainingShadow.upsert({
          where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episode.id, date: source.date } },
          create: {
            profileId, modelEpisodeId: episode.id, date: source.date, sourceFingerprint: cessationSourceFingerprint,
            modelRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, isStale: false,
            features: json(cessationFeatures), result: json(cessation),
          },
          update: {
            sourceFingerprint: cessationSourceFingerprint, modelRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
            isStale: false, features: json(cessationFeatures), result: json(cessation),
          },
        });
      deltaCumulative = delta.state.relativeCumulativeDeltaKg;
      cessationState = cessation.state;
      previousDeltaSourceFingerprint = deltaSourceFingerprint;
      previousCessationSourceFingerprint = cessationSourceFingerprint;
    }
  }
}

function readDeltaCumulative(row: { result: Prisma.JsonValue } | null): number | null {
  if (!row || !row.result || typeof row.result !== "object" || Array.isArray(row.result)) return null;
  const state = (row.result as { state?: { relativeCumulativeDeltaKg?: unknown } }).state;
  return typeof state?.relativeCumulativeDeltaKg === "number" && Number.isFinite(state.relativeCumulativeDeltaKg)
    ? state.relativeCumulativeDeltaKg
    : null;
}

function hasValidDeltaState(result: Prisma.JsonValue): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const state = (result as { state?: { relativeCumulativeDeltaKg?: unknown } }).state;
  return state !== null && typeof state === "object"
    && (state.relativeCumulativeDeltaKg === null
      || (typeof state.relativeCumulativeDeltaKg === "number" && Number.isFinite(state.relativeCumulativeDeltaKg)));
}

function readCessationState(row: { result: Prisma.JsonValue } | null): ExperimentalCessationStateV1 | null {
  if (!row || !row.result || typeof row.result !== "object" || Array.isArray(row.result)) return null;
  const state = (row.result as { state?: unknown }).state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const candidate = state as ExperimentalCessationStateV1;
  if (!Number.isInteger(candidate.observedNoExposureStreakDays) || candidate.observedNoExposureStreakDays < 0
      || typeof candidate.hadPriorQualifiedTraining !== "boolean"
      || !["not-in-cessation", "verified-rest-or-grace", "detraining", "unknown-coverage-not-cessation"].includes(candidate.phase)
      || candidate.absoluteSkeletalMuscleKg !== null
      || (candidate.relativeCumulativeDeltaKg !== null && !Number.isFinite(candidate.relativeCumulativeDeltaKg))) return null;
  return candidate;
}

async function getDeltaSourceFingerprint(client: RelativeMuscleDatabaseClient, profileId: number, modelEpisodeId: number, date: string) {
  return (await client.experimentalSkeletalMuscleDeltaShadow.findUnique({
    where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId, date } }, select: { sourceFingerprint: true },
  }))?.sourceFingerprint ?? null;
}

async function getCessationSourceFingerprint(client: RelativeMuscleDatabaseClient, profileId: number, modelEpisodeId: number, date: string) {
  return (await client.experimentalCessationDetrainingShadow.findUnique({
    where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId, date } }, select: { sourceFingerprint: true },
  }))?.sourceFingerprint ?? null;
}

async function isExactCompatiblePrefix(input: {
  client: RelativeMuscleDatabaseClient;
  profileId: number;
  episode: Episode;
  dayInputs: Array<{ date: string; sourceFingerprint: string }>;
  throughIndex: number;
}): Promise<boolean> {
  if (input.throughIndex < 0) return true;
  const prefixDates = input.dayInputs.slice(0, input.throughIndex + 1);
  const [deltaRows, cessationRows] = await Promise.all([
    input.client.experimentalSkeletalMuscleDeltaShadow.findMany({
      where: { profileId: input.profileId, modelEpisodeId: input.episode.id, date: { lte: prefixDates.at(-1)!.date } },
      orderBy: { date: "asc" },
      select: { date: true, sourceFingerprint: true, modelRevision: true, isStale: true, features: true, result: true },
    }),
    input.client.experimentalCessationDetrainingShadow.findMany({
      where: { profileId: input.profileId, modelEpisodeId: input.episode.id, date: { lte: prefixDates.at(-1)!.date } },
      orderBy: { date: "asc" },
      select: { date: true, sourceFingerprint: true, modelRevision: true, isStale: true, features: true, result: true },
    }),
  ]);
  if (deltaRows.length !== prefixDates.length || cessationRows.length !== prefixDates.length) return false;
  let priorDeltaToken: string | null = null;
  let priorCessationToken: string | null = null;
  const formulaFingerprint = currentFormulaFingerprint();
  for (let index = 0; index < prefixDates.length; index += 1) {
    const expectedDay = prefixDates[index]!;
    const delta = deltaRows[index]!;
    const cessation = cessationRows[index]!;
    if (delta.date !== expectedDay.date || cessation.date !== expectedDay.date || delta.isStale || cessation.isStale
        || delta.modelRevision !== EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION
        || cessation.modelRevision !== EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION) return false;
    const expectedDeltaToken = stableSha256({
      contract: CORE_FINGERPRINT_VERSION, kind: "daily-relative-muscle-delta",
      episodeId: input.episode.id, date: expectedDay.date, timezone: input.episode.timezone,
      inputs: expectedDay.sourceFingerprint, formulaFingerprint, predecessor: priorDeltaToken,
    });
    const expectedCessationToken = stableSha256({
      contract: CORE_FINGERPRINT_VERSION, kind: "episode-relative-muscle-state",
      episodeId: input.episode.id, date: expectedDay.date, timezone: input.episode.timezone,
      inputs: expectedDay.sourceFingerprint, dailyDelta: expectedDeltaToken,
      formulaFingerprint, predecessor: priorCessationToken,
    });
    if (delta.sourceFingerprint !== expectedDeltaToken || cessation.sourceFingerprint !== expectedCessationToken) return false;
    const deltaLineage = jsonObject(delta.features).lineage as Record<string, unknown> | undefined;
    const cessationLineage = jsonObject(cessation.features).lineage as Record<string, unknown> | undefined;
    if (deltaLineage?.predecessorSourceFingerprint !== priorDeltaToken
        || cessationLineage?.predecessorSourceFingerprint !== priorCessationToken
        || cessationLineage?.dailyDeltaSourceFingerprint !== expectedDeltaToken
        || deltaLineage?.resultFingerprint !== stableSha256(delta.result)
        || cessationLineage?.resultFingerprint !== stableSha256(cessation.result)) return false;
    if (!hasValidDeltaState(delta.result)) return false;
    if (readCessationState({ result: cessation.result }) === null) return false;
    priorDeltaToken = expectedDeltaToken;
    priorCessationToken = expectedCessationToken;
  }
  return true;
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
