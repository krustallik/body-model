import { describe, expect, it } from "vitest";
import {
  buildTransientExerciseWaterImpulseV2,
  EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
  replayTransientExerciseWaterV2,
  resolveTransientWaterV2CanonicalEventInstant,
  resolveTransientWaterV2Exposure,
  transientWaterV2ContributionKg,
} from "@/model/physiology-v7/experimental-transient-exercise-water-v2";
import {
  buildTransientEpisodePartitionsV2,
  indexTransientModelDayBoundariesV2,
  requireTransientModelDayBoundaryV2,
  transientEpisodeTimeForInstantV2,
  transientModelDayBoundariesV2,
} from "@/modules/model-episodes/transient-exercise-water-episode-time-v2";

function impulse(input: Partial<Parameters<typeof buildTransientExerciseWaterImpulseV2>[0]> = {}) {
  return buildTransientExerciseWaterImpulseV2({
    strengthDiarySessionId: 1,
    canonicalEventInstant: new Date("2026-01-01T12:00:00.000Z"),
    modelEpisodeId: 1,
    modelDate: "2026-01-01",
    sessionRevision: 1,
    doseInputFingerprint: "dose-input-v1",
    doseAvailability: "available",
    doseProvenance: "confirmed-dose",
    qualifiedHardSetCount: 8,
    exposureClass: "novel-or-unknown",
    exposureDependencyFingerprint: "exposure-v1",
    exposureDependencies: [],
    sourceFingerprint: "source-v1",
    ...input,
  });
}

function day(input: {
  episodeId?: number;
  modelDate: string;
  boundaryInstant: string;
  impulses?: ReturnType<typeof impulse>[];
}) {
  return {
    episodeId: input.episodeId ?? 1,
    modelDate: input.modelDate,
    boundaryInstant: input.boundaryInstant,
    impulses: input.impulses ?? [],
  };
}

