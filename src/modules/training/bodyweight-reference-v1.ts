import { instantToLocalDateTime, isValidTimeZone } from "@/model/time-zone";
import type { BodyweightReferenceV1 } from "./load-accounting-v1";
import { calendarDayIndex } from "@/modules/model-episodes/model-calendar";

export type HistoricalWeightSampleV1 = {
  id: string;
  timestamp: Date;
  valueKg: number;
  source: string | null;
};

export type AsOfModelWeightV1 = {
  localDate: string;
  valueKg: number;
  episodeId: number;
  modelVersion: string;
  uncertainty: unknown | null;
};

function unavailable(localDate: string): BodyweightReferenceV1 {
  return {
    status: "unavailable",
    valueKg: null,
    localDate,
    source: null,
    sourceId: null,
  };
}

/** Exact-local-date resolver; unproven and current/latest values are ignored. */
export function resolveBodyweightReferenceV1(input: {
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
  if (!isValidTimeZone(input.timeZone)) {
    return unavailable(input.localDate);
  }

  const observed = input.observedSamples
    .filter((sample) => sample.source === "apple-health-shortcut"
      && Number.isFinite(sample.valueKg)
      && sample.valueKg > 0
      && Number.isFinite(sample.timestamp.getTime())
      && instantToLocalDateTime(sample.timestamp, input.timeZone).date === input.localDate)
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())[0];
  if (observed) {
    return {
      status: "observed",
      valueKg: observed.valueKg,
      localDate: input.localDate,
      source: "apple-health-shortcut",
      sourceId: observed.id,
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
