/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

const routerPush = vi.fn();
const routerReplace = vi.fn();
const mockRouter = { push: routerPush, replace: routerReplace };

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/training/sessions/88/edit",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: () => <nav>nav</nav>,
}));

import { BackfillClient } from "@/app/training/backfill/backfill-client";
import { FromWorkoutClient } from "@/app/training/backfill/from/[workoutId]/from-workout-client";
import { SessionEditClient } from "@/app/training/sessions/[id]/edit/session-edit-client";
import { updateTrainingSearchParams } from "@/app/training/training-url-state";
import {
  DIARY_COMPLETENESS,
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_METHOD,
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
} from "@/modules/training/training.constants";

const session = {
  id: 88,
  status: SESSION_STATUS.COMPLETED,
  entryMode: ENTRY_MODE.RETROSPECTIVE,
  revision: 2,
  programId: 7,
  programName: "Push A",
  programVersionId: 11,
  programVersionNumber: 1,
  webStartedAt: null,
  webEndedAt: null,
  matchStatus: MATCH_STATUS.MATCHED,
  matchMethod: MATCH_METHOD.DIRECT_BACKFILL,
  matchedAt: "2026-09-17T18:00:00.000Z",
  matchedWorkoutId: 501,
  matchedWorkout: {
    id: 501,
    type: "Traditional Strength Training",
    startAt: "2026-09-10T16:00:00.000Z",
    endAt: "2026-09-10T17:10:00.000Z",
    durationMinutes: 70,
    activeEnergyKcal: 220,
    externalId: "ext:old",
  },
  exercises: [{
    id: 1,
    sourceExerciseCatalogId: 3,
    stableKey: null,
    snapshotExerciseName: "Жим",
    order: 0,
    plannedSets: 3,
    resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
    origin: EXERCISE_ORIGIN.PLANNED,
    muscleMappingSnapshot: null,
    sets: [{
      id: 9,
      sessionExerciseId: 1,
      setNumber: 1,
      reps: 10,
      weightKg: 30,
      bandNominalResistanceKg: null,
      rir: null,
      completedAt: "2026-09-10T16:20:00.000Z",
      createdAt: "2026-09-10T16:20:00.000Z",
      updatedAt: "2026-09-10T16:20:00.000Z",
    }],
  }],
  ordinaryTonnageKg: 300,
  createdAt: "2026-09-17T18:00:00.000Z",
  updatedAt: "2026-09-17T18:00:00.000Z",
};

