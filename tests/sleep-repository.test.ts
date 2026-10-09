import { describe, expect, it, vi } from "vitest";
import { SleepRepository } from "@/modules/health/sleep.repository";

type SleepRow = {
  startAt: Date;
  endAt: Date;
  state: string;
  rawState: string;
  startOffsetMinutes: number | null;
  endOffsetMinutes: number | null;
};

function row(
  startAt: string,
  endAt: string,
  state: string,
  offsets: { start?: number | null; end?: number | null } = {},
): SleepRow {
  return {
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    state,
    rawState: state,
    startOffsetMinutes: offsets.start ?? null,
    endOffsetMinutes: offsets.end ?? null,
  };
}

function repository(options: {
  rows?: SleepRow[];
  snapshotTimeZone?: string | null;
  segmentError?: unknown;
  snapshotError?: unknown;
} = {}) {
  const findMany = vi.fn(async () => {
    if (options.segmentError) throw options.segmentError;
    return options.rows ?? [];
  });
  const findFirst = vi.fn(async () => {
    if (options.snapshotError) throw options.snapshotError;
    return options.snapshotTimeZone ? { timezone: options.snapshotTimeZone } : null;
  });
  const subject = new SleepRepository({
    sleepSegment: { findMany },
    healthSyncSnapshot: { findFirst },
  } as never);
  return { subject, findMany, findFirst };
}

describe("SleepRepository", () => {
  it("queries the expanded date range and attributes an overnight sleep by the wake segment offset", async () => {
    const { subject, findMany, findFirst } = repository({
      snapshotTimeZone: "America/Los_Angeles",
      rows: [
        row("2114-10-24T22:00:00.000Z", "2114-10-25T04:00:00.000Z", "inBed", { start: 120, end: 60 }),
        row("2114-10-24T22:00:00.000Z", "2114-10-24T23:00:00.000Z", "core", { start: 120, end: 120 }),
        row("2114-10-24T23:00:00.000Z", "2114-10-25T01:00:00.000Z", "deep", { start: 120, end: 60 }),
        row("2114-10-25T01:00:00.000Z", "2114-10-25T02:00:00.000Z", "rem", { start: 60, end: 60 }),
        row("2114-10-25T02:00:00.000Z", "2114-10-25T02:15:00.000Z", "awake", { start: 60, end: 60 }),
        row("2114-10-25T02:30:00.000Z", "2114-10-25T04:00:00.000Z", "core", { start: 60, end: 60 }),
      ],
    });

    const summary = await subject.summaryForDate("2114-10-25", "UTC");

    expect(summary).toMatchObject({
      sleepDate: "2114-10-25",
      sleepDateAttribution: "segment-offset",
      wakeOffsetMinutes: 60,
      totalSleepMinutes: 330,
      timeInBedMinutes: 360,
      awakeMinutes: 15,
      coreMinutes: 150,
      deepMinutes: 120,
      remMinutes: 60,
      efficiencyPercent: (330 / 360) * 100,
      segmentCount: 6,
    });
    expect(findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: {
        startAt: { lte: new Date("2114-10-26T23:59:59.999Z") },
        endAt: { gte: new Date("2114-10-24T00:00:00.000Z") },
      },
      orderBy: { startAt: "asc" },
    }));
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("uses the newest sync timezone only when recorded segment offsets are absent", async () => {
    const { subject, findFirst } = repository({
      snapshotTimeZone: "Asia/Tokyo",
      rows: [row("2114-03-01T15:00:00.000Z", "2114-03-01T16:00:00.000Z", "deep")],
    });

    const summary = await subject.summaryForDate("2114-03-02");

    expect(summary).toMatchObject({
      sleepDate: "2114-03-02",
      sleepDateAttribution: "fallback-timezone",
      wakeOffsetMinutes: null,
      totalSleepMinutes: 60,
      timeInBedProvenance: "session-span-fallback",
      efficiencyPercent: null,
    });
    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      orderBy: { receivedAt: "desc" },
      select: { timezone: true },
    });
  });

  it("returns null for an absent sleep relation without manufacturing confirmed zero values", async () => {
    const { subject } = repository({
      segmentError: { code: "P2021" },
      snapshotError: { code: "P2021" },
    });

    await expect(subject.summaryForDate("2114-03-02")).resolves.toBeNull();
    await expect(subject.latestCompleted(undefined, new Date("2114-03-03T12:00:00.000Z"))).resolves.toBeNull();
    await expect(new SleepRepository({} as never).summaryForDate("2114-03-02")).resolves.toBeNull();
  });

  it("propagates unexpected persistence failures instead of converting them to empty or zero sleep", async () => {
    const databaseError = new Error("database unavailable");
    const { subject } = repository({ segmentError: databaseError });
    const { subject: repositoryWithError } = repository({ snapshotError: databaseError });

    await expect(subject.summaryForDate("2114-03-02")).rejects.toBe(databaseError);
    await expect(repositoryWithError.resolveFallbackTimeZone()).rejects.toThrow("database unavailable");
  });

  it("selects only completed sleep and applies the 21-day lower bound for latestCompleted", async () => {
    const now = new Date("2114-05-01T02:00:00.000Z");
    const { subject, findMany } = repository({
      rows: [
        row("2114-04-30T20:00:00.000Z", "2114-04-30T21:00:00.000Z", "deep", { end: 0 }),
        row("2114-05-01T03:00:00.000Z", "2114-05-01T04:00:00.000Z", "rem", { end: 0 }),
      ],
    });

    const latest = await subject.latestCompleted("UTC", now);

    expect(latest).toMatchObject({
      sleepEndAt: "2114-04-30T21:00:00.000Z",
      sleepDate: "2114-04-30",
      totalSleepMinutes: 60,
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        endAt: {
          gte: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1_000),
          lte: now,
        },
      },
      orderBy: { startAt: "asc" },
    }));
  });

  it("avoids all database queries for an empty requested date set", async () => {
    const { subject, findMany, findFirst } = repository();

    await expect(subject.summariesByDates([])).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
