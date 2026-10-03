import { describe, expect, it } from "vitest";
import {
  buildTransientExerciseWaterImpulseV2,
  transientWaterV2ContributionKg,
  type ActiveTransientExerciseWaterImpulseV2,
} from "@/model/physiology-v7/experimental-transient-exercise-water-v2";
import { childTransitions } from "@/modules/model-episodes/unified-experimental-physiology-state.service";

describe("Unified transient-water daily composition", () => {
  it("persists one episode model-day per transition and ages across date-line chronology", () => {
    const impulse = buildTransientExerciseWaterImpulseV2({
      strengthDiarySessionId: 11,
      canonicalEventInstant: new Date("2065-01-03T11:00:00.000Z"),
      modelEpisodeId: 1,
      modelDate: "2065-01-04",
      sessionRevision: 1,
      doseInputFingerprint: "dose-v1",
      doseAvailability: "available",
      doseProvenance: "confirmed-dose",
      qualifiedHardSetCount: 8,
      exposureClass: "novel-or-unknown",
      exposureDependencyFingerprint: "exposure-v1",
      exposureDependencies: [],
      sourceFingerprint: "source-v1",
    });
    const dayEvidence = (
      episodeId: number,
      modelDate: string,
      boundaryInstant: string,
      impulses: typeof impulse[] = [],
    ) => ({
      date: modelDate,
      modelEpisodeId: episodeId,
      boundaryAt: boundaryInstant,
      childOutputs: {
        slowTissue: null, glycogen: null, glycogenWater: null,
        transientWater: impulses.map((item, id) => ({
          id: id + 1,
          sourceFingerprint: item.sourceFingerprint,
          modelRevision: item.contractVersion,
          result: { impulse: item },
        })),
        relativeMuscle: null,
      },
      transientWaterBoundaries: [{ episodeId, modelDate, boundaryInstant }],
    }) as never;
    const firstBoundary = "2065-01-02T10:00:00.000Z";
    const episodeOneNextDay = "2065-01-03T10:00:00.000Z";
    const episodeTwoBoundary = "2065-01-03T12:00:00.000Z";
    const first = childTransitions(dayEvidence(1, "2065-01-03", firstBoundary), null).transientWater;
    const second = childTransitions(
      dayEvidence(1, "2065-01-04", episodeOneNextDay, [impulse]),
      { transientWater: first } as never,
    ).transientWater;
    const third = childTransitions(
      dayEvidence(2, "2065-01-03", episodeTwoBoundary),
      { transientWater: second } as never,
    ).transientWater;

    expect([first.boundaryInstant, second.boundaryInstant, third.boundaryInstant]).toEqual([
      firstBoundary, episodeOneNextDay, episodeTwoBoundary,
    ]);
    expect(second.episodeId).toBe(1);
    expect(second.modelDate).toBe("2065-01-04");
    expect((second.activeImpulses as ActiveTransientExerciseWaterImpulseV2[])[0]?.ageModelDays).toBe(0);
    expect(third.episodeId).toBe(2);
    expect(third.modelDate).toBe("2065-01-03");
    expect(third.relativeKg?.point).toBeCloseTo(
      transientWaterV2ContributionKg(impulse, "point", 1)
        - transientWaterV2ContributionKg(impulse, "point", 0),
    );
    expect((third.activeImpulses as ActiveTransientExerciseWaterImpulseV2[])[0]?.ageModelDays).toBe(1);
  });

  it("carries state unchanged over dates that have no episode boundary", () => {
    const impulse = buildTransientExerciseWaterImpulseV2({
      strengthDiarySessionId: 11,
      canonicalEventInstant: new Date("2026-01-01T12:00:00.000Z"),
      modelEpisodeId: 1,
      modelDate: "2026-01-01",
      sessionRevision: 1,
      doseInputFingerprint: "dose-v1",
      doseAvailability: "available",
      doseProvenance: "confirmed-dose",
      qualifiedHardSetCount: 8,
      exposureClass: "novel-or-unknown",
      exposureDependencyFingerprint: "exposure-v1",
      exposureDependencies: [],
      sourceFingerprint: "source-v1",
    });
    const active: ActiveTransientExerciseWaterImpulseV2 = { impulse, ageModelDays: 0 };
    const level = {
      point: transientWaterV2ContributionKg(impulse, "point", 0),
      lower: transientWaterV2ContributionKg(impulse, "lower", 0),
      upper: transientWaterV2ContributionKg(impulse, "upper", 0),
      representation: "engineering-range" as const,
    };
    const prior = { transientWater: {
      availability: "available", levelKg: level, activeImpulses: [active], relativeKg: level,
      provenance: "experimental-transient-exercise-water-v2-impulse-ledger", episodeId: 1,
      modelDate: "2026-01-01", boundaryInstant: "2026-01-01T00:00:00.000Z",
    } } as never;
    const dayWithoutBoundary = {
      date: "2026-01-02",
      childOutputs: { slowTissue: null, glycogen: null, glycogenWater: null, transientWater: [], relativeMuscle: null },
      transientWaterBoundaries: [],
    } as never;
    const carried = childTransitions(dayWithoutBoundary, prior).transientWater;
    expect(carried.levelKg).toEqual(level);
    expect(carried.relativeKg?.point).toBe(0);
    expect(carried.activeImpulses).toEqual([active]);
  });
});
