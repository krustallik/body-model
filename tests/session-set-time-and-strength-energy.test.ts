import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatSetCompletionClock,
  formatSelectedActiveEnergyText,
  setCompletionTimestampIso,
} from "@/app/training/training-labels";
import { selectStrengthEnergyV1 } from "@/model/activity/canonical-activity-policy-v1";
import {
  strengthEstimateFreshV1,
  strengthInputFingerprintV1,
  strengthSetFingerprintV1,
} from "@/modules/training/strength-publication-v1";
import {
  estimateExperimentalStrengthActiveEnergyV1,
  EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
} from "@/modules/training/experimental-strength-active-energy-v1";
import {
  historicalStrengthInputFingerprintV1,
  recomputeHistoricalStrengthEstimateKcalV1,
  resolveHistoricalStrengthBodyCastV1,
  resolveHistoricalStrengthMassV1,
  selectHistoricalStrengthEnergyV1,
} from "@/modules/training/strength-historical-energy-v1";
import { strengthEstimateFreshForDay } from "@/modules/days/training-day-fact";
import type { StrengthSessionDto } from "@/modules/training/training.types";
import {
  ENTRY_MODE,
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
  EXERCISE_ORIGIN,
} from "@/modules/training/training.constants";

describe("historical set completion clocks", () => {
  it("prefers completedAt over createdAt", () => {
    expect(setCompletionTimestampIso({
      completedAt: "2026-09-25T15:30:00.000Z",
      createdAt: "2026-09-25T15:00:00.000Z",
    })).toBe("2026-09-25T15:30:00.000Z");
  });

  it("falls back to createdAt when completedAt is null", () => {
    expect(setCompletionTimestampIso({
      completedAt: null,
      createdAt: "2026-09-25T15:26:00.000Z",
    })).toBe("2026-09-25T15:26:00.000Z");
  });

  it("formats HH:mm in Europe/Bratislava", () => {
    expect(formatClock("2026-09-25T15:30:00.000Z", "uk-UA")).toBe("17:30");
    expect(formatSetCompletionClock({
      completedAt: "2026-09-25T15:30:00.000Z",
      createdAt: "2026-09-25T15:00:00.000Z",
    }, "en-US")).toBe("17:30");
  });

  it("returns unavailable marker for invalid timestamps", () => {
    expect(setCompletionTimestampIso({
      completedAt: "not-a-time",
      createdAt: "also-bad",
    })).toBeNull();
    expect(formatSetCompletionClock({
      completedAt: "not-a-time",
      createdAt: "also-bad",
    }, "uk-UA")).toBe("—");
  });
});

function sessionFixture(): StrengthSessionDto {
  return {
    id: 11,
    status: SESSION_STATUS.COMPLETED,
    entryMode: ENTRY_MODE.LIVE,
    revision: 1,
    programId: 1,
    programName: "Тисни",
    programVersionId: 1,
    programVersionNumber: 1,
    webStartedAt: "2026-08-25T15:06:00.000Z",
    webEndedAt: "2026-08-25T16:28:00.000Z",
    matchStatus: MATCH_STATUS.MATCHED,
    matchMethod: "AUTO",
    matchedAt: "2026-08-25T16:28:00.000Z",
    matchedWorkoutId: 63,
    matchedWorkout: {
      id: 63,
      type: "Traditional Strength Training",
      startAt: "2026-08-25T15:05:00.000Z",
      endAt: "2026-08-25T16:28:00.000Z",
      durationMinutes: 83,
      activeEnergyKcal: 775,
      externalId: "x",
    },
    ordinaryTonnageKg: 1000,
    createdAt: "2026-08-25T15:06:00.000Z",
    updatedAt: "2026-08-25T16:28:00.000Z",
    exercises: [{
      id: 1,
      sourceExerciseCatalogId: 1,
      stableKey: null,
      snapshotExerciseName: "Press",
      order: 0,
      plannedSets: 1,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: EXERCISE_ORIGIN.PLANNED,
      muscleMappingSnapshot: null,
      sets: [{
        id: 1,
        sessionExerciseId: 1,
        setNumber: 1,
        reps: 8,
        weightKg: 36,
        bandNominalResistanceKg: null,
        rir: null,
        comment: null,
        completedAt: "2026-08-25T15:30:00.000Z",
        createdAt: "2026-08-25T15:30:00.000Z",
        updatedAt: "2026-08-25T15:30:00.000Z",
      }],
    }],
  };
}

const sets = [{ id: 1, reps: 8, weightKg: 36, bandNominalResistanceKg: null, rir: null }];

