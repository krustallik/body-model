import type { WeightFilterState } from "@/model/weight-observation-filter";
import { instantToLocalDateTime } from "@/model/time-zone";
import { HealthDaySchema } from "@/modules/health/health.schema";
import {
  DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2,
  DEFAULT_WEIGHT_PROCESS_NOISE_VARIANCE_KG2_PER_DAY,
  initializeWeightFilterState,
  latestWeightSnapshotsAsOf,
  predictWeightFilterState,
  replayWeightFilterAsOf,
  updateWeightFilterWithMeasurement,
} from "@/model/weight-observation-filter";
import type { WeightSnapshotObservation } from "@/model/weight-observation-filter";

export { latestWeightSnapshotsAsOf };
export type { WeightSnapshotObservation };

export type TimestampedSource = {
  profileId: number;
  createdAt: string | Date;
  updatedAt?: string | Date | null;
};

export type ResidualObservation = {
  date: string;
  observedKg: number;
  predictedKg: number;
  availableAt: string | Date;
};

export type DatedResidual = { date: string; residualKg: number };

export type ForecastSnapshotV1 = {
  schemaVersion: 1;
  profileId: number;
  episodeId: number;
  issuedAt: string;
  inputAsOf: string;
  originDate: string;
  timezone: string;
  forecastVersion: string;
  modelVersion: string;
  sourceFingerprint: string;
  scenarioFingerprint: string;
  horizons: Array<{
    leadDays: number;
    targetDate: string;
    p05Kg: number;
    p25Kg: number;
    p50Kg: number;
    p75Kg: number;
    p95Kg: number;
  }>;
};

const iso = (value: string | Date): number => {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError("timestamp must be valid");
  return time;
};

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Conservative as-of projection: if an existing row was modified later, drop it. */
export function selectAsOfSources<T extends TimestampedSource>(
  rows: readonly T[],
  profileId: number,
  inputAsOf: string | Date,
): T[] {
  const cutoff = iso(inputAsOf);
  return rows.filter((row) => row.profileId === profileId
    && iso(row.createdAt) <= cutoff
    && (row.updatedAt == null || iso(row.updatedAt) <= cutoff));
}

