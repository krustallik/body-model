import { describe, expect, it } from "vitest";
import { emptyTrainingDayFact, resolveTrainingDayFacts, type DiaryFactSource, type WorkoutFactSource } from "@/modules/days/training-day-fact";
import {
  strengthInputFingerprintV1,
  strengthSetFingerprintV1,
} from "@/modules/training/strength-publication-v1";

const workout = (overrides: Partial<WorkoutFactSource> = {}): WorkoutFactSource => ({
  id: 1,
  sourceIdentity: "ext:g-1",
  type: "Traditional Strength Training",
  startAt: new Date("2026-09-23T22:30:00.000Z"),
  endAt: new Date("2026-09-23T23:30:00.000Z"),
  durationMinutes: 60,
  activeEnergyKcal: null,
  hiddenFromHistory: false,
  matchedDiarySession: null,
  ...overrides,
});

const diary = (overrides: Partial<DiaryFactSource> = {}): DiaryFactSource => ({
  id: 4,
  status: "COMPLETED",
  entryMode: "LIVE",
  webStartedAt: new Date("2026-09-23T22:30:00.000Z"),
  webEndedAt: new Date("2026-09-23T23:30:00.000Z"),
  loggedSetCount: 0,
  programName: "Push",
  energyShadow: null,
  ...overrides,
});

