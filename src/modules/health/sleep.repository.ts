import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  buildNightlySleepSummaries,
  pickLatestCompletedSleep,
  type NightlySleepSummary,
  type SleepSegmentInterval,
} from "@/modules/health/sleep-summary";
import type { SleepState } from "@/modules/health/sleep-state";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";

export type NightlySleepDto = {
  sleepDate: string;
  sleepStartAt: string;
  sleepEndAt: string;
  totalSleepMinutes: number;
  timeInBedMinutes: number;
  awakeMinutes: number;
  coreMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  unspecifiedSleepMinutes: number;
  efficiencyPercent: number | null;
  segmentCount: number;
  timeInBedProvenance: NightlySleepSummary["timeInBedProvenance"];
  sleepDateAttribution: NightlySleepSummary["sleepDateAttribution"];
  wakeOffsetMinutes: number | null;
  qualityFlags: string[];
  segments: Array<{
    startAt: string;
    endAt: string;
    state: SleepState;
    rawState: string;
  }>;
};

function toDto(summary: NightlySleepSummary): NightlySleepDto {
  return {
    sleepDate: summary.sleepDate,
    sleepStartAt: summary.sleepStartAt,
    sleepEndAt: summary.sleepEndAt,
    totalSleepMinutes: summary.totalSleepMinutes,
    timeInBedMinutes: summary.timeInBedMinutes,
    awakeMinutes: summary.awakeMinutes,
    coreMinutes: summary.coreMinutes,
    deepMinutes: summary.deepMinutes,
    remMinutes: summary.remMinutes,
    unspecifiedSleepMinutes: summary.unspecifiedSleepMinutes,
    efficiencyPercent: summary.sleepEfficiency,
    segmentCount: summary.segmentCount,
    timeInBedProvenance: summary.timeInBedProvenance,
    sleepDateAttribution: summary.sleepDateAttribution,
    wakeOffsetMinutes: summary.wakeOffsetMinutes,
    qualityFlags: summary.qualityFlags,
    segments: summary.segments,
  };
}

function rowToInterval(row: {
  startAt: Date;
  endAt: Date;
  state: string;
  rawState: string;
  startOffsetMinutes?: number | null;
  endOffsetMinutes?: number | null;
}): SleepSegmentInterval {
  return {
    startAt: row.startAt,
    endAt: row.endAt,
    state: row.state as SleepState,
    rawState: row.rawState,
    startOffsetMinutes: row.startOffsetMinutes ?? null,
    endOffsetMinutes: row.endOffsetMinutes ?? null,
  };
}

export class SleepRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  private sleepClient() {
    return this.client as unknown as {
      sleepSegment?: {
        findMany(args: unknown): Promise<Array<{
          startAt: Date;
          endAt: Date;
          state: string;
          rawState: string;
          startOffsetMinutes: number | null;
          endOffsetMinutes: number | null;
        }>>;
      };
      healthSyncSnapshot?: {
        findFirst(args: unknown): Promise<{ timezone: string } | null>;
      };
    };
  }

  /** Prefer latest sync timezone as IANA fallback when segment offsets are missing. */
  async resolveFallbackTimeZone(explicit?: string): Promise<string | undefined> {
    if (explicit) return explicit;
    const snapshot = await this.sleepClient().healthSyncSnapshot?.findFirst({
      orderBy: { receivedAt: "desc" },
      select: { timezone: true },
    });
    return snapshot?.timezone || undefined;
  }

  async listSegmentsOverlappingRange(fromDate: string, toDate: string): Promise<SleepSegmentInterval[]> {
    const client = this.sleepClient().sleepSegment;
    if (!client) return [];
    // Expand one day on each side so overnight sessions near range edges are included.
    const from = new Date(`${addCalendarDays(fromDate, -1)}T00:00:00.000Z`);
    const to = new Date(`${addCalendarDays(toDate, 1)}T23:59:59.999Z`);
    const rows = await client.findMany({
      where: {
        startAt: { lte: to },
        endAt: { gte: from },
      },
      select: {
        startAt: true,
        endAt: true,
        state: true,
        rawState: true,
        startOffsetMinutes: true,
        endOffsetMinutes: true,
      },
      orderBy: { startAt: "asc" },
    });
    return rows.map(rowToInterval);
  }

  async summariesByDates(
    dates: string[],
    fallbackTimeZone?: string,
  ): Promise<Map<string, NightlySleepDto>> {
    if (dates.length === 0) return new Map();
    const ordered = [...dates].sort();
    const [segments, resolvedZone] = await Promise.all([
      this.listSegmentsOverlappingRange(ordered[0]!, ordered[ordered.length - 1]!),
      this.resolveFallbackTimeZone(fallbackTimeZone),
    ]);
    const summaries = buildNightlySleepSummaries(segments, resolvedZone);
    const wanted = new Set(dates);
    return new Map(
      summaries
        .filter((summary) => wanted.has(summary.sleepDate))
        .map((summary) => [summary.sleepDate, toDto(summary)]),
    );
  }

  async summaryForDate(
    sleepDate: string,
    fallbackTimeZone?: string,
  ): Promise<NightlySleepDto | null> {
    const map = await this.summariesByDates([sleepDate], fallbackTimeZone);
    return map.get(sleepDate) ?? null;
  }

  async latestCompleted(
    fallbackTimeZone?: string,
    now: Date = new Date(),
  ): Promise<NightlySleepDto | null> {
    const client = this.sleepClient().sleepSegment;
    if (!client) return null;
    const from = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1_000);
    const [rows, resolvedZone] = await Promise.all([
      client.findMany({
        where: { endAt: { gte: from, lte: now } },
        select: {
          startAt: true,
          endAt: true,
          state: true,
          rawState: true,
          startOffsetMinutes: true,
          endOffsetMinutes: true,
        },
        orderBy: { startAt: "asc" },
      }),
      this.resolveFallbackTimeZone(fallbackTimeZone),
    ]);
    const summary = pickLatestCompletedSleep(
      buildNightlySleepSummaries(rows.map(rowToInterval), resolvedZone),
      now,
    );
    return summary ? toDto(summary) : null;
  }
}

export const sleepRepository = new SleepRepository();
