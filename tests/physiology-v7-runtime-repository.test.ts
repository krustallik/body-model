import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runtimeStateFromStructuralStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import { rebuildPhysiologyRangeV7 } from "@/model/physiology-v7/rebuild-v7";
import { PhysiologyV7RuntimeRepository } from "@/modules/model-episodes/physiology-v7-runtime.repository";

function emptyDelegate() {
  return { findMany: async () => [] };
}

describe("Physiology V7 runtime observation loading", () => {
  it("causally applies late weigh-ins from receipt day onward without changing compartments", async () => {
    const snapshots = [
      { id: 1, date: "2033-04-01", receivedAt: new Date("2033-04-01T06:00:00.000Z"), syncedAt: null, steps: null, weightKg: 80 },
      { id: 2, date: "2033-04-02", receivedAt: new Date("2033-04-02T06:00:00.000Z"), syncedAt: null, steps: null, weightKg: 79.5 },
      { id: 3, date: "2033-04-03", receivedAt: new Date("2033-04-03T06:00:00.000Z"), syncedAt: null, steps: null, weightKg: 79.2 },
      // A correction at the exclusive Apr 4 cutoff is unavailable to Apr 3, but available Apr 4.
      { id: 4, date: "2033-04-02", receivedAt: new Date("2033-04-04T00:00:00.000Z"), syncedAt: null, steps: null, weightKg: 82 },
    ];
    const client = {
      dailyHealthData: emptyDelegate(),
      healthSyncSnapshot: { findMany: async () => snapshots },
      healthActivityInterval: emptyDelegate(),
      workout: emptyDelegate(),
      heartRateSample: emptyDelegate(),
      restingHeartRateSample: emptyDelegate(),
      sleepSegment: emptyDelegate(),
      strengthDiarySession: emptyDelegate(),
    } as unknown as PrismaClient;
    const repository = new PhysiologyV7RuntimeRepository(client);
    const common = {
      profileId: 1,
      fromDate: "2033-04-01",
      historyFromDate: "2033-04-01",
      timeZone: "UTC",
    };
    const throughApr3 = await repository.loadRangeSources({ ...common, toDate: "2033-04-03" });
    const throughApr4 = await repository.loadRangeSources({ ...common, toDate: "2033-04-04" });
    const priorApr3State = throughApr3.days.at(-1)!.weightFilterAsOf!.state;
    const fullApr3State = throughApr4.days.find((day) => day.date === "2033-04-03")!.weightFilterAsOf!.state;
    const fullApr4State = throughApr4.days.find((day) => day.date === "2033-04-04")!.weightFilterAsOf!.state;

    expect(fullApr3State).toEqual(priorApr3State);
    expect(fullApr4State).not.toEqual(priorApr3State);
    expect(throughApr4.days.find((day) => day.date === "2033-04-04")!.weightFilterAsOf)
      .toMatchObject({ observationCount: 3, latestObservationDate: "2033-04-03" });

    const initialState = runtimeStateFromStructuralStateV7({
      fatMassKg: 24,
      skeletalMuscleKg: 31,
      otherLeanTissueKg: 19,
      glycogenKg: 0.5,
      glycogenWaterKg: 1.35,
      ecfDeviationKg: 0,
      transientExerciseWaterKg: 0,
      adaptiveThermogenesisKcalPerDay: 0,
      weightFilterState: null,
    });
    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate: common.fromDate,
      toDate: "2033-04-04",
      initialState,
      sources: throughApr4,
    });
    expect(rebuilt.days[3]!.resultingState.weightFilterState).toEqual(fullApr4State);
    expect(rebuilt.days[3]!.resultingState.compartments).toEqual(rebuilt.days[2]!.resultingState.compartments);
  });

  it("retains the prior observation filter when the as-of range has no immutable scale rows", async () => {
    const client = {
      dailyHealthData: emptyDelegate(),
      healthSyncSnapshot: emptyDelegate(),
      healthActivityInterval: emptyDelegate(),
      workout: emptyDelegate(),
      heartRateSample: emptyDelegate(),
      restingHeartRateSample: emptyDelegate(),
      sleepSegment: emptyDelegate(),
      strengthDiarySession: emptyDelegate(),
    } as unknown as PrismaClient;
    const repository = new PhysiologyV7RuntimeRepository(client);
    const result = await repository.loadRangeSources({
      profileId: 1,
      fromDate: "2033-04-01",
      toDate: "2033-04-01",
      historyFromDate: "2033-04-01",
      timeZone: "UTC",
    });
    expect(result.days[0]!.weightFilterAsOf).toBeNull();
    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate: "2033-04-01",
      toDate: "2033-04-01",
      initialState: runtimeStateFromStructuralStateV7({
        fatMassKg: 24,
        skeletalMuscleKg: 31,
        otherLeanTissueKg: 19,
        glycogenKg: 0.5,
        glycogenWaterKg: 1.35,
        ecfDeviationKg: 0,
        transientExerciseWaterKg: 0,
        adaptiveThermogenesisKcalPerDay: 0,
        weightFilterState: { estimatedWeightKg: 80, varianceKg2: 0.2 },
      }),
      sources: result,
    });
    expect(rebuilt.finalState.weightFilterState?.estimatedWeightKg).toBe(80);
    expect(rebuilt.finalState.weightFilterState?.varianceKg2).toBeCloseTo(0.21, 12);
  });
});