describe("TrainingDayFact resolver", () => {
  it("returns explicit zero event count and duration for an empty day", () => {
    expect(emptyTrainingDayFact("2026-09-24")).toEqual({
      date: "2026-09-24",
      eventCount: 0,
      durationMinutes: 0,
      hiddenEventCount: 0,
      events: [],
    });
  });

  it("deduplicates a persisted matched pair by relation identity, including hidden Workouts", () => {
    const facts = resolveTrainingDayFacts({
      workouts: [workout({
        hiddenFromHistory: true,
        matchedDiarySession: { id: 4, status: "COMPLETED", programName: "Push", loggedSetCount: 0, energyShadow: null },
      })],
      diarySessions: [diary({ matchedWorkoutId: 1 })],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ date: "2026-09-24", eventCount: 1, hiddenEventCount: 1, durationMinutes: null, events: [] });
  });

  it("anchors a matched pair to the Garmin start when diary and Workout timestamps differ", () => {
    const startAt = new Date("2026-09-23T22:30:00.000Z");
    const facts = resolveTrainingDayFacts({
      workouts: [workout({
        startAt,
        matchedDiarySession: { id: 4, status: "COMPLETED", programName: "Push", loggedSetCount: 2, energyShadow: null },
      })],
      diarySessions: [diary({ matchedWorkoutId: 1, webStartedAt: new Date("2026-09-24T22:30:00.000Z") })],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ date: "2026-09-24", eventCount: 1 });
    expect(facts[0]?.events[0]).toMatchObject({
      source: "matched",
      occurrenceAt: startAt.toISOString(),
      diarySessionId: 4,
      executionStatus: "completed",
    });
  });

  it("counts LIVE ACTIVE and COMPLETED starts even with no logged sets", () => {
    const facts = resolveTrainingDayFacts({
      workouts: [],
      diarySessions: [
        diary({ id: 1, status: "ACTIVE", webEndedAt: null }),
        diary({ id: 2, status: "COMPLETED", loggedSetCount: 0 }),
      ],
    });
    expect(facts[0]?.eventCount).toBe(2);
    expect(facts[0]?.durationMinutes).toBeNull();
    expect(facts[0]?.events.map(({ exerciseDetailAvailability }) => exerciseDetailAvailability))
      .toEqual(["no-logged-sets", "no-logged-sets"]);
    expect(facts[0]?.events.map(({ executionStatus }) => executionStatus))
      .toEqual(["completed", "in-progress"]);
  });

  it("counts cancelled sessions only when a recorded set remains", () => {
    const facts = resolveTrainingDayFacts({
      workouts: [],
      diarySessions: [
        diary({ id: 1, status: "CANCELLED", loggedSetCount: 0 }),
        diary({ id: 2, status: "CANCELLED", loggedSetCount: 1 }),
        diary({ id: 3, status: "PLANNED", loggedSetCount: 5 }),
        diary({ id: 4, entryMode: "RETROSPECTIVE", loggedSetCount: 5 }),
      ],
    });
    expect(facts[0]?.eventCount).toBe(1);
    expect(facts[0]?.events[0]).toMatchObject({
      diarySessionId: 2,
      loggedSetCount: 1,
      exerciseDetailAvailability: "logged-sets",
      executionStatus: "partial",
    });
  });

  it("uses Europe/Bratislava local start date across UTC midnight and preserves distinct exact identities", () => {
    const facts = resolveTrainingDayFacts({
      workouts: [
        workout({ id: 1, sourceIdentity: "ext:a", startAt: new Date("2026-09-23T22:30:00.000Z"), endAt: new Date("2026-09-23T23:00:00.000Z") }),
        workout({ id: 2, sourceIdentity: "ext:b", startAt: new Date("2026-09-23T22:31:00.000Z"), endAt: new Date("2026-09-23T23:01:00.000Z") }),
      ],
      diarySessions: [],
    });
    expect(facts[0]?.date).toBe("2026-09-24");
    expect(facts[0]?.eventCount).toBe(2);
    expect(facts[0]?.durationMinutes).toBe(120);
  });

  it("does not turn partial known durations into a complete total", () => {
    const facts = resolveTrainingDayFacts({
      workouts: [
        workout({ id: 1, sourceIdentity: "fp:1" }),
        workout({ id: 2, sourceIdentity: "fp:2", durationMinutes: null, endAt: new Date("2026-09-23T22:30:00.000Z") }),
      ],
      diarySessions: [],
    });
    expect(facts[0]?.eventCount).toBe(2);
    expect(facts[0]?.durationMinutes).toBeNull();
  });

  it("keeps Garmin-only exercise detail unavailable and never invents sets", () => {
    const facts = resolveTrainingDayFacts({ workouts: [workout()], diarySessions: [] });
    expect(facts[0]?.events[0]).toMatchObject({
      exerciseDetailAvailability: "unavailable",
      loggedSetCount: null,
      executionStatus: "unknown",
    });
  });

  it("prefers BodyCast mechanical over Garmin active kcal for stair events", () => {
    const facts = resolveTrainingDayFacts({
      workouts: [workout({
        type: "Stair Climbing",
        activeEnergyKcal: 400,
        mechanicalStepperKcal: 275,
      })],
      diarySessions: [],
    });
    expect(facts[0]?.events[0]).toMatchObject({
      activeEnergyKcal: 275,
      energySource: "bodycast-stepper-mechanical",
    });
  });

  it("withholds stale shadow strength estimates when sessionRevision mismatches", () => {
    const facts = resolveTrainingDayFacts({
      workouts: [workout({
        activeEnergyKcal: 380,
        matchedDiarySession: {
          id: 9,
          status: "COMPLETED",
          revision: 5,
          loggedSetCount: 8,
          programName: "Push",
          energyShadow: {
            estimatedActiveKcal: 250,
            sessionRevision: 4,
            inputFingerprint: "stale-fingerprint",
          },
        },
      })],
      diarySessions: [],
    });
    expect(facts[0]?.events[0]).toMatchObject({
      activeEnergyKcal: 380,
      energySource: "garmin-fallback",
    });
  });

  it("withholds shadow strength estimates that lack an input fingerprint", () => {
    const facts = resolveTrainingDayFacts({
      workouts: [],
      diarySessions: [diary({
        revision: 2,
        energyShadow: {
          estimatedActiveKcal: 311,
          sessionRevision: 2,
        },
        sets: [{ id: 1, reps: 8, weightKg: 60 }],
        sameDayMassKg: 80,
        startOfDayMassKg: 79,
      })],
    });
    expect(facts[0]?.events[0]).toMatchObject({
      activeEnergyKcal: null,
      energySource: "unavailable",
      diaryOnly: true,
    });
  });

  it("withholds a published shadow when late same-day mass changes without a revision bump", () => {
    const sets = [{ id: 3, reps: 8, weightKg: 60, bandNominalResistanceKg: null, rir: null }];
    const published = strengthInputFingerprintV1({
      sessionId: 4,
      sessionRevision: 2,
      massKg: 80,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
      setFingerprint: strengthSetFingerprintV1(sets),
    });
    const facts = resolveTrainingDayFacts({
      workouts: [],
      diarySessions: [diary({
        id: 4,
        revision: 2,
        sets,
        sameDayMassKg: 81.2,
        startOfDayMassKg: 79,
        energyShadow: {
          estimatedActiveKcal: 311,
          sessionRevision: 2,
          inputFingerprint: published,
        },
      })],
    });
    expect(facts[0]?.events[0]).toMatchObject({
      activeEnergyKcal: null,
      energySource: "unavailable",
      diaryOnly: true,
    });
  });

  it("publishes a fresh diary shadow only when the recomputed fingerprint still matches", () => {
    const sets = [{ id: 3, reps: 8, weightKg: 60, bandNominalResistanceKg: null, rir: null }];
    const published = strengthInputFingerprintV1({
      sessionId: 4,
      sessionRevision: 2,
      massKg: 80,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
      setFingerprint: strengthSetFingerprintV1(sets),
    });
    const facts = resolveTrainingDayFacts({
      workouts: [],
      diarySessions: [diary({
        id: 4,
        revision: 2,
        sets,
        sameDayMassKg: 80,
        startOfDayMassKg: 79,
        energyShadow: {
          estimatedActiveKcal: 311,
          sessionRevision: 2,
          inputFingerprint: published,
        },
      })],
    });
    expect(facts[0]?.events[0]).toMatchObject({
      activeEnergyKcal: 311,
      energySource: "shadow-diary-estimate",
      diaryOnly: true,
    });
  });

  it("sorts events newest-first with deterministic eventId tie-break", () => {
    const facts = resolveTrainingDayFacts({
      workouts: [
        workout({ id: 10, sourceIdentity: "a", startAt: new Date("2026-09-23T10:00:00.000Z"), endAt: new Date("2026-09-23T11:00:00.000Z"), activeEnergyKcal: 100 }),
        workout({ id: 11, sourceIdentity: "b", startAt: new Date("2026-09-23T12:00:00.000Z"), endAt: new Date("2026-09-23T13:00:00.000Z"), activeEnergyKcal: 120 }),
      ],
      diarySessions: [],
    });
    expect(facts[0]?.events.map((event) => event.eventId)).toEqual([
      "workout:11",
      "workout:10",
    ]);
  });
});
