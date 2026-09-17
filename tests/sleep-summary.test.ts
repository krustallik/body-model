import { describe, expect, it } from "vitest";
import {
  buildNightlySleepSummaries,
  calendarDateAtOffset,
  offsetMinutesFromIso,
  partitionAsleepStageMinutes,
  pickLatestCompletedSleep,
  unionDurationMinutes,
  type SleepSegmentInterval,
} from "@/modules/health/sleep-summary";

function seg(
  startAt: string,
  endAt: string,
  state: SleepSegmentInterval["state"],
  rawState: string = state,
): SleepSegmentInterval {
  return {
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    state,
    rawState,
    startOffsetMinutes: offsetMinutesFromIso(startAt),
    endOffsetMinutes: offsetMinutesFromIso(endAt),
  };
}

describe("unionDurationMinutes", () => {
  it("does not double-count overlapping intervals", () => {
    expect(unionDurationMinutes([
      { startMs: 0, endMs: 60_000 },
      { startMs: 30_000, endMs: 90_000 },
    ])).toBe(1.5);
  });
});

describe("buildNightlySleepSummaries", () => {
  it("attributes midnight-spanning sleep using the wake segment offset, not a hardcoded city zone", () => {
    const summaries = buildNightlySleepSummaries([
      seg("2026-09-16T22:30:00+02:00", "2026-09-17T06:40:00+02:00", "core", "Повільний"),
    ]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.sleepDate).toBe("2026-09-17");
    expect(summaries[0]?.sleepDateAttribution).toBe("segment-offset");
    expect(summaries[0]?.wakeOffsetMinutes).toBe(120);
    expect(summaries[0]?.totalSleepMinutes).toBe(490);
  });

  it("keeps travel nights on the source offset calendar even when fallback timezone differs", () => {
    // Wake at 07:00 in Tokyo (+09). Same UTC instant is still previous calendar day in US/Pacific.
    const tokyoWake = seg(
      "2026-09-16T23:00:00+09:00",
      "2026-09-17T07:00:00+09:00",
      "core",
      "Повільний",
    );
    const summaries = buildNightlySleepSummaries([tokyoWake], "America/Los_Angeles");
    expect(summaries[0]?.sleepDate).toBe("2026-09-17");
    expect(summaries[0]?.sleepDateAttribution).toBe("segment-offset");
    expect(calendarDateAtOffset(tokyoWake.endAt, -7 * 60)).toBe("2026-09-16");
  });

  it("excludes awake and inBed from total sleep and avoids inBed double counting", () => {
    const inBed = seg("2026-09-16T22:21:00+02:00", "2026-09-17T06:30:00+02:00", "inBed", "У ліжку");
    const rem = seg("2026-09-16T22:21:00+02:00", "2026-09-16T23:20:00+02:00", "rem", "Швидкий");
    const core = seg("2026-09-16T23:20:00+02:00", "2026-09-17T04:20:00+02:00", "core", "Повільний");
    const awake = seg("2026-09-17T04:20:00+02:00", "2026-09-17T04:41:00+02:00", "awake", "Без сну");
    const deep = seg("2026-09-17T04:41:00+02:00", "2026-09-17T06:30:00+02:00", "deep", "Глибокий");

    const summary = buildNightlySleepSummaries([inBed, awake, rem, core, deep])[0]!;
    expect(summary.sleepDate).toBe("2026-09-17");
    expect(summary.timeInBedMinutes).toBe(8 * 60 + 9);
    expect(summary.awakeMinutes).toBe(21);
    expect(summary.remMinutes).toBe(59);
    expect(summary.coreMinutes).toBe(5 * 60);
    expect(summary.deepMinutes).toBe(1 * 60 + 49);
    expect(summary.totalSleepMinutes).toBe(7 * 60 + 48);
    expect(summary.totalSleepMinutes).toBe(summary.remMinutes + summary.coreMinutes + summary.deepMinutes);
    expect(summary.totalSleepMinutes + summary.awakeMinutes).toBe(summary.timeInBedMinutes);
    expect(summary.sleepEfficiency).toBeCloseTo((468 / 489) * 100, 5);
    expect(summary.timeInBedProvenance).toBe("inBed-union");
  });

  it("does not inflate totals when identical asleep intervals are duplicated", () => {
    const core = seg("2026-09-16T23:00:00+02:00", "2026-09-17T04:00:00+02:00", "core", "Повільний");
    const summary = buildNightlySleepSummaries([core, { ...core }])[0]!;
    expect(summary.totalSleepMinutes).toBe(5 * 60);
    expect(summary.coreMinutes).toBe(5 * 60);
  });

  it("partitions contradictory asleep overlaps so stage minutes sum to totalSleepMinutes", () => {
    // Policy: deep > rem > core > asleepUnspecified.
    // core 23:00-01:00, deep 23:30-00:30 → deep owns the middle hour, core keeps two 30m wings.
    const summary = buildNightlySleepSummaries([
      seg("2026-09-16T23:00:00+02:00", "2026-09-17T01:00:00+02:00", "core", "Повільний"),
      seg("2026-09-16T23:30:00+02:00", "2026-09-17T00:30:00+02:00", "deep", "Глибокий"),
    ])[0]!;
    expect(summary.qualityFlags).toContain("overlapping-asleep-stages");
    expect(summary.totalSleepMinutes).toBe(120);
    expect(summary.deepMinutes).toBe(60);
    expect(summary.coreMinutes).toBe(60);
    expect(
      summary.coreMinutes
      + summary.deepMinutes
      + summary.remMinutes
      + summary.unspecifiedSleepMinutes,
    ).toBe(summary.totalSleepMinutes);
    expect(summary.segmentCount).toBe(2);
  });

  it("uses session-span fallback when inBed is absent and leaves efficiency null", () => {
    const summary = buildNightlySleepSummaries([
      seg("2026-09-16T23:00:00+02:00", "2026-09-17T05:00:00+02:00", "core", "Повільний"),
    ])[0]!;
    expect(summary.timeInBedProvenance).toBe("session-span-fallback");
    expect(summary.timeInBedMinutes).toBe(6 * 60);
    expect(summary.qualityFlags).toContain("time-in-bed-derived-from-span");
    expect(summary.sleepEfficiency).toBeNull();
  });

  it("falls back to an explicit IANA timezone only when segment offsets are missing", () => {
    const withoutOffset: SleepSegmentInterval = {
      startAt: new Date("2026-09-16T21:00:00.000Z"),
      endAt: new Date("2026-09-17T05:00:00.000Z"),
      state: "core",
      rawState: "Повільний",
      startOffsetMinutes: null,
      endOffsetMinutes: null,
    };
    const summary = buildNightlySleepSummaries([withoutOffset], "Asia/Tokyo")[0]!;
    expect(summary.sleepDateAttribution).toBe("fallback-timezone");
    expect(summary.sleepDate).toBe("2026-09-17");
  });
});

