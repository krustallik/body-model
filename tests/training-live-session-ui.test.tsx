/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "uk", intlLocale: "uk-UA", setLocale: () => undefined }),
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: () => <nav>nav</nav>,
}));

const routerPush = vi.fn();
const routerReplace = vi.fn();
const searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  usePathname: () => "/training/sessions/42",
  useSearchParams: () => searchParams,
}));

import { SessionClient } from "@/app/training/sessions/[id]/session-client";
import styles from "@/app/training/training.module.css";

function activePane() {
  return within(screen.getByTestId("active-exercise-pane"));
}
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
        stableKey: null,
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
        stableKey: null,
        snapshotExerciseName: "Розведення гантелей на горизонтальній лаві",
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
        stableKey: null,
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
    routerPush.mockReset();
    routerReplace.mockReset();
    searchParams.delete("exercise");
  });

  function stubSessionFetch(
    session = buildSession(),
    extras?: (url: string, init?: RequestInit) => Response | null,
  ) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) {
        return Response.json({
          entries: [{
            sessionId: 9,
            occurredAt: "2026-09-10T16:00:00.000Z",
            programName: "ТИСНИ",
            resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
            sets: [
              { setNumber: 2, reps: 10, weightKg: 32, bandNominalResistanceKg: null, rir: 2, comment: "важко" },
              { setNumber: 1, reps: 12, weightKg: 30, bandNominalResistanceKg: null, rir: null, comment: null },
            ],
          }],
        });
      }
      const extra = extras?.(url, init);
      if (extra) return extra;
      return Response.json({ session });
    }));
  }

  it("shows program context, progress badge, and no UI Review label", async () => {
    stubSessionFetch();
    render(<SessionClient sessionId={42} />);
    await waitFor(() => {
      expect(screen.getByText("ТИСНИ")).toBeTruthy();
      expect(screen.getByRole("heading", {
        name: "Жим гантелей на похилій лаві вгору (30°)",
      })).toBeTruthy();
    });
    expect(screen.getByText("1 / 3 вправ")).toBeTruthy();
    expect(screen.getByText("Зовнішня вага")).toBeTruthy();
    expect(screen.getAllByText("0 / 4 підходів").length).toBeGreaterThan(0);
    expect(screen.queryByText(/UI Review/i)).toBeNull();
    expect(activePane().getByText("Вага, кг")).toBeTruthy();
    expect(activePane().getByText("Повтори")).toBeTruthy();
    expect(activePane().getByText("Ще немає записаних підходів.")).toBeTruthy();
  });

  it("keeps composer above logged sets and renders exercise history", async () => {
    stubSessionFetch();
    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByText("ТИСНИ")).toBeTruthy());

    const composer = activePane().getByLabelText("Новий підхід");
    const logged = activePane().getByLabelText("Підходи");
    const history = activePane().getByLabelText("Історія вправи");
    expect(
      composer.compareDocumentPosition(logged) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      logged.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() => {
      expect(activePane().getByText(/32 кг × 10|32 кг/)).toBeTruthy();
      expect(activePane().getByText("важко")).toBeTruthy();
    });
  });

  it("shows catalog image with contain sizing class and updates on next", async () => {
    const user = userEvent.setup();
    stubSessionFetch();

    const { container } = render(<SessionClient sessionId={42} />);
    await waitFor(() => {
      const img = screen.getByRole("img", {
        name: "Жим гантелей на похилій лаві вгору (30°)",
      }) as HTMLImageElement;
      expect(img.getAttribute("src")).toBe("/training/exercises/incline-dumbbell-press-30.jpg");
      expect(img.className).toContain(styles.workoutImage);
    });
    expect(container.querySelector(`.${styles.workoutVisual}`)).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: /Наступна вправа/i })[0]!);
    await waitFor(() => {
      const img = screen.getByRole("img", {
        name: "Розведення гантелей на горизонтальній лаві",
      }) as HTMLImageElement;
      expect(img.getAttribute("src")).toBe("/training/exercises/flat-dumbbell-fly.jpg");
    });
  });

  it("has no bottom Prev/Next footer; swipe affordances live on the image", async () => {
    stubSessionFetch();
    const { container } = render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByText("ТИСНИ")).toBeTruthy());

    expect(screen.queryByRole("button", { name: "Наступна →" })).toBeNull();
    expect(screen.queryByRole("button", { name: "← Попередня" })).toBeNull();
    expect(container.querySelector("[class*='workoutMobileArrow']")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Наступна вправа/i }).length).toBeGreaterThan(0);
  });

  it("pages exercises with arrows, comments, and shared workspace labels", async () => {
    const user = userEvent.setup();
    let session = buildSession();
    stubSessionFetch(session, (url, init) => {
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
                  rir: null,
                  comment: "пауза",
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
      if (!init?.method && url.includes("/sessions/42")) {
        return Response.json({ session });
      }
      return null;
    });

    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByText("ТИСНИ")).toBeTruthy());

    const save = screen.getByRole("button", { name: "Додати підхід" });
    expect(save).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: /\+ Коментар/i }));
    const weight = activePane().getByLabelText("Вага, кг");
    const reps = activePane().getByLabelText("Повтори");
    const comment = activePane().getByLabelText("Коментар");
    await user.type(weight, "30");
    await user.type(reps, "12");
    await user.type(comment, "пауза");
    expect(save).toHaveProperty("disabled", false);

    await user.click(save);
    await waitFor(() => {
      expect(activePane().getAllByText(/30 кг × 12/).length).toBeGreaterThan(0);
      expect(activePane().getByText("пауза")).toBeTruthy();
      expect(screen.getAllByText("1 / 4 підходів").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole("button", { name: /Наступна вправа/i })[0]!);
    await waitFor(() => {
      expect(screen.getByRole("heading", {
        name: "Розведення гантелей на горизонтальній лаві",
      })).toBeTruthy();
      expect(screen.getByText("2 / 3 вправ")).toBeTruthy();
      expect(activePane().getByText("Опір резинки, кг")).toBeTruthy();
    });

    await user.click(screen.getAllByRole("button", { name: /Наступна вправа/i })[0]!);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Віджимання від ручок" })).toBeTruthy();
      expect(activePane().getByText("Власна вага")).toBeTruthy();
      expect(activePane().queryByText("Вага, кг")).toBeNull();
      expect(activePane().queryByText("Опір резинки, кг")).toBeNull();
      expect(within(activePane().getByLabelText("Новий підхід")).getByText("Повтори")).toBeTruthy();
    });

    await user.click(screen.getAllByRole("button", { name: /Попередня вправа/i })[0]!);
    await waitFor(() => {
      expect(screen.getByRole("heading", {
        name: "Розведення гантелей на горизонтальній лаві",
      })).toBeTruthy();
    });
  });

  it("swipes left to advance exercise and image", async () => {
    stubSessionFetch();
    const { container } = render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByText("ТИСНИ")).toBeTruthy());

    const viewport = container.querySelector(`.${styles.workoutCarouselViewport}`);
    expect(viewport).toBeTruthy();
    fireEvent.pointerDown(viewport!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 220,
      clientY: 300,
    });
    fireEvent.pointerMove(viewport!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 305,
    });
    fireEvent.pointerUp(viewport!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 305,
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", {
        name: "Розведення гантелей на горизонтальній лаві",
      })).toBeTruthy();
      const img = screen.getByRole("img", {
        name: "Розведення гантелей на горизонтальній лаві",
      }) as HTMLImageElement;
      expect(img.getAttribute("src")).toBe("/training/exercises/flat-dumbbell-fly.jpg");
    });
  });

  it("exposes Cancel workout in menu and confirms cancel flow", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (init?.method === "POST" && url.endsWith("/cancel")) {
        return Response.json({ ok: true });
      }
      return Response.json({ session: buildSession() });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByText("ТИСНИ")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /Меню сесії/i }));
    const dialog = screen.getByRole("dialog", { name: "Дії" });
    expect(dialog).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Закрити" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Скасувати тренування" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/training/sessions/42/cancel",
        expect.objectContaining({ method: "POST" }),
      );
      expect(routerPush).toHaveBeenCalledWith("/training");
    });
  });

  it("keeps the active session after refresh reload", async () => {
    stubSessionFetch();
    const { rerender } = render(<SessionClient sessionId={42} />);
    await waitFor(() => {
      expect(screen.getByRole("heading", {
        name: "Жим гантелей на похилій лаві вгору (30°)",
      })).toBeTruthy();
    });
    rerender(<SessionClient sessionId={42} />);
    await waitFor(() => {
      expect(screen.getByRole("heading", {
        name: "Жим гантелей на похилій лаві вгору (30°)",
      })).toBeTruthy();
    });
  });

  it("opens the exercise from the URL query", async () => {
    searchParams.set("exercise", "2");
    stubSessionFetch();
    render(<SessionClient sessionId={42} />);
    await waitFor(() => {
      expect(screen.getByRole("heading", {
        name: "Розведення гантелей на горизонтальній лаві",
      })).toBeTruthy();
      expect(screen.getByText("2 / 3 вправ")).toBeTruthy();
    });
  });

  it("copies a historical set into the draft without saving", async () => {
    const user = userEvent.setup();
    stubSessionFetch();
    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(activePane().getByText(/32 кг × 10/)).toBeTruthy());
    await user.click(activePane().getByRole("button", { name: /#2/ }));
    expect((activePane().getByLabelText("Вага, кг") as HTMLInputElement).value).toBe("32");
    expect((activePane().getByLabelText("Повтори") as HTMLInputElement).value).toBe("10");
    expect((activePane().getByPlaceholderText("опційно") as HTMLInputElement).value).toBe("2");
    expect(activePane().getByText(/Поля підставлено/)).toBeTruthy();
  });

  it("accepts a comma decimal for kilograms", async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    stubSessionFetch(buildSession(), (url, init) => {
      if (init?.method === "POST" && url.includes("/sets")) {
        posted.push(JSON.parse(String(init.body)));
        return Response.json({ set: { id: 1 } }, { status: 201 });
      }
      return null;
    });
    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(activePane().getByLabelText("Вага, кг")).toBeTruthy());
    await user.type(activePane().getByLabelText("Вага, кг"), "33,5");
    await user.type(activePane().getByLabelText("Повтори"), "8");
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));
    await waitFor(() => {
      expect(posted[0]).toEqual(expect.objectContaining({ weightKg: 33.5, reps: 8 }));
    });
  });

  it("offers to finish after filling the last planned set of the last exercise", async () => {
    const user = userEvent.setup();
    let session = buildSession({
      exercises: [{
        id: 3,
        sourceExerciseCatalogId: 5,
        stableKey: null,
        snapshotExerciseName: "Віджимання від ручок",
        order: 0,
        plannedSets: 1,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      }],
    });
    stubSessionFetch(session, (url, init) => {
      if (init?.method === "POST" && url.includes("/sets")) {
        session = {
          ...session,
          exercises: [{
            ...session.exercises[0]!,
            sets: [{
              id: 91,
              sessionExerciseId: 3,
              setNumber: 1,
              reps: 12,
              weightKg: null,
              bandNominalResistanceKg: null,
              rir: null,
              comment: null,
              completedAt: "2026-09-17T16:05:00.000Z",
              createdAt: "2026-09-17T16:05:00.000Z",
              updatedAt: "2026-09-17T16:05:00.000Z",
            }],
          }],
        };
        return Response.json({ set: session.exercises[0]!.sets[0] }, { status: 201 });
      }
      if (!init?.method && url.includes("/sessions/42")) {
        return Response.json({ session });
      }
      return null;
    });

    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Віджимання від ручок" })).toBeTruthy());
    await user.type(screen.getByLabelText("Повтори"), "12");
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Завершити тренування?" })).toBeTruthy();
      expect(screen.getByText(/100% плану/)).toBeTruthy();
    });
  });
});
