import type { DiagnosticsDto } from "@/modules/model-diagnostics/model-diagnostics.types";
import {
  hasDiagnosticsCurrentEstimate,
  MODEL_DIAGNOSTICS_RECENT_WINDOW_DAYS,
} from "@/modules/model-diagnostics/model-diagnostics";
import type { EpisodeCalculation } from "./episode-calculation";
import { addCalendarDays } from "./model-calendar";

export type EpisodeSwitchReadiness = {
  latestModeledDate: string | null;
  currentEstimateAvailable: boolean;
  usableModeledCoverageDays: number;
};

export function episodeReadinessFromDiagnostics(
  diagnostics: Pick<DiagnosticsDto, "episode" | "currentState" | "dataContinuity">,
): EpisodeSwitchReadiness {
  return {
    latestModeledDate: diagnostics.episode.latestModeledDate,
    currentEstimateAvailable: diagnostics.currentState.status === "available",
    usableModeledCoverageDays: diagnostics.dataContinuity.completeDayCount,
  };
}

export function episodeReadinessFromCalculation(input: {
  calculation: EpisodeCalculation;
  startDate: string;
}): EpisodeSwitchReadiness {
  const latestModeledDate = input.calculation.latestModeledDate;
  const latestState = input.calculation.dailyStates.findLast(({ status }) => status === "complete");
  const coverageWindowStart = latestModeledDate === null
    ? null
    : addCalendarDays(latestModeledDate, -(MODEL_DIAGNOSTICS_RECENT_WINDOW_DAYS - 1));
  const boundedWindowStart = coverageWindowStart !== null && coverageWindowStart < input.startDate
    ? input.startDate
    : coverageWindowStart;

  return {
    latestModeledDate,
    currentEstimateAvailable: hasDiagnosticsCurrentEstimate({
      recoveryUsable: input.calculation.unknownIntervals.length === 0,
      predictedWeightKg: latestState?.endWeightKg ?? null,
      latestModeledDate,
    }),
    usableModeledCoverageDays: boundedWindowStart === null || latestModeledDate === null
      ? 0
      : input.calculation.dailyStates.filter(({ date, status }) => (
        status === "complete" && date >= boundedWindowStart && date <= latestModeledDate
      )).length,
  };
}

function compareLatestModeledDate(candidate: string | null, current: string | null): number {
  if (candidate === current) return 0;
  if (candidate === null) return -1;
  if (current === null) return 1;
  return candidate < current ? -1 : 1;
}

/** A candidate may replace the active episode only by Pareto-dominating its Diagnostics readiness. */
export function shouldSwitchModelEpisode(
  current: EpisodeSwitchReadiness,
  candidate: EpisodeSwitchReadiness,
): boolean {
  const dateComparison = compareLatestModeledDate(candidate.latestModeledDate, current.latestModeledDate);
  const availabilityComparison = Number(candidate.currentEstimateAvailable)
    - Number(current.currentEstimateAvailable);
  const coverageComparison = candidate.usableModeledCoverageDays - current.usableModeledCoverageDays;

  return dateComparison >= 0
    && availabilityComparison >= 0
    && coverageComparison >= 0
    && (dateComparison > 0 || availabilityComparison > 0 || coverageComparison > 0);
}