import { MODEL_INPUT_LIMITS } from "../constants";

const MILLISECONDS_PER_DAY = 86_400_000;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const BIA_INITIALIZATION_RECENCY_DEFAULTS = {
  maxAgeDays: 14,
  maxObservations: 7,
} as const;

export type RawBiaObservation = {
  date: string;
  weightKg: number | null | undefined;
  bodyFatPercent: number | null | undefined;
};

export type SelectedBiaObservation = {
  date: string;
  weightKg: number;
  bodyFatPercent: number;
};

export type RecentBiaSelectionInput = {
  observations: readonly RawBiaObservation[];
  referenceDate: string;
  maxAgeDays?: number;
  maxObservations?: number;
};

function calendarDayIndex(name: string, value: string): number {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) throw new TypeError(`${name} must use YYYY-MM-DD format`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  if (year < 1
      || parsed.getUTCFullYear() !== year
      || parsed.getUTCMonth() !== month - 1
      || parsed.getUTCDate() !== day) {
    throw new RangeError(`${name} must be a real calendar date`);
  }
  return parsed.getTime() / MILLISECONDS_PER_DAY;
}

function assertIntegerAtLeast(name: string, value: number, minimum: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer greater than or equal to ${minimum}`);
  }
}

function validateCompleteObservation(observation: SelectedBiaObservation): void {
  if (!Number.isFinite(observation.weightKg)) {
    throw new TypeError("BIA observation weightKg must be finite");
  }
  if (observation.weightKg <= MODEL_INPUT_LIMITS.weightKg.minimumExclusive
      || observation.weightKg > MODEL_INPUT_LIMITS.weightKg.maximumInclusive) {
    throw new RangeError("BIA observation weightKg is outside the supported physical range");
  }
  if (!Number.isFinite(observation.bodyFatPercent)) {
    throw new TypeError("BIA observation bodyFatPercent must be finite");
  }
  if (observation.bodyFatPercent < 0 || observation.bodyFatPercent > 100) {
    throw new RangeError("BIA observation bodyFatPercent must be between 0 and 100");
  }
}

/** Selects complete, recent BIA/weight pairs, newest first, without reading a clock. */
export function selectRecentBiaObservations(
  input: RecentBiaSelectionInput,
): SelectedBiaObservation[] {
  const maxAgeDays = input.maxAgeDays ?? BIA_INITIALIZATION_RECENCY_DEFAULTS.maxAgeDays;
  const maxObservations = input.maxObservations
    ?? BIA_INITIALIZATION_RECENCY_DEFAULTS.maxObservations;
  assertIntegerAtLeast("maxAgeDays", maxAgeDays, 0);
  assertIntegerAtLeast("maxObservations", maxObservations, 1);

  const referenceDay = calendarDayIndex("referenceDate", input.referenceDate);
  const eligible: Array<SelectedBiaObservation & { dayIndex: number }> = [];

  for (const observation of input.observations) {
    const dayIndex = calendarDayIndex("observation date", observation.date);
    if (observation.weightKg === null || observation.weightKg === undefined
        || observation.bodyFatPercent === null || observation.bodyFatPercent === undefined) {
      continue;
    }

    const complete = {
      date: observation.date,
      weightKg: observation.weightKg,
      bodyFatPercent: observation.bodyFatPercent,
    };
    validateCompleteObservation(complete);

    const ageDays = referenceDay - dayIndex;
    if (ageDays >= 0 && ageDays <= maxAgeDays) eligible.push({ ...complete, dayIndex });
  }

  return eligible
    .sort((left, right) => right.dayIndex - left.dayIndex)
    .slice(0, maxObservations)
    .map(({ date, weightKg, bodyFatPercent }) => ({ date, weightKg, bodyFatPercent }));
}
