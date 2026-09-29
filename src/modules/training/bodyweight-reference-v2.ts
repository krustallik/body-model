import { instantToLocalDateTime, isValidTimeZone } from "@/model/time-zone";
import { calendarDayIndex } from "@/modules/model-episodes/model-calendar";
import type { BodyweightReferenceV1 } from "./load-accounting-v1";
import type { AsOfModelWeightV1, HistoricalWeightSampleV1 } from "./bodyweight-reference-v1";

export const BODYWEIGHT_RESOLUTION_METHOD_V2 = "bodycast-bodyweight-resolution-v2" as const;
export const BODYWEIGHT_NEAREST_WINDOW_DAYS_V2 = 7;

function unavailable(localDate: string): BodyweightReferenceV1 {
  return { status: "unavailable", valueKg: null, localDate, source: null, sourceId: null };
}

function deterministicSampleOrder(left: HistoricalWeightSampleV1, right: HistoricalWeightSampleV1): number {
  const timeOrder = right.timestamp.getTime() - left.timestamp.getTime();
  if (timeOrder !== 0) return timeOrder;
  return right.id.localeCompare(left.id, undefined, { numeric: true });
}

/** Resolves only explicit Apple Health observations, then a safe as-of model estimate. */
export function resolveBodyweightReferenceV2(input: {
  localDate: string;
  timeZone: string;
  observedSamples: readonly HistoricalWeightSampleV1[];
  modelEstimate?: AsOfModelWeightV1 | null;
}): BodyweightReferenceV1 {
  try {
    calendarDayIndex(input.localDate);
  } catch {
    return unavailable(input.localDate);
  }
  if (!isValidTimeZone(input.timeZone)) return unavailable(input.localDate);

  const targetDay = calendarDayIndex(input.localDate);
  const valid = input.observedSamples.flatMap((sample) => {
    if (sample.source !== "apple-health-shortcut"
        || !Number.isFinite(sample.valueKg)
        || sample.valueKg <= 0
        || !Number.isFinite(sample.timestamp.getTime())) return [];
    const observationLocalDate = instantToLocalDateTime(sample.timestamp, input.timeZone).date;
    const day = calendarDayIndex(observationLocalDate);
    return Math.abs(day - targetDay) <= BODYWEIGHT_NEAREST_WINDOW_DAYS_V2
      ? [{ sample, observationLocalDate, day, distance: Math.abs(day - targetDay) }]
      : [];
  });

  const selected = valid.sort((left, right) => (
    left.distance - right.distance
    || left.day - right.day
    || deterministicSampleOrder(left.sample, right.sample)
  ))[0];
  if (selected) {
    if (selected.distance === 0) {
      return {
        status: "observed",
        valueKg: selected.sample.valueKg,
        localDate: input.localDate,
        source: "apple-health-shortcut",
        sourceId: selected.sample.id,
      };
    }
    return {
      status: "nearest-observed",
      valueKg: selected.sample.valueKg,
      localDate: input.localDate,
      observationLocalDate: selected.observationLocalDate,
      dayOffset: selected.day - targetDay,
      approximate: true,
      source: "apple-health-shortcut",
      sourceId: selected.sample.id,
    };
  }

  const estimate = input.modelEstimate;
  if (estimate
      && estimate.localDate === input.localDate
      && Number.isFinite(estimate.valueKg)
      && estimate.valueKg > 0
      && Number.isInteger(estimate.episodeId)
      && estimate.episodeId > 0
      && estimate.modelVersion.length > 0) {
    return {
      status: "model-estimated",
      valueKg: estimate.valueKg,
      localDate: estimate.localDate,
      source: "bodycast-as-of-model",
      sourceId: String(estimate.episodeId),
      modelVersion: estimate.modelVersion,
      uncertainty: estimate.uncertainty,
    };
  }
  return unavailable(input.localDate);
}