export function residualsAvailableAt(
  rows: readonly ResidualObservation[],
  originDate: string,
  inputAsOf: string | Date,
): Array<ResidualObservation & { residualKg: number }> {
  const cutoff = iso(inputAsOf);
  return rows
    .filter((row) => row.date <= originDate && iso(row.availableAt) <= cutoff)
    .map((row) => ({ ...row, residualKg: row.observedKg - row.predictedKg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median requires values");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Candidate B: slow, clipped correction state. This is a measurement/water state only. */
export function boundedOnlineCorrection(
  residuals: readonly DatedResidual[],
  input: { gain?: number; maxStepKg?: number; maxAbsKg?: number } = {},
): number {
  const gain = input.gain ?? 0.12;
  const maxStep = input.maxStepKg ?? 0.1;
  const maxAbs = input.maxAbsKg ?? 0.75;
  if (!(gain > 0 && gain <= 1 && maxStep > 0 && maxAbs > 0)) throw new RangeError("invalid correction bounds");
  let correction = 0;
  let previousEpoch: number | null = null;
  for (const row of sortDatedResiduals(residuals)) {
    const epoch = Date.parse(`${row.date}T00:00:00.000Z`);
    const elapsedDays = previousEpoch === null ? 1 : (epoch - previousEpoch) / 86_400_000;
    const elapsedGain = 1 - Math.pow(1 - gain, elapsedDays);
    const elapsedMaxStep = maxStep * elapsedDays;
    const step = clamp(elapsedGain * (clamp(row.residualKg, -1, 1) - correction), -elapsedMaxStep, elapsedMaxStep);
    correction = clamp(correction + step, -maxAbs, maxAbs);
    previousEpoch = epoch;
  }
  return correction;
}

export type TwoTimescaleState = { slowKg: number; fastKg: number };

export type MinimalMassState = {
  fatMassKg: number;
  leanTissueKg: number;
  glycogenKg: number;
  baselineExtracellularFluidLiters: number;
  extracellularFluidDeviationLiters: number;
  adaptiveThermogenesisKcalPerDay: number;
  weightFilterState: { estimatedWeightKg: number; varianceKg2: number };
};

/** Candidate A: level correction is kept in water, capped, and cannot rewrite tissue. */
export function waterOnlyInitializationCorrection(
  state: MinimalMassState,
  requestedKg: number,
  maxAbsKg = 0.75,
): { state: MinimalMassState; appliedKg: number } {
  if (!Number.isFinite(requestedKg) || maxAbsKg <= 0) throw new RangeError("invalid initial water correction");
  const appliedKg = clamp(requestedKg, -maxAbsKg, maxAbsKg);
  return {
    state: { ...state, extracellularFluidDeviationLiters: state.extracellularFluidDeviationLiters + appliedKg },
    appliedKg,
  };
}

/** Candidate B: preserves the current filter-only boundary; no tissue mass changes. */
export function filterOnlyStateCorrection(state: MinimalMassState, correctionKg: number): MinimalMassState {
  if (!Number.isFinite(correctionKg)) throw new TypeError("filter correction must be finite");
  return { ...state, weightFilterState: { ...state.weightFilterState,
    estimatedWeightKg: state.weightFilterState.estimatedWeightKg + correctionKg } };
}

/** Candidate C: causal, robust slow/fast decomposition of model residuals. */
export function estimateTwoTimescaleResidual(
  residuals: readonly DatedResidual[],
  input: { slowTimeConstantDays?: number; fastTimeConstantDays?: number; maxAbsPredictionKg?: number } = {},
): { state: TwoTimescaleState; predictResidualKg: (horizonDays: number) => number } {
  const slowTau = input.slowTimeConstantDays ?? 21;
  const fastTau = input.fastTimeConstantDays ?? 3;
  const maxAbsPrediction = input.maxAbsPredictionKg ?? 2;
  if (!(slowTau > fastTau && fastTau > 0 && maxAbsPrediction > 0)) {
    throw new RangeError("slow time constant must exceed positive fast time constant and prediction cap must be positive");
  }
  if (residuals.length === 0) throw new RangeError("residual history required");
  const rows = sortDatedResiduals(residuals);
  let slow = clamp(rows[0]!.residualKg, -2, 2);
  let previousEpoch = Date.parse(`${rows[0]!.date}T00:00:00.000Z`);
  for (const row of rows.slice(1)) {
    const epoch = Date.parse(`${row.date}T00:00:00.000Z`);
    const elapsedDays = (epoch - previousEpoch) / 86_400_000;
    const alpha = 1 - Math.exp(-elapsedDays / slowTau);
    slow += alpha * (clamp(row.residualKg, -2, 2) - slow);
    previousEpoch = epoch;
  }
  const current = rows.at(-1)!.residualKg;
  const state = { slowKg: slow, fastKg: current - slow };
  return {
    state,
    predictResidualKg: (horizonDays) => {
      if (!Number.isFinite(horizonDays) || horizonDays < 0) throw new RangeError("horizon must be nonnegative");
      return clamp(state.slowKg + state.fastKg * Math.exp(-horizonDays / fastTau), -maxAbsPrediction, maxAbsPrediction);
    },
  };
}

/** Candidate D: robust bounded persistent residual level; never treated as energy. */
export function estimatePersistentBias(
  residuals: readonly DatedResidual[],
  input: { windowDays?: number; maxAbsKg?: number } = {},
): number {
  if (residuals.length === 0) throw new RangeError("residual history required");
  const window = input.windowDays ?? 28;
  const maxAbs = input.maxAbsKg ?? 1;
  if (!Number.isInteger(window) || window < 3 || maxAbs <= 0) throw new RangeError("invalid bias bounds");
  const rows = sortDatedResiduals(residuals);
  const lastEpoch = Date.parse(`${rows.at(-1)!.date}T00:00:00.000Z`);
  const firstIncludedEpoch = lastEpoch - (window - 1) * 86_400_000;
  const values = rows.filter((row) => Date.parse(`${row.date}T00:00:00.000Z`) >= firstIncludedEpoch)
    .map((row) => row.residualKg);
  return clamp(median(values), -maxAbs, maxAbs);
}

export type ResidualPersistenceEstimate = {
  observationCount: number;
  transitionCount: number;
  persistencePerDay: number;
  stationaryResidualKg: number;
  innovationMadKg: number;
  predictResidualKg: (horizonDays: number) => number;
};

/**
 * Causal AR(1) persistence for observed-scale-minus-model residuals. Unlike a fixed
 * anchor, this estimates how much of today's discrepancy survives to a future
 * day; it is a scale residual only and never changes physiological state.
 */
export function estimateResidualPersistence(
  residuals: readonly DatedResidual[],
  input: { minimumObservations?: number; maxAbsPredictionKg?: number } = {},
): ResidualPersistenceEstimate | null {
  const minimumObservations = input.minimumObservations ?? 8;
  const maxAbsPrediction = input.maxAbsPredictionKg ?? 2;
  if (!Number.isInteger(minimumObservations) || minimumObservations < 4 || maxAbsPrediction <= 0) {
    throw new RangeError("invalid residual persistence bounds");
  }
  const rows = sortDatedResiduals(residuals);
  if (rows.length < minimumObservations) return null;
  const center = median(rows.map((row) => row.residualKg));
  const mad = median(rows.map((row) => Math.abs(row.residualKg - center)));
  const cap = Math.max(0.5, mad * 1.4826 * 3);
  const bounded = rows.map((row) => ({ ...row, residualKg: center + clamp(row.residualKg - center, -cap, cap) }));
  const transitions = bounded.slice(1).map((row, index) => {
    const previous = bounded[index]!;
    const gapDays = (Date.parse(`${row.date}T00:00:00.000Z`) - Date.parse(`${previous.date}T00:00:00.000Z`)) / 86_400_000;
    return { previous: previous.residualKg - center, current: row.residualKg - center, gapDays };
  });
  let bestPhi = 0;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let step = 0; step <= 49; step += 1) {
    const phi = step * 0.02;
    const loss = transitions.reduce((sum, row) => {
      const error = row.current - row.previous * Math.pow(phi, row.gapDays);
      const absolute = Math.abs(error);
      return sum + (absolute <= 0.5 ? 0.5 * absolute * absolute : 0.5 * (absolute - 0.25));
    }, 0);
    if (loss < bestLoss) { bestLoss = loss; bestPhi = phi; }
  }
  // Small histories otherwise push a noisy estimate to either boundary.
  const persistencePerDay = bestPhi * transitions.length / (transitions.length + 8);
  const latestResidual = bounded.at(-1)!.residualKg;
  return {
    observationCount: rows.length,
    transitionCount: transitions.length,
    persistencePerDay,
    stationaryResidualKg: center,
    innovationMadKg: mad,
    predictResidualKg: (horizonDays) => {
      if (!Number.isFinite(horizonDays) || horizonDays < 0) throw new RangeError("horizon must be nonnegative");
      return clamp(center + (latestResidual - center) * Math.pow(persistencePerDay, horizonDays), -maxAbsPrediction, maxAbsPrediction);
    },
  };
}

export type EnergyDriftObservation = {
  date: string;
  residualKg: number;
  massSensitivityKgPerKcalPerDay: number;
};

export type EnergyDriftEstimate = {
  status: "insufficient-history" | "unstable-split" | "unidentifiable" | "estimated";
  observationCount: number;
  spanDays: number;
  residualSlopeKgPerDay: number | null;
  sensitivitySlopeKgPerDayPerKcalPerDay: number | null;
  rawOffsetCorrectionKcalPerDay: number | null;
  offsetCorrectionKcalPerDay: number;
  posteriorSdKcalPerDay: number | null;
};

/**
 * Research-only robust estimate of a trailing energy offset from the slope of
 * causal scale-minus-physiology residuals and the simulator's finite-difference
 * mass sensitivity. A zero-centered prior shrinks weakly identified estimates.
 */
export function estimateEnergyDriftCorrection(
  observations: readonly EnergyDriftObservation[],
  input: { minimumObservations?: number; minimumSpanDays?: number; priorSdKcalPerDay?: number; maxAbsCorrectionKcalPerDay?: number } = {},
): EnergyDriftEstimate {
  const minimumObservations = input.minimumObservations ?? 6;
  const minimumSpanDays = input.minimumSpanDays ?? 14;
  const priorSd = input.priorSdKcalPerDay ?? 200;
  const maxAbs = input.maxAbsCorrectionKcalPerDay ?? 500;
  if (!Number.isInteger(minimumObservations) || minimumObservations < 4 || !Number.isInteger(minimumSpanDays)
      || minimumSpanDays < 1 || !(priorSd > 0) || !(maxAbs > 0)) throw new RangeError("invalid energy drift bounds");
  const rows = observations.map((row) => {
    if (!validDate(row.date) || !Number.isFinite(row.residualKg)
        || !Number.isFinite(row.massSensitivityKgPerKcalPerDay)) throw new TypeError("invalid energy drift observation");
    return row;
  }).toSorted((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < rows.length; i += 1) if (rows[i]!.date === rows[i - 1]!.date) {
    throw new TypeError("energy drift dates must be unique");
  }
  const spanDays = rows.length < 2 ? 0 : (Date.parse(`${rows.at(-1)!.date}T00:00:00.000Z`)
    - Date.parse(`${rows[0]!.date}T00:00:00.000Z`)) / 86_400_000;
  const base = { observationCount: rows.length, spanDays, residualSlopeKgPerDay: null as number | null,
    sensitivitySlopeKgPerDayPerKcalPerDay: null as number | null, rawOffsetCorrectionKcalPerDay: null as number | null,
    offsetCorrectionKcalPerDay: 0, posteriorSdKcalPerDay: null as number | null };
  if (rows.length < minimumObservations || spanDays < minimumSpanDays) return { ...base, status: "insufficient-history" };
  const x0 = Date.parse(`${rows[0]!.date}T00:00:00.000Z`);
  const dated = rows.map((row) => ({ x: (Date.parse(`${row.date}T00:00:00.000Z`) - x0) / 86_400_000, row }));
  const slope = (values: readonly number[], points = dated) => {
    const pairs: number[] = [];
    for (let i = 0; i < values.length; i += 1) for (let j = i + 1; j < values.length; j += 1) {
      const dx = points[j]!.x - points[i]!.x;
      if (dx > 0) pairs.push((values[j]! - values[i]!) / dx);
    }
    return median(pairs);
  };
  const residualValues = rows.map((row) => row.residualKg);
  const sensitivityValues = rows.map((row) => row.massSensitivityKgPerKcalPerDay);
  const residualSlope = slope(residualValues);
  const sensitivitySlope = slope(sensitivityValues);
  const half = Math.floor(rows.length / 2);
  const firstHalfSlope = slope(residualValues.slice(0, half), dated.slice(0, half));
  const secondHalfSlope = slope(residualValues.slice(half), dated.slice(half));
  const withSlopes = { ...base, residualSlopeKgPerDay: residualSlope,
    sensitivitySlopeKgPerDayPerKcalPerDay: sensitivitySlope };
  if (firstHalfSlope !== 0 && secondHalfSlope !== 0 && Math.sign(firstHalfSlope) !== Math.sign(secondHalfSlope)) {
    return { ...withSlopes, status: "unstable-split" };
  }
  if (Math.abs(sensitivitySlope) < 1e-9) return { ...withSlopes, status: "unidentifiable" };
  const raw = residualSlope / sensitivitySlope;
  const centerX = median(dated.map(({ x }) => x));
  const fittedAtMedian = median(rows.map((row, index) => row.residualKg - residualSlope * (dated[index]!.x - centerX)));
  const detrended = rows.map((row, index) => row.residualKg - (fittedAtMedian + residualSlope * (dated[index]!.x - centerX)));
  const noiseSd = Math.max(0.25, median(detrended.map(Math.abs)) * 1.4826);
  const sxx = dated.reduce((sum, point) => sum + (point.x - centerX) ** 2, 0);
  const slopeSd = noiseSd / Math.sqrt(Math.max(sxx, 1));
  const offsetSd = slopeSd / Math.abs(sensitivitySlope);
  const posteriorVariance = 1 / (1 / (priorSd * priorSd) + 1 / (offsetSd * offsetSd));
  const posteriorMean = raw * posteriorVariance / (offsetSd * offsetSd);
  return { ...withSlopes, status: "estimated", rawOffsetCorrectionKcalPerDay: raw,
    offsetCorrectionKcalPerDay: clamp(posteriorMean, -maxAbs, maxAbs), posteriorSdKcalPerDay: Math.sqrt(posteriorVariance) };
}

function sortDatedResiduals(rows: readonly DatedResidual[]): DatedResidual[] {
  const ordered = rows.map((row) => {
    if (!validDate(row.date) || !Number.isFinite(row.residualKg)) {
      throw new TypeError("residuals require valid dates and finite kg values");
    }
    return row;
  }).toSorted((left, right) => left.date.localeCompare(right.date));
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.date === ordered[index - 1]!.date) {
      throw new TypeError("residual dates must be unique");
    }
  }
  return ordered;
}

export type AvailableWeightObservation = {
  date: string;
  weightKg: number;
  availableAt: string | Date;
};

export type WeightOutcomeLabel = {
  date: string;
  weightKg: number;
  firstReceivedAt: string | Date;
  receivedAt: string | Date;
};

export type ActivityIntervalSnapshot = {
  id: number;
  profileId: number;
  date: string;
  receivedAt: string | Date;
  timezone: string;
  rawPayload: unknown;
};

export type ReconstructedActivityInterval = {
  id: number;
  date: string;
  metric: "steps" | "walking-distance-km";
  startAt: Date;
  endAt: Date;
  value: number;
};

export type AsOfActivityIntervalProjection = {
  rows: ReconstructedActivityInterval[];
  complete: boolean;
  unavailableDates: string[];
};

export type PreparedActivityIntervalSnapshot = {
  id: number;
  profileId: number;
  date: string;
  receivedAtMs: number;
  intervalRows: ReconstructedActivityInterval[];
  unavailable: boolean;
};

function rawPayloadMayContainActivityIntervals(value: unknown): boolean {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed) as unknown; } catch { return false; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const fields = new Map(Object.entries(parsed).map(([key, fieldValue]) => [key.trim().toLowerCase(), fieldValue]));
  if (fields.has("stepintervals") || fields.has("walkingdistanceintervals")) return true;
  return ["steps", "walkingdistancekm"].some((key) => {
    const field = fields.get(key);
    return (typeof field === "object" && field !== null)
      || (typeof field === "string" && /^[\s]*[\[{]/.test(field));
  });
}

/**
 * Rebuild the mutable HealthActivityInterval projection from immutable,
 * timestamped sync snapshots. A latest non-empty interval series replaces
 * that date/metric, matching the writer's delete-and-create semantics; absent
 * or empty series preserve the previous projection. Invalid interval payloads
 * fail closed for that date instead of silently treating them as no activity.
 */
export function prepareActivityIntervalSnapshots(
  snapshots: readonly ActivityIntervalSnapshot[],
): PreparedActivityIntervalSnapshot[] {
  const ordered = snapshots.map((row) => ({ row, receivedAtMs: iso(row.receivedAt) }))
    .sort((a, b) => a.row.date.localeCompare(b.row.date)
      || a.receivedAtMs - b.receivedAtMs || a.row.id - b.row.id);
  let syntheticId = 0;
  return ordered.map(({ row, receivedAtMs }) => {
    let rawPayload = row.rawPayload;
    if (typeof rawPayload === "string") {
      try { rawPayload = JSON.parse(rawPayload) as unknown; } catch { /* handled by the guarded parse below */ }
    }
    if (!rawPayloadMayContainActivityIntervals(rawPayload)) {
      return { id: row.id, profileId: row.profileId, date: row.date, receivedAtMs,
        intervalRows: [], unavailable: false };
    }
    const parsed = HealthDaySchema.safeParse(rawPayload);
    if (!parsed.success || parsed.data.date !== row.date) {
      return { id: row.id, profileId: row.profileId, date: row.date, receivedAtMs,
        intervalRows: [], unavailable: true };
    }

    const intervalRows: ReconstructedActivityInterval[] = [];
    const seriesByMetric = [
      ["steps", parsed.data.stepIntervals],
      ["walking-distance-km", parsed.data.walkingDistanceIntervals],
    ] as const;
    for (const [metric, series] of seriesByMetric) {
      if (!series) continue;
      for (let index = 0; index < series.starts.length; index += 1) {
        const startAt = new Date(series.starts[index]!);
        const endAt = new Date(series.ends[index]!);
        if (instantToLocalDateTime(startAt, row.timezone).date !== row.date) continue;
        intervalRows.push({ id: -(++syntheticId), date: row.date, metric,
          startAt, endAt, value: series.values[index]! });
      }
    }
    return { id: row.id, profileId: row.profileId, date: row.date, receivedAtMs,
      intervalRows, unavailable: false };
  });
}

export function projectPreparedActivityIntervalsAsOf(
  snapshots: readonly PreparedActivityIntervalSnapshot[],
  input: { profileId: number; originDate: string; inputAsOf: string | Date },
): AsOfActivityIntervalProjection {
  if (!validDate(input.originDate)) throw new TypeError("originDate must be a valid local calendar date");
  const cutoff = iso(input.inputAsOf);
  const eligible = snapshots
    .filter((row) => row.profileId === input.profileId
      && row.date <= input.originDate && row.receivedAtMs < cutoff);
  const byDateMetric = new Map<string, ReconstructedActivityInterval[]>();
  const unavailableDates = new Set<string>();

  for (const snapshot of eligible) {
    if (snapshot.unavailable) unavailableDates.add(snapshot.date);
    if (snapshot.intervalRows.length === 0) continue;
    // A snapshot can contain both interval metrics; each metric is versioned independently.
    for (const intervalMetric of ["steps", "walking-distance-km"] as const) {
      const rows = snapshot.intervalRows.filter((row) => row.metric === intervalMetric);
      // The current writer skips empty day subsets; they do not erase earlier rows.
      if (rows.length > 0) byDateMetric.set(`${snapshot.date}|${intervalMetric}`, rows);
    }
  }

  return {
    rows: [...byDateMetric.values()].flat(),
    complete: unavailableDates.size === 0,
    unavailableDates: [...unavailableDates].sort(),
  };
}

export function projectActivityIntervalsAsOf(
  snapshots: readonly ActivityIntervalSnapshot[],
  input: { profileId: number; originDate: string; inputAsOf: string | Date },
): AsOfActivityIntervalProjection {
  return projectPreparedActivityIntervalsAsOf(prepareActivityIntervalSnapshots(snapshots), input);
}

/** A forecast outcome is eligible only if the first observation was unavailable at issue cutoff. */
export function outcomeArrivedAfterCutoff(availableAt: string | Date, issueCutoff: string | Date): boolean {
  return iso(availableAt) >= iso(issueCutoff);
}

/** Build an online residual only for a target weight first observed after issue. */
export function newOutcomeResidualIfEligible(
  label: WeightOutcomeLabel | undefined,
  predictedKg: number,
  issueCutoff: string | Date,
): ResidualObservation | null {
  if (!Number.isFinite(predictedKg)) throw new TypeError("predicted weight must be finite");
  if (!label || !outcomeArrivedAfterCutoff(label.firstReceivedAt, issueCutoff)) return null;
  return { date: label.date, observedKg: label.weightKg, predictedKg, availableAt: label.receivedAt };
}

/** Latest non-null weight field known by an exclusive receipt-time cutoff, per local day. */
/** Latest value for scoring, plus the first receipt time used to decide whether it is a new outcome. */
export function weightOutcomeLabelsAsOf(
  rows: readonly WeightSnapshotObservation[],
  inputAsOf: string | Date,
): WeightOutcomeLabel[] {
  const cutoff = iso(inputAsOf);
  const firstReceivedAt = new Map<string, string | Date>();
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date)
    || iso(a.receivedAt) - iso(b.receivedAt) || (a.id ?? 0) - (b.id ?? 0));
  for (const row of ordered) {
    if (!validDate(row.date)) throw new TypeError("weight snapshot date must be a valid local calendar date");
    if (row.weightKg === null || iso(row.receivedAt) >= cutoff) continue;
    firstReceivedAt.set(row.date, firstReceivedAt.get(row.date) ?? row.receivedAt);
  }
  return latestWeightSnapshotsAsOf(ordered, inputAsOf).map(({ date, weightKg, receivedAt }) => {
    const first = firstReceivedAt.get(date);
    if (first === undefined) throw new Error("latest weight outcome has no first-received timestamp");
    return { date, weightKg, firstReceivedAt: first, receivedAt };
  });
}

export type CausalWeightFilterReplay = {
  state: WeightFilterState | null;
  stateAtOriginDate: WeightFilterState | null;
  observationCount: number;
  updates: Array<{
    date: string;
    observedWeightKg: number;
    priorEstimateKg: number;
    posteriorEstimateKg: number;
    posteriorVarianceKg2: number;
  }>;
};

/**
 * Research-only causal scale observation replay.
 * It reuses BodyCast's local-level Kalman filter and never accepts or mutates
 * tissue/energy state. The estimate is an observation-layer state, not a body
 * composition or energy-balance correction.
 */
export function causalWeightFilterAsOf(
  rows: readonly WeightSnapshotObservation[],
  input: { originDate: string; inputAsOf: string | Date },
): CausalWeightFilterReplay {
  const replay = replayWeightFilterAsOf({ rows, ...input });
  return {
    state: replay.state,
    stateAtOriginDate: replay.stateAtOriginDate,
    observationCount: replay.observationCount,
    updates: replay.updates,
  };
}

export type AdaptiveLocalLevelWeightFilterReplay = {
  state: WeightFilterState | null;
  stateAtOriginDate: WeightFilterState | null;
  observationCount: number;
  latestObservationDate: string | null;
  processNoiseVarianceKg2PerDay: number | null;
  updates: Array<{
    date: string;
    innovationKg: number;
    posteriorEstimateKg: number;
    posteriorVarianceKg2: number;
    processNoiseVarianceKg2PerDay: number;
  }>;
};

/**
 * Research-only adaptive local-level Kalman filter for the scale-observation
 * layer. It adapts process noise from clipped, one-step innovations; it never
 * changes tissue, fluid-compartment, or energy-accounting state.
 */
export function adaptiveLocalLevelWeightFilterAsOf(
  rows: readonly WeightSnapshotObservation[],
  input: {
    originDate: string;
    inputAsOf: string | Date;
    measurementNoiseVarianceKg2?: number;
    initialProcessNoiseVarianceKg2PerDay?: number;
    minProcessNoiseVarianceKg2PerDay?: number;
    maxProcessNoiseVarianceKg2PerDay?: number;
    adaptationTimeConstantDays?: number;
    maxAbsInnovationKg?: number;
  },
): AdaptiveLocalLevelWeightFilterReplay {
  if (!validDate(input.originDate)) throw new TypeError("originDate must be a valid local calendar date");
  const measurementNoise = input.measurementNoiseVarianceKg2
    ?? DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2;
  const minimumProcessNoise = input.minProcessNoiseVarianceKg2PerDay ?? 0.001;
  const maximumProcessNoise = input.maxProcessNoiseVarianceKg2PerDay ?? 0.25;
  const initialProcessNoise = input.initialProcessNoiseVarianceKg2PerDay
    ?? DEFAULT_WEIGHT_PROCESS_NOISE_VARIANCE_KG2_PER_DAY;
  const adaptationTimeConstant = input.adaptationTimeConstantDays ?? 14;
  const maxAbsInnovation = input.maxAbsInnovationKg ?? 1.5;
  if (![measurementNoise, minimumProcessNoise, maximumProcessNoise, initialProcessNoise,
    adaptationTimeConstant, maxAbsInnovation].every(Number.isFinite)
      || !(measurementNoise > 0) || !(minimumProcessNoise > 0)
      || maximumProcessNoise < minimumProcessNoise
      || initialProcessNoise < minimumProcessNoise || initialProcessNoise > maximumProcessNoise
      || !(adaptationTimeConstant > 0) || !(maxAbsInnovation > 0)) {
    throw new RangeError("invalid adaptive local-level filter parameters");
  }

  const observations = latestWeightSnapshotsAsOf(rows, input.inputAsOf)
    .filter((row) => row.date <= input.originDate);
  let state: WeightFilterState | null = null;
  let processNoise = initialProcessNoise;
  let previousDate: string | null = null;
  const updates: AdaptiveLocalLevelWeightFilterReplay["updates"] = [];
  for (const observation of observations) {
    const elapsedDays = previousDate === null ? 0
      : (Date.parse(`${observation.date}T00:00:00.000Z`)
        - Date.parse(`${previousDate}T00:00:00.000Z`)) / 86_400_000;
    if (state === null) {
      state = initializeWeightFilterState({ measuredWeightKg: observation.weightKg,
        measurementNoiseVarianceKg2: measurementNoise });
    } else {
      const predicted = predictWeightFilterState({ state, elapsedDays,
        processNoiseVarianceKg2PerDay: processNoise });
      const innovationKg = observation.weightKg - predicted.estimatedWeightKg;
      const clippedInnovation = clamp(innovationKg, -maxAbsInnovation, maxAbsInnovation);
      const innovationVariance = predicted.varianceKg2 + measurementNoise;
      state = updateWeightFilterWithMeasurement({ predictedState: predicted,
        measuredWeightKg: predicted.estimatedWeightKg + clippedInnovation,
        measurementNoiseVarianceKg2: measurementNoise }).state;
      const elapsedForLearning = Math.max(1, elapsedDays);
      const excessInnovationVariance = Math.max(0, clippedInnovation ** 2 - innovationVariance);
      const targetProcessNoise = clamp(excessInnovationVariance / elapsedForLearning,
        minimumProcessNoise, maximumProcessNoise);
      const alpha = 1 - Math.exp(-elapsedForLearning / adaptationTimeConstant);
      processNoise = clamp(processNoise + alpha * (targetProcessNoise - processNoise),
        minimumProcessNoise, maximumProcessNoise);
      updates.push({ date: observation.date, innovationKg,
        posteriorEstimateKg: state.estimatedWeightKg, posteriorVarianceKg2: state.varianceKg2,
        processNoiseVarianceKg2PerDay: processNoise });
    }
    previousDate = observation.date;
  }
  const stateAtOriginDate = state === null || previousDate === null || previousDate === input.originDate
    ? state
    : predictWeightFilterState({ state,
      elapsedDays: (Date.parse(`${input.originDate}T00:00:00.000Z`)
        - Date.parse(`${previousDate}T00:00:00.000Z`)) / 86_400_000,
      processNoiseVarianceKg2PerDay: processNoise });
  return {
    state,
    stateAtOriginDate,
    observationCount: observations.length,
    latestObservationDate: observations.at(-1)?.date ?? null,
    processNoiseVarianceKg2PerDay: state === null ? null : processNoise,
    updates,
  };
}

export type ForecastIntervalOutcome = {
  originDate: string;
  targetDate: string;
  horizonDays: number;
  issueCutoff: string | Date;
  firstReceivedAt: string | Date;
  receivedAt: string | Date;
  observedKg: number;
  p05Kg: number;
  p95Kg: number;
};

export type PrequentialIntervalWidening = {
  sampleCount: number;
  widenByKg: number | null;
  empiricalPriorCoverage: number | null;
};

/**
 * Counterfactual prequential conformal-style interval widening. Its output is
 * an empirical diagnostic, not a formal coverage guarantee under serial
 * dependence or regime change.
 */
export function prequentialIntervalWidening(
  history: readonly ForecastIntervalOutcome[],
  input: { originDate: string; inputAsOf: string | Date; horizonDays: number; coverage?: number; minimumObservations?: number; maximumObservations?: number },
): PrequentialIntervalWidening {
  if (!validDate(input.originDate) || !Number.isInteger(input.horizonDays) || input.horizonDays <= 0) {
    throw new TypeError("interval calibration requires a valid origin and positive horizon");
  }
  const coverage = input.coverage ?? 0.9;
  const minimumObservations = input.minimumObservations ?? 8;
  const maximumObservations = input.maximumObservations ?? 28;
  if (!(coverage > 0 && coverage < 1) || !Number.isInteger(minimumObservations) || minimumObservations < 1
      || !Number.isInteger(maximumObservations) || maximumObservations < minimumObservations) {
    throw new RangeError("invalid interval calibration bounds");
  }
  const cutoff = iso(input.inputAsOf);
  const originEpoch = Date.parse(`${input.originDate}T00:00:00.000Z`);
  const eligible = history.filter((row) => {
    if (row.horizonDays !== input.horizonDays || !validDate(row.originDate) || !validDate(row.targetDate)
        || ![row.observedKg, row.p05Kg, row.p95Kg].every(Number.isFinite) || row.p05Kg > row.p95Kg) return false;
    const rowOrigin = Date.parse(`${row.originDate}T00:00:00.000Z`);
    const target = Date.parse(`${row.targetDate}T00:00:00.000Z`);
    return rowOrigin < originEpoch && target <= originEpoch && iso(row.receivedAt) < cutoff
      && iso(row.firstReceivedAt) >= iso(row.issueCutoff)
      && target - rowOrigin === row.horizonDays * 86_400_000;
  }).toSorted((a, b) => b.originDate.localeCompare(a.originDate)).slice(0, maximumObservations);
  const scores = eligible.map((row) => Math.max(row.p05Kg - row.observedKg, row.observedKg - row.p95Kg, 0));
  const empiricalPriorCoverage = scores.length === 0 ? null : scores.filter((score) => score === 0).length / scores.length;
  if (scores.length < minimumObservations) return { sampleCount: scores.length, widenByKg: null, empiricalPriorCoverage };
  const sorted = [...scores].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.ceil((sorted.length + 1) * coverage));
  return { sampleCount: scores.length, widenByKg: sorted[rank - 1]!, empiricalPriorCoverage };
}

