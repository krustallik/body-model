import { missingPhysiologicalTransitionFields } from "@/model/physiological-simulator";
import { calendarDayIndex } from "./model-calendar";
import type {
  BuiltSimulationDay,
  UnknownIntervalWrite,
} from "./model-episode.types";

export type StateContinuityAnalysis = {
  resolvedDays: BuiltSimulationDay[];
  lastResolvedDate: string | null;
  unknownIntervals: UnknownIntervalWrite[];
};

type MissingRun = {
  startIndex: number;
  endIndex: number;
  missingTransitionFields: string[];
};

/**
 * Finds source-level unavailable transition runs while retaining only the
 * deterministic prefix before the first unresolved run.
 */
export function analyzeStateContinuity(
  days: readonly BuiltSimulationDay[],
  ecfPolicy: Parameters<typeof missingPhysiologicalTransitionFields>[1],
): StateContinuityAnalysis {
  const missing = days.map(({ input }) => (
    missingPhysiologicalTransitionFields(input, ecfPolicy)
  ));
  const runs: MissingRun[] = [];
  for (let index = 0; index < missing.length;) {
    if (missing[index].length === 0) {
      index += 1;
      continue;
    }
    const startIndex = index;
    const fields = new Set<string>();
    while (index < missing.length && missing[index].length > 0) {
      for (const field of missing[index]) fields.add(field);
      index += 1;
    }
    runs.push({
      startIndex,
      endIndex: index - 1,
      missingTransitionFields: [...fields].sort(),
    });
  }

  const firstMissingIndex = runs[0]?.startIndex ?? days.length;
  const resolvedDays = days.slice(0, firstMissingIndex).map((day) => ({ ...day }));
  const lastResolvedDate = resolvedDays.at(-1)?.input.date ?? null;
  const unknownIntervals = runs.map((run, runIndex): UnknownIntervalWrite => {
    const nextRunStart = runs[runIndex + 1]?.startIndex ?? days.length;
    const postGapObservationDates = days
      .slice(run.endIndex + 1, nextRunStart)
      .filter(({ sourceQuality }) => sourceQuality.sourceObservationFields.length > 0)
      .map(({ input }) => input.date);
    const open = run.endIndex === days.length - 1;
    return {
      startDate: days[run.startIndex].input.date,
      lastUnknownDate: days[run.endIndex].input.date,
      endDate: open ? null : days[run.endIndex].input.date,
      anchorDate: lastResolvedDate,
      firstPostGapObservationDate: postGapObservationDates[0] ?? null,
      postGapObservedDayCount: postGapObservationDates.length,
      postGapObservationDates,
      missingTransitionFields: run.missingTransitionFields,
      recoveryRequired: true,
    };
  });

  return { resolvedDays, lastResolvedDate, unknownIntervals };
}

export function unknownIntervalDurationDays(interval: {
  startDate: string;
  lastUnknownDate: string;
}): number {
  return calendarDayIndex(interval.lastUnknownDate) - calendarDayIndex(interval.startDate) + 1;
}
