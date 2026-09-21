/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

const routerPush = vi.fn();
const searchParams = new URLSearchParams();
const PROGRAM_CHANGE_UI_TIMEOUT_MS = 10_000;
const PROGRAM_CHANGE_TEST_TIMEOUT_MS = 12_000;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  usePathname: () => "/training/sessions/88/edit",
  useSearchParams: () => searchParams,
}));

import { SessionEditClient } from "@/app/training/sessions/[id]/edit/session-edit-client";
import styles from "@/app/training/training.module.css";

function activePane() {
  return within(screen.getByTestId("active-exercise-pane"));
}
import {
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_METHOD,
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
} from "@/modules/training/training.constants";

function makeSession(
  status: (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS] = SESSION_STATUS.COMPLETED,
) {
  return {
    id: 88,
    status,
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
    exercises: [
      {
        id: 1,
        sourceExerciseCatalogId: 3,
        stableKey: null,
        snapshotExerciseName: "Жим гантелей на похилій лаві вгору (30°)",
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
          comment: null,
          completedAt: "2026-09-10T16:20:00.000Z",
          createdAt: "2026-09-10T16:20:00.000Z",
          updatedAt: "2026-09-10T16:20:00.000Z",
        }],
      },
      {
        id: 2,
        sourceExerciseCatalogId: 4,
        stableKey: null,
        snapshotExerciseName: "Розгинання однієї руки в блоці",
        order: 1,
        plannedSets: 4,
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
        origin: EXERCISE_ORIGIN.EXTRA,
        muscleMappingSnapshot: null,
        sets: [],
      },
    ],
    ordinaryTonnageKg: 300,
    createdAt: "2026-09-17T18:00:00.000Z",
    updatedAt: "2026-09-17T18:00:00.000Z",
  };
}

