/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

const routerPush = vi.fn();
const routerReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: () => <nav>nav</nav>,
}));

import { BackfillClient } from "@/app/training/backfill/backfill-client";
import { SessionEditClient } from "@/app/training/sessions/[id]/edit/session-edit-client";
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
});

describe("Session edit UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    routerPush.mockReset();
    routerReplace.mockReset();
  });

  it("loads completed session with Garmin context and set editing", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
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
      if (url.includes("/program") && init?.method === "POST") {
        return Response.json({ session: { ...session, programName: "Pull B", revision: 3 } });
      }
      return new Response("not found", { status: 404 });
    }));

    render(<SessionEditClient sessionId={88} />);
    await waitFor(() => {
      expect(screen.getByText("Push A")).toBeTruthy();
      expect(screen.getByText(/Garmin \(read-only\)/i)).toBeTruthy();
      expect(screen.getByText(/30 kg/)).toBeTruthy();
      expect(screen.getByRole("button", { name: /Delete diary/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: /^Change$/i }));
    expect(screen.getByRole("button", { name: /Apply/i })).toBeTruthy();
    expect(screen.queryByText(/^Version$/i)).toBeNull();
    expect(screen.queryByText(/Show archived/i)).toBeNull();
    expect(screen.getByText(/Always uses the program/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Delete diary/i }));
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/training/backfill");
    });
  });
});
