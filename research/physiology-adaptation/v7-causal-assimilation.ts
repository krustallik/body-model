import type { WeightSnapshotObservation } from "./methods";
import { causalWeightFilterAsOf } from "./methods";
import type { PhysiologyRuntimeStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import { predictWeightFilterState } from "@/model/weight-observation-filter";
import { calendarDayIndex } from "@/modules/model-episodes/model-calendar";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

export const V7_CAUSAL_SCALE_ASSIMILATION_CANDIDATE =
  "research-v7-causal-scale-assimilation-1" as const;

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

/**
 * Research-only V7 challenger: attach the existing causal scale filter to a
 * V7 state without changing any physiological compartment or energy value.
 * Historical source rows are replayed only when their receipt time precedes
 * the supplied exclusive cutoff.
 */
export function assimilateV7ScaleStateAsOf(
  runtimeState: PhysiologyRuntimeStateV7,
  snapshots: readonly WeightSnapshotObservation[],
  input: { fromDate: string; originDate: string; inputAsOf: string | Date },
): {
  resultingState: PhysiologyRuntimeStateV7;
  observationCount: number;
  lastObservationDate: string | null;
} {
  if (!isDate(input.fromDate)
      || !isDate(input.originDate)
      || input.fromDate > input.originDate) {
    throw new TypeError("assimilation range must use ordered calendar dates");
  }

  const replay = causalWeightFilterAsOf(
    snapshots.filter((row) => row.date >= input.fromDate),
    { originDate: input.originDate, inputAsOf: input.inputAsOf },
  );
  const lastObservationDate = replay.updates.at(-1)?.date ?? null;
  const daysSinceObservation = lastObservationDate === null
    ? 0
    : calendarDayIndex(input.originDate) - calendarDayIndex(lastObservationDate);
  const weightFilterState = replay.state === null
    ? null
    : predictWeightFilterState({ state: replay.state, elapsedDays: daysSinceObservation });
  const resultingState: PhysiologyRuntimeStateV7 = {
    ...structuredClone(runtimeState),
    weightFilterState: weightFilterState === null ? null : { ...weightFilterState },
    lineageFingerprint: stableSha256({
      candidate: V7_CAUSAL_SCALE_ASSIMILATION_CANDIDATE,
      priorLineageFingerprint: runtimeState.lineageFingerprint,
      fromDate: input.fromDate,
      originDate: input.originDate,
      inputAsOf: input.inputAsOf instanceof Date ? input.inputAsOf.toISOString() : input.inputAsOf,
      weightFilterState,
    }),
  };

  return {
    resultingState,
    observationCount: replay.observationCount,
    lastObservationDate: replay.updates.at(-1)?.date ?? null,
  };
}
