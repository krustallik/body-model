import { calendarDayIndex } from "./model-calendar";
import type {
  NutritionDependency,
  NutritionProvenance,
  NutritionVector,
} from "./model-episode.types";

export const NUTRITION_GAP_POLICY_DEFAULTS = {
  maxBridgeDays: 2,
  localWindowDays: 7,
  minimumLocalReferenceDays: 2,
  maximumReferenceDaysPerSide: 3,
  minimumMacroEnergyRatio: 0.5,
  maximumMacroEnergyRatio: 1.5,
} as const;

export type NutritionGapPolicy = {
  maxBridgeDays: number;
  localWindowDays?: number;
  minimumLocalReferenceDays?: number;
  maximumReferenceDaysPerSide?: number;
  minimumMacroEnergyRatio?: number;
  maximumMacroEnergyRatio?: number;
};

export type NutritionDay = {
  date: string;
  caloriesKcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
};

export type BridgedNutritionDay = NutritionDay & { provenance: NutritionProvenance };

const FIELDS = ["caloriesKcal", "proteinG", "fatG", "carbsG"] as const;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values: readonly number[]): number {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function complete(day: NutritionDay): day is NutritionDay & NutritionVector {
  return FIELDS.every((field) => day[field] !== null
    && Number.isFinite(day[field]) && day[field]! >= 0);
}

export function observedNutritionProvenance(): NutritionProvenance {
  return {
    source: "observed",
    method: null,
    referenceDayCount: 0,
    gapLength: 0,
    referenceDates: [],
    observedFields: [...FIELDS],
    imputedFields: [],
    referenceCaloriesMedian: null,
    referenceCaloriesMad: null,
    referenceMacroMadG: null,
    dependency: "observed",
  };
}

function missingProvenance(day: NutritionDay, gapLength: number): NutritionProvenance {
  const observedFields = FIELDS.filter((field) => day[field] !== null);
  return {
    source: "missing",
    method: null,
    referenceDayCount: 0,
    gapLength,
    referenceDates: [],
    observedFields,
    imputedFields: FIELDS.filter((field) => day[field] === null),
    referenceCaloriesMedian: null,
    referenceCaloriesMad: null,
    referenceMacroMadG: null,
    dependency: "observed",
  };
}

function selectLocalDonors(
  days: readonly NutritionDay[],
  gapStart: number,
  gapEnd: number,
  windowDays: number,
  maximumPerSide: number,
): Array<NutritionDay & NutritionVector> {
  const startDay = calendarDayIndex(days[gapStart].date);
  const endDay = calendarDayIndex(days[gapEnd].date);
  const completeDays = days.filter(complete);
  const before = completeDays.filter((day) => calendarDayIndex(day.date) < startDay
    && startDay - calendarDayIndex(day.date) <= windowDays)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, maximumPerSide);
  const after = completeDays.filter((day) => calendarDayIndex(day.date) > endDay
    && calendarDayIndex(day.date) - endDay <= windowDays)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, maximumPerSide);
  return [...before, ...after];
}

function donorScore(day: NutritionDay, donor: NutritionDay & NutritionVector): number {
  const observed = FIELDS.filter((field) => day[field] !== null);
  if (observed.length === 0) return 0;
  return observed.reduce((score, field) => (
    score + Math.abs(donor[field] - day[field]!) / Math.max(Math.abs(day[field]!), 1)
  ), 0);
}

function chooseJointDonor(
  day: NutritionDay,
  donors: readonly (NutritionDay & NutritionVector)[],
): NutritionDay & NutritionVector {
  const calorieCenter = median(donors.map(({ caloriesKcal }) => caloriesKcal));
  return [...donors].sort((left, right) => (
    donorScore(day, left) - donorScore(day, right)
    || Math.abs(left.caloriesKcal - calorieCenter)
      - Math.abs(right.caloriesKcal - calorieCenter)
    || Math.abs(calendarDayIndex(left.date) - calendarDayIndex(day.date))
      - Math.abs(calendarDayIndex(right.date) - calendarDayIndex(day.date))
    || left.date.localeCompare(right.date)
  ))[0];
}

function coherent(vector: NutritionVector, policy: Required<NutritionGapPolicy>): boolean {
  if (!FIELDS.every((field) => Number.isFinite(vector[field]) && vector[field] >= 0)) return false;
  if (vector.caloriesKcal === 0) {
    return vector.proteinG === 0 && vector.fatG === 0 && vector.carbsG === 0;
  }
  const ratio = (4 * vector.proteinG + 9 * vector.fatG + 4 * vector.carbsG)
    / vector.caloriesKcal;
  return ratio >= policy.minimumMacroEnergyRatio
    && ratio <= policy.maximumMacroEnergyRatio;
}

