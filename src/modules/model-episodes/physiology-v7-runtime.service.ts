import { createUnavailablePhysiologyRuntimeStateV7, type PhysiologyRuntimeStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import { rebuildPhysiologyRangeV7 } from "@/model/physiology-v7/rebuild-v7";
import { calendarDayIndex } from "./model-calendar";
import {
  physiologyV7RuntimeRepository,
  type PhysiologyV7RangeSourceLoader,
} from "./physiology-v7-runtime.repository";

export const PHYSIOLOGY_V7_REBUILD_SERVICE_VERSION =
  "bodycast-physiology-v7-rebuild-service-1" as const;

/**
 * Production application/use-case boundary for deterministic v7 rebuilds.
 * Pure results are returned in memory; Stage 9A intentionally persists no v7
 * derived state and creates no API/cron side effect.
 */
export class PhysiologyV7RuntimeService {
  constructor(private readonly sourceLoader: PhysiologyV7RangeSourceLoader = physiologyV7RuntimeRepository) {}

  async rebuildProfileRange(input: {
    profileId?: number;
    fromDate: string;
    toDate: string;
    timeZone: string;
    historyFromDate?: string;
    initialState?: PhysiologyRuntimeStateV7;
  }) {
    calendarDayIndex(input.fromDate);
    calendarDayIndex(input.toDate);
    if (input.toDate < input.fromDate) throw new RangeError("toDate must not precede fromDate");
    const historyFromDate = input.historyFromDate ?? input.fromDate;
    const sources = await this.sourceLoader.loadRangeSources({
      profileId: input.profileId ?? 1,
      fromDate: input.fromDate,
      toDate: input.toDate,
      historyFromDate,
      timeZone: input.timeZone,
    });
    const rebuild = rebuildPhysiologyRangeV7({
      fromDate: input.fromDate,
      toDate: input.toDate,
      initialState: input.initialState ?? createUnavailablePhysiologyRuntimeStateV7(),
      sources,
    });
    return {
      serviceVersion: PHYSIOLOGY_V7_REBUILD_SERVICE_VERSION,
      profileId: input.profileId ?? 1,
      timeZone: input.timeZone,
      persistence: "none-stage-9a" as const,
      ...rebuild,
    };
  }
}

export const physiologyV7RuntimeService = new PhysiologyV7RuntimeService();

/** Canonical callable production use case for Stage 9B/10 and application code. */
export function rebuildPhysiologyForProfileRangeV7(input: {
  profileId?: number;
  fromDate: string;
  toDate: string;
  timeZone: string;
  historyFromDate?: string;
  initialState?: PhysiologyRuntimeStateV7;
}) {
  return physiologyV7RuntimeService.rebuildProfileRange(input);
}
