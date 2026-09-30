/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "uk", intlLocale: "uk-UA", setLocale: () => undefined }),
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: () => <nav>nav</nav>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/training/sessions/11",
  useSearchParams: () => new URLSearchParams(),
}));

import { SessionClient } from "@/app/training/sessions/[id]/session-client";
import {
  ENTRY_MODE,
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
  EXERCISE_ORIGIN,
} from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

function completedSession(): StrengthSessionDto {
  return {
    id: 11,
    status: SESSION_STATUS.COMPLETED,
    entryMode: ENTRY_MODE.LIVE,
    revision: 1,
    programId: 2,
    programName: "Тисни",
    programVersionId: 2,
    programVersionNumber: 1,
    webStartedAt: "2026-09-25T15:06:00.000Z",
    webEndedAt: "2026-09-25T16:28:00.000Z",
    matchStatus: MATCH_STATUS.MATCHED,
    matchMethod: "AUTO",
    matchedAt: "2026-09-25T16:28:00.000Z",
    matchedWorkoutId: 63,
    matchedWorkout: {
      id: 63,
      type: "Traditional Strength Training",
      startAt: "2026-09-25T15:05:00.000Z",
      endAt: "2026-09-25T16:28:00.000Z",
      durationMinutes: 83,
      activeEnergyKcal: 775,
      externalId: "x",
    },
    selectedActiveEnergy: {
      kcal: 270,
      source: "bodycast-strength-estimate",
      fullCoverage: true,
    },
    ordinaryTonnageKg: 1000,
    loggedSets: 4,
    plannedSets: 4,
    planCompletionPercent: 100,
    autoAdvanceExercises: false,
    createdAt: "2026-09-25T15:06:00.000Z",
    updatedAt: "2026-09-25T16:28:00.000Z",
    exercises: [{
      id: 101,
      sourceExerciseCatalogId: 1,
      stableKey: "incline_press",
      snapshotExerciseName: "Жим гантелей",
      order: 1,
      plannedSets: 4,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: EXERCISE_ORIGIN.PLANNED,
      muscleMappingSnapshot: null,
      sets: [
        {
          id: 1, sessionExerciseId: 101, setNumber: 1, reps: 8, weightKg: 26,
          bandNominalResistanceKg: null, rir: null, comment: null,
          completedAt: "2026-09-25T15:30:00.000Z",
          createdAt: "2026-09-25T15:30:00.000Z",
          updatedAt: "2026-09-25T15:30:00.000Z",
        },
        {
          id: 2, sessionExerciseId: 101, setNumber: 2, reps: 8, weightKg: 36,
          bandNominalResistanceKg: null, rir: null, comment: null,
          completedAt: null,
          createdAt: "2026-09-25T15:26:00.000Z",
          updatedAt: "2026-09-25T15:26:00.000Z",
        },
        {
          id: 3, sessionExerciseId: 101, setNumber: 3, reps: 8, weightKg: 36,
          bandNominalResistanceKg: null, rir: null, comment: null,
          completedAt: "not-a-time",
          createdAt: "also-bad",
          updatedAt: "2026-09-25T15:22:00.000Z",
        },
      ],
    }],
  };
}

describe("completed session historical set clocks and energy", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders set completion clocks and BodyCast selected energy", async () => {
    const session = completedSession();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/history")) {
        return Response.json({ entries: [] });
      }
      return Response.json({ session });
    }));

    render(<SessionClient sessionId={11} />);

    await waitFor(() => {
      expect(screen.getByText("270 активних ккал · Оцінка сили BodyCast")).toBeTruthy();
    });
    const headings = Array.from(screen.getByRole("main").querySelectorAll("h2"))
      .map((heading) => heading.textContent?.trim());
    const sourcePosition = headings.indexOf("Джерела");
    const matchPosition = headings.indexOf("Ручне зіставлення");
    const exercisesPosition = headings.indexOf("Вправи та підходи");
    const accountingPosition = headings.indexOf("Облік навантаження");
    expect(sourcePosition).toBeGreaterThanOrEqual(0);
    expect(matchPosition).toBeGreaterThan(sourcePosition);
    expect(exercisesPosition).toBeGreaterThan(matchPosition);
    expect(accountingPosition).toBeGreaterThan(exercisesPosition);
    // 15:30 UTC → 17:30 Bratislava; createdAt fallback 15:26 UTC → 17:26
    expect(screen.getByText("17:30")).toBeTruthy();
    expect(screen.getByText("17:26")).toBeTruthy();
    expect(screen.getByText("час недоступний")).toBeTruthy();
    expect(screen.getByText("#1 8×26kg")).toBeTruthy();
    expect(screen.getByText("#2 8×36kg")).toBeTruthy();
  });
});