describe("experimental transient exercise water V2 impulse ledger", () => {
  it("uses matched Workout start before accounting time and the unmatched fallback chain", () => {
    const workoutStart = new Date("2026-04-03T20:00:00.000Z");
    const accountingAt = new Date("2026-04-04T01:00:00.000Z");
    const webStart = new Date("2026-04-04T02:00:00.000Z");
    const createdAt = new Date("2026-04-04T03:00:00.000Z");
    expect(resolveTransientWaterV2CanonicalEventInstant({
      matchedWorkout: { startAt: workoutStart }, effectiveAccountingAt: accountingAt, webStartedAt: webStart, createdAt,
    })).toBe(workoutStart);
    expect(resolveTransientWaterV2CanonicalEventInstant({
      matchedWorkout: null, effectiveAccountingAt: accountingAt, webStartedAt: webStart, createdAt,
    })).toBe(accountingAt);
    expect(resolveTransientWaterV2CanonicalEventInstant({
      matchedWorkout: null, effectiveAccountingAt: null, webStartedAt: webStart, createdAt,
    })).toBe(webStart);
  });

  it("creates one V2 impulse per Strength session and keeps unknown dose numerically zero with provenance", () => {
    const unknown = impulse({
      doseAvailability: "unavailable",
      doseProvenance: "no-recorded-sets-defaulted-to-zero",
      qualifiedHardSetCount: 4,
    });
    const confirmedZero = impulse({
      strengthDiarySessionId: 2,
      doseProvenance: "observed-zero-qualified-sets",
      qualifiedHardSetCount: 0,
    });
    expect(unknown.contractVersion).toBe(EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION);
    expect(unknown.branches.point.amplitudeKg).toBe(0);
    expect(confirmedZero.branches.point.amplitudeKg).toBe(0);
    expect(unknown.doseProvenance).not.toBe(confirmedZero.doseProvenance);
  });

  it("keeps session-specific horizons while overlapping impulses decay independently", () => {
    const accustomed = impulse({
      strengthDiarySessionId: 1,
      exposureClass: "accustomed",
      canonicalEventInstant: new Date("2026-01-01T08:00:00.000Z"),
    });
    const novel = impulse({
      strengthDiarySessionId: 2,
      exposureClass: "novel-or-unknown",
      canonicalEventInstant: new Date("2026-01-01T18:00:00.000Z"),
    });
    expect(accustomed.branches.point.horizonDays).toBe(1);
    expect(novel.branches.point.horizonDays).toBe(3.5);
    const result = replayTransientExerciseWaterV2({ days: [
      day({ modelDate: "2026-01-01", boundaryInstant: "2026-01-01T00:00:00.000Z", impulses: [novel, accustomed] }),
      day({ modelDate: "2026-01-02", boundaryInstant: "2026-01-02T00:00:00.000Z" }),
      day({ modelDate: "2026-01-03", boundaryInstant: "2026-01-03T00:00:00.000Z" }),
    ] });
    expect(result.days[0]!.endOfDayLevelKg.point)
      .toBeCloseTo(transientWaterV2ContributionKg(accustomed, "point", 0)
        + transientWaterV2ContributionKg(novel, "point", 0));
    expect(result.days[1]!.branchDeltaKg.point).toBeLessThan(0);
    expect(result.activeImpulses.map(({ impulse: item }) => item.strengthDiarySessionId)).toEqual([2]);
  });

  it("ages by model-day steps, not elapsed 24-hour periods", () => {
    const event = impulse({
      canonicalEventInstant: new Date("2026-03-28T12:00:00.000Z"),
      modelDate: "2026-03-28",
    });
    const result = replayTransientExerciseWaterV2({ days: [
      day({ modelDate: "2026-03-28", boundaryInstant: "2026-03-28T00:00:00.000Z", impulses: [event] }),
      day({ modelDate: "2026-03-29", boundaryInstant: "2026-03-28T23:00:00.000Z" }),
    ] });
    expect(result.days[1]!.branchDeltaKg.point).toBeLessThan(0);
    expect(result.days[1]!.endOfDayLevelKg.point).toBeCloseTo(
      transientWaterV2ContributionKg(event, "point", 1),
    );
  });

  it("normalizes coherent branch deltas and records which trajectories define the envelope", () => {
    const event = impulse();
    const result = replayTransientExerciseWaterV2({ days: [
      day({ modelDate: "2026-01-01", boundaryInstant: "2026-01-01T00:00:00.000Z", impulses: [event] }),
      day({ modelDate: "2026-01-02", boundaryInstant: "2026-01-02T00:00:00.000Z" }),
    ] });
    const decayed = result.days[1]!;
    expect(decayed.dailyDeltaKg.lower).toBe(Math.min(...Object.values(decayed.branchDeltaKg)));
    expect(decayed.dailyDeltaKg.upper).toBe(Math.max(...Object.values(decayed.branchDeltaKg)));
    expect(decayed.dailyDeltaKg.lower).toBeLessThanOrEqual(decayed.dailyDeltaKg.point);
    expect(decayed.dailyDeltaKg.point).toBeLessThanOrEqual(decayed.dailyDeltaKg.upper);
    expect(decayed.dailyDeltaKg.numericLowerBranch).toBe("upper");
    expect(decayed.dailyDeltaKg.numericUpperBranch).toBe("lower");
  });

  it("supports two and three same-day events independent of input/DB ordering", () => {
    const events = [1, 2, 3].map((id) => impulse({
      strengthDiarySessionId: id,
      canonicalEventInstant: new Date(`2026-01-01T0${id}:00:00.000Z`),
    }));
    const run = (items: typeof events) => replayTransientExerciseWaterV2({ days: [
      day({ modelDate: "2026-01-01", boundaryInstant: "2026-01-01T00:00:00.000Z", impulses: items }),
    ] }).days[0];
    expect(run(events)?.endOfDayLevelKg.point).toBe(run([...events].reverse())?.endOfDayLevelKg.point);
    expect(run(events)?.sourceFingerprint).toBe(run([...events].reverse())?.sourceFingerprint);
    expect(run(events)?.activeImpulseSessionIds).toEqual([1, 2, 3]);
    expect(run(events.slice(0, 2))?.activeImpulseSessionIds).toEqual([1, 2]);
  });

  it("uses the Strength session ID as the final stable replay tie-break for equal event instants", () => {
    const equalTime = [2, 1, 3].map((id) => impulse({
      strengthDiarySessionId: id,
      canonicalEventInstant: new Date("2026-01-01T12:00:00.000Z"),
    }));
    const replay = (items: typeof equalTime) => replayTransientExerciseWaterV2({ days: [
      day({ modelDate: "2026-01-01", boundaryInstant: "2026-01-01T00:00:00.000Z", impulses: items }),
    ] }).days[0]!;
    expect(replay(equalTime).sourceFingerprint).toBe(replay([...equalTime].reverse()).sourceFingerprint);
    expect(replay(equalTime).activeImpulseSessionIds).toEqual([1, 2, 3]);
  });

  it("matches a suffix replay from the persisted D-1 ledger to a clean full replay", () => {
    const first = impulse({ strengthDiarySessionId: 1 });
    const second = impulse({
      strengthDiarySessionId: 2,
      canonicalEventInstant: new Date("2026-01-02T12:00:00.000Z"),
      modelDate: "2026-01-02",
      exposureClass: "accustomed",
    });
    const days = [
      day({ modelDate: "2026-01-01", boundaryInstant: "2026-01-01T00:00:00.000Z", impulses: [first] }),
      day({ modelDate: "2026-01-02", boundaryInstant: "2026-01-02T00:00:00.000Z", impulses: [second] }),
      day({ modelDate: "2026-01-03", boundaryInstant: "2026-01-03T00:00:00.000Z" }),
    ];
    const full = replayTransientExerciseWaterV2({ days });
    const predecessor = replayTransientExerciseWaterV2({ days: [days[0]!] });
    const suffix = replayTransientExerciseWaterV2({
      initialActiveImpulses: predecessor.activeImpulses,
      days: days.slice(1),
    });
    expect(suffix.days).toEqual(full.days.slice(1));
    expect(suffix.activeImpulses).toEqual(full.activeImpulses);
  });

  it("uses exact 14-day inclusive/exclusive exposure bounds and never ID-orders same-time events", () => {
    const anchor = { strengthDiarySessionId: 50, eventInstant: new Date("2026-01-15T12:00:00.000Z"), sourceFingerprint: "anchor" };
    const events = [
      { strengthDiarySessionId: 90, eventInstant: new Date("2026-01-01T12:00:00.000Z"), sourceFingerprint: "lower-inclusive" },
      { strengthDiarySessionId: 91, eventInstant: new Date("2026-01-01T11:59:59.999Z"), sourceFingerprint: "outside" },
      { strengthDiarySessionId: 1, eventInstant: new Date("2026-01-15T12:00:00.000Z"), sourceFingerprint: "same-time-lower-id" },
      { strengthDiarySessionId: 92, eventInstant: new Date("2026-01-15T11:59:59.999Z"), sourceFingerprint: "strictly-before" },
    ];
    const result = resolveTransientWaterV2Exposure({ event: anchor, completedEvents: events });
    expect(result.dependencies.map((event) => event.sourceFingerprint)).toEqual(["lower-inclusive", "strictly-before"]);
    expect(result.exposureClass).toBe("accustomed");
  });

  it("does not let a newly added later session reclassify an earlier impulse", () => {
    const earlier = { strengthDiarySessionId: 1, eventInstant: new Date("2026-05-01T10:00:00.000Z"), sourceFingerprint: "earlier" };
    const priorSessions = [
      { strengthDiarySessionId: 2, eventInstant: new Date("2026-04-20T10:00:00.000Z"), sourceFingerprint: "prior-1" },
      { strengthDiarySessionId: 3, eventInstant: new Date("2026-04-25T10:00:00.000Z"), sourceFingerprint: "prior-2" },
    ];
    const before = resolveTransientWaterV2Exposure({ event: earlier, completedEvents: [...priorSessions, earlier] });
    const after = resolveTransientWaterV2Exposure({
      event: earlier,
      completedEvents: [...priorSessions, earlier,
        { strengthDiarySessionId: 4, eventInstant: new Date("2026-05-02T10:00:00.000Z"), sourceFingerprint: "newer" }],
    });
    expect(after.exposureClass).toBe(before.exposureClass);
    expect(after.dependencyFingerprint).toBe(before.dependencyFingerprint);
  });

  it("prunes at the exact maximum branch horizon and has distinct start/end levels", () => {
    const event = impulse();
    const result = replayTransientExerciseWaterV2({ days: [
      day({ modelDate: "2026-01-01", boundaryInstant: "2026-01-01T00:00:00.000Z", impulses: [event] }),
      day({ modelDate: "2026-01-02", boundaryInstant: "2026-01-02T00:00:00.000Z" }),
      day({ modelDate: "2026-01-03", boundaryInstant: "2026-01-03T00:00:00.000Z" }),
      day({ modelDate: "2026-01-04", boundaryInstant: "2026-01-04T00:00:00.000Z" }),
      day({ modelDate: "2026-01-05", boundaryInstant: "2026-01-05T00:00:00.000Z" }),
      day({ modelDate: "2026-01-06", boundaryInstant: "2026-01-06T00:00:00.000Z" }),
    ] });
    expect(result.days[0]!.dailyDeltaKg.point).toBeGreaterThan(0);
    expect(result.days[1]!.dailyDeltaKg.point).toBeLessThan(0);
    expect(result.days.at(-1)!.endOfDayLevelKg.upper).toBe(0);
    expect(result.activeImpulses).toEqual([]);
  });
});

