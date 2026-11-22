export type BodyMapEnergyBalanceContextV1 = {
  status: "available" | "unavailable";
  reason: "observed-days-not-complete-enough" | "model-energy-not-current" | null;
  sourceEpisodeId: number | null;
  modelVersion: string | null;
  windowDays: number | null;
  early: { fromDate: string; toDate: string; medianKcalPerDay: number; validDays: number } | null;
  late: { fromDate: string; toDate: string; medianKcalPerDay: number; validDays: number } | null;
};

type NutritionDay = { date: string; caloriesKcal: number | null };

type ModeledEnergyDay = {
  date: string;
  status: string;
  dataQuality: string;
  nutritionSource: string;
  nutritionImputationMethod: unknown;
  nutritionGapLength: number;
  energyIntakeKcal: number;
  energyExpenditureKcal: number;
  modelVersion?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateShift(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function validModelDay(value: unknown): value is ModeledEnergyDay {
  if (!isRecord(value)) return false;
  return typeof value.date === "string"
    && value.status === "complete"
    && value.dataQuality === "observed"
    && value.nutritionSource === "observed"
    && value.nutritionImputationMethod === null
    && value.nutritionGapLength === 0
    && typeof value.energyIntakeKcal === "number" && Number.isFinite(value.energyIntakeKcal)
    && typeof value.energyExpenditureKcal === "number" && Number.isFinite(value.energyExpenditureKcal)
    && value.energyExpenditureKcal >= 0
    && typeof value.modelVersion === "string";
}

export function summarizeBodyMapEnergyBalanceContextV1(input: {
  periodFrom: string;
  periodTo: string;
  activeEpisodeId: number | null;
  modeledDays: readonly unknown[];
  nutritionDays: readonly NutritionDay[];
  modelHistoryCurrent: boolean;
}): BodyMapEnergyBalanceContextV1 {
  const base = {
    sourceEpisodeId: input.activeEpisodeId,
    modelVersion: null,
    windowDays: null,
    early: null,
    late: null,
  } as const;
  if (!input.modelHistoryCurrent || input.activeEpisodeId === null) return {
    status: "unavailable", reason: "model-energy-not-current", ...base,
  };

  const fromDate = input.periodFrom.slice(0, 10);
  const toDate = input.periodTo.slice(0, 10);
  const totalDays = Math.max(1, Math.ceil((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000) + 1);
  const windowDays = Math.min(28, Math.max(14, Math.floor(totalDays / 3)));
  const minimumValidDays = Math.max(10, Math.ceil(windowDays * 0.75));
  const nutritionByDate = new Map(input.nutritionDays
    .filter((day) => day.caloriesKcal !== null && Number.isFinite(day.caloriesKcal) && day.caloriesKcal >= 0)
    .map((day) => [day.date, day.caloriesKcal!]));
  const modelVersions = new Set<string>();
  const balanceByDate = new Map<string, number>();

  for (const candidate of input.modeledDays) {
    if (!validModelDay(candidate) || candidate.date! < fromDate || candidate.date! > toDate) continue;
    const recordedCalories = nutritionByDate.get(candidate.date!);
    if (recordedCalories === undefined || Math.abs(recordedCalories - candidate.energyIntakeKcal!) > 1) continue;
    const balance = recordedCalories - candidate.energyExpenditureKcal!;
    if (!Number.isFinite(balance)) continue;
    balanceByDate.set(candidate.date!, balance);
    if (typeof candidate.modelVersion === "string") modelVersions.add(candidate.modelVersion);
  }

  const earlyFrom = fromDate;
  const earlyTo = dateShift(earlyFrom, windowDays - 1);
  const lateTo = toDate;
  const lateFrom = dateShift(lateTo, -(windowDays - 1));
  const summarizeWindow = (from: string, to: string) => {
    const values = [...balanceByDate.entries()]
      .filter(([date]) => date >= from && date <= to)
      .map(([, balance]) => balance);
    const typical = median(values);
    return values.length >= minimumValidDays && typical !== null
      ? { fromDate: from, toDate: to, medianKcalPerDay: typical, validDays: values.length }
      : null;
  };
  const early = summarizeWindow(earlyFrom, earlyTo);
  const late = summarizeWindow(lateFrom, lateTo);
  if (modelVersions.size > 1) return {
    status: "unavailable",
    reason: "model-energy-not-current",
    sourceEpisodeId: input.activeEpisodeId,
    modelVersion: null,
    windowDays,
    early,
    late,
  };
  if (!early || !late) return {
    status: "unavailable",
    reason: "observed-days-not-complete-enough",
    sourceEpisodeId: input.activeEpisodeId,
    modelVersion: modelVersions.size === 1 ? [...modelVersions][0]! : null,
    windowDays,
    early,
    late,
  };
  return {
    status: "available",
    reason: null,
    sourceEpisodeId: input.activeEpisodeId,
    modelVersion: [...modelVersions][0]!,
    windowDays,
    early,
    late,
  };
}
