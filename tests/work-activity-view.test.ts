import { describe, expect, it } from "vitest";
import {
  dailyActivityView,
  durationMinutes,
  formatDuration,
  reconstructionQuality,
} from "@/modules/work-intervals/work-activity-view";
import type { WorkActivityDiagnosticsDto } from "@/modules/work-intervals/work-activity.service";

const boundary = (method: "exact" | "interpolated" | "nearest", gapMinutes: number) => ({
  value: 1,
  targetTime: "2026-08-23T08:00:00.000Z",
  sourceTimes: ["2026-08-23T08:00:00.000Z"],
  gapMinutes,
  method,
});
const interval = (kind: "exact" | "interpolated" | "nearest" | "gap-too-large" | "insufficient-data" | "counter-decreased") => {
  const metric = kind === "gap-too-large" || kind === "insufficient-data" || kind === "counter-decreased"
    ? {
        value: null,
        start: { value: null, targetTime: "x", reason: kind },
        end: { value: null, targetTime: "x", reason: kind },
        reason: kind,
      }
    : { value: 10, start: boundary(kind, kind === "exact" ? 0 : 5), end: boundary(kind, kind === "exact" ? 0 : 5) };
  return { intervalId: 1, estimatedSteps: metric, estimatedWalkingDistanceKm: metric } as Parameters<typeof reconstructionQuality>[0];
};

describe("work activity UI view model", () => {
  it.each([
    ["exact", "Excellent snapshot coverage"],
    ["interpolated", "Estimated between nearby syncs"],
    ["nearest", "Estimated from nearest sync"],
    ["gap-too-large", "Not enough nearby sync data"],
    ["insufficient-data", "Insufficient sync history"],
    ["counter-decreased", "changed unexpectedly"],
  ] as const)("maps %s diagnostics to human text", (kind, text) => {
    expect(reconstructionQuality(interval(kind)).label).toContain(text);
  });

  it("exposes nearest boundary gaps", () => {
    expect(reconstructionQuality(interval("nearest"))).toMatchObject({
      startGapMinutes: 5, endGapMinutes: 5, tone: "info",
    });
  });

  it("formats actual interval durations", () => {
    expect(durationMinutes("2026-08-23T06:00:00Z", "2026-08-23T14:30:00Z")).toBe(510);
    expect(formatDuration(510)).toBe("8h 30m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(30)).toBe("30m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("uses only outside-work walking in the activity breakdown regression", () => {
    const diagnostics = {
      walking: {
        workWalkingDistanceKm: 2.5,
        outsideWorkWalkingDistanceKm: 2.6,
      },
      activity: {
        occupationalActivityKcal: 620,
        outsideWorkWalkingActivityKcal: 210,
        strengthActivityKcal: 180,
        totalActivityKcal: 1_010,
      },
    } as WorkActivityDiagnosticsDto;
    expect(dailyActivityView(diagnostics)).toEqual({
      workWalkingDistanceKm: 2.5,
      outsideWorkWalkingDistanceKm: 2.6,
      occupationalActivityKcal: 620,
      workWalkingActivityKcal: null,
      residualWorkActivityKcal: null,
      outsideWorkWalkingActivityKcal: 210,
      strengthActivityKcal: 180,
      totalActivityKcal: 1_010,
    });
    expect(dailyActivityView(diagnostics).outsideWorkWalkingDistanceKm).not.toBe(5.1);
  });

  it("preserves unavailable kcal as null", () => {
    const diagnostics = {
      walking: { workWalkingDistanceKm: null, outsideWorkWalkingDistanceKm: null },
      activity: null,
    } as WorkActivityDiagnosticsDto;
    expect(dailyActivityView(diagnostics)).toMatchObject({
      occupationalActivityKcal: null,
      outsideWorkWalkingActivityKcal: null,
      totalActivityKcal: null,
    });
  });
});
