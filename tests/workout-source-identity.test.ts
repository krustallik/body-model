import { describe, expect, it } from "vitest";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";
import { planDayWorkoutReconciliation } from "@/modules/health/reconcile-day-workouts";

describe("workoutSourceIdentity", () => {
  it("prefers trimmed externalId over time fields", () => {
    expect(workoutSourceIdentity({
      externalId: "  apple-1  ",
      type: "Traditional Strength Training",
      startAt: "2026-09-17T17:00:00+02:00",
      endAt: "2026-09-17T18:00:00+02:00",
    })).toBe("ext:apple-1");
  });

  it("fingerprints exact type and ISO endpoints when externalId is absent", () => {
    expect(workoutSourceIdentity({
      type: "Traditional Strength Training",
      startAt: "2026-09-17T17:00:00+02:00",
      endAt: "2026-09-17T18:00:00+02:00",
    })).toBe("fp:Traditional Strength Training|2026-09-17T15:00:00.000Z|2026-09-17T16:00:00.000Z");
  });

  it("treats blank externalId as missing", () => {
    expect(workoutSourceIdentity({
      externalId: "   ",
      type: "Stair Climbing",
      startAt: new Date("2026-09-17T06:00:00Z"),
      endAt: new Date("2026-09-17T06:12:00Z"),
    })).toBe("fp:Stair Climbing|2026-09-17T06:00:00.000Z|2026-09-17T06:12:00.000Z");
  });
});

describe("planDayWorkoutReconciliation", () => {
  it("updates in place and preserves ids for matching external identities", () => {
    const plan = planDayWorkoutReconciliation(
      [{
        id: 10,
        sourceIdentity: "ext:a",
        externalId: "a",
        type: "Traditional Strength Training",
        startAt: new Date("2026-09-17T15:00:00Z"),
        endAt: new Date("2026-09-17T16:00:00Z"),
        linkedToDiary: true,
      }],
      [{
        externalId: "a",
        type: "Traditional Strength Training",
        startAt: "2026-09-17T17:05:00+02:00",
        endAt: "2026-09-17T18:05:00+02:00",
        activeEnergyKcal: 410,
      }],
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.id).toBe(10);
    expect(plan.updates[0]?.fields.activeEnergyKcal).toBe(410);
    expect(plan.creates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.retainedLinkedMissingFromFeed).toEqual([]);
  });

  it("reconciles missing externalId by exact fingerprint, not fuzzy time", () => {
    const plan = planDayWorkoutReconciliation(
      [{
        id: 11,
        sourceIdentity: null,
        externalId: null,
        type: "Traditional Strength Training",
        startAt: new Date("2026-09-17T15:00:00Z"),
        endAt: new Date("2026-09-17T16:00:00Z"),
        linkedToDiary: false,
      }],
      [{
        type: "Traditional Strength Training",
        startAt: "2026-09-17T17:00:00+02:00",
        endAt: "2026-09-17T18:00:00+02:00",
        activeEnergyKcal: 300,
      }],
    );
    expect(plan.updates.map((row) => row.id)).toEqual([11]);
    expect(plan.creates).toEqual([]);
  });

  it("does not fuzzy-match a near-time different fingerprint", () => {
    const plan = planDayWorkoutReconciliation(
      [{
        id: 12,
        sourceIdentity: "fp:Traditional Strength Training|2026-09-17T15:00:00.000Z|2026-09-17T16:00:00.000Z",
        externalId: null,
        type: "Traditional Strength Training",
        startAt: new Date("2026-09-17T15:00:00Z"),
        endAt: new Date("2026-09-17T16:00:00Z"),
        linkedToDiary: false,
      }],
      [{
        type: "Traditional Strength Training",
        startAt: "2026-09-17T17:02:00+02:00",
        endAt: "2026-09-17T18:00:00+02:00",
      }],
    );
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.deletes).toEqual([12]);
  });

  it("keeps linked workouts missing from the feed instead of deleting them", () => {
    const plan = planDayWorkoutReconciliation(
      [{
        id: 13,
        sourceIdentity: "ext:linked",
        externalId: "linked",
        type: "Traditional Strength Training",
        startAt: new Date("2026-09-17T15:00:00Z"),
        endAt: new Date("2026-09-17T16:00:00Z"),
        linkedToDiary: true,
      }],
      [],
    );
    expect(plan.deletes).toEqual([]);
    expect(plan.retainedLinkedMissingFromFeed).toEqual([13]);
  });

  it("deletes unlinked workouts absent from the feed", () => {
    const plan = planDayWorkoutReconciliation(
      [{
        id: 14,
        sourceIdentity: "ext:gone",
        externalId: "gone",
        type: "Stair Climbing",
        startAt: new Date("2026-09-17T06:00:00Z"),
        endAt: new Date("2026-09-17T06:12:00Z"),
        linkedToDiary: false,
      }],
      [],
    );
    expect(plan.deletes).toEqual([14]);
    expect(plan.retainedLinkedMissingFromFeed).toEqual([]);
  });

  it("does not cross-wire two same-day strength workouts", () => {
    const plan = planDayWorkoutReconciliation(
      [
        {
          id: 1,
          sourceIdentity: "ext:morning",
          externalId: "morning",
          type: "Traditional Strength Training",
          startAt: new Date("2026-09-17T08:00:00Z"),
          endAt: new Date("2026-09-17T09:00:00Z"),
          linkedToDiary: true,
        },
        {
          id: 2,
          sourceIdentity: "ext:evening",
          externalId: "evening",
          type: "Traditional Strength Training",
          startAt: new Date("2026-09-17T16:00:00Z"),
          endAt: new Date("2026-09-17T17:00:00Z"),
          linkedToDiary: false,
        },
      ],
      [
        {
          externalId: "evening",
          type: "Traditional Strength Training",
          startAt: "2026-09-17T18:00:00+02:00",
          endAt: "2026-09-17T19:00:00+02:00",
          activeEnergyKcal: 350,
        },
        {
          externalId: "morning",
          type: "Traditional Strength Training",
          startAt: "2026-09-17T10:00:00+02:00",
          endAt: "2026-09-17T11:00:00+02:00",
          activeEnergyKcal: 280,
        },
      ],
    );
    expect(plan.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, fields: expect.objectContaining({ externalId: "morning", activeEnergyKcal: 280 }) }),
      expect.objectContaining({ id: 2, fields: expect.objectContaining({ externalId: "evening", activeEnergyKcal: 350 }) }),
    ]));
    expect(plan.creates).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });
});
