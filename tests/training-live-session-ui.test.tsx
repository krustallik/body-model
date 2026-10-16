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
let searchParams = new URLSearchParams();

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Live training session mobile UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    routerPush.mockReset();
    routerReplace.mockReset();
    searchParams = new URLSearchParams();
  });

  function stubSessionFetch(
    session = buildSession(),
    extras?: (url: string, init?: RequestInit) => Response | null,
    historyEntries?: unknown[],
  ) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) {
        return Response.json({
          entries: historyEntries ?? [{
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
      if (url.includes("/match-candidates")) return Response.json({ candidates: [] });
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

  it("reconciles a committed set from authoritative GET after a stale-fence response without retrying", async () => {
    const user = userEvent.setup();
    const initial = buildSession();
    const createdSet = {
      id: 301,
      sessionExerciseId: 1,
      setNumber: 1,
      reps: 12,
      weightKg: 30,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
      completedAt: "2026-10-16T06:00:00.000Z",
      createdAt: "2026-10-16T06:00:00.000Z",
      updatedAt: "2026-10-16T06:00:00.000Z",
    };
    let persistedSession = initial;
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/42" && method === "GET") return Response.json({ session: persistedSession });
      if (url.endsWith("/exercises/1/sets") && method === "POST") {
        persistedSession = {
          ...initial,
          exercises: initial.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: [createdSet] }
            : exercise),
        };
        return Response.json({ error: "strength_energy_source_stale" }, { status: 409 });
      }
      return Response.json({ session: initial });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionClient sessionId={42} />);
    await screen.findByText("ТИСНИ");
    await user.type(activePane().getByLabelText("Вага, кг"), "30");
    await user.type(activePane().getByLabelText("Повтори"), "12");
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));

    await waitFor(() => expect(activePane().getByText(/30 кг × 12/)).toBeTruthy());
    expect(activePane().queryByRole("alert")).toBeNull();
    expect(calls.filter(({ method, url }) => method === "POST" && url.endsWith("/exercises/1/sets")).length).toBe(1);
    expect(calls.some(({ method, url }) => method === "POST" && url.endsWith("/finish"))).toBe(false);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it.each([200, 404, 500])("does not let an older detail GET (%i) replace a successfully saved set", async (staleStatus) => {
    const user = userEvent.setup();
    const initial = buildSession();
    const staleDetail = deferred<Response>();
    const savedSet = {
      id: 302,
      sessionExerciseId: 1,
      setNumber: 1,
      reps: 12,
      weightKg: 30,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
      completedAt: "2026-10-16T06:00:00.000Z",
      createdAt: "2026-10-16T06:00:00.000Z",
      updatedAt: "2026-10-16T06:00:00.000Z",
    };
    let detailReads = 0;
    let setPosts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/42" && method === "GET") {
        detailReads += 1;
        return detailReads === 1 ? Response.json({ session: initial }) : staleDetail.promise;
      }
      if (url.endsWith("/exercises/1/sets") && method === "POST") {
        setPosts += 1;
        return Response.json({ set: savedSet, modelPublicationStatus: "current" }, { status: 201 });
      }
      return Response.json({ session: initial });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<SessionClient sessionId={42} />);
    await screen.findByText("ТИСНИ");
    searchParams = new URLSearchParams("exercise=1");
    rerender(<SessionClient sessionId={42} />);
    await waitFor(() => expect(detailReads).toBe(2));

    await user.type(activePane().getByLabelText("Вага, кг"), "30");
    await user.type(activePane().getByLabelText("Повтори"), "12");
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));
    await waitFor(() => expect(activePane().getByText(/30 кг × 12/)).toBeTruthy());

    staleDetail.resolve(staleStatus === 200
      ? Response.json({ session: initial })
      : Response.json({ error: "delayed detail failure" }, { status: staleStatus }));
    await waitFor(() => expect(activePane().getByText(/30 кг × 12/)).toBeTruthy());
    expect(setPosts).toBe(1);
    expect(activePane().queryByRole("alert")).toBeNull();
  });

  it("does not let a pending stale detail error body clear a successful set save", async () => {
    const user = userEvent.setup();
    const initial = buildSession();
    const staleErrorBody = deferred<{ error: string }>();
    let detailReads = 0;
    let errorBodyRead = false;
    const savedSet = {
      id: 303,
      sessionExerciseId: 1,
      setNumber: 1,
      reps: 12,
      weightKg: 30,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
      completedAt: "2026-10-16T06:00:00.000Z",
      createdAt: "2026-10-16T06:00:00.000Z",
      updatedAt: "2026-10-16T06:00:00.000Z",
    };
    const delayedError = {
      ok: false,
      status: 500,
      json: () => { errorBodyRead = true; return staleErrorBody.promise; },
    } as unknown as Response;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/42" && method === "GET") {
        detailReads += 1;
        return detailReads === 1 ? Response.json({ session: initial }) : delayedError;
      }
      if (url.endsWith("/exercises/1/sets") && method === "POST") {
        return Response.json({ set: savedSet, modelPublicationStatus: "current" }, { status: 201 });
      }
      return Response.json({ session: initial });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<SessionClient sessionId={42} />);
    await screen.findByText("ТИСНИ");
    searchParams = new URLSearchParams("exercise=1");
    rerender(<SessionClient sessionId={42} />);
    await waitFor(() => expect(detailReads).toBe(2));
    await waitFor(() => expect(errorBodyRead).toBe(true));

    await user.type(activePane().getByLabelText("Вага, кг"), "30");
    await user.type(activePane().getByLabelText("Повтори"), "12");
    await user.click(screen.getByRole("button", { name: "Додати підхід" }));
    await waitFor(() => expect(activePane().getByText(/30 кг × 12/)).toBeTruthy());

    staleErrorBody.resolve({ error: "delayed detail failure" });
    await waitFor(() => expect(activePane().getByText(/30 кг × 12/)).toBeTruthy());
    expect(activePane().queryByRole("alert")).toBeNull();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/exercises/1/sets") && init?.method === "POST")).toHaveLength(1);
  });

  it("returns after finish only when the response or authoritative GET confirms completion", async () => {
    const user = userEvent.setup();
    const active = buildSession();
    const completed = buildSession({
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: "2026-10-16T06:30:00.000Z",
      updatedAt: "2026-10-16T06:30:00.000Z",
    });
    let persistedSession = active;
    const finishCalls: string[] = [];
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url.includes("/match-candidates")) return Response.json({ candidates: [] });
      if (url === "/api/v1/training/sessions/42" && method === "GET") return Response.json({ session: persistedSession });
      if (url.endsWith("/finish") && method === "POST") {
        finishCalls.push(url);
        persistedSession = completed;
        return Response.json({ error: "strength_energy_source_stale" }, { status: 409 });
      }
      return Response.json({ session: persistedSession });
    }));
    searchParams.set("returnTo", "/dashboard");

    render(<SessionClient sessionId={42} />);
    await screen.findByText("ТИСНИ");
    await user.click(screen.getByRole("button", { name: "Меню сесії" }));
    const sessionMenu = screen.getByRole("dialog", { name: "Дії" });
    await user.click(within(sessionMenu).getByRole("button", { name: "Завершити тренування" }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/dashboard"));
    expect(finishCalls).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
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
    const pickerOpener = await screen.findByRole("button", { name: "Додати вправу" });
    await user.click(pickerOpener);
    const picker = await screen.findByRole("dialog", { name: "Додати вправу" });
    await user.selectOptions(await screen.findByLabelText("Вправа з каталогу"), "9");
    await user.selectOptions(screen.getByLabelText("Тип опору"), RESISTANCE.BODYWEIGHT);
    await user.click(within(picker).getByRole("button", { name: "Додати вправу" }));

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

  it("keeps the empty-session exercise picker accessible and ignores stale catalog requests", async () => {
    const user = userEvent.setup();
    const pendingRequests = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    let catalogRequestIndex = 0;
    const mutations = vi.fn();
    const dynamicSession = buildSession({
      programId: null,
      programName: null,
      programVersionId: null,
      programVersionNumber: null,
      exercises: [],
    });
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") {
        return pendingRequests[catalogRequestIndex++]!.promise;
      }
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (init?.method && init.method !== "GET") mutations();
      return Response.json({ session: dynamicSession });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionClient sessionId={42} />);
    const opener = await screen.findByRole("button", { name: "Додати вправу" });
    await user.click(opener);
    let dialog = await screen.findByRole("dialog", { name: "Додати вправу" });
    const cancel = within(dialog).getByRole("button", { name: "Скасувати" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(opener.parentElement?.hasAttribute("inert")).toBe(true);
    expect(within(dialog).getByRole("status").textContent).toContain("Завантаження каталогу");

    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Додати вправу" })).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(opener.parentElement?.hasAttribute("inert")).toBe(false);

    await user.click(opener);
    dialog = await screen.findByRole("dialog", { name: "Додати вправу" });
    expect(catalogRequestIndex).toBe(2);
    pendingRequests[0]!.resolve(Response.json({ exercises: [{
      id: 9,
      name: "Стара відповідь",
      stableKey: "old_response",
      isActive: true,
      archivedAt: null,
      muscleMapping: null,
    }] }));
    await waitFor(() => expect(within(dialog).getByRole("status")).toBeTruthy());
    expect(within(dialog).queryByLabelText("Вправа з каталогу")).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Додати вправу" })).toBeNull());
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    dialog = await screen.findByRole("dialog", { name: "Додати вправу" });
    expect(catalogRequestIndex).toBe(3);
    pendingRequests[1]!.reject(new Error("catalog unavailable after close"));
    await waitFor(() => expect(within(dialog).getByRole("status")).toBeTruthy());
    expect(within(dialog).queryByRole("alert")).toBeNull();
    pendingRequests[2]!.resolve(Response.json({ exercises: [{
      id: 10,
      name: "Підтягування",
      stableKey: "pull_up_bar",
      isActive: true,
      archivedAt: null,
      muscleMapping: null,
    }] }));
    const catalogSelect = await within(dialog).findByLabelText("Вправа з каталогу");
    expect(catalogSelect).toBeTruthy();
    await user.selectOptions(catalogSelect, "10");
    const addButton = within(dialog).getByRole("button", { name: "Додати вправу" });
    expect((addButton as HTMLButtonElement).disabled).toBe(false);
    await user.tab();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(addButton);
    await user.tab();
    expect(document.activeElement).toBe(catalogSelect);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(addButton);
    expect(mutations).not.toHaveBeenCalled();
  });

  it("keeps the active-workout draft on picker failure and returns focus to its menu opener", async () => {
    const user = userEvent.setup();
    const catalogRequest = deferred<Response>();
    const mutations = vi.fn();
    const session = buildSession();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") return catalogRequest.promise;
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (init?.method && init.method !== "GET") mutations();
      return Response.json({ session });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionClient sessionId={42} />);
    await screen.findByTestId("active-exercise-pane");
    const repsInput = await activePane().findByLabelText("Повтори");
    await user.type(repsInput, "8");
    await user.click(screen.getByRole("button", { name: "Меню сесії" }));
    const actionMenu = await screen.findByRole("dialog", { name: "Дії" });
    const opener = within(actionMenu).getByRole("button", { name: "Додати вправу" });
    await user.click(opener);

    const picker = await screen.findByRole("dialog", { name: "Додати вправу" });
    const cancel = within(picker).getByRole("button", { name: "Скасувати" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(within(picker).getByRole("status")).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
    expect(document.querySelector(`.${styles.workoutFrame}`)?.hasAttribute("inert")).toBe(true);
    catalogRequest.reject(new Error("catalog unavailable"));
    expect(await within(picker).findByRole("alert")).toBeTruthy();
    expect(within(picker).getByRole("button", { name: "Скасувати" })).toBeTruthy();
    const firstSelect = within(picker).getByLabelText("Вправа з каталогу");
    await user.tab();
    expect(document.activeElement).toBe(firstSelect);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Додати вправу" })).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector(`.${styles.workoutFrame}`)?.hasAttribute("inert")).toBe(false);
    expect((repsInput as HTMLInputElement).value).toBe("8");
    expect(mutations).not.toHaveBeenCalled();
  });

  it("creates, reads, edits, and clears additional load for a programless BODYWEIGHT set", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
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
          loadAccountingOverride: Object.hasOwn(payload, "loadAccountingOverride")
            ? payload.loadAccountingOverride ?? null
            : prior.loadAccountingOverride,
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

    const loggedSet = activePane().getByTestId("logged-set-901");
    await user.click(within(loggedSet).getByRole("button", { name: "Редагувати підхід 1" }));
    expect(within(loggedSet).getByRole("region", { name: "Редагування підходу 1" })).toBeTruthy();
    expect(loggedSet.getAttribute("data-editing")).toBe("true");
    expect(loggedSet.querySelector(`.${styles.liveSetSurface}`)?.getAttribute("style")).toContain("translateX(0px)");
    const editLoad = activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)");
    expect((editLoad as HTMLInputElement).value).toBe("15");
    await waitFor(() => expect(document.activeElement).toBe(editLoad));
    expect(activePane().queryByLabelText("Новий підхід")).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
    await user.clear(editLoad);
    await user.type(editLoad, "12,5");
    await user.click(within(loggedSet).getByRole("button", { name: "Оновити підхід" }));
    await waitFor(() => expect(activePane().getByText("власна вага +12,5 кг × 10")).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(activePane().getByRole("button", { name: "Редагувати підхід 1" })));
    expect(loggedSet.getAttribute("data-open")).toBe("true");
    expect(loggedSet.querySelector(`.${styles.liveSetSurface}`)?.getAttribute("style")).toContain("translateX(-104px)");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(requests[1]).toMatchObject({
      method: "PATCH",
      body: { loadAccountingOverride: { additionalLoadKg: 12.5 } },
    });

    await user.click(within(loggedSet).getByRole("button", { name: "Редагувати підхід 1" }));
    await user.clear(activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)"));
    await user.click(within(loggedSet).getByRole("button", { name: "Оновити підхід" }));
    await waitFor(() => expect(requests).toHaveLength(3));
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

  it("reveals live set actions on a short swipe and treats vertical movement as scrolling", async () => {
    const set = {
      id: 909, sessionExerciseId: 1, setNumber: 1, reps: 10, weightKg: 30,
      bandNominalResistanceKg: null, rir: 2, comment: null,
      completedAt: "2026-10-15T06:00:00.000Z", createdAt: "2026-10-15T06:00:00.000Z",
      updatedAt: "2026-10-15T06:00:00.000Z",
    };
    const base = buildSession();
    const session = buildSession({ exercises: [{ ...base.exercises[0]!, sets: [set] }, ...base.exercises.slice(1)] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    stubSessionFetch(session);
    render(<SessionClient sessionId={42} />);
    const row = await screen.findByTestId("logged-set-909");
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ width: 320 } as DOMRect);

    fireEvent.pointerDown(row, { pointerId: 1, pointerType: "touch", clientX: 240, clientY: 10 });
    fireEvent.pointerMove(row, { pointerId: 1, pointerType: "touch", clientX: 235, clientY: 65 });
    fireEvent.pointerUp(row, { pointerId: 1, pointerType: "touch", clientX: 230, clientY: 90 });
    expect(row.hasAttribute("data-open")).toBe(false);

    fireEvent.pointerDown(row, { pointerId: 2, pointerType: "touch", clientX: 240, clientY: 10 });
    fireEvent.pointerMove(row, { pointerId: 2, pointerType: "touch", clientX: 160, clientY: 10 });
    expect(row.querySelector(`.${styles.liveSetSurface}`)?.getAttribute("style")).toContain("translateX(-80px)");
    fireEvent.pointerUp(row, { pointerId: 2, pointerType: "touch", clientX: 160, clientY: 10 });
    expect(within(row).getByRole("button", { name: "Редагувати підхід 1" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Видалити підхід 1" })).toBeTruthy();
    expect(row.getAttribute("data-open")).toBe("true");

    fireEvent.pointerDown(row, { pointerId: 4, pointerType: "touch", clientX: 160, clientY: 10 });
    fireEvent.pointerMove(row, { pointerId: 4, pointerType: "touch", clientX: 150, clientY: 10 });
    expect(row.hasAttribute("data-delete-intent")).toBe(false);
    fireEvent.pointerUp(row, { pointerId: 4, pointerType: "touch", clientX: 150, clientY: 10 });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(row.getAttribute("data-open")).toBe("true");

    fireEvent.pointerCancel(row, { pointerId: 2, pointerType: "touch" });
    expect(row.hasAttribute("data-open")).toBe(false);
  });

  it("requires confirmation when a long live-set swipe reaches the delete threshold", async () => {
    const set = {
      id: 910, sessionExerciseId: 1, setNumber: 1, reps: 10, weightKg: 30,
      bandNominalResistanceKg: null, rir: 2, comment: null,
      completedAt: "2026-10-15T06:00:00.000Z", createdAt: "2026-10-15T06:00:00.000Z",
      updatedAt: "2026-10-15T06:00:00.000Z",
    };
    const base = buildSession();
    const session = buildSession({ exercises: [{ ...base.exercises[0]!, sets: [set] }, ...base.exercises.slice(1)] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubSessionFetch(session);
    render(<SessionClient sessionId={42} />);
    const row = await screen.findByTestId("logged-set-910");
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ width: 320 } as DOMRect);

    fireEvent.pointerDown(row, { pointerId: 3, pointerType: "touch", clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { pointerId: 3, pointerType: "touch", clientX: 200, clientY: 10 });
    expect(row.getAttribute("data-delete-intent")).toBe("true");
    fireEvent.pointerUp(row, { pointerId: 3, pointerType: "touch", clientX: 0, clientY: 10 });

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("підхід"));
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => String(input).endsWith("/sets/910") && init?.method === "DELETE")).toBe(false);
    expect(within(row).getByText(/30 кг × 10/)).toBeTruthy();
  });

  it("omits unchanged historical BODYWEIGHT overrides from current-set RIR/comment PATCHes", async () => {
    const scenarios = [
      { override: { additionalLoadKg: 0 }, programless: true, field: "rir" },
      { override: { additionalLoadKg: 0 }, programless: false, field: "comment" },
      { override: { additionalLoadKg: 2_500 }, programless: true, field: "rir" },
      { override: { assistanceLoadKg: 2_500 }, programless: false, field: "comment" },
      { override: { additionalLoadKg: 15 }, programless: false, field: "rir" },
    ];

    for (const scenario of scenarios) {
      cleanup();
      const user = userEvent.setup();
      let persistedSet = {
        id: 901,
        sessionExerciseId: 77,
        setNumber: 1,
        reps: 10,
        weightKg: null,
        bandNominalResistanceKg: null,
        rir: 2 as number | null,
        comment: "before" as string | null,
        completedAt: "2026-10-15T06:00:00.000Z",
        createdAt: "2026-10-15T06:00:00.000Z",
        updatedAt: "2026-10-15T06:00:00.000Z",
        loadAccountingOverride: scenario.override as Record<string, unknown>,
      };
      const exercise = {
        id: 77,
        sourceExerciseCatalogId: 9,
        stableKey: "pull_up_bar",
        snapshotExerciseName: "Підтягування",
        order: 0,
        plannedSets: scenario.programless ? 0 : 3,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: scenario.programless ? EXERCISE_ORIGIN.EXTRA : EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [persistedSet],
      };
      let persistedSession = buildSession({
        programId: scenario.programless ? null : 7,
        programName: scenario.programless ? null : "ТИСНИ",
        programVersionId: scenario.programless ? null : 11,
        programVersionNumber: scenario.programless ? null : 1,
        exercises: [exercise],
      });
      const patchPayloads: Record<string, unknown>[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/history")) return Response.json({ entries: [] });
        if (url.endsWith("/sets/901") && init?.method === "PATCH") {
          const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
          patchPayloads.push(payload);
          persistedSet = {
            ...persistedSet,
            reps: Number(payload.reps),
            rir: typeof payload.rir === "number" || payload.rir === null ? payload.rir : persistedSet.rir,
            comment: typeof payload.comment === "string" || payload.comment === null ? payload.comment : persistedSet.comment,
            loadAccountingOverride: Object.hasOwn(payload, "loadAccountingOverride")
              ? payload.loadAccountingOverride as Record<string, unknown>
              : persistedSet.loadAccountingOverride,
          };
          persistedSession = {
            ...persistedSession,
            exercises: persistedSession.exercises.map((item) => ({
              ...item,
              sets: item.id === 77 ? [persistedSet] : item.sets,
            })),
          };
          return Response.json({ set: persistedSet });
        }
        return Response.json({ session: persistedSession });
      }));

      render(<SessionClient sessionId={42} />);
      await waitFor(() => expect(activePane().getByText(/власна вага/)).toBeTruthy());
      await user.click(activePane().getByRole("button", { name: "Редагувати підхід 1" }));
      if (scenario.field === "rir") {
        await user.clear(activePane().getByLabelText("RIR"));
        await user.type(activePane().getByLabelText("RIR"), "3");
      } else {
        await user.clear(activePane().getByLabelText("Коментар"));
        await user.type(activePane().getByLabelText("Коментар"), "after");
      }
      await user.click(screen.getByRole("button", { name: "Оновити підхід" }));
      await waitFor(() => expect(patchPayloads).toHaveLength(1));

      expect(patchPayloads[0]).toMatchObject(scenario.field === "rir" ? { rir: 3 } : { comment: "after" });
      expect(patchPayloads[0]).not.toHaveProperty("loadAccountingOverride");
      expect(persistedSet.loadAccountingOverride).toEqual(scenario.override);
    }
  });

  it("resets current-set load dirty state on cancel and isolates it between sets", async () => {
    const user = userEvent.setup();
    const makeSet = (id: number, setNumber: number, additionalLoadKg: number, rir: number) => ({
      id,
      sessionExerciseId: 77,
      setNumber,
      reps: 10,
      weightKg: null,
      bandNominalResistanceKg: null,
      rir,
      comment: "before",
      completedAt: "2026-10-15T06:00:00.000Z",
      createdAt: "2026-10-15T06:00:00.000Z",
      updatedAt: "2026-10-15T06:00:00.000Z",
      loadAccountingOverride: { additionalLoadKg },
    });
    type PersistedSet = Omit<ReturnType<typeof makeSet>, "rir" | "comment" | "loadAccountingOverride">
      & { rir: number | null; comment: string | null; loadAccountingOverride: unknown };
    let persistedSets: PersistedSet[] = [makeSet(901, 1, 0, 2), makeSet(902, 2, 15, 2)];
    const exercise = {
      id: 77,
      sourceExerciseCatalogId: 9,
      stableKey: "pull_up_bar",
      snapshotExerciseName: "Підтягування",
      order: 0,
      plannedSets: 0,
      resistanceType: RESISTANCE.BODYWEIGHT,
      origin: EXERCISE_ORIGIN.EXTRA,
      muscleMappingSnapshot: null,
      sets: persistedSets,
    };
    let persistedSession = buildSession({
      programId: null,
      programName: null,
      programVersionId: null,
      programVersionNumber: null,
      exercises: [exercise],
    });
    const patchPayloads: Array<{ setId: number; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) return Response.json({ entries: [] });
      const patchMatch = url.match(/\/sets\/(\d+)$/);
      if (patchMatch && init?.method === "PATCH") {
        const setId = Number(patchMatch[1]);
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchPayloads.push({ setId, body: payload });
        persistedSets = persistedSets.map((set) => set.id === setId ? {
          ...set,
          rir: typeof payload.rir === "number" || payload.rir === null ? payload.rir : set.rir,
          comment: typeof payload.comment === "string" || payload.comment === null ? payload.comment : set.comment,
          loadAccountingOverride: Object.hasOwn(payload, "loadAccountingOverride")
            ? payload.loadAccountingOverride ?? null
            : set.loadAccountingOverride,
        } : set);
        persistedSession = {
          ...persistedSession,
          exercises: persistedSession.exercises.map((item) => item.id === 77 ? { ...item, sets: persistedSets } : item),
        };
        return Response.json({ set: persistedSets.find((set) => set.id === setId) });
      }
      return Response.json({ session: persistedSession });
    }));
    render(<SessionClient sessionId={42} />);
    await waitFor(() => expect(activePane().getAllByText(/власна вага/)).toHaveLength(2));
    const setRow = (number: number) => {
      const row = activePane().getAllByRole("listitem").find((item) => item.textContent?.trim().startsWith(`#${number}`));
      expect(row).toBeDefined();
      return within(row!);
    };

    await user.click(setRow(1).getByRole("button", { name: "Редагувати підхід 1" }));
    await user.type(activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)"), "0");
    await user.click(activePane().getByRole("button", { name: "Скасувати" }));

    await user.click(setRow(2).getByRole("button", { name: "Редагувати підхід 2" }));
    await user.clear(activePane().getByLabelText("RIR"));
    await user.type(activePane().getByLabelText("RIR"), "3");
    await user.click(screen.getByRole("button", { name: "Оновити підхід" }));
    await waitFor(() => expect(patchPayloads).toHaveLength(1));
    expect(patchPayloads[0]).toMatchObject({ setId: 902 });
    expect(patchPayloads[0]?.body).not.toHaveProperty("loadAccountingOverride");
    expect(persistedSets[1]?.loadAccountingOverride).toEqual({ additionalLoadKg: 15 });

    await user.click(setRow(1).getByRole("button", { name: "Редагувати підхід 1" }));
    const zeroInput = activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)");
    expect((zeroInput as HTMLInputElement).value).toBe("");
    await user.type(zeroInput, "0");
    await user.click(screen.getByRole("button", { name: "Оновити підхід" }));
    await waitFor(() => expect(patchPayloads).toHaveLength(2));
    expect(patchPayloads[1]).toMatchObject({ setId: 901, body: { loadAccountingOverride: null } });
    expect(persistedSets[0]?.loadAccountingOverride).toBeNull();
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
    await user.click(activePane().getByRole("button", { name: "Редагувати підхід 1" }));
    await user.type(activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)"), "2001");
    await user.click(screen.getByRole("button", { name: "Оновити підхід" }));
    expect((await screen.findByRole("alert")).textContent).toContain("2000 кг");
    expect(mutation).not.toHaveBeenCalled();

    await user.clear(activePane().getByLabelText("Додаткове обтяження, кг (необов’язково)"));
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

  it("explains the BodyCast diary cascade before deleting a cancelled session from its detail page", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url.includes("/match-candidates")) return Response.json({ candidates: [] });
      if (url === "/api/v1/training/sessions/42" && !init?.method) {
        return Response.json({ session: buildSession({ status: SESSION_STATUS.CANCELLED }) });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionClient sessionId={42} />);
    await user.click(await screen.findByRole("button", { name: "Видалити" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("вправами, підходами та знімками обліку"));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Garmin та Apple Health залишаться без змін"));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("returns to the originating Training page after deleting a cancelled session", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    searchParams.set("returnTo", "/training?recentPage=3");
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url.includes("/match-candidates")) return Response.json({ candidates: [] });
      if (url === "/api/v1/training/sessions/42" && !init?.method) {
        return Response.json({ session: buildSession({ status: SESSION_STATUS.CANCELLED }) });
      }
      if (url === "/api/v1/training/sessions/42" && init?.method === "DELETE") {
        return Response.json({ deleted: true });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionClient sessionId={42} />);
    await user.click(await screen.findByRole("button", { name: "Видалити" }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/training?recentPage=3"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/training/sessions/42", { method: "DELETE" });
  });

  it("omits unchanged historical BODYWEIGHT overrides from RIR/comment patches and preserves changed load fields", async () => {
    const scenarios = [
      { override: { additionalLoadKg: 0 }, programless: true, changeLoad: false, field: "rir", cancelReopen: true },
      { override: { additionalLoadKg: 0 }, programless: false, changeLoad: false, field: "comment" },
      { override: { additionalLoadKg: 0 }, programless: true, changeLoad: false, explicitClear: true },
      {
        override: {
          additionalLoadKg: 0,
          reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
          equipmentSetupId: "rings",
          inventoryCount: 2,
        },
        programless: true,
        changeLoad: false,
        changeAsymmetricReps: true,
      },
      { override: { additionalLoadKg: 2_500 }, programless: true, changeLoad: false },
      { override: { assistanceLoadKg: 2_500 }, programless: false, changeLoad: false },
      { override: { additionalLoadKg: 15 }, programless: false, changeLoad: false },
      {
        override: {
          additionalLoadKg: 15,
          reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
          equipmentSetupId: "rings",
          inventoryCount: 2,
        },
        programless: true,
        changeLoad: true,
      },
    ];

    for (const scenario of scenarios) {
      cleanup();
      const user = userEvent.setup();
      let persistedHistorySet: {
        id: number;
        setNumber: number;
        completedAt: string;
        reps: number;
        weightKg: number | null;
        bandNominalResistanceKg: number | null;
        rir: number | null;
        comment: string | null;
        loadAccountingOverride: unknown;
      } = {
        id: 71,
        setNumber: 1,
        completedAt: "2026-09-10T16:10:00.000Z",
        reps: 10,
        weightKg: null,
        bandNominalResistanceKg: null,
        rir: 2 as number | null,
        comment: "before" as string | null,
        loadAccountingOverride: scenario.override as Record<string, unknown>,
      };
      const patchPayloads: Record<string, unknown>[] = [];
      const exercise = {
        id: 77,
        sourceExerciseCatalogId: 9,
        stableKey: "pull_up_bar",
        snapshotExerciseName: "Підтягування",
        order: 0,
        plannedSets: scenario.programless ? 0 : 3,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: scenario.programless ? EXERCISE_ORIGIN.EXTRA : EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      };
      const session = buildSession({
        programId: scenario.programless ? null : 7,
        programName: scenario.programless ? null : "ТИСНИ",
        programVersionId: scenario.programless ? null : 11,
        programVersionNumber: scenario.programless ? null : 1,
        exercises: [exercise],
      });
      const historicalEntry = {
        sessionId: 40,
        occurredAt: "2026-09-10T16:00:00.000Z",
        programName: scenario.programless ? null : "ТИСНИ",
        resistanceType: RESISTANCE.BODYWEIGHT,
        sets: [persistedHistorySet],
      };
      stubSessionFetch(session, (url, init) => {
        if (url === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH") {
          const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
          patchPayloads.push(payload);
          persistedHistorySet = {
            ...persistedHistorySet,
            ...(typeof payload.rir === "number" || payload.rir === null ? { rir: payload.rir } : {}),
            ...(typeof payload.comment === "string" || payload.comment === null ? { comment: payload.comment } : {}),
            ...(Object.hasOwn(payload, "loadAccountingOverride")
              ? { loadAccountingOverride: payload.loadAccountingOverride as Record<string, unknown> }
              : {}),
          };
          return Response.json({ set: persistedHistorySet, modelPublicationStatus: "current" });
        }
        return null;
      }, [historicalEntry]);

      render(<SessionClient sessionId={42} />);
      await screen.findByTestId("active-exercise-pane");
      const historySet = await within(activePane().getByLabelText("Історія вправи"))
        .findByTestId("history-set-40-71");
      if (scenario.cancelReopen) {
        await user.click(within(historySet).getByRole("button", { name: "Редагувати підхід 1" }));
        const load = within(historySet).getByLabelText("Додаткове обтяження, кг (необов’язково)");
        await user.type(load, "0");
        await user.click(within(historySet).getByRole("button", { name: "Скасувати" }));
      }
      await user.click(within(historySet).getByRole("button", { name: "Редагувати підхід 1" }));
      if (scenario.changeLoad) {
        const load = within(historySet).getByLabelText("Додаткове обтяження, кг (необов’язково)");
        await user.clear(load);
        await user.type(load, "20");
      } else if (scenario.changeAsymmetricReps) {
        const leftReps = within(historySet).getByLabelText("Повтори зліва");
        await user.clear(leftReps);
        await user.type(leftReps, "7");
      } else if (scenario.explicitClear) {
        await user.type(within(historySet).getByLabelText("Додаткове обтяження, кг (необов’язково)"), "0");
      } else if (scenario.field === "rir") {
        await user.clear(within(historySet).getByLabelText("RIR"));
        await user.type(within(historySet).getByLabelText("RIR"), "3");
      } else if (scenario.field === "comment") {
        await user.clear(within(historySet).getByLabelText("Коментар"));
        await user.type(within(historySet).getByLabelText("Коментар"), "after");
      } else {
        await user.clear(within(historySet).getByLabelText("RIR"));
        await user.type(within(historySet).getByLabelText("RIR"), "3");
        await user.clear(within(historySet).getByLabelText("Коментар"));
        await user.type(within(historySet).getByLabelText("Коментар"), "after");
      }
      await user.click(within(historySet).getByRole("button", { name: "Зберегти" }));
      await waitFor(() => expect(patchPayloads).toHaveLength(1));

      if (scenario.explicitClear) {
        expect(patchPayloads[0]).toMatchObject({ loadAccountingOverride: null });
        expect(persistedHistorySet.loadAccountingOverride).toBeNull();
      } else if (scenario.changeAsymmetricReps) {
        const expectedOverride = {
          ...scenario.override,
          reps: { kind: "asymmetric-per-side", left: 7, right: 4 },
        };
        expect(patchPayloads[0]).toMatchObject({ loadAccountingOverride: expectedOverride });
        expect(persistedHistorySet.loadAccountingOverride).toEqual(expectedOverride);
        expect(persistedHistorySet.completedAt).toBe("2026-09-10T16:10:00.000Z");
      } else if (!scenario.changeLoad) {
        expect(patchPayloads[0]).not.toHaveProperty("loadAccountingOverride");
        expect(persistedHistorySet.loadAccountingOverride).toEqual(scenario.override);
        if (scenario.field === "rir") expect(patchPayloads[0]).toMatchObject({ rir: 3 });
        else if (scenario.field === "comment") expect(patchPayloads[0]).toMatchObject({ comment: "after" });
        else expect(patchPayloads[0]).toMatchObject({ rir: 3, comment: "after" });
      } else {
        expect(patchPayloads[0]?.loadAccountingOverride).toEqual({
          ...scenario.override,
          additionalLoadKg: 20,
        });
      }
    }
  });

  it("rejects a changed historical BODYWEIGHT load above the write limit", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const persistedSet = {
      id: 71,
      setNumber: 1,
      completedAt: "2026-09-10T16:10:00.000Z",
      reps: 10,
      weightKg: null,
      bandNominalResistanceKg: null,
      rir: 2,
      comment: "before",
      loadAccountingOverride: { additionalLoadKg: 15 },
    };
    const entry = {
      sessionId: 40,
      occurredAt: "2026-09-10T16:00:00.000Z",
      programName: null,
      resistanceType: RESISTANCE.BODYWEIGHT,
      sets: [persistedSet],
    };
    stubSessionFetch(buildSession(), undefined, [entry]);
    render(<SessionClient sessionId={42} />);
    await screen.findByTestId("active-exercise-pane");
    const historySet = await within(activePane().getByLabelText("Історія вправи"))
      .findByTestId("history-set-40-71");
    await user.click(within(historySet).getByRole("button", { name: "Редагувати підхід 1" }));
    const load = within(historySet).getByLabelText("Додаткове обтяження, кг (необов’язково)");
    await user.clear(load);
    await user.type(load, "2001");
    await user.click(within(historySet).getByRole("button", { name: "Зберегти" }));

    expect((await within(historySet).findByRole("alert")).textContent).toContain("2000 кг");
    expect(vi.mocked(fetch).mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH"
    ))).toHaveLength(0);
  });

  it("does not transfer historical-row dirty load state to the next set", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const firstSet = {
      id: 71, setNumber: 1, completedAt: "2026-09-10T16:10:00.000Z", reps: 10,
      weightKg: null, bandNominalResistanceKg: null, rir: 2, comment: null,
      loadAccountingOverride: { additionalLoadKg: 0 },
    };
    const secondSet = {
      id: 72, setNumber: 2, completedAt: "2026-09-10T16:12:00.000Z", reps: 10,
      weightKg: null, bandNominalResistanceKg: null, rir: 2, comment: null,
      loadAccountingOverride: { additionalLoadKg: 15 },
    };
    let storedSecondSet: Omit<typeof secondSet, "loadAccountingOverride"> & { loadAccountingOverride: unknown } = secondSet;
    const entry = {
      sessionId: 40,
      occurredAt: "2026-09-10T16:00:00.000Z",
      programName: null,
      resistanceType: RESISTANCE.BODYWEIGHT,
      sets: [firstSet, secondSet],
    };
    const exercise = {
      id: 77, sourceExerciseCatalogId: 9, stableKey: "pull_up_bar",
      snapshotExerciseName: "Підтягування", order: 0, plannedSets: 0,
      resistanceType: RESISTANCE.BODYWEIGHT, origin: EXERCISE_ORIGIN.EXTRA,
      muscleMappingSnapshot: null, sets: [],
    };
    const session = buildSession({
      programId: null,
      programName: null,
      programVersionId: null,
      programVersionNumber: null,
      exercises: [exercise],
    });
    let patchBody: Record<string, unknown> | null = null;
    stubSessionFetch(session, (url, init) => {
      if (url === "/api/v1/training/sessions/40/sets/72" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        storedSecondSet = {
          ...storedSecondSet,
          rir: typeof patchBody.rir === "number" ? patchBody.rir : storedSecondSet.rir,
          loadAccountingOverride: Object.hasOwn(patchBody, "loadAccountingOverride")
            ? patchBody.loadAccountingOverride as Record<string, unknown>
            : storedSecondSet.loadAccountingOverride,
        };
        return Response.json({ set: storedSecondSet, modelPublicationStatus: "current" });
      }
      return null;
    }, [entry]);
    render(<SessionClient sessionId={42} />);
    await screen.findByTestId("active-exercise-pane");
    const history = activePane().getByLabelText("Історія вправи");
    const firstRow = await within(history).findByTestId("history-set-40-71");
    const secondRow = await within(history).findByTestId("history-set-40-72");
    await user.click(within(firstRow).getByRole("button", { name: "Редагувати підхід 1" }));
    await user.type(within(firstRow).getByLabelText("Додаткове обтяження, кг (необов’язково)"), "0");
    await user.click(within(firstRow).getByRole("button", { name: "Скасувати" }));

    await user.click(within(secondRow).getByRole("button", { name: "Редагувати підхід 2" }));
    await user.clear(within(secondRow).getByLabelText("RIR"));
    await user.type(within(secondRow).getByLabelText("RIR"), "3");
    await user.click(within(secondRow).getByRole("button", { name: "Зберегти" }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).not.toHaveProperty("loadAccountingOverride");
    expect(storedSecondSet.loadAccountingOverride).toEqual({ additionalLoadKg: 15 });
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

  it("does not render accounting controls for an active session", async () => {
    const initial = buildSession({ materializationState: "missing" });
    const calls: Array<{ url: string; method?: string }> = [];
    stubSessionFetch(initial, (url, init) => {
      calls.push({ url, method: init?.method });
      if (url === "/api/v1/training/sessions/42" && !init?.method) {
        return Response.json({ session: initial });
      }
      return null;
    });
    render(<SessionClient sessionId={42} />);
    await screen.findByRole("heading", { name: "Жим гантелей на похилій лаві вгору (30°)" });
    expect(screen.queryByRole("region", { name: "Облік навантаження" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Load accounting" })).toBeNull();
    expect(calls.some((call) => call.method === "POST" && call.url.includes("/accounting/"))).toBe(false);
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