function requiredPolicy(policy?: NutritionGapPolicy): Required<NutritionGapPolicy> {
  const result = { ...NUTRITION_GAP_POLICY_DEFAULTS, ...policy };
  const integerFields = [
    "maxBridgeDays", "localWindowDays", "minimumLocalReferenceDays",
    "maximumReferenceDaysPerSide",
  ] as const;
  for (const field of integerFields) {
    if (!Number.isInteger(result[field]) || result[field] < (field === "maxBridgeDays" ? 0 : 1)) {
      throw new RangeError(`${field} has an invalid value`);
    }
  }
  if (result.maxBridgeDays > 7
      || result.minimumMacroEnergyRatio < 0
      || result.maximumMacroEnergyRatio < result.minimumMacroEnergyRatio) {
    throw new RangeError("nutrition gap policy is inconsistent");
  }
  return result;
}

function diagnostics(
  donors: readonly (NutritionDay & NutritionVector)[],
): Pick<NutritionProvenance,
  "referenceDates" | "referenceCaloriesMedian" | "referenceCaloriesMad" | "referenceMacroMadG"> {
  return {
    referenceDates: donors.map(({ date }) => date).sort(),
    referenceCaloriesMedian: median(donors.map(({ caloriesKcal }) => caloriesKcal)),
    referenceCaloriesMad: mad(donors.map(({ caloriesKcal }) => caloriesKcal)),
    referenceMacroMadG: {
      proteinG: mad(donors.map(({ proteinG }) => proteinG)),
      fatG: mad(donors.map(({ fatG }) => fatG)),
      carbsG: mad(donors.map(({ carbsG }) => carbsG)),
    },
  };
}

/** Deterministically bridges bounded nutrition gaps without mutating observed inputs. */
export function bridgeNutritionGaps(input: {
  days: readonly NutritionDay[];
  fallbackNutrition?: NutritionVector | null;
  policy?: NutritionGapPolicy;
}): BridgedNutritionDay[] {
  const policy = requiredPolicy(input.policy);
  const days = input.days.map((day) => ({ ...day }));
  const result: BridgedNutritionDay[] = days.map((day) => ({
    ...day,
    provenance: complete(day) ? observedNutritionProvenance() : missingProvenance(day, 1),
  }));

  for (let index = 0; index < days.length;) {
    if (complete(days[index])) {
      index += 1;
      continue;
    }
    const gapStart = index;
    while (index + 1 < days.length && !complete(days[index + 1])) index += 1;
    const gapEnd = index;
    const gapLength = gapEnd - gapStart + 1;
    if (gapLength > policy.maxBridgeDays) {
      for (let gapIndex = gapStart; gapIndex <= gapEnd; gapIndex += 1) {
        result[gapIndex].provenance = missingProvenance(days[gapIndex], gapLength);
      }
      index += 1;
      continue;
    }

    const localDonors = selectLocalDonors(
      days, gapStart, gapEnd, policy.localWindowDays, policy.maximumReferenceDaysPerSide,
    );
    const useLocal = localDonors.length >= policy.minimumLocalReferenceDays;
    const fallbackDonor = input.fallbackNutrition
      ? { date: "frozen-baseline", ...input.fallbackNutrition }
      : null;
    const donors = useLocal ? localDonors : fallbackDonor ? [fallbackDonor] : [];

    for (let gapIndex = gapStart; gapIndex <= gapEnd; gapIndex += 1) {
      const day = days[gapIndex];
      if (donors.length === 0) {
        result[gapIndex].provenance = missingProvenance(day, gapLength);
        continue;
      }
      const donor = chooseJointDonor(day, donors);
      const vector = Object.fromEntries(FIELDS.map((field) => [
        field, day[field] ?? donor[field],
      ])) as NutritionVector;
      if (!coherent(vector, policy)) {
        result[gapIndex].provenance = missingProvenance(day, gapLength);
        continue;
      }
      const observedFields = FIELDS.filter((field) => day[field] !== null);
      result[gapIndex] = {
        date: day.date,
        ...vector,
        provenance: {
          source: useLocal ? "imputed-local" : "imputed-fallback",
          method: useLocal ? "local-joint-donor" : "frozen-baseline-joint-donor",
          referenceDayCount: donors.length,
          gapLength,
          ...diagnostics(donors),
          observedFields,
          imputedFields: FIELDS.filter((field) => day[field] === null),
          dependency: "imputed-direct",
        },
      };
    }
    index += 1;
  }

  let dependency: NutritionDependency = "observed";
  return result.map((day) => {
    if (day.provenance.source === "imputed-local"
        || day.provenance.source === "imputed-fallback") {
      dependency = "imputed-downstream";
      return day;
    }
    if (dependency === "imputed-downstream" && day.provenance.source === "observed") {
      return { ...day, provenance: { ...day.provenance, dependency } };
    }
    return day;
  });
}