export type UncertaintyFallbackAssessment = {
  fallbackToLastKnown: boolean;
  sampleCount: number;
  intervalCoverage: number | null;
};

/**
 * Conservative research gate: if a horizon's recent, matured 90% intervals
 * are badly under-covering, use the causal last-known scale weight for the
 * point estimate. Too little calibration evidence keeps the base forecast.
 */
export function assessUncertaintyAwareFallback(
  history: readonly ForecastIntervalOutcome[],
  input: {
    originDate: string;
    inputAsOf: string | Date;
    horizonDays: number;
    lookbackDays?: number;
    maxObservations?: number;
    minimumObservations?: number;
    minimumIntervalCoverage?: number;
  },
): UncertaintyFallbackAssessment {
  if (!validDate(input.originDate) || !Number.isInteger(input.horizonDays) || input.horizonDays <= 0) {
    throw new TypeError("fallback assessment requires a valid origin and positive horizon");
  }
  const lookbackDays = input.lookbackDays ?? 28;
  const maxObservations = input.maxObservations ?? 14;
  const minimumObservations = input.minimumObservations ?? 8;
  const minimumCoverage = input.minimumIntervalCoverage ?? 0.6;
  if (![minimumCoverage].every(Number.isFinite)
      || !Number.isInteger(lookbackDays) || lookbackDays < 1 || !Number.isInteger(maxObservations)
      || maxObservations < 1 || !Number.isInteger(minimumObservations) || minimumObservations < 1
      || minimumObservations > maxObservations || minimumCoverage < 0 || minimumCoverage > 1) {
    throw new RangeError("invalid uncertainty fallback thresholds");
  }
  const cutoff = iso(input.inputAsOf);
  const originEpoch = Date.parse(`${input.originDate}T00:00:00.000Z`);
  const earliestOriginEpoch = originEpoch - lookbackDays * 86_400_000;
  for (const row of history) {
    if (!validDate(row.originDate) || !validDate(row.targetDate)
        || !Number.isInteger(row.horizonDays) || row.horizonDays <= 0
        || ![row.observedKg, row.p05Kg, row.p95Kg].every(Number.isFinite)
        || row.p05Kg > row.p95Kg) throw new TypeError("invalid forecast interval outcome");
    iso(row.issueCutoff);
    const firstReceivedAt = iso(row.firstReceivedAt);
    if (iso(row.receivedAt) < firstReceivedAt
        || Date.parse(`${row.targetDate}T00:00:00.000Z`) - Date.parse(`${row.originDate}T00:00:00.000Z`)
          !== row.horizonDays * 86_400_000) throw new TypeError("invalid forecast interval outcome");
  }
  const eligible = history.filter((row) => {
    if (row.horizonDays !== input.horizonDays) return false;
    const rowOrigin = Date.parse(`${row.originDate}T00:00:00.000Z`);
    const target = Date.parse(`${row.targetDate}T00:00:00.000Z`);
    return rowOrigin < originEpoch && rowOrigin >= earliestOriginEpoch
      && target <= originEpoch
      && iso(row.firstReceivedAt) >= iso(row.issueCutoff)
      && iso(row.receivedAt) < cutoff;
  }).toSorted((a, b) => b.targetDate.localeCompare(a.targetDate)
    || b.originDate.localeCompare(a.originDate)).slice(0, maxObservations);
  const intervalCoverage = eligible.length === 0 ? null
    : eligible.filter((row) => row.observedKg >= row.p05Kg && row.observedKg <= row.p95Kg).length / eligible.length;
  return {
    fallbackToLastKnown: eligible.length >= minimumObservations
      && intervalCoverage !== null && intervalCoverage < minimumCoverage,
    sampleCount: eligible.length,
    intervalCoverage,
  };
}

