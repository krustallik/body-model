import { buildResistanceTrainingExposureHistoryFromSourcesV7, type ResistanceTrainingExposureHistorySourceDayV7, type ResistanceTrainingExposureHistorySourceSessionV7, type ResistanceTrainingExposureHistorySourceWorkoutV7 } from "./resistance-training-exposure-history-sources-v7";
import {
  buildPhysiologyDayV7,
  type PhysiologyDayResultV7,
  type PhysiologyDaySourceV7,
  type PhysiologyRuntimeStateV7,
} from "./daily-runtime-v7";
import { enumerateCalendarDates } from "@/modules/model-episodes/model-calendar";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

export const PHYSIOLOGY_RANGE_REBUILD_V7_VERSION =
  "bodycast-physiology-range-rebuild-v7-1" as const;

export type PhysiologyRangeSourceBundleV7 = {
  days: readonly PhysiologyDaySourceV7[];
  exposure: {
    historyFromDate: string;
    days: readonly ResistanceTrainingExposureHistorySourceDayV7[];
    strengthWorkouts: readonly ResistanceTrainingExposureHistorySourceWorkoutV7[];
    sessions: readonly ResistanceTrainingExposureHistorySourceSessionV7[];
  };
};

export function rebuildPhysiologyRangeV7(input: {
  fromDate: string;
  toDate: string;
  initialState: PhysiologyRuntimeStateV7;
  sources: PhysiologyRangeSourceBundleV7;
}): {
  contractVersion: typeof PHYSIOLOGY_RANGE_REBUILD_V7_VERSION;
  fromDate: string;
  toDate: string;
  initialStateFingerprint: string;
  days: PhysiologyDayResultV7[];
  finalState: PhysiologyRuntimeStateV7;
  fingerprint: string;
} {
  const dates = enumerateCalendarDates(input.fromDate, input.toDate);
  const byDate = new Map(input.sources.days.map((day) => [day.date, day] as const));
  let state = structuredClone(input.initialState);
  const initialStateFingerprint = stableSha256(state);
  const results: PhysiologyDayResultV7[] = [];
  for (const date of dates) {
    const sources = byDate.get(date);
    if (!sources) throw new RangeError(`missing assembled v7 sources for ${date}`);
    const exposureHistory = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: input.sources.exposure.historyFromDate,
      toDate: date,
      days: input.sources.exposure.days.filter((day) => day.date <= date),
      strengthWorkouts: input.sources.exposure.strengthWorkouts
        .filter((workout) => workout.localDate <= date),
      sessions: input.sources.exposure.sessions.filter((session) => session.localDate <= date),
    });
    const result = buildPhysiologyDayV7({ date, priorState: state, sources, exposureHistory });
    results.push(result);
    state = result.resultingState;
  }
  return {
    contractVersion: PHYSIOLOGY_RANGE_REBUILD_V7_VERSION,
    fromDate: input.fromDate,
    toDate: input.toDate,
    initialStateFingerprint,
    days: results,
    finalState: state,
    fingerprint: stableSha256({
      contractVersion: PHYSIOLOGY_RANGE_REBUILD_V7_VERSION,
      fromDate: input.fromDate,
      toDate: input.toDate,
      initialStateFingerprint,
      dayFingerprints: results.map(({ fingerprint }) => fingerprint),
    }),
  };
}