describe("V2 transient ModelEpisode instant partitions", () => {
  it("requires unique episode/date identities and fails when a replay day is missing", () => {
    const boundary = { episodeId: 1, modelDate: "2026-01-01", boundaryInstant: new Date("2026-01-01T00:00:00.000Z") };
    const indexed = indexTransientModelDayBoundariesV2([boundary]);
    expect(requireTransientModelDayBoundaryV2(indexed, 1, "2026-01-01")).toBe(boundary);
    expect(() => requireTransientModelDayBoundaryV2(indexed, 1, "2026-01-02"))
      .toThrow(/missing episode model-day boundary/);
    expect(() => indexTransientModelDayBoundariesV2([boundary, { ...boundary }]))
      .toThrow(/duplicate episode model-day boundary/);
  });

  it("maps exact episode boundary to the new timezone and the preceding instant to the old episode", () => {
    const partitions = buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: null },
      { id: 2, startDate: "2026-01-03", timezone: "Etc/GMT+12", active: true, deactivatedAt: null },
    ]);
    const boundary = partitions[1]!.startInstant;
    expect(transientEpisodeTimeForInstantV2(partitions, boundary)?.episode.id).toBe(2);
    expect(transientEpisodeTimeForInstantV2(partitions, new Date(boundary.getTime() - 1))?.episode.id).toBe(1);
    expect(transientEpisodeTimeForInstantV2(partitions, boundary)?.modelDate).toBe("2026-01-03");
  });

  it("resolves the reverse date-line timezone transition and local-midnight event on its instant side", () => {
    const partitions = buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "Etc/GMT+12", active: false, deactivatedAt: null },
      { id: 2, startDate: "2026-01-05", timezone: "Pacific/Kiritimati", active: true, deactivatedAt: null },
    ]);
    const boundary = partitions[1]!.startInstant;
    const justBefore = transientEpisodeTimeForInstantV2(partitions, new Date(boundary.getTime() - 1));
    const exact = transientEpisodeTimeForInstantV2(partitions, boundary);
    expect(justBefore?.episode.id).toBe(1);
    expect(exact?.episode.id).toBe(2);
    expect(exact?.modelDate).toBe("2026-01-05");
  });

  it("rejects invalid zones and ambiguous active partitions", () => {
    expect(() => buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "Invalid/Zone", active: true, deactivatedAt: null },
    ])).toThrow();
    expect(() => buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "UTC", active: true, deactivatedAt: null },
      { id: 2, startDate: "2026-01-02", timezone: "UTC", active: true, deactivatedAt: null },
    ])).toThrow(/active partition/);
    expect(() => buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "UTC", active: false, deactivatedAt: null },
      { id: 2, startDate: "2026-01-02", timezone: "UTC", active: true, deactivatedAt: null },
      { id: 3, startDate: "2026-01-03", timezone: "UTC", active: false, deactivatedAt: new Date("2026-01-04T00:00:00.000Z") },
    ])).not.toThrow();
    expect(() => buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "UTC", active: false, deactivatedAt: null },
      { id: 2, startDate: "2026-01-02", timezone: "UTC", active: false, deactivatedAt: null },
    ])).toThrow(/valid upper boundary/);
  });

  it("assigns equal absolute starts to the highest ID and omits zero-width episodes", () => {
    const partitions = buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "UTC", active: false, deactivatedAt: null },
      { id: 2, startDate: "2026-01-02", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: null },
      { id: 3, startDate: "2026-01-01", timezone: "Etc/GMT+10", active: true, deactivatedAt: null },
    ]);
    const beforeTie = new Date("2026-01-01T09:59:59.999Z");
    const tie = new Date("2026-01-01T10:00:00.000Z");

    expect(partitions[1]!.startInstant.toISOString()).toBe(tie.toISOString());
    expect(partitions[2]!.startInstant.toISOString()).toBe(tie.toISOString());
    expect(partitions[1]!.endInstant?.toISOString()).toBe(tie.toISOString());
    expect(partitions[1]!.endInstant?.getTime()).toBe(partitions[1]!.startInstant.getTime());
    expect(transientEpisodeTimeForInstantV2(partitions, beforeTie)?.episode.id).toBe(1);
    const exact = transientEpisodeTimeForInstantV2(partitions, tie);
    expect(exact?.episode.id).toBe(3);
    expect(exact?.modelDate).toBe("2026-01-01");
    expect(exact?.timeZone).toBe("Etc/GMT+10");

    const boundaries = transientModelDayBoundariesV2({
      partitions,
      fromInstant: partitions[0]!.startInstant,
      throughInstant: new Date("2026-01-02T10:00:00.000Z"),
    });
    expect(boundaries.map(({ episodeId, modelDate }) => `${episodeId}|${modelDate}`)).toEqual([
      "1|2026-01-01", "3|2026-01-01",
    ]);
    expect(boundaries.some(({ episodeId }) => episodeId === 2)).toBe(false);
  });

  it("suppresses stale later inactive episodes while preserving the active interval", () => {
    const partitions = buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-02", timezone: "Pacific/Kiritimati", active: true, deactivatedAt: null },
      { id: 2, startDate: "2026-01-02", timezone: "Etc/GMT+10", active: false, deactivatedAt: new Date("2026-01-03T10:00:00.000Z") },
    ]);

    expect(partitions.map(({ episode }) => episode.id)).toEqual([1]);
    expect(partitions[0]?.endInstant).toBeNull();
    expect(partitions[0]?.startInstant.toISOString()).toBe("2026-01-01T10:00:00.000Z");
    expect(transientEpisodeTimeForInstantV2(partitions, new Date("2026-01-02T12:00:00.000Z"))?.episode.id).toBe(1);
    expect(() => buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "UTC", active: true, deactivatedAt: null },
      { id: 2, startDate: "2026-01-03", timezone: "Invalid/Zone", active: false, deactivatedAt: new Date("2026-01-04T00:00:00.000Z") },
    ])).toThrow();
  });

  it("keeps an equal-start inactive episode with a higher ID fail-closed", () => {
    expect(() => buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "UTC", active: true, deactivatedAt: null },
      { id: 2, startDate: "2026-01-01", timezone: "UTC", active: false, deactivatedAt: new Date("2026-01-02T00:00:00.000Z") },
    ])).toThrow(/active partition/);
  });

  it("keeps one ordered model-day step across a DST-shortened day", () => {
    const partitions = buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-03-27", timezone: "Europe/Bratislava", active: true, deactivatedAt: null },
    ]);
    const boundaries = transientModelDayBoundariesV2({
      partitions,
      fromInstant: new Date("2026-03-26T23:00:00.000Z"),
      throughInstant: new Date("2026-03-31T22:00:00.000Z"),
    });
    expect(boundaries.map(({ modelDate }) => modelDate)).toEqual([
      "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31",
    ]);
    expect(boundaries[3]!.boundaryInstant.getTime() - boundaries[2]!.boundaryInstant.getTime())
      .toBe(23 * 60 * 60 * 1000);
  });

  it("keeps one ordered model-day step across a DST-lengthened day", () => {
    const partitions = buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-10-23", timezone: "Europe/Bratislava", active: true, deactivatedAt: null },
    ]);
    const boundaries = transientModelDayBoundariesV2({
      partitions,
      fromInstant: new Date("2026-10-22T22:00:00.000Z"),
      throughInstant: new Date("2026-10-27T23:00:00.000Z"),
    });
    expect(boundaries.map(({ modelDate }) => modelDate)).toEqual([
      "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27",
    ]);
    expect(boundaries[3]!.boundaryInstant.getTime() - boundaries[2]!.boundaryInstant.getTime())
      .toBe(25 * 60 * 60 * 1000);
  });

  it("uses one deterministic boundary when the episode timezone changes across the date line", () => {
    const partitions = buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: null },
      { id: 2, startDate: "2026-01-03", timezone: "Etc/GMT+12", active: true, deactivatedAt: null },
    ]);
    const transition = partitions[1]!.startInstant;
    const boundaries = transientModelDayBoundariesV2({
      partitions,
      fromInstant: partitions[0]!.startInstant,
      throughInstant: new Date(transition.getTime() + 2 * 86_400_000),
    });
    expect(boundaries.filter(({ boundaryInstant }) => boundaryInstant.getTime() === transition.getTime())).toHaveLength(1);
    expect(boundaries.every((row, index) => index === 0
      || row.boundaryInstant.getTime() > boundaries[index - 1]!.boundaryInstant.getTime())).toBe(true);
    const transitionIndex = boundaries.findIndex((boundary, index) =>
      index > 0 && boundary.episodeId !== boundaries[index - 1]!.episodeId);
    expect(transitionIndex).toBeGreaterThan(0);
    const beforeTransition = boundaries[transitionIndex - 1]!;
    const afterTransition = boundaries[transitionIndex]!;
    const event = impulse({
      canonicalEventInstant: beforeTransition.boundaryInstant,
      modelEpisodeId: beforeTransition.episodeId,
      modelDate: beforeTransition.modelDate,
    });
    const replay = replayTransientExerciseWaterV2({ days: [
      day({ episodeId: beforeTransition.episodeId, modelDate: beforeTransition.modelDate, boundaryInstant: beforeTransition.boundaryInstant.toISOString(), impulses: [event] }),
      day({ episodeId: afterTransition.episodeId, modelDate: afterTransition.modelDate, boundaryInstant: afterTransition.boundaryInstant.toISOString() }),
    ] });
    expect(replay.days[1]!.endOfDayLevelKg.point).toBeCloseTo(
      transientWaterV2ContributionKg(event, "point", 1),
    );
  });

  it("replays both ordered episode-local steps when a date-line shift puts two model days on one profile date", () => {
    const partitions = buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2026-01-01", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: null },
      { id: 2, startDate: "2026-01-03", timezone: "Etc/GMT+12", active: true, deactivatedAt: null },
    ]);
    const transition = partitions[1]!.startInstant;
    const boundaries = transientModelDayBoundariesV2({
      partitions,
      fromInstant: partitions[0]!.startInstant,
      throughInstant: new Date(transition.getTime() + 2 * 86_400_000),
    });
    const sameDateSteps = boundaries.filter(({ modelDate }) => modelDate === "2026-01-03");
    expect(sameDateSteps.map(({ episodeId }) => episodeId)).toEqual([1, 2]);
    const first = boundaries[0]!;
    const event = impulse({
      canonicalEventInstant: first.boundaryInstant,
      modelEpisodeId: first.episodeId,
      modelDate: first.modelDate,
    });
    const replay = replayTransientExerciseWaterV2({ days: boundaries.map((boundary, index) => day({
      episodeId: boundary.episodeId,
      modelDate: boundary.modelDate,
      boundaryInstant: boundary.boundaryInstant.toISOString(),
      impulses: index === 0 ? [event] : [],
    })) });
    const lastSameDate = boundaries.indexOf(sameDateSteps[1]!);
    expect(replay.days[lastSameDate]!.endOfDayLevelKg.point).toBeCloseTo(
      transientWaterV2ContributionKg(event, "point", lastSameDate),
    );
  });

  it("preserves Kiritimati Jan 3 → Jan 4 → GMT-12 Jan 3 and ages an 11Z Strength impulse at the 12Z boundary", () => {
    const partitions = buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2065-01-03", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: null },
      { id: 2, startDate: "2065-01-03", timezone: "Etc/GMT+12", active: true, deactivatedAt: null },
    ]);
    const boundaries = transientModelDayBoundariesV2({
      partitions,
      fromInstant: partitions[0]!.startInstant,
      throughInstant: new Date("2065-01-04T12:00:00.000Z"),
    });
    expect(boundaries.slice(0, 3).map(({ episodeId, modelDate, boundaryInstant }) => [
      episodeId, modelDate, boundaryInstant.toISOString(),
    ])).toEqual([
      [1, "2065-01-03", "2065-01-02T10:00:00.000Z"],
      [1, "2065-01-04", "2065-01-03T10:00:00.000Z"],
      [2, "2065-01-03", "2065-01-03T12:00:00.000Z"],
    ]);
    const event = impulse({
      canonicalEventInstant: new Date("2065-01-03T11:00:00.000Z"),
      modelEpisodeId: 1,
      modelDate: "2065-01-04",
    });
    const replay = replayTransientExerciseWaterV2({ days: boundaries.slice(0, 3).map((boundary, index) => day({
      episodeId: boundary.episodeId,
      modelDate: boundary.modelDate,
      boundaryInstant: boundary.boundaryInstant.toISOString(),
      impulses: index === 1 ? [event] : [],
    })) });
    expect(replay.days[1]!.activeImpulseSessionIds).toContain(event.strengthDiarySessionId);
    expect(replay.days[2]!.endOfDayLevelKg.point).toBeCloseTo(
      transientWaterV2ContributionKg(event, "point", 1),
    );
    expect(replay.activeImpulses[0]!.ageModelDays).toBe(1);
  });

  it("matches suffix and full replay across a reverse date-line episode boundary", () => {
    const partitions = buildTransientEpisodePartitionsV2([
      { id: 1, startDate: "2065-01-03", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: null },
      { id: 2, startDate: "2065-01-03", timezone: "Etc/GMT+12", active: true, deactivatedAt: null },
    ]);
    const boundaries = transientModelDayBoundariesV2({
      partitions,
      fromInstant: partitions[0]!.startInstant,
      throughInstant: new Date("2065-01-04T12:00:00.000Z"),
    });
    const event = impulse({
      canonicalEventInstant: new Date("2065-01-03T11:00:00.000Z"),
      modelEpisodeId: 1,
      modelDate: "2065-01-04",
    });
    const days = boundaries.slice(0, 3).map((boundary, index) => day({
      episodeId: boundary.episodeId,
      modelDate: boundary.modelDate,
      boundaryInstant: boundary.boundaryInstant.toISOString(),
      impulses: index === 1 ? [event] : [],
    }));
    const full = replayTransientExerciseWaterV2({ days });
    const prefix = replayTransientExerciseWaterV2({ days: days.slice(0, 2) });
    const suffix = replayTransientExerciseWaterV2({ initialActiveImpulses: prefix.activeImpulses, days: days.slice(2) });
    expect(suffix.days).toEqual(full.days.slice(2));
    expect(suffix.activeImpulses).toEqual(full.activeImpulses);
    expect(suffix.days[0]?.activeImpulseSessionIds).toContain(event.strengthDiarySessionId);
    expect(suffix.days[0]?.endOfDayLevelKg.point).toBeCloseTo(transientWaterV2ContributionKg(event, "point", 1));
  });
});
