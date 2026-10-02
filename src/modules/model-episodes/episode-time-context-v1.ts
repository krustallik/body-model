import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";

export type EpisodeTimeContextRowV1 = {
  startDate: string;
  timezone: string;
  active: boolean;
};

/** Resolve an event instant to the calendar-date partition owned by its episode. */
export function episodeTimeContextForInstantV1<T extends EpisodeTimeContextRowV1>(
  episodes: readonly T[],
  instant: Date,
  fallbackTimeZone = DEFAULT_TIME_ZONE,
): { episode: T | null; date: string; timeZone: string } {
  for (let index = episodes.length - 1; index >= 0; index -= 1) {
    const episode = episodes[index]!;
    const date = instantToLocalDateTime(instant, episode.timezone).date;
    const nextStart = episodes[index + 1]?.startDate ?? null;
    if (date >= episode.startDate && (nextStart === null || date < nextStart)) {
      return { episode, date, timeZone: episode.timezone };
    }
    if (episode.active && date >= episode.startDate) {
      return { episode, date, timeZone: episode.timezone };
    }
  }
  const timeZone = fallbackTimeZone || DEFAULT_TIME_ZONE;
  return { episode: null, date: instantToLocalDateTime(instant, timeZone).date, timeZone };
}