describe("Session edit exercise pager", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    routerPush.mockReset();
    searchParams.delete("exercise");
  });

  function stubFetch(session = makeSession()) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) {
        return Response.json({
          entries: [{
            sessionId: 40,
            occurredAt: "2026-09-01T10:00:00.000Z",
            programName: "Push A",
            resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
            sets: [
              { setNumber: 1, reps: 10, weightKg: 28, bandNominalResistanceKg: null, comment: null },
            ],
          }],
        });
      }
      if (url.includes("/sessions/88") && !init?.method) {
        return Response.json({ session });
      }
      if (url.includes("/exercises") && !url.includes("/sessions/")) {
        return Response.json({
          exercises: [
            {
              id: 3,
              name: "Жим гантелей на похилій лаві вгору (30°)",
              isActive: true,
              archivedAt: null,
              muscleMapping: null,
            },
            {
              id: 4,
              name: "Розгинання однієї руки в блоці",
              isActive: true,
              archivedAt: null,
              muscleMapping: null,
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
          }, {
            id: 8,
            name: "Pull B",
            archivedAt: null,
            currentVersionId: 12,
            currentVersionNumber: 1,
            exerciseCount: 2,
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-01T10:00:00.000Z",
          }],
        });
      }
      if (url.includes("/program") && init?.method === "POST") {
        return Response.json({
          session: {
            ...session,
            programId: 8,
            programName: "Pull B",
            exercises: [
              {
                id: 2,
                sourceExerciseCatalogId: 4,
                stableKey: null,
                snapshotExerciseName: "Розгинання однієї руки в блоці",
                order: 0,
                plannedSets: 4,
                resistanceType: RESISTANCE.RESISTANCE_BAND,
                origin: EXERCISE_ORIGIN.PLANNED,
                muscleMappingSnapshot: null,
                sets: [],
              },
              {
                id: 40,
                sourceExerciseCatalogId: 9,
                stableKey: null,
                snapshotExerciseName: "Тяга горизонтального блоку сидячи однією рукою",
                order: 1,
                plannedSets: 3,
                resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
                origin: EXERCISE_ORIGIN.PLANNED,
                muscleMappingSnapshot: null,
                sets: [],
              },
            ],
          },
        });
      }
      return new Response("not found", { status: 404 });
    }));
  }

  it("renders one exercise at a time and pages with arrows", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<SessionEditClient sessionId={88} />);

    await waitFor(() => {
      expect(screen.getByText("Жим гантелей на похилій лаві вгору (30°)")).toBeTruthy();
      expect(screen.getByText("1 / 3 exercises")).toBeTruthy();
    });
    expect(screen.queryByRole("heading", { name: "Розгинання однієї руки в блоці" })).toBeNull();
    expect(activePane().getByText(/30 kg × 10|30 кг × 10/)).toBeTruthy();
    expect(screen.getByText("Розгинання однієї руки в блоці")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Розгинання однієї руки в блоці" })).toBeNull();
    expect(screen.getAllByText("1 / 3 sets").length).toBeGreaterThan(0);
    expect(screen.queryByText(/UI Review/i)).toBeNull();
    expect(activePane().getByLabelText(/Weight, kg/i)).toBeTruthy();
    expect(activePane().queryByLabelText(/Band resistance/i)).toBeNull();
    expect((screen.getByRole("img", {
      name: "Жим гантелей на похилій лаві вгору (30°)",
    }) as HTMLImageElement).getAttribute("src")).toBe(
      "/training/exercises/incline-dumbbell-press-30.jpg",
    );

    const nextButtons = screen.getAllByRole("button", { name: /Next exercise/i });
    expect((nextButtons[0] as HTMLButtonElement).disabled).toBe(false);
    await user.click(nextButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText("Розгинання однієї руки в блоці")).toBeTruthy();
      expect(screen.getByText("2 / 3 exercises")).toBeTruthy();
    });
    expect(screen.queryByRole("heading", { name: "Жим гантелей на похилій лаві вгору (30°)" })).toBeNull();
    expect(activePane().getByLabelText(/Band resistance/i)).toBeTruthy();
    expect(activePane().queryByLabelText(/Weight, kg/i)).toBeNull();
    expect((screen.getByRole("img", {
      name: "Розгинання однієї руки в блоці",
    }) as HTMLImageElement).getAttribute("src")).toBe(
      "/training/exercises/one-arm-cable-pushdown.jpg",
    );

    await user.click(screen.getAllByRole("button", { name: /Next exercise/i })[0]!);
    await waitFor(() => {
      expect(screen.getByText("Віджимання від ручок")).toBeTruthy();
      expect(screen.getByText("3 / 3 exercises")).toBeTruthy();
    });
    expect(activePane().queryByLabelText(/Weight, kg/i)).toBeNull();
    expect(activePane().queryByLabelText(/Band resistance/i)).toBeNull();
    expect(activePane().getByLabelText(/Reps/i)).toBeTruthy();
    expect((screen.getAllByRole("button", { name: /Next exercise/i })[0] as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getAllByRole("button", { name: /Previous exercise/i })[0]!);
    await waitFor(() => {
      expect(screen.getByText("Розгинання однієї руки в блоці")).toBeTruthy();
    });
  });

  it("keeps focus on surviving exercise after program change", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<SessionEditClient sessionId={88} />);
    await waitFor(() => {
      expect(screen.getByText("Жим гантелей на похилій лаві вгору (30°)")).toBeTruthy();
    });

    await user.click(screen.getAllByRole("button", { name: /Next exercise/i })[0]!);
    await waitFor(() => {
      expect(activePane().getByRole("heading", { name: "Розгинання однієї руки в блоці" })).toBeTruthy();
      expect(screen.getByText("2 / 3 exercises")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: /Session menu/i }));
    await user.click(within(screen.getByRole("dialog", { name: "Actions" })).getByRole("button", { name: /Change program/i }));
    const programSelect = screen.getByLabelText("Program") as HTMLSelectElement;
    await user.selectOptions(programSelect, "8");
    await waitFor(() => expect(programSelect.value).toBe("8"));
    await user.click(screen.getByRole("button", { name: /Apply/i }));

    await waitFor(() => {
      expect(screen.getByText("Pull B")).toBeTruthy();
      expect(screen.getByText("Розгинання однієї руки в блоці")).toBeTruthy();
      expect(screen.getByText("1 / 2 exercises")).toBeTruthy();
    }, { timeout: PROGRAM_CHANGE_UI_TIMEOUT_MS });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/training/sessions/88/program",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ programId: 8 }) }),
    );
    expect(screen.queryByRole("heading", { name: "Жим гантелей на похилій лаві вгору (30°)" })).toBeNull();
  }, PROGRAM_CHANGE_TEST_TIMEOUT_MS);

  it("supports editing a set from the compact list", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<SessionEditClient sessionId={88} />);
    await waitFor(() => {
      expect(screen.getByText("Жим гантелей на похилій лаві вгору (30°)")).toBeTruthy();
    });

    await user.click(activePane().getByRole("button", { name: /Edit set/i }));
    expect((activePane().getByLabelText(/Weight, kg/i) as HTMLInputElement).value).toBe("30");
    expect((activePane().getByLabelText(/Reps/i) as HTMLInputElement).value).toBe("10");
    expect(screen.getByRole("button", { name: /Update set/i })).toBeTruthy();
  });

  it("opens session menu as a compact dialog without Close action", async () => {
    stubFetch();
    render(<SessionEditClient sessionId={88} />);
    await waitFor(() => {
      expect(screen.getByText("Жим гантелей на похилій лаві вгору (30°)")).toBeTruthy();
    });
    await userEvent.setup().click(screen.getByRole("button", { name: /Session menu/i }));
    const dialog = screen.getByRole("dialog", { name: "Actions" });
    expect(dialog).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Close$/i })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Delete exercise/i }).className)
      .toContain(styles.editMenuDanger);
  });

  it("exposes desktop session actions without relying on kebab alone", async () => {
    stubFetch();
    const { container } = render(<SessionEditClient sessionId={88} />);
    await waitFor(() => {
      expect(screen.getByRole("heading", {
        name: "Жим гантелей на похилій лаві вгору (30°)",
      })).toBeTruthy();
    });
    expect(container.querySelector(`.${styles.workoutHero}`)).toBeTruthy();
    const desktop = container.querySelector(`.${styles.workoutDesktopActions}`);
    expect(desktop).toBeTruthy();
    expect(within(desktop as HTMLElement).getByRole("button", { name: "Change program" })).toBeTruthy();
    expect(within(desktop as HTMLElement).getByRole("button", { name: "Add exercise" })).toBeTruthy();
    expect(within(desktop as HTMLElement).getByRole("link", { name: "Details" })).toBeTruthy();
    expect(within(desktop as HTMLElement).getByRole("button", { name: "Delete exercise" }).className)
      .toContain(styles.workoutDesktopDangerBtn);
  });

  it("does not expose Cancel workout on completed edit sessions", async () => {
    stubFetch();
    render(<SessionEditClient sessionId={88} />);
    await waitFor(() => {
      expect(screen.getByText("Жим гантелей на похилій лаві вгору (30°)")).toBeTruthy();
    });
    await userEvent.setup().click(screen.getByRole("button", { name: /Session menu/i }));
    expect(screen.queryByRole("button", { name: /Cancel workout/i })).toBeNull();
  });

  it("keeps cancelled sessions editable and exposes diary deletion", async () => {
    stubFetch(makeSession(SESSION_STATUS.CANCELLED));
    render(<SessionEditClient sessionId={88} />);
    await waitFor(() => {
      expect(screen.getByText("Жим гантелей на похилій лаві вгору (30°)")).toBeTruthy();
    });
    await userEvent.setup().click(screen.getByRole("button", { name: /Session menu/i }));
    expect(screen.getAllByRole("button", { name: /Delete diary/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Edit exercise/i })).toHaveLength(2);
  });
});
