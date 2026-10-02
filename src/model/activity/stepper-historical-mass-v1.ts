import { instantToLocalDateTime } from "@/model/time-zone";
import { calendarDayIndex } from "@/modules/model-episodes/model-calendar";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

export const STEPPER_HISTORICAL_MASS_POLICY_V1 = "stepper-observed-nearest-seven-calendar-days-v1" as const;

/** Model fallback for workout date D reads D-1, so replay from D can affect only later days. */
export function stepperMassCandidateDependsOnReplayV1(input: {
  workoutDate: string;
  replayFromDate: string;
  massStatus: StepperMassProvenanceV1["status"];
}): boolean {
  return input.workoutDate > input.replayFromDate && input.massStatus !== "observed";
}

export type StepperObservedMassInputV1 = {
  sourceType: "health-metric-sample" | "daily-health-data";
  sourceId: string;
  valueKg: number;
  timestamp: Date | null;
  date: string;
};

export type StepperMassProvenanceV1 = {
  status: "observed" | "model-estimated" | "unavailable";
  sourceType: string | null;
  sourceId: string | null;
  valueKg: number | null;
  sourceTimestamp: string | null;
  sourceDate: string | null;
  normalizedLocalDate: string | null;
  dayDistance: number | null;
  policyVersion: typeof STEPPER_HISTORICAL_MASS_POLICY_V1;
  modelSourceKind?: "predecessor-model" | "episode-initial";
  modelEpisodeId?: number;
  modelVersion?: string;
  modelStateUpdatedAt?: string;
  modelGeneration?: number;
};

/** Exclude volatile publication generation while retaining the as-of mass identity and value. */
export function stableStepperMassProvenanceV1(provenance: StepperMassProvenanceV1): StepperMassProvenanceV1 {
  if (provenance.status !== "model-estimated") return provenance;
  const stable = { ...provenance };
  delete stable.modelGeneration;
  return stable;
}

export function stepperActiveEnergyInputFingerprintV1(inputs: unknown): string {
  return stableSha256(JSON.stringify(inputs));
}

export function stepperActiveEnergyCandidateFingerprintV1(resultFingerprint: string, inputFingerprint: string): string {
  return stableSha256(`${resultFingerprint}|${inputFingerprint}`);
}

export function resolveStepperHistoricalMassV1(input: {
  workoutAt: Date;
  workoutDate: string;
  timeZone: string;
  observations: readonly StepperObservedMassInputV1[];
  modelEstimate?: {
    valueKg: number | null;
    episodeId: number;
    modelVersion: string;
    sourceKind: "predecessor-model" | "episode-initial";
    sourceId: string;
    sourceDate: string;
    stateUpdatedAt: Date | null;
    generation?: number;
  } | null;
}): { massKg: number | null; provenance: StepperMassProvenanceV1 } {
  const targetDay = calendarDayIndex(input.workoutDate);
  const ranked = input.observations.flatMap((sample) => {
    if (!Number.isFinite(sample.valueKg) || sample.valueKg <= 0 || (sample.timestamp !== null && !Number.isFinite(sample.timestamp.getTime()))) return [];
    let localDate: string;
    try { localDate = sample.timestamp === null ? sample.date : instantToLocalDateTime(sample.timestamp, input.timeZone).date; }
    catch { return []; }
    let day: number;
    try { day = calendarDayIndex(localDate); } catch { return []; }
    const distance = Math.abs(day - targetDay);
    return distance <= 7 ? [{ sample, localDate, day, distance }] : [];
  });
  ranked.sort((left, right) => {
    if (left.distance !== right.distance) return left.distance - right.distance;
    if (left.day !== right.day) return left.day - right.day; // equidistant before/after: before wins
    if ((left.sample.timestamp !== null) !== (right.sample.timestamp !== null)) return left.sample.timestamp !== null ? -1 : 1;
    if (left.sample.timestamp !== null && right.sample.timestamp !== null) {
      const leftDistance = Math.abs(left.sample.timestamp.getTime() - input.workoutAt.getTime());
      const rightDistance = Math.abs(right.sample.timestamp.getTime() - input.workoutAt.getTime());
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      const timestampOrder = left.sample.timestamp.getTime() - right.sample.timestamp.getTime();
      if (timestampOrder !== 0) return timestampOrder;
    }
    return left.sample.sourceType.localeCompare(right.sample.sourceType)
      || left.sample.sourceId.localeCompare(right.sample.sourceId, undefined, { numeric: true });
  });
  const selected = ranked[0];
  if (selected) {
    return {
      massKg: selected.sample.valueKg,
      provenance: {
        status: "observed",
        sourceType: selected.sample.sourceType,
        sourceId: selected.sample.sourceId,
        valueKg: selected.sample.valueKg,
        sourceTimestamp: selected.sample.timestamp?.toISOString() ?? null,
        sourceDate: selected.sample.date,
        normalizedLocalDate: selected.localDate,
        dayDistance: selected.distance,
        policyVersion: STEPPER_HISTORICAL_MASS_POLICY_V1,
      },
    };
  }
  const model = input.modelEstimate;
  if (model && Number.isFinite(model.valueKg) && (model.valueKg ?? 0) > 0 && model.stateUpdatedAt !== null) {
    return {
      massKg: model.valueKg,
      provenance: {
        status: "model-estimated", sourceType: model.sourceKind, sourceId: model.sourceId,
        valueKg: model.valueKg, sourceTimestamp: model.stateUpdatedAt.toISOString(), sourceDate: model.sourceDate,
        normalizedLocalDate: model.sourceDate, dayDistance: Math.abs(calendarDayIndex(model.sourceDate) - targetDay),
        policyVersion: STEPPER_HISTORICAL_MASS_POLICY_V1,
        modelSourceKind: model.sourceKind, modelEpisodeId: model.episodeId,
        modelVersion: model.modelVersion, modelStateUpdatedAt: model.stateUpdatedAt.toISOString(),
        ...(model.generation === undefined ? {} : { modelGeneration: model.generation }),
      },
    };
  }
  return {
    massKg: null,
    provenance: {
      status: "unavailable", sourceType: null, sourceId: null, valueKg: null,
      sourceTimestamp: null, sourceDate: null, normalizedLocalDate: input.workoutDate,
      dayDistance: null, policyVersion: STEPPER_HISTORICAL_MASS_POLICY_V1,
    },
  };
}
