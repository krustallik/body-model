import type { WeightFilterState } from "@/model/weight-observation-filter";
import { instantToLocalDateTime } from "@/model/time-zone";
import { HealthDaySchema } from "@/modules/health/health.schema";
import {
  latestWeightSnapshotsAsOf,
  replayWeightFilterAsOf,
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
  input: { slowTimeConstantDays?: number; fastTimeConstantDays?: number } = {},
): { state: TwoTimescaleState; predictResidualKg: (horizonDays: number) => number } {
  const slowTau = input.slowTimeConstantDays ?? 21;
  const fastTau = input.fastTimeConstantDays ?? 3;
  if (!(slowTau > fastTau && fastTau > 0)) throw new RangeError("slow time constant must exceed positive fast time constant");
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
      return state.slowKg + state.fastKg * Math.exp(-horizonDays / fastTau);
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
    observationCount: replay.observationCount,
    updates: replay.updates,
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