describe("historical as-of-date strength energy", () => {
  it("A: historical workout at 80 kg ignores today's 76 kg", () => {
    expect(resolveHistoricalStrengthMassV1({
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    }).massKg).toBe(80);
    const at80 = recomputeHistoricalStrengthEstimateKcalV1({
      session: sessionFixture(),
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    });
    const at76 = recomputeHistoricalStrengthEstimateKcalV1({
      session: sessionFixture(),
      sameDayMassKg: 76,
      startOfDayMassKg: 79,
    });
    expect(at80).not.toBeNull();
    expect(at76).not.toBeNull();
    expect(at80).not.toBe(at76);
    // Display path must use historical 80, not today's 76.
    const selected = selectHistoricalStrengthEnergyV1({
      sessionCompleted: true,
      sessionId: 11,
      sessionRevision: 1,
      energyShadow: { estimatedActiveKcal: 999 }, // legacy unmarked
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
      onDemandEstimateKcal: at80,
      garminKcal: 775,
    });
    expect(selected).toMatchObject({
      selectedKcal: at80,
      source: "bodycast-strength-estimate",
      bodyCastOrigin: "on-demand-recompute",
    });
  });

  it("B: today's weight change does not invalidate historical fingerprint", () => {
    const historicalFp = historicalStrengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    });
    const afterTodayChange = historicalStrengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    });
    expect(afterTodayChange).toBe(historicalFp);
    expect(strengthEstimateFreshV1({
      estimateKcal: 270,
      sessionRevision: 1,
      shadowSessionRevision: 1,
      storedInputFingerprint: historicalFp,
      currentInputFingerprint: afterTodayChange,
    })).toBe(true);
  });

  it("C: correcting historical same-day weight invalidates stored estimate", () => {
    const published = historicalStrengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    });
    const afterCorrection = historicalStrengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      sets,
      sameDayMassKg: 81.4,
      startOfDayMassKg: 79,
    });
    expect(afterCorrection).not.toBe(published);
    expect(strengthEstimateFreshV1({
      estimateKcal: 270,
      sessionRevision: 1,
      shadowSessionRevision: 1,
      storedInputFingerprint: published,
      currentInputFingerprint: afterCorrection,
    })).toBe(false);
  });

  it("D: editing historical sets invalidates stored estimate", () => {
    const published = historicalStrengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    });
    const edited = historicalStrengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      sets: [{ id: 1, reps: 10, weightKg: 40, bandNominalResistanceKg: null, rir: null }],
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    });
    expect(edited).not.toBe(published);
    expect(strengthEstimateFreshV1({
      estimateKcal: 270,
      sessionRevision: 1,
      shadowSessionRevision: 1,
      storedInputFingerprint: published,
      currentInputFingerprint: edited,
    })).toBe(false);
  });

  it("E: uses historical start-of-day mass when same-day mass is unavailable", () => {
    expect(resolveHistoricalStrengthMassV1({
      sameDayMassKg: null,
      startOfDayMassKg: 80,
    })).toEqual({ massKg: 80, source: "unified-start-of-day" });
    const kcal = recomputeHistoricalStrengthEstimateKcalV1({
      session: sessionFixture(),
      sameDayMassKg: null,
      startOfDayMassKg: 80,
    });
    expect(kcal).not.toBeNull();
  });

  it("F: never substitutes today's latest mass when historical mass is missing", () => {
    expect(resolveHistoricalStrengthMassV1({
      sameDayMassKg: null,
      startOfDayMassKg: null,
    })).toEqual({ massKg: null, source: "unavailable" });
    expect(recomputeHistoricalStrengthEstimateKcalV1({
      session: sessionFixture(),
      sameDayMassKg: null,
      startOfDayMassKg: null,
    })).toBeNull();
    const selected = selectHistoricalStrengthEnergyV1({
      sessionCompleted: true,
      sessionId: 11,
      sessionRevision: 1,
      energyShadow: { estimatedActiveKcal: 270 },
      sets,
      sameDayMassKg: null,
      startOfDayMassKg: null,
      onDemandEstimateKcal: null,
      garminKcal: 775,
    });
    expect(selected).toMatchObject({
      selectedKcal: 775,
      source: "garmin-fallback",
      bodyCastOrigin: "none",
    });
  });

  it("G: retroactive prior-day mass correction invalidates dependent estimate", () => {
    const published = historicalStrengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      sets,
      sameDayMassKg: null,
      startOfDayMassKg: 80,
    });
    const afterPriorCorrection = historicalStrengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      sets,
      sameDayMassKg: null,
      startOfDayMassKg: 82,
    });
    expect(afterPriorCorrection).not.toBe(published);
    expect(strengthEstimateFreshForDay({
      sessionId: 11,
      status: "COMPLETED",
      revision: 1,
      diaryKcal: 270,
      energyShadow: {
        estimatedActiveKcal: 270,
        sessionRevision: 1,
        inputFingerprint: published,
      },
      sameDayMassKg: null,
      startOfDayMassKg: 82,
      sets,
    })).toBe(false);
  });

  it("H: session and day-fact share the same historical estimate and provenance", () => {
    const onDemand = recomputeHistoricalStrengthEstimateKcalV1({
      session: sessionFixture(),
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    });
    const sessionSelected = selectHistoricalStrengthEnergyV1({
      sessionCompleted: true,
      sessionId: 11,
      sessionRevision: 1,
      energyShadow: { estimatedActiveKcal: 270.1 },
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
      onDemandEstimateKcal: onDemand,
      garminKcal: 775,
    });
    const historySelected = selectHistoricalStrengthEnergyV1({
      sessionCompleted: true,
      sessionId: 11,
      sessionRevision: 1,
      energyShadow: { estimatedActiveKcal: 270.1 },
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
      onDemandEstimateKcal: onDemand,
      garminKcal: 775,
    });
    expect(sessionSelected).toEqual(historySelected);
    expect(formatSelectedActiveEnergyText({
      kcal: sessionSelected.selectedKcal,
      source: sessionSelected.source,
      fullCoverage: true,
      uk: true,
    })).toMatch(/активних ккал · .*BodyCast/i);
  });

  it("I: modern valid fingerprints stay selectable; stale fingerprints do not", () => {
    const fingerprint = historicalStrengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    });
    expect(resolveHistoricalStrengthBodyCastV1({
      sessionCompleted: true,
      sessionId: 11,
      sessionRevision: 1,
      energyShadow: {
        estimatedActiveKcal: 255,
        sessionRevision: 1,
        inputFingerprint: fingerprint,
      },
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
      onDemandEstimateKcal: 999,
    })).toMatchObject({
      bodyCastKcal: 255,
      bodyCastFresh: true,
      origin: "stored-shadow",
    });
    expect(resolveHistoricalStrengthBodyCastV1({
      sessionCompleted: true,
      sessionId: 11,
      sessionRevision: 2,
      energyShadow: {
        estimatedActiveKcal: 255,
        sessionRevision: 1,
        inputFingerprint: fingerprint,
      },
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
      onDemandEstimateKcal: 240,
    })).toMatchObject({
      bodyCastKcal: 240,
      bodyCastFresh: true,
      origin: "on-demand-recompute",
    });
  });

  it("J: does not leak future mass into historical estimation", () => {
    const historical = recomputeHistoricalStrengthEstimateKcalV1({
      session: sessionFixture(),
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    });
    // Future/today mass is simply never passed into the historical mass context.
    const leaked = estimateExperimentalStrengthActiveEnergyV1({
      session: sessionFixture(),
      bodyMassKg: 120,
    }).estimatedActiveKcal;
    expect(historical).not.toBe(leaked);
    expect(resolveHistoricalStrengthMassV1({
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    }).massKg).toBe(80);
  });

  it("uses Europe/Bratislava local date for historical as-of mass lookup", async () => {
    const { strengthWorkoutAsOfDateV1 } = await import(
      "@/modules/training/strength-historical-energy-v1"
    );
    // 23:30 UTC on Aug 25 is already Aug 26 in Bratislava (CEST).
    expect(strengthWorkoutAsOfDateV1({
      matchedWorkoutStartAt: "2026-08-25T23:30:00.000Z",
      webStartedAt: null,
      createdAt: "2026-08-25T23:30:00.000Z",
    })).toBe("2026-08-26");
  });

  it("rejects unmarked legacy shadows without on-demand validation", () => {
    expect(strengthEstimateFreshV1({
      estimateKcal: 270.1191167122709,
      sessionRevision: 1,
      shadowSessionRevision: null,
      storedInputFingerprint: null,
      currentInputFingerprint: "anything",
    })).toBe(false);
    expect(resolveHistoricalStrengthBodyCastV1({
      sessionCompleted: true,
      sessionId: 11,
      sessionRevision: 1,
      energyShadow: { estimatedActiveKcal: 270.1191167122709 },
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
      onDemandEstimateKcal: null,
    })).toMatchObject({
      bodyCastKcal: null,
      bodyCastFresh: false,
      origin: "none",
    });
  });

  it("falls back to Garmin when BodyCast cannot be established", () => {
    expect(selectStrengthEnergyV1({
      bodyCastKcal: null,
      bodyCastFresh: false,
      sessionCompleted: true,
      garminKcal: 775,
    })).toMatchObject({
      selectedKcal: 775,
      source: "garmin-fallback",
    });
  });

  it("keeps default v7 path independent of selection-v1 activation", () => {
    const fingerprint = strengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      massKg: 80,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
      setFingerprint: strengthSetFingerprintV1(sets),
      estimatorVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    });
    expect(fingerprint).toBe(historicalStrengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      sets,
      sameDayMassKg: 80,
      startOfDayMassKg: 79,
    }));
  });
});
