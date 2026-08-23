import type { WorkActivityDiagnosticsDto } from "./work-activity.service";

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

export function reconstructionQuality(interval: IntervalEstimate): QualityDisplay {
  const metrics = [interval.estimatedWalkingDistanceKm, interval.estimatedSteps];
  const reason = metrics.find((metric) => metric.value === null)?.reason;
  if (reason === "counter-decreased") {
    return {
      tone: "warning",
      label: "Health cumulative value changed unexpectedly; interval estimate unavailable.",
      startGapMinutes: null,
      endGapMinutes: null,
    };
  }
  if (reason === "gap-too-large") {
    return {
      tone: "warning",
      label: "Not enough nearby sync data to estimate work walking.",
      startGapMinutes: null,
      endGapMinutes: null,
    };
  }
  if (reason === "insufficient-data") {
    return {
      tone: "warning",
      label: "Insufficient sync history.",
      startGapMinutes: null,
      endGapMinutes: null,
    };
  }
  const distance = interval.estimatedWalkingDistanceKm;
  const methods = distance.value === null ? [] : [distance.start, distance.end]
    .flatMap((boundary) => "method" in boundary ? [boundary.method] : []);
  const label = methods.includes("nearest")
    ? "Estimated from nearest sync."
    : methods.includes("interpolated")
      ? "Estimated between nearby syncs."
      : "Excellent snapshot coverage.";
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

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return [hours > 0 ? `${hours}h` : "", remainder > 0 ? `${remainder}m` : ""]
    .filter(Boolean).join(" ") || "0m";
}

export function dailyActivityView(diagnostics: WorkActivityDiagnosticsDto) {
  return {
    workWalkingDistanceKm: diagnostics.walking.workWalkingDistanceKm,
    outsideWorkWalkingDistanceKm: diagnostics.walking.outsideWorkWalkingDistanceKm,
    occupationalActivityKcal: diagnostics.activity?.occupationalActivityKcal ?? null,
    outsideWorkWalkingActivityKcal: diagnostics.activity?.outsideWorkWalkingActivityKcal ?? null,
    strengthActivityKcal: diagnostics.activity?.strengthActivityKcal ?? null,
    totalActivityKcal: diagnostics.activity?.totalActivityKcal ?? null,
  };
}
