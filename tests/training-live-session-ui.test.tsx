/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "uk", intlLocale: "uk-UA", setLocale: () => undefined }),
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: () => <nav>nav</nav>,
}));

import { SessionClient } from "@/app/training/sessions/[id]/session-client";
import {
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
} from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

function buildSession(overrides: Partial<StrengthSessionDto> = {}): StrengthSessionDto {
  return {
    id: 42,
    status: SESSION_STATUS.ACTIVE,
    entryMode: ENTRY_MODE.LIVE,
    revision: 1,
    programId: 7,
    programName: "ТИСНИ",
    programVersionId: 11,
    programVersionNumber: 1,
    webStartedAt: "2026-09-17T16:00:00.000Z",
    webEndedAt: null,
    matchStatus: MATCH_STATUS.PENDING,
    matchMethod: null,
    matchedAt: null,
    matchedWorkoutId: null,
    matchedWorkout: null,
    ordinaryTonnageKg: null,
    createdAt: "2026-09-17T16:00:00.000Z",
    updatedAt: "2026-09-17T16:00:00.000Z",
    exercises: [
      {
        id: 1,
        sourceExerciseCatalogId: 3,
        snapshotExerciseName: "Жим гантелей на похилій лаві вгору (30°)",
        order: 0,
        plannedSets: 4,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      },
      {
        id: 2,
        sourceExerciseCatalogId: 4,
        snapshotExerciseName: "Розведення гантелей",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.RESISTANCE_BAND,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      },
      {
        id: 3,
        sourceExerciseCatalogId: 5,
        snapshotExerciseName: "Віджимання від ручок",
        order: 2,
        plannedSets: 3,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      },
    ],
    ...overrides,
  };
}

describe("Live training session mobile UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows program context, exercise hierarchy, and external-weight labels", async () => {
    const session = buildSession();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ session })));

    render(<SessionClient sessionId={42} />);
    await waitFor(() => {
      expect(screen.getByText("ТИСНИ")).toBeTruthy();
      expect(screen.getByRole("heading", {
        name: "Жим гантелей на похилій лаві вгору (30°)",
      })).toBeTruthy();
    });
    expect(screen.getByText("1 / 3 вправ")).toBeTruthy();
    expect(screen.getByText("Зовнішня вага")).toBeTruthy();
    expect(screen.getByText("4 заплановані підходи")).toBeTruthy();
    expect(screen.getByText("Вага, кг")).toBeTruthy();
    expect(screen.getByText("Повтори")).toBeTruthy();
    expect(screen.getByText("Ще немає записаних підходів.")).toBeTruthy();
  });

  it("disables Save until values are valid, then logs a set and advances exercises", async () => {
    const user = userEvent.setup();
    let session = buildSession();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/sets")) {
        session = {
          ...session,
          exercises: session.exercises.map((exercise, index) => (
            index === 0
              ? {
                ...exercise,
                sets: [{
                  id: 91,
                  sessionExerciseId: exercise.id,
                  setNumber: 1,
                  reps: 12,
                  weightKg: 30,
                  bandNominalResistanceKg: null,
                  completedAt: "2026-09-17T16:05:00.000Z",
                  createdAt: "2026-09-17T16:05:00.000Z",
                  updatedAt: "2026-09-17T16:05:00.000Z",
                }],
              }
              : exercise
          )),
        };
        return Response.json({
          set: session.exercises[0]!.sets[0],
        }, { status: 201 });
      }
      return Response.json({ session });
    }));

    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByText("ТИСНИ")).toBeTruthy());

    const save = screen.getByRole("button", { name: "Зберегти підхід" });
    expect(save).toHaveProperty("disabled", true);

    const weight = screen.getByLabelText("Вага, кг");
    const reps = screen.getByLabelText("Повтори");
    await user.type(weight, "30");
    await user.type(reps, "12");
    expect(save).toHaveProperty("disabled", false);

    await user.click(save);
    await waitFor(() => {
      expect(screen.getByText("30 кг")).toBeTruthy();
      expect(screen.getByText(/12/)).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Наступна →" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Розведення гантелей" })).toBeTruthy();
      expect(screen.getByText("2 / 3 вправ")).toBeTruthy();
      expect(screen.getByText("Опір резинки, кг")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Наступна →" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Віджимання від ручок" })).toBeTruthy();
      expect(screen.getByText("Власна вага")).toBeTruthy();
      expect(screen.queryByText("Вага, кг")).toBeNull();
      expect(screen.queryByText("Опір резинки, кг")).toBeNull();
      expect(within(screen.getByLabelText("Новий підхід")).getByText("Повтори")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "← Попередня" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Розведення гантелей" })).toBeTruthy();
    });
  });

  it("keeps the active session after refresh reload", async () => {
    const session = buildSession();
    const fetchMock = vi.fn(async () => Response.json({ session }));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByText("ТИСНИ")).toBeTruthy());
    rerender(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByText("ТИСНИ")).toBeTruthy());
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
