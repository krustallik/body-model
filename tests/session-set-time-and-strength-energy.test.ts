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
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION } from "@/modules/training/experimental-strength-active-energy-v1";
import { strengthEstimateFreshForDay } from "@/modules/days/training-day-fact";

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
    // 15:30 UTC = 17:30 Bratislava (CEST)
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

describe("BodyCast strength energy selection freshness", () => {
  const sets = strengthSetFingerprintV1([
    { id: 1, reps: 8, weightKg: 36, bandNominalResistanceKg: null, rir: null },
  ]);
  const fingerprint = strengthInputFingerprintV1({
    sessionId: 11,
    sessionRevision: 1,
    massKg: 87.6,
    sameDayMassKg: 87.6,
    startOfDayMassKg: 87.6,
    setFingerprint: sets,
    estimatorVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  });

  it("selects a fresh BodyCast estimate over Garmin", () => {
    expect(strengthEstimateFreshV1({
      estimateKcal: 270,
      sessionRevision: 1,
      shadowSessionRevision: 1,
      storedInputFingerprint: fingerprint,
      currentInputFingerprint: fingerprint,
    })).toBe(true);
    const selected = selectStrengthEnergyV1({
      bodyCastKcal: 270,
      bodyCastFresh: true,
      sessionCompleted: true,
      garminKcal: 775,
    });
    expect(selected).toMatchObject({
      selectedKcal: 270,
      source: "bodycast-strength-estimate",
    });
    expect(formatSelectedActiveEnergyText({
      kcal: selected.selectedKcal,
      source: selected.source,
      fullCoverage: selected.fullCoverage,
      uk: true,
    })).toMatch(/270 активних ккал · .*BodyCast/i);
  });

  it("rejects a stale fingerprinted BodyCast estimate and falls back to Garmin", () => {
    expect(strengthEstimateFreshV1({
      estimateKcal: 270,
      sessionRevision: 2,
      shadowSessionRevision: 1,
      storedInputFingerprint: fingerprint,
      currentInputFingerprint: fingerprint,
    })).toBe(false);
    const selected = selectStrengthEnergyV1({
      bodyCastKcal: 270,
      bodyCastFresh: false,
      sessionCompleted: true,
      garminKcal: 775,
    });
    expect(selected).toMatchObject({
      selectedKcal: 775,
      source: "garmin-fallback",
    });
    expect(formatSelectedActiveEnergyText({
      kcal: selected.selectedKcal,
      source: selected.source,
      fullCoverage: true,
      uk: true,
    })).toBe("775 активних ккал · Оцінка пристрою");
  });

  it("falls back to Garmin when BodyCast estimate is missing", () => {
    expect(strengthEstimateFreshV1({
      estimateKcal: null,
      sessionRevision: 1,
      shadowSessionRevision: null,
      storedInputFingerprint: null,
      currentInputFingerprint: fingerprint,
    })).toBe(false);
    expect(selectStrengthEnergyV1({
      bodyCastKcal: null,
      bodyCastFresh: false,
      sessionCompleted: true,
      garminKcal: 775,
    }).source).toBe("garmin-fallback");
  });

  it("treats legacy shadows without fingerprint markers as fresh when estimate exists", () => {
    // Production session 11 shape: available estimate, no sessionRevision/inputFingerprint.
    expect(strengthEstimateFreshV1({
      estimateKcal: 270.1191167122709,
      sessionRevision: 1,
      shadowSessionRevision: null,
      storedInputFingerprint: null,
      currentInputFingerprint: fingerprint,
    })).toBe(true);
    expect(strengthEstimateFreshForDay({
      sessionId: 11,
      status: "COMPLETED",
      revision: 1,
      diaryKcal: 270.1191167122709,
      energyShadow: {
        estimatedActiveKcal: 270.1191167122709,
        availability: "available",
      },
      sameDayMassKg: 87.6,
      startOfDayMassKg: 87.6,
      sets: [{ id: 1, reps: 8, weightKg: 36, bandNominalResistanceKg: null, rir: null }],
      estimatorVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    })).toBe(true);
  });

  it("keeps modern fingerprint mismatch stale (v7 path, not selection-v1)", () => {
    const other = strengthInputFingerprintV1({
      sessionId: 11,
      sessionRevision: 1,
      massKg: 90,
      sameDayMassKg: 90,
      startOfDayMassKg: 87.6,
      setFingerprint: sets,
      estimatorVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    });
    expect(strengthEstimateFreshV1({
      estimateKcal: 270,
      sessionRevision: 1,
      shadowSessionRevision: 1,
      storedInputFingerprint: fingerprint,
      currentInputFingerprint: other,
    })).toBe(false);
  });
});
