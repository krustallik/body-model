/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  type ResistanceType,
} from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

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

  function stubFetch(session = makeSession(), options: {
    historyOverride?: unknown;
    historyResistanceType?: ResistanceType;
    mutationErrorStatus?: number;
    publicationStatus?: "current" | "stale" | "not-run";
  } = {}) {
    const historyResistanceType = options.historyResistanceType ?? RESISTANCE.EXTERNAL_WEIGHT;
    let storedHistorySet: {
      id: number;
      setNumber: number;
      reps: number;
      weightKg: number | null;
      bandNominalResistanceKg: number | null;
      rir: number | null;
      comment: string | null;
      completedAt: string;
      loadAccountingOverride: unknown;
    } = {
      id: 71,
      setNumber: 1,
      reps: 10,
      weightKg: historyResistanceType === RESISTANCE.BODYWEIGHT ? null : 28,
      bandNominalResistanceKg: null as number | null,
      rir: 2,
      comment: null as string | null,
      completedAt: "2026-09-01T10:23:00.000Z",
      loadAccountingOverride: options.historyOverride ?? null,
    };
    let storedHistorySetExists = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) {
        const exerciseId = Number(url.match(/\/exercises\/(\d+)\/history/)?.[1] ?? 1);
        return Response.json({
          entries: [{
            sessionId: 40,
            occurredAt: "2026-09-01T10:00:00.000Z",
            programName: "Push A",
            resistanceType: exerciseId === 1 ? historyResistanceType : RESISTANCE.EXTERNAL_WEIGHT,
            sets: exerciseId === 1
              ? (storedHistorySetExists ? [storedHistorySet] : [])
              : [{ ...storedHistorySet, id: 70 + exerciseId, loadAccountingOverride: null }],
          }],
        });
      }
      if (url === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        storedHistorySet = {
          ...storedHistorySet,
          reps: Number(payload.reps),
          weightKg: payload.weightKg === null
            ? null
            : typeof payload.weightKg === "number"
              ? Math.round(payload.weightKg * 100) / 100
              : storedHistorySet.weightKg,
          rir: payload.rir === null || typeof payload.rir === "number" ? payload.rir : storedHistorySet.rir,
          comment: payload.comment === null || typeof payload.comment === "string" ? payload.comment : storedHistorySet.comment,
          loadAccountingOverride: payload.loadAccountingOverride === undefined
            ? storedHistorySet.loadAccountingOverride
            : payload.loadAccountingOverride,
        };
        if (options.mutationErrorStatus) return Response.json({ error: "dependent refresh failed" }, { status: options.mutationErrorStatus });
        return Response.json({
          set: {
            id: 71,
            sessionExerciseId: 400,
            setNumber: 1,
            reps: storedHistorySet.reps,
            weightKg: storedHistorySet.weightKg,
            bandNominalResistanceKg: null,
            rir: storedHistorySet.rir,
            comment: storedHistorySet.comment,
            completedAt: storedHistorySet.completedAt,
            createdAt: "2026-09-01T10:23:00.000Z",
            updatedAt: "2026-09-01T10:24:00.000Z",
            loadAccountingOverride: storedHistorySet.loadAccountingOverride,
          },
          ...(options.publicationStatus ? { modelPublicationStatus: options.publicationStatus } : {}),
        });
      }
      if (url === "/api/v1/training/sessions/40/sets/71" && init?.method === "DELETE") {
        storedHistorySetExists = false;
        if (options.mutationErrorStatus) return Response.json({ error: "dependent refresh failed" }, { status: options.mutationErrorStatus });
        if (options.publicationStatus) return Response.json({ deleted: true, modelPublicationStatus: options.publicationStatus });
        return new Response(null, { status: 204 });
      }
      if (url === "/api/v1/training/sessions/40/sets/71" && !init?.method) {
        if (!storedHistorySetExists) return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json({
          set: {
            ...storedHistorySet,
            id: 71,
            setNumber: 1,
            sessionExerciseId: 400,
            createdAt: "2026-09-01T10:23:00.000Z",
            updatedAt: "2026-09-01T10:24:00.000Z",
          },
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
    return { getStoredHistorySet: () => storedHistorySet };
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

  it("saves BODYWEIGHT additional load from the current-session edit page", async () => {
    const user = userEvent.setup();
    const bodyweightSet = {
      id: 91,
      sessionExerciseId: 3,
      setNumber: 1,
      reps: 10,
      weightKg: null,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
      completedAt: "2026-09-10T16:20:00.000Z",
      createdAt: "2026-09-10T16:20:00.000Z",
      updatedAt: "2026-09-10T16:20:00.000Z",
      loadAccountingOverride: {
        reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
        additionalLoadKg: 2,
        equipmentSetupId: "rings",
      },
    };
    let session: StrengthSessionDto = {
      ...makeSession(),
      exercises: makeSession().exercises.map((exercise) => exercise.id === 3
        ? { ...exercise, sets: [bodyweightSet] }
        : exercise),
    };
    let patchBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88/sets/91" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        const updatedSet = {
          ...bodyweightSet,
          reps: Number(patchBody.reps),
          loadAccountingOverride: patchBody.loadAccountingOverride,
          updatedAt: "2026-09-10T16:21:00.000Z",
        };
        session = {
          ...session,
          exercises: session.exercises.map((exercise) => exercise.id === 3
            ? { ...exercise, sets: [updatedSet] }
            : exercise),
        };
        return Response.json({ set: updatedSet });
      }
      if (url === "/api/v1/training/sessions/88" && !init?.method) {
        return Response.json({ session });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    searchParams.set("exercise", "3");

    render(<SessionEditClient sessionId={88} />);
    await user.click(await screen.findByRole("button", { name: /Edit set/i }));
    const loadInput = activePane().getByLabelText("Additional load, kg (optional)");
    expect((loadInput as HTMLInputElement).value).toBe("2");
    await user.clear(loadInput);
    await user.type(loadInput, "15");
    await user.click(activePane().getByRole("button", { name: "Update set" }));

    await waitFor(() => expect(activePane().getByText(/bodyweight \+15 kg/)).toBeTruthy());
    expect(patchBody).toMatchObject({
      loadAccountingOverride: {
        reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
        additionalLoadKg: 15,
        equipmentSetupId: "rings",
      },
    });
    expect(patchBody).not.toHaveProperty("weightKg");
    expect(patchBody).not.toHaveProperty("bandNominalResistanceKg");

    await user.click(activePane().getByRole("button", { name: "Edit set" }));
    const clearInput = activePane().getByLabelText("Additional load, kg (optional)");
    expect((clearInput as HTMLInputElement).value).toBe("15");
    await user.clear(clearInput);
    await user.click(activePane().getByRole("button", { name: "Update set" }));
    await waitFor(() => expect(activePane().getByText(/bodyweight × 10/)).toBeTruthy());
    expect(patchBody).toMatchObject({
      loadAccountingOverride: {
        reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
        equipmentSetupId: "rings",
      },
    });

    await user.click(activePane().getByRole("button", { name: "Edit set" }));
    const oversizedInput = activePane().getByLabelText("Additional load, kg (optional)");
    await user.clear(oversizedInput);
    await user.type(oversizedInput, "1e308");
    await user.click(activePane().getByRole("button", { name: "Update set" }));
    expect((await screen.findByRole("alert")).textContent).toContain("2000 kg");
    expect(vi.mocked(fetch).mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88/sets/91" && init?.method === "PATCH"
    ))).toHaveLength(2);
  });

  it("preserves untouched zero load on RIR/comment edits and clears it only after explicit input", async () => {
    for (const field of ["rir", "comment"] as const) {
      cleanup();
      const user = userEvent.setup();
      const bodyweightSet = {
        id: 91,
        sessionExerciseId: 3,
        setNumber: 1,
        reps: 10,
        weightKg: null,
        bandNominalResistanceKg: null,
        rir: 2,
        comment: "before",
        completedAt: "2026-09-10T16:20:00.000Z",
        createdAt: "2026-09-10T16:19:00.000Z",
        updatedAt: "2026-09-10T16:21:00.000Z",
        loadAccountingOverride: { additionalLoadKg: 0 },
      };
      let session: StrengthSessionDto = {
        ...makeSession(),
        exercises: makeSession().exercises.map((exercise) => exercise.id === 3
          ? { ...exercise, sets: [bodyweightSet] }
          : exercise),
      };
      const patchBodies: Record<string, unknown>[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
        if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
        if (url.includes("/history")) return Response.json({ entries: [] });
        if (url === "/api/v1/training/sessions/88/sets/91" && init?.method === "PATCH") {
          const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
          patchBodies.push(payload);
          const updatedSet = {
            ...bodyweightSet,
            rir: typeof payload.rir === "number" || payload.rir === null ? payload.rir : bodyweightSet.rir,
            comment: typeof payload.comment === "string" || payload.comment === null ? payload.comment : bodyweightSet.comment,
            loadAccountingOverride: Object.hasOwn(payload, "loadAccountingOverride")
              ? payload.loadAccountingOverride
              : bodyweightSet.loadAccountingOverride,
          };
          session = {
            ...session,
            exercises: session.exercises.map((exercise) => exercise.id === 3
              ? { ...exercise, sets: [updatedSet] }
              : exercise),
          };
          return Response.json({ set: updatedSet });
        }
        if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session });
        return Response.json({});
      }));
      searchParams.set("exercise", "3");
      render(<SessionEditClient sessionId={88} />);
      await user.click(await screen.findByRole("button", { name: /Edit set/i }));
      if (field === "rir") {
        const load = activePane().getByLabelText("Additional load, kg (optional)");
        await user.type(load, "0");
        await user.click(activePane().getByRole("button", { name: "Cancel" }));
        await user.click(activePane().getByRole("button", { name: /Edit set/i }));
        await user.clear(activePane().getByLabelText("RIR"));
        await user.type(activePane().getByLabelText("RIR"), "3");
      } else {
        await user.clear(activePane().getByLabelText("Comment"));
        await user.click(activePane().getByRole("button", { name: "+ Comment" }));
        await user.type(activePane().getByLabelText("Comment"), "after");
      }
      await user.click(activePane().getByRole("button", { name: "Update set" }));
      await waitFor(() => expect(patchBodies).toHaveLength(1));
      expect(patchBodies[0]).not.toHaveProperty("loadAccountingOverride");
      expect(session.exercises.find((exercise) => exercise.id === 3)?.sets[0]).toMatchObject({
        completedAt: "2026-09-10T16:20:00.000Z",
        createdAt: "2026-09-10T16:19:00.000Z",
        loadAccountingOverride: { additionalLoadKg: 0 },
      });

      await user.click(activePane().getByRole("button", { name: "Edit set" }));
      const zeroInput = activePane().getByLabelText("Additional load, kg (optional)");
      expect((zeroInput as HTMLInputElement).value).toBe("");
      await user.type(zeroInput, "0");
      await user.click(activePane().getByRole("button", { name: "Update set" }));
      await waitFor(() => expect(patchBodies).toHaveLength(2));
      expect(patchBodies[1]).toMatchObject({ loadAccountingOverride: null });
      expect(session.exercises.find((exercise) => exercise.id === 3)?.sets[0]?.loadAccountingOverride).toBeNull();
    }
  });

  it("does not transfer current-set load dirty state to the next set", async () => {
    const user = userEvent.setup();
    const makeSet = (id: number, setNumber: number, additionalLoadKg: number) => ({
      id, sessionExerciseId: 3, setNumber, reps: 10, weightKg: null, bandNominalResistanceKg: null,
      rir: 2, comment: null, completedAt: "2026-09-10T16:20:00.000Z",
      createdAt: "2026-09-10T16:19:00.000Z", updatedAt: "2026-09-10T16:21:00.000Z",
      loadAccountingOverride: { additionalLoadKg },
    });
    const firstSet = makeSet(91, 1, 0);
    let secondSet = makeSet(92, 2, 15);
    let session: StrengthSessionDto = {
      ...makeSession(),
      exercises: makeSession().exercises.map((exercise) => exercise.id === 3
        ? { ...exercise, sets: [firstSet, secondSet] }
        : exercise),
    };
    let patchBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88/sets/92" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        secondSet = {
          ...secondSet,
          rir: typeof patchBody.rir === "number" ? patchBody.rir : secondSet.rir,
        };
        session = {
          ...session,
          exercises: session.exercises.map((exercise) => exercise.id === 3
            ? { ...exercise, sets: [firstSet, secondSet] }
            : exercise),
        };
        return Response.json({ set: secondSet });
      }
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session });
      return Response.json({});
    }));
    searchParams.set("exercise", "3");
    render(<SessionEditClient sessionId={88} />);
    await screen.findByTestId("active-exercise-pane");
    const setRow = (number: number) => {
      const row = activePane().getAllByRole("listitem").find((item) => item.textContent?.trim().startsWith(`#${number}`));
      expect(row).toBeDefined();
      return within(row!);
    };
    await user.click(setRow(1).getByRole("button", { name: /Edit set/i }));
    await user.type(activePane().getByLabelText("Additional load, kg (optional)"), "0");
    await user.click(activePane().getByRole("button", { name: "Cancel" }));

    await user.click(setRow(2).getByRole("button", { name: /Edit set/i }));
    await user.clear(activePane().getByLabelText("RIR"));
    await user.type(activePane().getByLabelText("RIR"), "3");
    await user.click(activePane().getByRole("button", { name: "Update set" }));
    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).not.toHaveProperty("loadAccountingOverride");
    expect(secondSet.loadAccountingOverride).toEqual({ additionalLoadKg: 15 });
  });

  it("edits a prior session set inline and preserves its original completion timestamp", async () => {
    const user = userEvent.setup();
    stubFetch();
    const scrollTo = vi.fn();
    vi.spyOn(window, "scrollTo").mockImplementation(scrollTo);
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    expect(document.activeElement).toBe(within(historySet).getByLabelText("Reps"));
    await user.click(within(historySet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(within(historySet).getByRole("button", { name: "Actions for set 1" })));
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());

    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    await user.clear(within(historySet).getByLabelText("Reps"));
    await user.type(within(historySet).getByLabelText("Reps"), "11");
    await user.clear(within(historySet).getByLabelText("Weight, kg"));
    await user.type(within(historySet).getByLabelText("Weight, kg"), "30");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(historySet).getByText(/30 kg × 11/)).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/training/sessions/40/sets/71",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ reps: 11, rir: 2, comment: null, weightKg: 30 }),
      }),
    );
    const patch = vi.mocked(fetch).mock.calls.find(([input, init]) => (
      String(input) === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH"
    ));
    expect(String(patch?.[1]?.body)).not.toContain("completedAt");
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: /September 1/i })).toBeNull();
  });

  it("keeps asymmetric execution and load override data when editing historical reps", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const override = { reps: { kind: "asymmetric-per-side", left: 6, right: 4 }, additionalLoadKg: 2 };
    stubFetch(makeSession(), { historyOverride: override, publicationStatus: "stale" });
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    await user.clear(within(historySet).getByLabelText("Left reps"));
    await user.type(within(historySet).getByLabelText("Left reps"), "7");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    const patch = vi.mocked(fetch).mock.calls.find(([input, init]) => (
      String(input) === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH"
    ));
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      reps: 11,
      loadAccountingOverride: {
        reps: { kind: "asymmetric-per-side", left: 7, right: 4 },
        additionalLoadKg: 2,
      },
    });
    await waitFor(() => expect(within(historySet).getByText(/28 kg × 11/)).toBeTruthy());
    expect(screen.getByText("Set saved, but the model is not current.").getAttribute("role")).toBe("status");
  });

  it("edits and clears historical BODYWEIGHT load while preserving other override attributes", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const override = {
      reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
      additionalLoadKg: 15,
      equipmentSetupId: "rings",
    };
    stubFetch(makeSession(), {
      historyOverride: override,
      historyResistanceType: RESISTANCE.BODYWEIGHT,
    });
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" }))
      .findByTestId("history-set-40-71");
    expect(within(historySet).getByText(/bodyweight \+15 kg/)).toBeTruthy();

    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    const loadInput = within(historySet).getByLabelText("Additional load, kg (optional)");
    expect((loadInput as HTMLInputElement).value).toBe("15");
    await user.clear(loadInput);
    await user.type(loadInput, "20");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(historySet).getByText(/bodyweight \+20 kg/)).toBeTruthy());
    const patchCalls = () => vi.mocked(fetch).mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH"
    ));
    let patchBody = JSON.parse(String(patchCalls().at(-1)?.[1]?.body)) as Record<string, unknown>;
    expect(patchBody).not.toHaveProperty("weightKg");
    expect(patchBody).toMatchObject({
      loadAccountingOverride: {
        reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
        additionalLoadKg: 20,
        equipmentSetupId: "rings",
      },
    });

    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    await user.clear(within(historySet).getByLabelText("Additional load, kg (optional)"));
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(historySet).getByText(/bodyweight/)).toBeTruthy());
    patchBody = JSON.parse(String(patchCalls().at(-1)?.[1]?.body)) as Record<string, unknown>;
    expect(patchBody.loadAccountingOverride).toEqual({
      reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
      equipmentSetupId: "rings",
    });
    expect(within(historySet).queryByText(/\+0(?:\.0+)? kg/)).toBeNull();

    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    const oversizedInput = within(historySet).getByLabelText("Additional load, kg (optional)");
    await user.type(oversizedInput, "1e308");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));
    expect((await within(historySet).findByRole("alert")).textContent).toContain("2000 kg");
    expect(patchCalls()).toHaveLength(2);
  });

  it("rejects a changed historical BODYWEIGHT load above the write limit", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    stubFetch(makeSession(), {
      historyOverride: { additionalLoadKg: 15 },
      historyResistanceType: RESISTANCE.BODYWEIGHT,
    });
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" }))
      .findByTestId("history-set-40-71");
    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    const load = within(historySet).getByLabelText("Additional load, kg (optional)");
    await user.clear(load);
    await user.type(load, "2001");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    expect((await within(historySet).findByRole("alert")).textContent).toContain("2000 kg");
    expect(vi.mocked(fetch).mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH"
    ))).toHaveLength(0);
  });

  it("preserves an untouched persisted zero additional-load value when the blank field is saved", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const stub = stubFetch(makeSession(), {
      historyOverride: { additionalLoadKg: 0 },
      historyResistanceType: RESISTANCE.BODYWEIGHT,
    });
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" }))
      .findByTestId("history-set-40-71");
    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    const load = within(historySet).getByLabelText("Additional load, kg (optional)");
    expect((load as HTMLInputElement).value).toBe("");
    await user.type(load, "0");
    await user.click(within(historySet).getByRole("button", { name: "Cancel" }));
    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    await user.clear(within(historySet).getByLabelText("RIR"));
    await user.type(within(historySet).getByLabelText("RIR"), "3");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    const patch = vi.mocked(fetch).mock.calls.find(([input, init]) => (
      String(input) === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH"
    ));
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ rir: 3 });
    expect(JSON.parse(String(patch?.[1]?.body))).not.toHaveProperty("loadAccountingOverride");
    expect(stub.getStoredHistorySet().loadAccountingOverride).toEqual({ additionalLoadKg: 0 });
  });

  it("clears persisted zero only after an explicit additional-load edit", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const stub = stubFetch(makeSession(), {
      historyOverride: { additionalLoadKg: 0 },
      historyResistanceType: RESISTANCE.BODYWEIGHT,
    });
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" }))
      .findByTestId("history-set-40-71");
    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    const load = within(historySet).getByLabelText("Additional load, kg (optional)");
    expect((load as HTMLInputElement).value).toBe("");
    await user.type(load, "0");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    const patch = vi.mocked(fetch).mock.calls.find(([input, init]) => (
      String(input) === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH"
    ));
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ loadAccountingOverride: null });
    expect(stub.getStoredHistorySet().loadAccountingOverride).toBeNull();
  });

  it("omits unchanged oversized and valid BODYWEIGHT overrides from historical RIR/comment patches", async () => {
    const scenarios = [
      { override: { additionalLoadKg: 2_500 }, expectedLabel: /bodyweight \+2,?500 kg/ },
      { override: { assistanceLoadKg: 2_500 }, expectedLabel: /bodyweight/ },
      { override: { additionalLoadKg: 15 }, expectedLabel: /bodyweight \+15 kg/ },
    ];

    for (const scenario of scenarios) {
      cleanup();
      const user = userEvent.setup();
      vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
      const stub = stubFetch(makeSession(), {
        historyOverride: scenario.override,
        historyResistanceType: RESISTANCE.BODYWEIGHT,
      });
      render(<SessionEditClient sessionId={88} />);
      await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
      const historySet = await within(activePane().getByRole("region", { name: "Exercise history" }))
        .findByTestId("history-set-40-71");
      await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
      await user.click(within(historySet).getByRole("button", { name: "Edit" }));
      await user.clear(within(historySet).getByLabelText("RIR"));
      await user.type(within(historySet).getByLabelText("RIR"), "3");
      await user.type(within(historySet).getByLabelText("Comment"), "after");
      await user.click(within(historySet).getByRole("button", { name: "Save" }));

      await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input, init]) => (
        String(input) === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH"
      ))).toBe(true));
      const patch = vi.mocked(fetch).mock.calls.find(([input, init]) => (
        String(input) === "/api/v1/training/sessions/40/sets/71" && init?.method === "PATCH"
      ));
      const patchBody = JSON.parse(String(patch?.[1]?.body)) as Record<string, unknown>;
      expect(patchBody).toMatchObject({ rir: 3, comment: "after" });
      expect(patchBody).not.toHaveProperty("loadAccountingOverride");
      expect(stub.getStoredHistorySet().loadAccountingOverride).toEqual(scenario.override);
      expect(within(historySet).getByText(scenario.expectedLabel)).toBeTruthy();
    }
  });

  it("reconciles a committed historical edit when dependent publication returns an error", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    stubFetch(makeSession(), { mutationErrorStatus: 500 });
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    await user.clear(within(historySet).getByLabelText("Reps"));
    await user.type(within(historySet).getByLabelText("Reps"), "11");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(historySet).getByText(/28 kg × 11/)).toBeTruthy());
    expect(screen.getByText("Set saved, but model refresh reported a problem.").getAttribute("role")).toBe("status");
    expect(within(historySet).queryByRole("alert")).toBeNull();
  });

  it("reconciles a committed historical load edit at the database decimal precision", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    stubFetch(makeSession(), { mutationErrorStatus: 500 });
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit" }));
    await user.clear(within(historySet).getByLabelText("Weight, kg"));
    await user.type(within(historySet).getByLabelText("Weight, kg"), "28.126");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(historySet).getByText(/28\.13 kg/)).toBeTruthy());
    expect(screen.getByText("Set saved, but model refresh reported a problem.").getAttribute("role")).toBe("status");
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => (
      url === "/api/v1/training/sessions/40/sets/71" && init?.method === undefined
    ))).toBe(true);
  });

  it("reveals explicit history actions on a short left swipe", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    stubFetch();
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    fireEvent.pointerDown(historySet, { pointerId: 1, pointerType: "touch", clientX: 220, clientY: 20 });
    fireEvent.pointerUp(historySet, { pointerId: 1, pointerType: "touch", clientX: 120, clientY: 20 });

    expect(within(historySet).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(within(historySet).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    await user.click(within(historySet).getByRole("button", { name: "Use values from set 1" }));
    expect(screen.getByText("Fields filled — add the set when ready.").getAttribute("role")).toBe("status");
  });

  it("asks before deleting after a near-edge swipe", async () => {
    stubFetch();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");
    vi.spyOn(historySet, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 300, height: 48, top: 0, right: 300, bottom: 48, left: 0, toJSON: () => ({}),
    });

    fireEvent.pointerDown(historySet, { pointerId: 2, pointerType: "touch", clientX: 280, clientY: 20 });
    fireEvent.pointerUp(historySet, { pointerId: 2, pointerType: "touch", clientX: 5, clientY: 20 });

    expect(confirm).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(within(activePane().getByRole("region", { name: "Exercise history" })).getByTestId("history-set-40-71")).toBeTruthy();
  });

  it("reconciles a committed historical delete when dependent publication returns an error", async () => {
    const user = userEvent.setup();
    stubFetch(makeSession(), { mutationErrorStatus: 500 });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historyRegion = activePane().getByRole("region", { name: "Exercise history" });
    const historySet = await within(historyRegion).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(within(historyRegion).queryByTestId("history-set-40-71")).toBeNull());
    expect(screen.getByText("Set deleted, but model refresh reported a problem.").getAttribute("role")).toBe("status");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => (
      url === "/api/v1/training/sessions/40/sets/71" && init?.method === undefined
    ))).toBe(true);
  });

  it("offers keyboard-accessible delete and requires confirmation for a historical set", async () => {
    const user = userEvent.setup();
    stubFetch(makeSession(), { publicationStatus: "stale" });
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Actions for set 1" }));
    await user.click(within(historySet).getByRole("button", { name: "Delete" }));

    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(within(activePane().getByRole("region", { name: "Exercise history" })).queryByTestId("history-set-40-71")).toBeNull());
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/training/sessions/40/sets/71",
      expect.objectContaining({ method: "DELETE" }),
    );
    const announcement = screen.getByText("Set deleted, but the model is not current.");
    expect(announcement.getAttribute("role")).toBe("status");
    await waitFor(() => expect(document.activeElement).toBe(announcement));
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
