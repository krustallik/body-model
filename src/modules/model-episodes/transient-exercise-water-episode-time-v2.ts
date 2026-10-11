import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";

export const TRANSIENT_EPISODE_PARTITION_V2_REVISION = "transient-water-v2-active-bounded-stale-inactive-highest-id-tie-wins" as const;
export const TRANSIENT_EPISODE_PARTITION_V2_CONTRACT = "instant-half-open-episode-local-midnight-v2-highest-id-equal-start-wins-active-bounded-stale-inactive-suppressed" as const;

export type TransientEpisodeTimeRowV2 = {
  id: number;
  startDate: string;
  timezone: string;
  active: boolean;
  deactivatedAt: Date | null;
};

export type TransientEpisodePartitionV2<T extends TransientEpisodeTimeRowV2 = TransientEpisodeTimeRowV2> = {
  episode: T;
  startInstant: Date;
  endInstant: Date | null;
};

export type TransientEpisodeEventTimeV2<T extends TransientEpisodeTimeRowV2 = TransientEpisodeTimeRowV2> = {
  episode: T;
  modelDate: string;
  timeZone: string;
};

export type TransientModelDayBoundaryV2 = {
  episodeId: number;
  modelDate: string;
  boundaryInstant: Date;
};

export function transientModelDayIdentityV2(episodeId: number, modelDate: string): string {
  return `${episodeId}|${modelDate}`;
}

export function indexTransientModelDayBoundariesV2<T extends Pick<TransientModelDayBoundaryV2, "episodeId" | "modelDate">>(
  boundaries: readonly T[],
): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const boundary of boundaries) {
    const key = transientModelDayIdentityV2(boundary.episodeId, boundary.modelDate);
    if (indexed.has(key)) throw new RangeError(`duplicate episode model-day boundary ${key}`);
    indexed.set(key, boundary);
  }
  return indexed;
}

export function requireTransientModelDayBoundaryV2<T>(
  indexed: ReadonlyMap<string, T>,
  episodeId: number,
  modelDate: string,
): T {
  const key = transientModelDayIdentityV2(episodeId, modelDate);
  const boundary = indexed.get(key);
  if (boundary === undefined) throw new RangeError(`missing episode model-day boundary ${key}`);
  return boundary;
}

export function buildTransientEpisodePartitionsV2<T extends TransientEpisodeTimeRowV2>(
  rows: readonly T[],
): TransientEpisodePartitionV2<T>[] {
  const ids = new Set<number>();
  const partitions = rows.map((episode) => {
    if (!Number.isInteger(episode.id) || episode.id <= 0 || ids.has(episode.id)) {
      throw new RangeError("ModelEpisode IDs must be unique positive integers");
    }
    ids.add(episode.id);
    const startInstant = localDateTimeToInstant(episode.startDate, "00:00", episode.timezone);
    if (episode.startDate !== instantToLocalDateTime(startInstant, episode.timezone).date) {
      throw new RangeError("ModelEpisode start boundary does not round-trip in its timezone");
    }
    return { episode, startInstant, endInstant: null as Date | null };
  }).sort((left, right) => left.startInstant.getTime() - right.startInstant.getTime()
    || left.episode.id - right.episode.id);

  const active = partitions.filter(({ episode }) => episode.active);
  if (active.length > 1) {
    throw new RangeError("ModelEpisode active partition is ambiguous or not the latest boundary");
  }
  // Match the established Relative Muscle partition contract: a stale
  // inactive row dated after the single active episode cannot own an
  // interval or shadow the active episode. Keep equal-instant rows so the
  // existing highest-ID boundary rule remains authoritative.
  const activeStart = active[0]?.startInstant.getTime();
  const effectivePartitions = activeStart === undefined
    ? partitions
    : partitions.filter(({ episode, startInstant }) => episode.active || startInstant.getTime() <= activeStart);
  const effectiveActive = effectivePartitions.filter(({ episode }) => episode.active);
  if (effectiveActive.length === 1 && effectiveActive[0] !== effectivePartitions.at(-1)) {
    throw new RangeError("ModelEpisode active partition is ambiguous or not the latest boundary");
  }
  for (let index = 1; index < effectivePartitions.length; index += 1) {
    if (effectivePartitions[index]!.startInstant.getTime() < effectivePartitions[index - 1]!.startInstant.getTime()) {
      throw new RangeError("ModelEpisode boundaries must be ordered");
    }
    // Sorting ties by ascending ID gives the highest ID the exact instant.
    // The prior half-open interval becomes empty, matching Relative Muscle's
    // same-start replacement rule without changing any source observations.
    effectivePartitions[index - 1]!.endInstant = effectivePartitions[index]!.startInstant;
  }
  const last = effectivePartitions.at(-1);
  if (last) {
    last.endInstant = null;
    if (!last.episode.active) {
      if (last.episode.deactivatedAt === null
          || !Number.isFinite(last.episode.deactivatedAt.getTime())
          || last.episode.deactivatedAt.getTime() <= last.startInstant.getTime()) {
        throw new RangeError("last inactive ModelEpisode has no valid upper boundary");
      }
      last.endInstant = last.episode.deactivatedAt;
    }
  }
  return effectivePartitions;
}

