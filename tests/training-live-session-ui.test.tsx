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
              { id: 92, setNumber: 2, completedAt: null, reps: 10, weightKg: 32, bandNominalResistanceKg: null, rir: 2, comment: "важко" },
              { id: 91, setNumber: 1, completedAt: null, reps: 12, weightKg: 30, bandNominalResistanceKg: null, rir: null, comment: null },
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
    expect(activePane().queryByLabelText(/Додаткове обтяження/)).toBeNull();
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
    expect(within(dialog).getByRole("button", { name: "Завершити тренування" })).toBeTruthy();
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

  it("adds a catalog exercise to an empty programless live session", async () => {
    const user = userEvent.setup();
    const dynamicSession = buildSession({
      programId: null,
      programName: null,
      programVersionId: null,
      programVersionNumber: null,
      exercises: [],
    });
    const addedExercise = {
      id: 77,
      sourceExerciseCatalogId: 9,
      stableKey: "pushup_handles",
      snapshotExerciseName: "Віджимання від ручок",
      order: 0,
      plannedSets: 0,
      resistanceType: RESISTANCE.BODYWEIGHT,
      origin: EXERCISE_ORIGIN.EXTRA,
      muscleMappingSnapshot: null,
      sets: [],
    };
    const updatedSession = { ...dynamicSession, exercises: [addedExercise] };
    let persistedSession = dynamicSession;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") {
        return Response.json({ exercises: [{ id: 9, name: "Віджимання від ручок", stableKey: "pushup_handles", isActive: true, archivedAt: null, muscleMapping: null }] });
      }
      if (url.endsWith("/sessions/42/exercises") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          catalogId: 9,
          plannedSets: 0,
          resistanceType: RESISTANCE.BODYWEIGHT,
        });
        persistedSession = updatedSession;
        return Response.json({ session: persistedSession }, { status: 201 });
      }
      if (url.includes("/history")) return Response.json({ entries: [] });
      return Response.json({ session: persistedSession });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<SessionClient sessionId={42} />);
    await user.click(await screen.findByRole("button", { name: "Додати вправу" }));
    await user.selectOptions(await screen.findByLabelText("Вправа з каталогу"), "9");
    await user.selectOptions(screen.getByLabelText("Тип опору"), RESISTANCE.BODYWEIGHT);
    await user.click(screen.getByRole("button", { name: "Додати вправу" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Віджимання від ручок" })).toBeTruthy();
      expect(screen.getAllByText("Записано підходів: 0")).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/training/sessions/42/exercises",
        expect.objectContaining({ method: "POST" }),
      );
    });
    view.unmount();
    persistedSession = {
      ...updatedSession,
      exercises: [{
        ...addedExercise,
        sets: [{
          id: 90,
          sessionExerciseId: addedExercise.id,
          setNumber: 1,
          reps: 12,
          weightKg: null,
          bandNominalResistanceKg: null,
          rir: null,
          comment: null,
          completedAt: "2026-10-15T06:00:00.000Z",
          createdAt: "2026-10-15T06:00:00.000Z",
          updatedAt: "2026-10-15T06:00:00.000Z",
        }],
      }],
    };
    render(<SessionClient sessionId={42} />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Віджимання від ручок" })).toBeTruthy();
      expect(screen.getAllByText("Записано підходів: 1")).toHaveLength(2);
    });
  });

  it("creates, reads, edits, and clears additional load for a programless BODYWEIGHT set", async () => {
    const user = userEvent.setup();
    const bodyweightExercise = {
      id: 77,
      sourceExerciseCatalogId: 9,
      stableKey: "pull_up_bar",
      snapshotExerciseName: "Підтягування",
      order: 0,
      plannedSets: 0,
      resistanceType: RESISTANCE.BODYWEIGHT,
      origin: EXERCISE_ORIGIN.EXTRA,
      muscleMappingSnapshot: null,
      sets: [],
    };
    let persistedSession = buildSession({
      programId: null,
      programName: null,
      programVersionId: null,
      programVersionNumber: null,
      exercises: [bodyweightExercise],
    });
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url.endsWith("/exercises/77/sets") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ method: "POST", body: payload });
        const createdSet = {
          id: 901 + (persistedSession.exercises.find((exercise) => exercise.id === 77)?.sets.length ?? 0),
          sessionExerciseId: 77,
          setNumber: (persistedSession.exercises.find((exercise) => exercise.id === 77)?.sets.length ?? 0) + 1,
          reps: Number(payload.reps),
          weightKg: null,
          bandNominalResistanceKg: null,
          rir: typeof payload.rir === "number" ? payload.rir : null,
          comment: typeof payload.comment === "string" ? payload.comment : null,
          completedAt: "2026-10-15T06:00:00.000Z",
          createdAt: "2026-10-15T06:00:00.000Z",
          updatedAt: "2026-10-15T06:00:00.000Z",
          loadAccountingOverride: payload.loadAccountingOverride ?? null,
        };
        persistedSession = {
          ...persistedSession,
          exercises: persistedSession.exercises.map((exercise) => ({
            ...exercise,
            sets: exercise.id === 77 ? [...exercise.sets, createdSet] : exercise.sets,
          })),
        };
        return Response.json({ set: createdSet }, { status: 201 });
      }
      if (url.endsWith("/sets/901") && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ method: "PATCH", body: payload });
        const exercise = persistedSession.exercises.find((item) => item.id === 77)!;
        const prior = exercise.sets[0]!;
        const updatedSet = {
          ...prior,
          reps: Number(payload.reps),
          loadAccountingOverride: payload.loadAccountingOverride ?? null,
          updatedAt: "2026-10-15T06:01:00.000Z",
        };
        persistedSession = {
          ...persistedSession,
          exercises: persistedSession.exercises.map((item) => ({
            ...item,
            sets: item.id === 77 ? [updatedSet] : item.sets,
          })),
        };
        return Response.json({ set: updatedSet });
      }
      if (!init?.method && url.includes("/sessions/42")) return Response.json({ session: persistedSession });
      return Response.json({ session: persistedSession });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionClient sessionId={42} />);
    const additionalLoad = await screen.findByLabelText("Додаткове обтяження, кг (необов’язково)");
    await user.type(additionalLoad, "15");
    await user.type(activePane().getByLabelText("Повтори"), "10");
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));

    await waitFor(() => expect(activePane().getByText("власна вага +15 кг × 10")).toBeTruthy());
    expect(requests[0]).toEqual({
      method: "POST",
      body: expect.objectContaining({
        reps: 10,
        weightKg: null,
        bandNominalResistanceKg: null,
        loadAccountingOverride: { additionalLoadKg: 15 },
      }),
    });
    expect(requests[0]!.body).not.toHaveProperty("additionalLoadKg");

    await user.click(activePane().getByRole("button", { name: "Змінити підхід" }));
    const editLoad = activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)");
    expect((editLoad as HTMLInputElement).value).toBe("15");
    await user.clear(editLoad);
    await user.type(editLoad, "12,5");
    await user.click(screen.getByRole("button", { name: "Оновити підхід" }));
    await waitFor(() => expect(activePane().getByText("власна вага +12,5 кг × 10")).toBeTruthy());
    expect(requests[1]).toMatchObject({
      method: "PATCH",
      body: { loadAccountingOverride: { additionalLoadKg: 12.5 } },
    });

    await user.click(activePane().getByRole("button", { name: "Змінити підхід" }));
    await user.clear(activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)"));
    await user.click(screen.getByRole("button", { name: "Оновити підхід" }));
    await waitFor(() => expect(activePane().getByText("власна вага × 10")).toBeTruthy());
    expect(activePane().queryByText(/\+0(?:\.0+)? кг/)).toBeNull();
    expect(requests[2]).toMatchObject({ method: "PATCH", body: { loadAccountingOverride: null } });

    await user.type(activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)"), "0");
    await user.type(activePane().getByLabelText("Повтори"), "8");
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));
    await waitFor(() => expect(activePane().getByText("власна вага × 8")).toBeTruthy());
    expect(requests[3]!.method).toBe("POST");
    expect(requests[3]!.body).not.toHaveProperty("loadAccountingOverride");

    await user.type(activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)"), "2000");
    await user.type(activePane().getByLabelText("Повтори"), "10000");
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));
    await waitFor(() => expect(requests).toHaveLength(5));
    expect(requests[4]).toMatchObject({
      method: "POST",
      body: { reps: 10_000, loadAccountingOverride: { additionalLoadKg: 2_000 } },
    });
  });

  it("rejects invalid and conflicting additional load without sending a set mutation", async () => {
    const user = userEvent.setup();
    const loadedSet = {
      id: 901,
      sessionExerciseId: 77,
      setNumber: 1,
      reps: 10,
      weightKg: null,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
      completedAt: "2026-10-15T06:00:00.000Z",
      createdAt: "2026-10-15T06:00:00.000Z",
      updatedAt: "2026-10-15T06:00:00.000Z",
      loadAccountingOverride: { assistanceLoadKg: 5 },
    };
    const bodyweightExercise = {
      id: 77,
      sourceExerciseCatalogId: 9,
      stableKey: "pull_up_bar",
      snapshotExerciseName: "Підтягування",
      order: 0,
      plannedSets: 0,
      resistanceType: RESISTANCE.BODYWEIGHT,
      origin: EXERCISE_ORIGIN.EXTRA,
      muscleMappingSnapshot: null,
      sets: [loadedSet],
    };
    const session = buildSession({
      programId: null,
      programName: null,
      programVersionId: null,
      programVersionNumber: null,
      exercises: [bodyweightExercise],
    });
    const mutation = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (init?.method === "PATCH" || init?.method === "POST") mutation();
      return Response.json({ session });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionClient sessionId={42} />);

    await user.type(await screen.findByLabelText("Додаткове обтяження, кг (необов’язково)"), "-1");
    await user.type(activePane().getByLabelText("Повтори"), "10");
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));
    expect((await screen.findByRole("alert")).textContent).toContain("скінченним невід’ємним числом");
    expect(mutation).not.toHaveBeenCalled();

    for (const invalid of ["NaN", "Infinity"]) {
      const input = activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)");
      await user.clear(input);
      await user.type(input, invalid);
      await user.click(screen.getByRole("button", { name: "Додати підхід" }));
      expect((await screen.findByRole("alert")).textContent).toContain("скінченним невід’ємним числом");
      expect(mutation).not.toHaveBeenCalled();
    }

    const oversizedInput = activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)");
    await user.clear(oversizedInput);
    await user.type(oversizedInput, "1e308");
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));
    expect((await screen.findByRole("alert")).textContent).toContain("2000 кг");
    expect(mutation).not.toHaveBeenCalled();

    await user.clear(activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)"));
    await user.click(activePane().getByRole("button", { name: "Змінити підхід" }));
    await user.type(activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)"), "15");
    await user.click(screen.getByRole("button", { name: "Оновити підхід" }));
    expect((await screen.findByRole("alert")).textContent).toContain("одночасно мати додаткове обтяження та допомогу");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("shows bodyweight reference and additional load in the completed workout view", async () => {
    const session = buildSession({
      status: SESSION_STATUS.COMPLETED,
      matchStatus: MATCH_STATUS.MATCHED,
      exercises: [{
        id: 77,
        sourceExerciseCatalogId: 9,
        stableKey: "pull_up_bar",
        snapshotExerciseName: "Підтягування",
        order: 0,
        plannedSets: 0,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: EXERCISE_ORIGIN.EXTRA,
        muscleMappingSnapshot: null,
        sets: [
          {
            id: 901,
            sessionExerciseId: 77,
            setNumber: 1,
            reps: 10,
            weightKg: null,
            bandNominalResistanceKg: null,
            rir: null,
            comment: null,
            completedAt: "2026-10-15T06:00:00.000Z",
            createdAt: "2026-10-15T06:00:00.000Z",
            updatedAt: "2026-10-15T06:00:00.000Z",
            loadAccountingOverride: { additionalLoadKg: 15 },
          },
          {
            id: 902,
            sessionExerciseId: 77,
            setNumber: 2,
            reps: 8,
            weightKg: null,
            bandNominalResistanceKg: null,
            rir: null,
            comment: null,
            completedAt: "2026-10-15T06:02:00.000Z",
            createdAt: "2026-10-15T06:02:00.000Z",
            updatedAt: "2026-10-15T06:02:00.000Z",
            loadAccountingOverride: null,
          },
        ],
      }],
    });
    stubSessionFetch(session, (url) => (
      url.includes("/match-candidates") ? Response.json({ candidates: [] }) : null
    ));
    render(<SessionClient sessionId={42} />);
    await waitFor(() => {
      expect(screen.getByText("#1 10×власна вага +15 кг")).toBeTruthy();
      expect(screen.getByText("#2 8×власна вага")).toBeTruthy();
    });
  });

  it("opens the exercise from the URL query", async () => {
    const user = userEvent.setup();
    searchParams.set("exercise", "2");
    stubSessionFetch();
    render(<SessionClient sessionId={42} />);
    await waitFor(() => {
      expect(screen.getByRole("heading", {
        name: "Розведення гантелей на горизонтальній лаві",
      })).toBeTruthy();
      expect(screen.getByText("2 / 3 вправ")).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: /Меню сесії/i }));
    expect(within(screen.getByRole("dialog", { name: "Дії" })).getByRole("button", { name: "Завершити тренування" })).toBeTruthy();
  });

  it("copies a historical set into the draft without saving", async () => {
    const user = userEvent.setup();
    stubSessionFetch();
    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(activePane().getByText(/32 кг × 10/)).toBeTruthy());
    await user.click(activePane().getByRole("button", { name: "Підставити дані підходу 2" }));
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
      expect(posted[0]).not.toHaveProperty("loadAccountingOverride");
    });
  });

  it("keeps ordinary set entry scalar and hides asymmetric side controls", async () => {
    const user = userEvent.setup();
    const posted: Record<string, unknown>[] = [];
    stubSessionFetch(buildSession(), (url, init) => {
      if (init?.method === "POST" && url.includes("/sets")) {
        posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Response.json({ set: { id: 99 } }, { status: 201 });
      }
      return null;
    });
    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(activePane().getByLabelText("Вага, кг")).toBeTruthy());
    await user.type(activePane().getByLabelText("Вага, кг"), "10");
    await user.type(activePane().getByLabelText("Повтори"), "12");
    expect(activePane().queryByLabelText(/Ліва сторона|Права сторона/)).toBeNull();
    expect(activePane().queryByText(/Різні повтори для сторін|asymmetric reps/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      reps: 12,
      weightKg: 10,
    });
    expect(posted[0]).not.toHaveProperty("loadAccountingOverride");
  });

  it("loads accounting from session GET, materializes missing snapshots ordinarily, and refreshes explicitly", async () => {
    const user = userEvent.setup();
    const initial = buildSession({ materializationState: "missing" });
    const current = buildSession({
      materializationState: "current",
      loadAccountingV1: {
        methodVersion: "bodycast-load-accounting-v1",
        externalLoadVolume: { value: 4667, unit: "kg-repetitions", availability: "available", coverage: { eligibleRows: 4, accountedRows: 4, omittedRows: 0, omittedReasons: {} }, provenance: [] },
        bandNominalIndex: {
          perLoggedSide: { value: null, unit: "nominal-kg-repetitions-per-logged-side", availability: "unavailable", coverage: { eligibleRows: 0, accountedRows: 0, omittedRows: 0, omittedReasons: {} }, provenance: [] },
          leftSide: { value: null, unit: "nominal-kg-repetitions-per-side", availability: "unavailable", coverage: { eligibleRows: 0, accountedRows: 0, omittedRows: 0, omittedReasons: {} }, provenance: [] },
          rightSide: { value: null, unit: "nominal-kg-repetitions-per-side", availability: "unavailable", coverage: { eligibleRows: 0, accountedRows: 0, omittedRows: 0, omittedReasons: {} }, provenance: [] },
        },
        bodyweight: {
          sets: { value: null, unit: "sets", availability: "unavailable", coverage: { eligibleRows: 0, accountedRows: 0, omittedRows: 0, omittedReasons: {} }, provenance: [] },
          repetitions: { value: null, unit: "repetitions", availability: "unavailable", coverage: { eligibleRows: 0, accountedRows: 0, omittedRows: 0, omittedReasons: {} }, provenance: [] },
          referenceVolume: { value: null, unit: "bodyweight-reference-kg-repetitions", availability: "unavailable", coverage: { eligibleRows: 0, accountedRows: 0, omittedRows: 0, omittedReasons: {} }, provenance: [] },
          reference: { status: "unavailable", valueKg: null, localDate: "2026-09-17", source: null, sourceId: null },
        },
        additionalLoad: { value: null, unit: "kg-repetitions", availability: "unavailable", coverage: { eligibleRows: 0, accountedRows: 0, omittedRows: 0, omittedReasons: {} }, provenance: [] },
        assistanceLoad: { value: null, unit: "kg-repetitions", availability: "unavailable", coverage: { eligibleRows: 0, accountedRows: 0, omittedRows: 0, omittedReasons: {} }, provenance: [] },
        identityCoverage: { customExercises: 0, ambiguousExercises: 0, unverifiedExercises: 0 },
      },
    });
    const calls: Array<{ url: string; method?: string }> = [];
    stubSessionFetch(initial, (url, init) => {
      calls.push({ url, method: init?.method });
      if (url.endsWith("/accounting/materialize") && init?.method === "POST") {
        return Response.json({ session: current });
      }
      if (url.endsWith("/accounting/refresh") && init?.method === "POST") {
        return Response.json({ session: current });
      }
      if (url === "/api/v1/training/sessions/42" && !init?.method) {
        return Response.json({ session: calls.some((call) => call.url.endsWith("/accounting/materialize")) ? current : initial });
      }
      return null;
    });
    const { unmount } = render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Створити знімок обліку" })).toBeTruthy());
    expect(calls.some((call) => call.method === "POST" && call.url.includes("/accounting/"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Створити знімок обліку" }));
    await waitFor(() => expect(screen.getByText(/4\s?667/)).toBeTruthy());
    expect(calls.some((call) => call.url.endsWith("/accounting/materialize") && call.method === "POST")).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/accounting/refresh") && call.method === "POST")).toBe(false);
    unmount();
    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(screen.getByText(/4\s?667/)).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Оновити облік" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/accounting/refresh") && call.method === "POST")).toBe(true));
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