/** Weight-only Theil-Sen baseline. Caller supplies immutable observations; later/future rows are excluded here. */
export function robustTrendWeightForecast(
  observations: readonly AvailableWeightObservation[],
  input: { originDate: string; inputAsOf: string | Date; targetDate: string; lookbackDays?: number; minimumObservations?: number },
): { estimateKg: number; slopeKgPerDay: number; observationCount: number } | null {
  const { originDate, targetDate } = input;
  if (!validDate(originDate) || !validDate(targetDate)) {
    throw new TypeError("origin and target must be valid local calendar dates");
  }
  const originEpoch = Date.parse(`${originDate}T00:00:00.000Z`);
  const targetEpoch = Date.parse(`${targetDate}T00:00:00.000Z`);
  if (targetEpoch <= originEpoch) throw new RangeError("trend target must follow its origin");
  const lookbackDays = input.lookbackDays ?? 14;
  const minimumObservations = input.minimumObservations ?? 5;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 3 || !Number.isInteger(minimumObservations)
      || minimumObservations < 3 || minimumObservations > lookbackDays) {
    throw new RangeError("invalid robust trend window");
  }
  const cutoff = iso(input.inputAsOf);
  const firstEpoch = originEpoch - (lookbackDays - 1) * 86_400_000;
  const latestByDate = new Map<string, { epoch: number; weightKg: number }>();
  for (const row of observations) {
    if (!validDate(row.date) || !Number.isFinite(row.weightKg)) {
      throw new TypeError("weight observations must have valid dates and finite kg values");
    }
    const epoch = Date.parse(`${row.date}T00:00:00.000Z`);
    const availableAt = iso(row.availableAt);
    if (epoch > originEpoch || epoch < firstEpoch || availableAt >= cutoff) continue;
    const existing = latestByDate.get(row.date);
    if (existing) throw new TypeError("weight observations must be unique by local calendar date");
    latestByDate.set(row.date, { epoch, weightKg: row.weightKg });
  }
  const points = [...latestByDate.values()].sort((a, b) => a.epoch - b.epoch);
  if (points.length < minimumObservations) return null;
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      slopes.push((points[j].weightKg - points[i].weightKg) / ((points[j].epoch - points[i].epoch) / 86_400_000));
    }
  }
  const slopeKgPerDay = median(slopes);
  const levelAtOriginKg = median(points.map((point) => point.weightKg - slopeKgPerDay * ((point.epoch - originEpoch) / 86_400_000)));
  return {
    estimateKg: levelAtOriginKg + slopeKgPerDay * ((targetEpoch - originEpoch) / 86_400_000),
    slopeKgPerDay,
    observationCount: points.length,
  };
}