export function transientEpisodeTimeForInstantV2<T extends TransientEpisodeTimeRowV2>(
  partitions: readonly TransientEpisodePartitionV2<T>[],
  instant: Date,
): TransientEpisodeEventTimeV2<T> | null {
  if (!Number.isFinite(instant.getTime())) return null;
  const partition = partitions.find(({ startInstant, endInstant }) => instant.getTime() >= startInstant.getTime()
    && (endInstant === null || instant.getTime() < endInstant.getTime()));
  if (!partition) return null;
  const modelDate = instantToLocalDateTime(instant, partition.episode.timezone).date;
  if (modelDate < partition.episode.startDate) return null;
  return { episode: partition.episode, modelDate, timeZone: partition.episode.timezone };
}

/**
 * Returns the ordered model-day boundaries in an absolute-instant window.
 * Episode starts are boundaries even when a timezone transition makes the
 * preceding episode's next local midnight later or earlier in UTC.
 */
export function transientModelDayBoundariesV2<T extends TransientEpisodeTimeRowV2>(input: {
  partitions: readonly TransientEpisodePartitionV2<T>[];
  fromInstant: Date;
  throughInstant: Date;
}): TransientModelDayBoundaryV2[] {
  if (!Number.isFinite(input.fromInstant.getTime()) || !Number.isFinite(input.throughInstant.getTime())
      || input.throughInstant.getTime() < input.fromInstant.getTime()) {
    throw new RangeError("transient boundary interval is invalid");
  }
  const boundaries: TransientModelDayBoundaryV2[] = [];
  for (const partition of input.partitions) {
    const intervalStart = Math.max(partition.startInstant.getTime(), input.fromInstant.getTime());
    const intervalEnd = Math.min(partition.endInstant?.getTime() ?? Number.POSITIVE_INFINITY,
      input.throughInstant.getTime());
    if (intervalStart >= intervalEnd) continue;

    let date = instantToLocalDateTime(new Date(intervalStart), partition.episode.timezone).date;
    let dateStart = localDateTimeToInstant(date, "00:00", partition.episode.timezone);
    let boundary = dateStart.getTime() < partition.startInstant.getTime()
      ? partition.startInstant
      : dateStart;
    if (boundary.getTime() < input.fromInstant.getTime()) {
      date = addCalendarDays(date, 1);
      dateStart = localDateTimeToInstant(date, "00:00", partition.episode.timezone);
      boundary = dateStart;
    }
    while (boundary.getTime() < intervalEnd) {
      boundaries.push({ episodeId: partition.episode.id, modelDate: date, boundaryInstant: boundary });
      date = addCalendarDays(date, 1);
      const nextDateStart = localDateTimeToInstant(date, "00:00", partition.episode.timezone);
      if (nextDateStart.getTime() <= boundary.getTime()) {
        throw new RangeError("episode-local model-day boundaries are not strictly increasing");
      }
      boundary = nextDateStart;
    }
  }
  boundaries.sort((left, right) => left.boundaryInstant.getTime() - right.boundaryInstant.getTime()
    || left.episodeId - right.episodeId);
  for (let index = 1; index < boundaries.length; index += 1) {
    if (boundaries[index]!.boundaryInstant.getTime() <= boundaries[index - 1]!.boundaryInstant.getTime()) {
      throw new RangeError("transient model-day boundaries must be unique and strictly increasing");
    }
  }
  return boundaries;
}