describe("Training backfill UI", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    routerPush.mockReset();
    routerReplace.mockReset();
  });

  it("lists historical workouts with add/edit actions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/workouts/historical")) {
        return Response.json({
          workouts: [
            {
              workoutId: 12,
              type: "Traditional Strength Training",
              startAt: "2026-09-14T15:55:00.000Z",
              endAt: "2026-09-14T17:06:00.000Z",
              durationMinutes: 71,
              activeEnergyKcal: 210,
              linkedSessionId: null,
              linkedProgramName: null,
              diaryCompleteness: DIARY_COMPLETENESS.NO_DIARY,
            },
            {
              workoutId: 13,
              type: "Traditional Strength Training",
              startAt: "2026-09-17T16:04:00.000Z",
              endAt: "2026-09-17T17:18:00.000Z",
              durationMinutes: 74,
              activeEnergyKcal: 230,
              linkedSessionId: 88,
              linkedProgramName: "Push A",
              diaryCompleteness: DIARY_COMPLETENESS.DIARY_WITH_SETS,
            },
          ],
        });
      }
      if (url.includes("/programs")) {
        return Response.json({
          programs: [{
            id: 7,
            name: "Push A",
            archivedAt: null,
            currentVersionId: 11,
            currentVersionNumber: 1,
            exerciseCount: 3,
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-01T10:00:00.000Z",
          }],
        });
      }
      return new Response("not found", { status: 404 });
    }));

    render(<BackfillClient />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add diary/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Edit$/i })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Missing diary only/i })).toBeTruthy();
    const createButton = screen.getByRole("button", { name: /Create diaries \(0\)/i });
    expect((createButton as HTMLButtonElement).disabled).toBe(true);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect((checkboxes[0] as HTMLInputElement).disabled).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText(/No diary/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Push A/).length).toBeGreaterThan(0);
  });

  it("refetches the Garmin list when a session editor returns with a refresh token", async () => {
    window.history.replaceState(null, "", "/training/backfill");
    let historicalRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/workouts/historical")) {
        historicalRequests += 1;
        return Response.json({ workouts: [], totalCount: 0 });
      }
      if (url.includes("/programs")) return Response.json({ programs: [] });
      return new Response("not found", { status: 404 });
    }));

    render(<BackfillClient />);
    await waitFor(() => expect(historicalRequests).toBe(1));
    updateTrainingSearchParams({ refresh: "2-2026-10-14T18:00:00.000Z" });
    await waitFor(() => expect(historicalRequests).toBe(2));
  });

  it("returns from Garmin history to the originating Training hub query", async () => {
    window.history.replaceState(null, "", `/training/backfill?returnTo=${encodeURIComponent("/training?recentPage=3&stepperPage=2")}`);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/workouts/historical")) return Response.json({ workouts: [], totalCount: 0 });
      if (url.includes("/programs")) return Response.json({ programs: [] });
      return new Response("not found", { status: 404 });
    }));

    render(<BackfillClient />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Back" }).getAttribute("href"))
      .toBe("/training?recentPage=3&stepperPage=2"));
  });

  it("ignores a stale linked-workout response after the return context changes", async () => {
    window.history.replaceState(null, "", `/training/backfill/from/501?returnTo=${encodeURIComponent("/training?recentPage=1")}`);
    let resolveOldWorkouts!: (response: Response) => void;
    const oldWorkouts = new Promise<Response>((resolve) => { resolveOldWorkouts = resolve; });
    let historicalRequests = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/workouts/historical")) {
        historicalRequests += 1;
        return historicalRequests === 1
          ? oldWorkouts
          : Promise.resolve(Response.json({ workouts: [{
            workoutId: 501,
            type: "Traditional Strength Training",
            startAt: "2026-09-14T15:55:00.000Z",
            endAt: "2026-09-14T17:06:00.000Z",
            durationMinutes: 71,
            activeEnergyKcal: 210,
            linkedSessionId: 88,
            linkedProgramName: "Push A",
            diaryCompleteness: DIARY_COMPLETENESS.DIARY_WITH_SETS,
          }] }));
      }
      if (url.includes("/programs")) return Promise.resolve(Response.json({ programs: [] }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    }));
    const view = render(<FromWorkoutClient workoutId={501} />);
    await waitFor(() => expect(historicalRequests).toBe(1));

    window.history.replaceState(null, "", `/training/backfill/from/501?returnTo=${encodeURIComponent("/training?recentPage=2")}`);
    view.rerender(<FromWorkoutClient workoutId={501} />);
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith(
      `/training/sessions/88/edit?returnTo=${encodeURIComponent("/training?recentPage=2")}`,
    ));
    await act(async () => {
      resolveOldWorkouts(Response.json({ workouts: [{
        workoutId: 501,
        type: "Traditional Strength Training",
        startAt: "2026-09-14T15:55:00.000Z",
        endAt: "2026-09-14T17:06:00.000Z",
        durationMinutes: 71,
        activeEnergyKcal: 210,
        linkedSessionId: 88,
        linkedProgramName: "Push A",
        diaryCompleteness: DIARY_COMPLETENESS.DIARY_WITH_SETS,
      }] }));
      await oldWorkouts;
    });
    expect(routerReplace).toHaveBeenCalledTimes(1);
  });
});

describe("Session edit UI", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    routerPush.mockReset();
    routerReplace.mockReset();
  });

  it("loads completed session pager with delete diary in menu", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) {
        return Response.json({ entries: [] });
      }
      if (url.includes("/sessions/88") && init?.method === "DELETE") {
        return Response.json({ deleted: true, matchedWorkoutId: 501 });
      }
      if (url.includes("/sessions/88") && !init?.method) {
        return Response.json({ session });
      }
      if (url.includes("/exercises") && !url.includes("/sessions/")) {
        return Response.json({ exercises: [{ id: 3, name: "Жим", isActive: true, archivedAt: null, muscleMapping: null }] });
      }
      if (url.includes("/programs")) {
        return Response.json({
          programs: [{
            id: 7,
            name: "Push A",
            archivedAt: null,
            currentVersionId: 11,
            currentVersionNumber: 1,
            exerciseCount: 3,
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-01T10:00:00.000Z",
          }],
        });
      }
      return new Response("not found", { status: 404 });
    }));

    render(<SessionEditClient sessionId={88} />);
    await waitFor(() => {
      expect(screen.getByText("Push A")).toBeTruthy();
      expect(screen.getByText("Жим")).toBeTruthy();
      expect(screen.getByText(/30 kg|30 кг/)).toBeTruthy();
      expect(screen.getByRole("button", { name: /Session menu/i })).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "← Back" }).getAttribute("href")).toContain("/training/backfill?refresh=2-");

    await user.click(screen.getByRole("button", { name: /Session menu/i }));
    const dialog = screen.getByRole("dialog", { name: /Actions|Дії/i });
    expect(within(dialog).getByRole("button", { name: /Change program/i })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: /Delete diary/i }));
    await waitFor(() => {
      expect(routerPush.mock.calls.at(-1)?.[0]).toMatch(/^\/training\/backfill\?refresh=\d+$/);
    });
  });
});