export function validateForecastSnapshotV1(value: unknown): ForecastSnapshotV1 {
  if (!value || typeof value !== "object") throw new TypeError("forecast snapshot must be an object");
  const row = value as Partial<ForecastSnapshotV1>;
  if (row.schemaVersion !== 1 || !Number.isInteger(row.profileId) || row.profileId! <= 0
      || !Number.isInteger(row.episodeId) || row.episodeId! <= 0) throw new TypeError("invalid snapshot identity");
  const issuedAt = iso(row.issuedAt!);
  const inputAsOf = iso(row.inputAsOf!);
  if (inputAsOf > issuedAt) throw new RangeError("snapshot input cutoff is after issue time");
  if (!row.originDate || !row.timezone || !row.forecastVersion || !row.modelVersion
      || !row.sourceFingerprint || !row.scenarioFingerprint || !Array.isArray(row.horizons)
      || row.horizons.length === 0) throw new TypeError("snapshot contract fields missing");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.originDate)) throw new TypeError("originDate must be a local calendar date");
  try { new Intl.DateTimeFormat("en", { timeZone: row.timezone }); }
  catch { throw new TypeError("timezone must be a supported IANA timezone"); }
  const origin = new Date(`${row.originDate}T00:00:00.000Z`);
  if (origin.toISOString().slice(0, 10) !== row.originDate) throw new TypeError("originDate must be a valid calendar date");
  const seen = new Set<number>();
  for (const horizon of row.horizons) {
    if (!Number.isInteger(horizon.leadDays) || horizon.leadDays <= 0 || seen.has(horizon.leadDays)) {
      throw new TypeError("invalid or duplicate forecast lead");
    }
    seen.add(horizon.leadDays);
    if (typeof horizon.targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(horizon.targetDate)) {
      throw new TypeError("targetDate must be a local calendar date");
    }
    const expectedTarget = new Date(origin.getTime() + horizon.leadDays * 86_400_000).toISOString().slice(0, 10);
    if (horizon.targetDate !== expectedTarget) throw new TypeError("target date must match calendar lead");
    const q = [horizon.p05Kg, horizon.p25Kg, horizon.p50Kg, horizon.p75Kg, horizon.p95Kg];
    if (!q.every(Number.isFinite) || !(q[0] <= q[1] && q[1] <= q[2] && q[2] <= q[3] && q[3] <= q[4])) {
      throw new TypeError("forecast quantiles must be finite and ordered");
    }
  }
  return value as ForecastSnapshotV1;
}

/** Forecast record encoding is deterministic and does not include raw source rows. */
export function encodeForecastSnapshotV1(value: unknown): string {
  return JSON.stringify(validateForecastSnapshotV1(value));
}
