export type WorkoutHeartRateSampleProvenanceV7 = {
  provider: string;
  device: string | null;
};

export type WorkoutHeartRateSampleV7 = {
  timestamp: string;
  bpm: number;
  /** Preserved per observation: a workout can contain more than one source. */
  provenance: WorkoutHeartRateSampleProvenanceV7;
};

export type WorkoutIntervalV7 = {
  startAt: string;
  endAt: string;
};

export type WorkoutHeartRateEvidenceV7 = {
  availability: "unavailable";
  availabilityReason: "no-hr-source";
  workoutInterval: WorkoutIntervalV7;
  samples: null;
  sampleCount: null;
  distinctSources: null;
  samplingTopology: null;
  summary: null;
} | {
  availability: "loaded";
  workoutInterval: WorkoutIntervalV7;
  /** Sorted, interval-contained observations. Raw source records are not changed. */
  samples: readonly WorkoutHeartRateSampleV7[];
  sampleCount: number;
  /** Deterministic summary; provenance remains available per sample above. */
  distinctSources: readonly WorkoutHeartRateSampleProvenanceV7[];
  samplingTopology: {
    sampledSpan: WorkoutIntervalV7 | null;
    leadingGap: WorkoutIntervalV7 | null;
    interSampleGaps: readonly WorkoutIntervalV7[];
    trailingGap: WorkoutIntervalV7 | null;
  };
  /** Sample statistics only; this is not a time-weighted workout average. */
  summary: {
    sampleMeanBpm: number;
    maxObservedBpm: number;
    basis: "observed-samples-only";
  } | null;
};

export type WorkoutHeartRateEvidenceInputV7 = {
  workoutInterval: WorkoutIntervalV7;
  heartRate: {
    availability: "unavailable";
  } | {
    availability: "loaded";
    samples: readonly WorkoutHeartRateSampleV7[];
  };
};

function timestampMs(timestamp: string): number {
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) throw new Error(`Invalid HR timestamp: ${timestamp}`);
  return value;
}

function compareProvenance(
  left: WorkoutHeartRateSampleProvenanceV7,
  right: WorkoutHeartRateSampleProvenanceV7,
): number {
  const provider = left.provider.localeCompare(right.provider);
  if (provider !== 0) return provider;
  return (left.device ?? "").localeCompare(right.device ?? "");
}

/**
 * Canonicalizes temporal observation facts only. It neither infers coverage
 * quality nor converts HR into energy, intensity, or physiological dose.
 */
export function canonicalizeWorkoutHeartRateEvidenceV7(
  input: WorkoutHeartRateEvidenceInputV7,
): WorkoutHeartRateEvidenceV7 {
  const { workoutInterval } = input;
  const startMs = timestampMs(workoutInterval.startAt);
  const endMs = timestampMs(workoutInterval.endAt);
  if (endMs < startMs) throw new Error("Workout HR interval end must not precede start");

  if (input.heartRate.availability === "unavailable") {
    return {
      availability: "unavailable",
      availabilityReason: "no-hr-source",
      workoutInterval: { ...workoutInterval },
      samples: null,
      sampleCount: null,
      distinctSources: null,
      samplingTopology: null,
      summary: null,
    };
  }

  const samples = input.heartRate.samples
    .map((sample, sourceIndex) => ({ sample: { ...sample, provenance: { ...sample.provenance } }, sourceIndex, timeMs: timestampMs(sample.timestamp) }))
    .filter(({ timeMs }) => timeMs >= startMs && timeMs <= endMs)
    .sort((left, right) => left.timeMs - right.timeMs || left.sourceIndex - right.sourceIndex)
    .map(({ sample }) => sample);

  const distinctSources = [...new Map(
    samples.map((sample) => [`${sample.provenance.provider}\u0000${sample.provenance.device ?? ""}`, sample.provenance]),
  ).values()].sort(compareProvenance);

  if (samples.length === 0) {
    return {
      availability: "loaded",
      workoutInterval: { ...workoutInterval },
      samples,
      sampleCount: 0,
      distinctSources,
      samplingTopology: { sampledSpan: null, leadingGap: null, interSampleGaps: [], trailingGap: null },
      summary: null,
    };
  }

  const first = samples[0];
  const last = samples.at(-1)!;
  const interSampleGaps = samples.slice(1).map((sample, index) => ({
    startAt: samples[index].timestamp,
    endAt: sample.timestamp,
  }));
  const bpmSeriesIsValid = samples.every((sample) => Number.isFinite(sample.bpm) && sample.bpm > 0);
  const sampleMeanBpm = bpmSeriesIsValid
    ? samples.reduce((sum, sample) => sum + sample.bpm, 0) / samples.length
    : null;

  return {
    availability: "loaded",
    workoutInterval: { ...workoutInterval },
    samples,
    sampleCount: samples.length,
    distinctSources,
    samplingTopology: {
      sampledSpan: { startAt: first.timestamp, endAt: last.timestamp },
      leadingGap: { startAt: workoutInterval.startAt, endAt: first.timestamp },
      interSampleGaps,
      trailingGap: { startAt: last.timestamp, endAt: workoutInterval.endAt },
    },
    summary: sampleMeanBpm === null ? null : {
      sampleMeanBpm,
      maxObservedBpm: Math.max(...samples.map((sample) => sample.bpm)),
      basis: "observed-samples-only",
    },
  };
}