describe("partitionAsleepStageMinutes", () => {
  it("never lets partitioned stage totals exceed the asleep union", () => {
    const byState = new Map([
      ["core", [{ startMs: 0, endMs: 120 * 60_000 }]],
      ["deep", [{ startMs: 30 * 60_000, endMs: 90 * 60_000 }]],
      ["rem", [{ startMs: 60 * 60_000, endMs: 150 * 60_000 }]],
    ] as Array<[SleepSegmentInterval["state"], Array<{ startMs: number; endMs: number }>]>);
    const stages = partitionAsleepStageMinutes(byState);
    const total = unionDurationMinutes([
      { startMs: 0, endMs: 120 * 60_000 },
      { startMs: 30 * 60_000, endMs: 90 * 60_000 },
      { startMs: 60 * 60_000, endMs: 150 * 60_000 },
    ]);
    expect(stages.deep + stages.rem + stages.core + stages.asleepUnspecified).toBe(total);
    expect(stages.deep).toBe(60);
    expect(stages.rem).toBe(60);
    expect(stages.core).toBe(30);
  });
});

describe("pickLatestCompletedSleep", () => {
  it("returns the latest completed night and ignores future-ending sessions", () => {
    const summaries = buildNightlySleepSummaries([
      seg("2026-09-15T23:00:00+02:00", "2026-09-16T06:00:00+02:00", "core"),
      seg("2026-09-16T23:00:00+02:00", "2026-09-17T06:00:00+02:00", "core"),
    ]);
    const latest = pickLatestCompletedSleep(summaries, new Date("2026-09-17T08:00:00+02:00"));
    expect(latest?.sleepDate).toBe("2026-09-17");
  });
});
