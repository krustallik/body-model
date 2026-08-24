import type { WorkActivityDiagnosticsDto } from "./work-activity.service";
import type { Locale } from "@/i18n/i18n-provider";

type IntervalEstimate = WorkActivityDiagnosticsDto["walking"]["intervals"][number];
type MetricEstimate = IntervalEstimate["estimatedWalkingDistanceKm"];

export type QualityDisplay = {
  tone: "good" | "info" | "warning";
  label: string;
  startGapMinutes: number | null;
  endGapMinutes: number | null;
};

function availableGap(boundary: MetricEstimate["start"]): number | null {
  return "gapMinutes" in boundary ? boundary.gapMinutes : null;
}

export function reconstructionQuality(interval: IntervalEstimate, locale: Locale = "en"): QualityDisplay {
  const uk = locale === "uk";
  const metrics = [interval.estimatedWalkingDistanceKm, interval.estimatedSteps];
  const reason = metrics.find((metric) => metric.value === null)?.reason;
  if (reason === "counter-decreased") {
    return {
      tone: "warning",
      label: uk ? "Накопичувальне значення Health неочікувано змінилося; оцінка проміжку недоступна." : "Health cumulative value changed unexpectedly; interval estimate unavailable.",
      startGapMinutes: null,
      endGapMinutes: null,
    };
  }
  if (reason === "gap-too-large") {
    return {
      tone: "warning",
      label: uk ? "Недостатньо близьких синхронізацій для оцінки ходьби на роботі." : "Not enough nearby sync data to estimate work walking.",
      startGapMinutes: null,
      endGapMinutes: null,
    };
  }
  if (reason === "insufficient-data") {
    return {
      tone: "warning",
      label: uk ? "Недостатня історія синхронізації." : "Insufficient sync history.",
      startGapMinutes: null,
      endGapMinutes: null,
    };
  }
  const distance = interval.estimatedWalkingDistanceKm;
  const methods = distance.value === null ? [] : [distance.start, distance.end]
    .flatMap((boundary) => "method" in boundary ? [boundary.method] : []);
  const label = methods.includes("nearest")
    ? (uk ? "Оцінено за найближчою синхронізацією." : "Estimated from nearest sync.")
    : methods.includes("interpolated")
      ? (uk ? "Оцінено між сусідніми синхронізаціями." : "Estimated between nearby syncs.")
      : (uk ? "Відмінне покриття знімками." : "Excellent snapshot coverage.");
  return {
    tone: methods.includes("exact") && methods.every((method) => method === "exact") ? "good" : "info",
    label,
    startGapMinutes: availableGap(distance.start),
    endGapMinutes: availableGap(distance.end),
  };
}

export function durationMinutes(startAt: string, endAt: string): number {
  return (Date.parse(endAt) - Date.parse(startAt)) / 60_000;
}

export function formatDuration(minutes: number, locale: Locale = "en"): string {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  const uk = locale === "uk";
  return [hours > 0 ? `${hours}${uk ? " год" : "h"}` : "", remainder > 0 ? `${remainder}${uk ? " хв" : "m"}` : ""]
    .filter(Boolean).join(" ") || (uk ? "0 хв" : "0m");
}

export function dailyActivityView(diagnostics: WorkActivityDiagnosticsDto) {
  const workWalkingComponents = diagnostics.occupationalIntervals
    ?.map(({ walkingActivityKcal }) => walkingActivityKcal) ?? null;
  const residualComponents = diagnostics.occupationalIntervals
    ?.map(({ residualActivityKcal }) => residualActivityKcal) ?? null;
  return {
    workWalkingDistanceKm: diagnostics.walking.workWalkingDistanceKm,
    outsideWorkWalkingDistanceKm: diagnostics.walking.outsideWorkWalkingDistanceKm,
    occupationalActivityKcal: diagnostics.activity?.occupationalActivityKcal ?? null,
    workWalkingActivityKcal: workWalkingComponents === null
      || workWalkingComponents.some((value) => value === null)
      ? null
      : workWalkingComponents.reduce<number>((sum, value) => sum + value!, 0),
    residualWorkActivityKcal: residualComponents === null
      || residualComponents.some((value) => value === null)
      ? null
      : residualComponents.reduce<number>((sum, value) => sum + value!, 0),
    outsideWorkWalkingActivityKcal: diagnostics.activity?.outsideWorkWalkingActivityKcal ?? null,
    strengthActivityKcal: diagnostics.activity?.strengthActivityKcal ?? null,
    totalActivityKcal: diagnostics.activity?.totalActivityKcal ?? null,
  };
}
