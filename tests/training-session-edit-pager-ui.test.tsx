/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

const routerPush = vi.fn();
const searchParams = new URLSearchParams();
const PROGRAM_CHANGE_UI_TIMEOUT_MS = 10_000;
const PROGRAM_CHANGE_TEST_TIMEOUT_MS = 12_000;
const draftOperations = vi.hoisted(() => new Map<string, {
  operationId: string;
  sessionId: number;
  exerciseId: number;
  payload: Record<string, unknown>;
  draft: unknown;
  createdAt: number;
  terminalState?: "new-intent-required" | "replaced";
  terminalReason?: "not-committed" | "tombstoned";
  replacementOperationId?: string;
}>());

vi.mock("../src/app/training/set-create-operation-store", () => ({
  storeSetCreateOperation: vi.fn(async (operation: { operationId: string; sessionId: number; exerciseId: number; payload: Record<string, unknown>; draft: unknown; createdAt: number }) => {
    if (!draftOperations.has(operation.operationId)) draftOperations.set(operation.operationId, { ...operation });
  }),
  markSetCreateOperationTerminal: vi.fn(async (operation: {
    operationId: string; sessionId: number; exerciseId: number; payload: Record<string, unknown>;
    draft: unknown; createdAt: number; terminalState?: "new-intent-required" | "replaced";
    terminalReason?: "not-committed" | "tombstoned"; replacementOperationId?: string;
  }) => {
    let current = draftOperations.get(operation.operationId);
    const visited = new Set<string>();
    while (current?.replacementOperationId) {
      if (visited.has(current.operationId)) return null;
      visited.add(current.operationId);
      current = draftOperations.get(current.replacementOperationId);
    }
    if (!current) {
      draftOperations.set(operation.operationId, { ...operation });
      return operation;
    }
    if (current.operationId !== operation.operationId) return current;
    const terminal = { ...current, terminalState: operation.terminalState, terminalReason: operation.terminalReason };
    draftOperations.set(operation.operationId, terminal);
    return terminal;
  }),
  listSetCreateOperations: vi.fn(async (sessionId: number) => [...draftOperations.values()].filter((operation) =>
    operation.sessionId === sessionId && operation.replacementOperationId === undefined)),
  replaceSetCreateOperation: vi.fn(async (previousOperationId: string, operation: { operationId: string; sessionId: number; exerciseId: number; payload: Record<string, unknown>; draft: unknown; createdAt: number; terminalState?: "new-intent-required" | "replaced"; terminalReason?: "not-committed" | "tombstoned"; replacementOperationId?: string }) => {
    let previous = draftOperations.get(previousOperationId);
    const visited = new Set<string>();
    while (previous?.replacementOperationId) {
      if (visited.has(previous.operationId)) return null;
      visited.add(previous.operationId);
      previous = draftOperations.get(previous.replacementOperationId);
    }
    if (!previous) return null;
    if (previous.operationId !== previousOperationId) return previous;
    if (previous.terminalState !== "new-intent-required") return null;
    draftOperations.set(previousOperationId, {
      ...previous, terminalState: "replaced", terminalReason: undefined,
      replacementOperationId: operation.operationId,
    });
    const replacement = { ...previous, operationId: operation.operationId, createdAt: operation.createdAt,
      terminalState: undefined, terminalReason: undefined, replacementOperationId: undefined };
    draftOperations.set(operation.operationId, replacement);
    return replacement;
  }),
  removeSetCreateOperation: vi.fn(async (operationId: string) => {
    const removedIds = new Set([operationId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const operation of draftOperations.values()) {
        if (operation.replacementOperationId && removedIds.has(operation.replacementOperationId)
            && !removedIds.has(operation.operationId)) {
          removedIds.add(operation.operationId);
          changed = true;
        }
      }
    }
    for (const removedId of removedIds) draftOperations.delete(removedId);
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  usePathname: () => "/training/sessions/88/edit",
  useSearchParams: () => searchParams,
}));

import { SessionEditClient, setCreatePayloadDigest as editSetCreatePayloadDigest } from "@/app/training/sessions/[id]/edit/session-edit-client";
import { sha256Canonical } from "@/modules/training/persisted-load-accounting-v1";
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

function operationStatusResponse(url: string, session: StrengthSessionDto): Response | null {
  const match = url.match(/^\/api\/v1\/training\/set-create-operations\/([^/?]+)(?:\?.*)?$/);
  if (!match) return null;
  const operation = draftOperations.get(decodeURIComponent(match[1]!));
  if (!operation) return Response.json({ state: "NOT_FOUND" }, { status: 404 });
  const exercise = session.exercises.find((candidate) => candidate.id === operation.exerciseId);
  const set = exercise?.sets.find((candidate) => {
    const payload = operation.payload;
    const fields = ["setNumber", "reps", "weightKg", "bandNominalResistanceKg", "rir", "comment"] as const;
    if (fields.some((field) => Object.prototype.hasOwnProperty.call(payload, field)
      && candidate[field] !== payload[field])) return false;
    if (Object.prototype.hasOwnProperty.call(payload, "loadAccountingOverride")) {
      return JSON.stringify(candidate.loadAccountingOverride ?? null)
        === JSON.stringify(payload.loadAccountingOverride ?? null);
    }
    return candidate.loadAccountingOverride == null;
  });
  return set
    ? Response.json({ state: "COMMITTED", set })
    : Response.json({ state: "NOT_FOUND" }, { status: 404 });
}

function installCompletedSessionMutationFetch(
  outcome: "postcommit-error" | "postcommit-network-error" | "not-committed" | "unknown",
) {
  let persisted = structuredClone(makeSession()) as StrengthSessionDto;
  let detailGetFailures = 0;
  const requests: Array<{ url: string; method: string }> = [];
  const updatePersistedSet = (payload: Record<string, unknown>) => {
    const exercise = persisted.exercises.find((item) => item.id === 1)!;
    const original = exercise.sets[0]!;
    const updated = {
      ...original,
      ...payload,
      updatedAt: "2026-09-10T16:25:00.000Z",
    } as typeof original;
    persisted = {
      ...persisted,
      exercises: persisted.exercises.map((item) => item.id === 1 ? { ...item, sets: [updated] } : item),
    };
    return updated;
  };
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method });
    if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
    if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
    if (url.includes("/history")) return Response.json({ entries: [] });
    if (url === "/api/v1/training/sessions/88" && method === "GET") {
      if (detailGetFailures > 0) {
        detailGetFailures -= 1;
        return Response.json({ error: "temporary read failure" }, { status: 503 });
      }
      return Response.json({ session: persisted });
    }
    if (url === "/api/v1/training/sessions/88/sets/9" && method === "PATCH") {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (outcome === "not-committed") return Response.json({ error: "conflict" }, { status: 409 });
      if (outcome === "unknown") throw new Error("connection lost before confirmation");
      updatePersistedSet(payload);
      if (outcome === "postcommit-network-error") throw new Error("response lost after commit");
      return Response.json({ error: "dependent refresh failed" }, { status: 500 });
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    requests,
    getSession: () => persisted,
    failNextDetailGet: () => { detailGetFailures += 1; },
    commitPendingEdit: () => updatePersistedSet({ reps: 11, weightKg: 30, bandNominalResistanceKg: null, rir: null, comment: null }),
  };
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

const originalViewportWidth = window.innerWidth;

describe("Session edit exercise pager", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalViewportWidth });
    vi.restoreAllMocks();
    draftOperations.clear();
    routerPush.mockReset();
    searchParams.delete("exercise");
    window.sessionStorage.clear();
  });

  function stubFetch(session = makeSession(), options: {
    historyOverride?: unknown;
    historyResistanceType?: ResistanceType;
    mutationErrorStatus?: number;
    mutationErrorPublicationStatus?: "current" | "stale" | "not-run";
    publicationStatus?: "current" | "stale" | "not-run";
    malformedSuccess?: "patch" | "delete";
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
        if (options.malformedSuccess === "patch") return new Response("invalid json", { status: 200 });
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
        if (options.mutationErrorStatus) return Response.json({
          error: "dependent refresh failed",
          ...(options.mutationErrorPublicationStatus ? { modelPublicationStatus: options.mutationErrorPublicationStatus } : {}),
        }, { status: options.mutationErrorStatus });
        if (options.malformedSuccess === "delete") return new Response("invalid json", { status: 200 });
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

  it.each(["postcommit-error", "postcommit-network-error"] as const)(
    "immediately reflects a committed edit after a %s response without retrying",
    async (outcome) => {
      const user = userEvent.setup();
      const fixture = installCompletedSessionMutationFetch(outcome);
      render(<SessionEditClient sessionId={88} />);
      const row = await screen.findByTestId("logged-set-9");
      await user.click(within(row).getByRole("button", { name: "Edit set 1" }));
      await user.clear(within(row).getByLabelText("Reps"));
      await user.type(within(row).getByLabelText("Reps"), "11");
      await user.click(within(row).getByRole("button", { name: "Update set" }));

      await waitFor(() => expect(within(row).getByText(/30 kg × 11/)).toBeTruthy());
      expect(fixture.getSession().exercises[0]?.sets[0]).toMatchObject({
        reps: 11,
        completedAt: "2026-09-10T16:20:00.000Z",
      });
      expect(fixture.requests.filter((request) => request.method === "PATCH" && request.url.endsWith("/sets/9"))).toHaveLength(1);
      expect(within(row).queryByRole("button", { name: "Update set" })).toBeNull();
    },
  );

  it("restores the submitted update draft if a concurrent write reverses an early observed update", async () => {
    const user = userEvent.setup();
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    let resolvePatch!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") return Promise.resolve(Response.json({ exercises: [] }));
      if (url === "/api/v1/training/programs") return Promise.resolve(Response.json({ programs: [] }));
      if (url.includes("/history")) return Promise.resolve(Response.json({ entries: [] }));
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Promise.resolve(Response.json({ session: persisted }));
      if (url === "/api/v1/training/sessions/88/sets/9" && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const exercise = persisted.exercises.find((item) => item.id === 1)!;
        const original = exercise.sets[0]!;
        const updated = { ...original, ...payload, updatedAt: "2026-09-10T16:25:00.000Z" };
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((item) => item.id === 1 ? { ...item, sets: [updated] } : item),
        };
        return new Promise<Response>((resolve) => { resolvePatch = resolve; });
      }
      return Promise.resolve(Response.json({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);
    const row = await screen.findByTestId("logged-set-9");
    await user.click(within(row).getByRole("button", { name: "Edit set 1" }));
    await user.clear(within(row).getByLabelText("Reps"));
    await user.type(within(row).getByLabelText("Reps"), "11");
    await user.click(within(row).getByRole("button", { name: "Update set" }));

    await screen.findByText("Set saved.", {}, { timeout: 2_000 });
    expect(within(row).queryByRole("button", { name: "Update set" })).toBeNull();

    persisted = structuredClone(makeSession()) as StrengthSessionDto;
    resolvePatch(Response.json({ error: "concurrent update" }, { status: 409 }));
    await waitFor(() => {
      expect(within(row).getByRole("button", { name: "Update set" })).toBeTruthy();
      expect((within(row).getByLabelText("Reps") as HTMLInputElement).value).toBe("11");
    });
    expect(persisted.exercises[0]?.sets[0]?.reps).toBe(10);
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88/sets/9" && init?.method === "PATCH"
    ))).toHaveLength(1);
  });

  it("keeps the submitted edit draft if the authoritative GET fails after an early persisted read", async () => {
    const user = userEvent.setup();
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    let sessionReads = 0;
    let resolvePatch!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") return Promise.resolve(Response.json({ exercises: [] }));
      if (url === "/api/v1/training/programs") return Promise.resolve(Response.json({ programs: [] }));
      if (url.includes("/history")) return Promise.resolve(Response.json({ entries: [] }));
      if (url === "/api/v1/training/sessions/88" && !init?.method) {
        sessionReads += 1;
        if (sessionReads === 3) return Promise.resolve(Response.json({ error: "verification temporarily unavailable" }, { status: 503 }));
        return Promise.resolve(Response.json({ session: persisted }));
      }
      if (url === "/api/v1/training/sessions/88/sets/9" && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const exercise = persisted.exercises.find((item) => item.id === 1)!;
        const original = exercise.sets[0]!;
        const updated = { ...original, ...payload, updatedAt: "2026-09-10T16:25:00.000Z" };
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((item) => item.id === 1 ? { ...item, sets: [updated] } : item),
        };
        return new Promise<Response>((resolve) => { resolvePatch = resolve; });
      }
      return Promise.resolve(Response.json({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);
    const row = await screen.findByTestId("logged-set-9");
    await user.click(within(row).getByRole("button", { name: "Edit set 1" }));
    await user.clear(within(row).getByLabelText("Reps"));
    await user.type(within(row).getByLabelText("Reps"), "11");
    await user.click(within(row).getByRole("button", { name: "Update set" }));

    await screen.findByText("Set saved.", {}, { timeout: 2_000 });
    expect(within(row).queryByRole("button", { name: "Update set" })).toBeNull();
    resolvePatch(Response.json({ error: "publication unavailable" }, { status: 503 }));

    expect(await screen.findByRole("button", { name: "Check status" })).toBeTruthy();
    expect(screen.queryByText(/model publication|waiting for model/i)).toBeNull();
    await waitFor(() => {
      expect(within(row).getByRole("button", { name: "Update set" }).hasAttribute("disabled")).toBe(true);
      expect((within(row).getByLabelText("Reps") as HTMLInputElement).value).toBe("11");
    });
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88/sets/9" && init?.method === "PATCH"
    ))).toHaveLength(1);
  });

  it("keeps an uncommitted edit draft after authoritative GET and avoids resubmission while outcome is unknown", async () => {
    const user = userEvent.setup();
    const fixture = installCompletedSessionMutationFetch("unknown");
    render(<SessionEditClient sessionId={88} />);
    const row = await screen.findByTestId("logged-set-9");
    await user.click(within(row).getByRole("button", { name: "Edit set 1" }));
    await user.clear(within(row).getByLabelText("Reps"));
    await user.type(within(row).getByLabelText("Reps"), "11");
    fixture.failNextDetailGet();
    await user.click(within(row).getByRole("button", { name: "Update set" }));

    const checkStatus = await screen.findByRole("button", { name: "Check status" });
    expect((within(row).getByLabelText("Reps") as HTMLInputElement).value).toBe("11");
    expect(within(row).getByRole("button", { name: "Update set" }).hasAttribute("disabled")).toBe(true);
    expect(fixture.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);

    fixture.commitPendingEdit();
    await user.click(checkStatus);
    await waitFor(() => expect(within(row).getByText(/30 kg × 11/)).toBeTruthy());
    expect(fixture.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
  });

  it("keeps the edit form and draft when the authoritative session confirms no commit", async () => {
    const user = userEvent.setup();
    const fixture = installCompletedSessionMutationFetch("not-committed");
    render(<SessionEditClient sessionId={88} />);
    const row = await screen.findByTestId("logged-set-9");
    await user.click(within(row).getByRole("button", { name: "Edit set 1" }));
    await user.clear(within(row).getByLabelText("Reps"));
    await user.type(within(row).getByLabelText("Reps"), "11");
    await user.click(within(row).getByRole("button", { name: "Update set" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((within(row).getByLabelText("Reps") as HTMLInputElement).value).toBe("11");
    expect(fixture.getSession().exercises[0]?.sets[0]?.reps).toBe(10);
    expect(fixture.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
  });

  it("adds a completed-session set from the authoritative GET without a model notice", async () => {
    const user = userEvent.setup();
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    const createdSet = {
      id: 10,
      sessionExerciseId: 1,
      setNumber: 2,
      reps: 8,
      weightKg: 25,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
      completedAt: "2026-09-10T16:30:00.000Z",
      createdAt: "2026-09-10T16:30:00.000Z",
      updatedAt: "2026-09-10T16:30:00.000Z",
      loadAccountingOverride: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const operationStatus = operationStatusResponse(url, persisted);
      if (operationStatus) return operationStatus;
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session: persisted });
      if (url === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST") {
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: [...exercise.sets, createdSet] }
            : exercise),
        };
        return Response.json({ set: createdSet, modelPublicationStatus: "stale" }, { status: 201 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);

    await screen.findByTestId("active-exercise-pane");
    const pane = activePane();
    await user.clear(await pane.findByLabelText("Weight, kg"));
    await user.type(pane.getByLabelText("Weight, kg"), "25");
    await user.type(pane.getByLabelText("Reps"), "8");
    await user.click(pane.getByRole("button", { name: "Add set" }));

    expect(await screen.findByTestId("logged-set-10")).toBeTruthy();
    expect(screen.getByText("Set saved.").getAttribute("role")).toBe("status");
    expect(screen.queryByText(/model publication|energy|glycogen|unified recalculation/i)).toBeNull();
    expect(persisted.exercises[0]?.sets).toHaveLength(2);
    const createCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST"
    ));
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST"
    ))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88" && !init?.method
    ))).toHaveLength(2);
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ reps: 8, weightKg: 25 });
    expect(createdSet.setNumber).toBe(2);
  });

  it("locks a create draft while outcome is uncertain and restores it only after the authoritative check", async () => {
    const user = userEvent.setup();
    const persisted = structuredClone(makeSession()) as StrengthSessionDto;
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    let sessionReads = 0;
    let postCount = 0;
    const historicalEntry = {
      sessionId: 40,
      occurredAt: "2026-09-10T16:00:00.000Z",
      programName: "Earlier session",
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      sets: [{
        id: 71,
        setNumber: 1,
        reps: 10,
        weightKg: 20,
        bandNominalResistanceKg: null,
        rir: 2,
        comment: null,
        completedAt: "2026-09-10T16:10:00.000Z",
        loadAccountingOverride: null,
      }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const operationStatus = operationStatusResponse(url, persisted);
      if (operationStatus) return operationStatus;
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [historicalEntry] });
      if (url === "/api/v1/training/sessions/88" && !init?.method) {
        sessionReads += 1;
        if (sessionReads === 2) return Response.json({ error: "temporary verification outage" }, { status: 503 });
        return Response.json({ session: persisted });
      }
      if (url === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST") {
        postCount += 1;
        return Response.json({ error: "write outcome unavailable" }, { status: 503 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);
    await screen.findByTestId("active-exercise-pane");
    const pane = activePane();
    await user.clear(await pane.findByLabelText("Weight, kg"));
    await user.type(pane.getByLabelText("Weight, kg"), "25");
    await user.type(pane.getByLabelText("Reps"), "8");
    await user.click(pane.getByRole("button", { name: "Add set" }));

    const checkStatus = await screen.findByRole("button", { name: "Check status" }, { timeout: 5_000 });
    const reps = pane.getByLabelText("Reps") as HTMLInputElement;
    expect(reps.readOnly).toBe(true);
    expect(reps.value).toBe("8");
    expect(pane.getByRole("button", { name: "Next exercise" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Session menu" }).hasAttribute("disabled")).toBe(true);
    const historyRow = await pane.findByTestId("history-set-40-71");
    const copyButton = within(historyRow).getByRole("button", { name: "Use values from set 1" });
    const editButton = within(historyRow).getByRole("button", { name: "Edit set 1" });
    const deleteButton = within(historyRow).getByRole("button", { name: "Delete set 1" });
    expect(copyButton.hasAttribute("disabled")).toBe(true);
    expect(editButton.hasAttribute("disabled")).toBe(true);
    expect(deleteButton.hasAttribute("disabled")).toBe(true);
    await user.click(copyButton);
    await user.click(editButton);
    await user.click(deleteButton);
    fireEvent.pointerDown(historyRow, { pointerId: 7, pointerType: "touch", clientX: 280, clientY: 20 });
    fireEvent.pointerMove(historyRow, { pointerId: 7, pointerType: "touch", clientX: 5, clientY: 20 });
    fireEvent.pointerUp(historyRow, { pointerId: 7, pointerType: "touch", clientX: 5, clientY: 20 });
    expect(confirm).not.toHaveBeenCalled();
    expect((pane.getByLabelText("Reps") as HTMLInputElement).value).toBe("8");
    expect(fetchMock.mock.calls.some(([, request]) => request?.method === "PATCH" || request?.method === "DELETE")).toBe(false);
    await user.click(checkStatus);

    await screen.findByRole("alert");
    await waitFor(() => expect(checkStatus.hasAttribute("disabled")).toBe(false));
    expect((pane.getByLabelText("Reps") as HTMLInputElement).value).toBe("8");
    expect(postCount).toBe(2);
    const idempotencyKeys = fetchMock.mock.calls
      .filter(([url, request]) => String(url) === "/api/v1/training/sessions/88/exercises/1/sets" && request?.method === "POST")
      .map(([, request]) => (request?.headers as Record<string, string>)?.["Idempotency-Key"]);
    expect(new Set(idempotencyKeys).size).toBe(1);
  });

  it("shows a completed-session set as soon as an authoritative GET confirms persistence", async () => {
    const user = userEvent.setup();
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    let resolvePost!: (response: Response) => void;
    let postCommitted = false;
    const createdSet = {
      id: 10,
      sessionExerciseId: 1,
      setNumber: 2,
      reps: 8,
      weightKg: 25,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
      completedAt: "2026-09-10T16:30:00.000Z",
      createdAt: "2026-09-10T16:30:00.000Z",
      updatedAt: "2026-09-10T16:30:00.000Z",
      loadAccountingOverride: null,
    };
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/v1/training/set-create-operations/") && !postCommitted) {
        return Promise.resolve(Response.json({ state: "NOT_FOUND" }, { status: 404 }));
      }
      const operationStatus = operationStatusResponse(url, persisted);
      if (operationStatus) return Promise.resolve(operationStatus);
      if (url === "/api/v1/training/exercises") return Promise.resolve(Response.json({ exercises: [] }));
      if (url === "/api/v1/training/programs") return Promise.resolve(Response.json({ programs: [] }));
      if (url.includes("/history")) return Promise.resolve(Response.json({ entries: [] }));
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Promise.resolve(Response.json({ session: persisted }));
      if (url === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST") {
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: [...exercise.sets, createdSet] }
            : exercise),
        };
        return new Promise<Response>((resolve) => { resolvePost = resolve; });
      }
      return Promise.resolve(Response.json({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);
    await screen.findByTestId("active-exercise-pane");
    const pane = activePane();
    await user.clear(await pane.findByLabelText("Weight, kg"));
    await user.type(pane.getByLabelText("Weight, kg"), "25");
    await user.type(pane.getByLabelText("Reps"), "8");
    await user.click(pane.getByRole("button", { name: "Add set" }));

    expect(screen.queryByTestId("logged-set-10")).toBeNull();
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST"
    ))).toHaveLength(1);

    postCommitted = true;
    resolvePost(Response.json({ set: createdSet, modelPublicationStatus: "stale" }, { status: 201 }));
    expect(await screen.findByTestId("logged-set-10")).toBeTruthy();
    expect(screen.getByText("Set saved.").getAttribute("role")).toBe("status");
    expect(screen.queryByText(/model publication|waiting for model/i)).toBeNull();
    expect(await screen.findByText("Set saved.")).toBeTruthy();
    expect(draftOperations.size).toBe(0);
  });

  it("does not treat a 409 colliding create as committed or clear its draft", async () => {
    const user = userEvent.setup();
    const concurrentSet = {
      id: 10,
      sessionExerciseId: 1,
      setNumber: 2,
      reps: 8,
      weightKg: 25,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
      completedAt: "2026-09-10T16:30:00.000Z",
      createdAt: "2026-09-10T16:30:00.000Z",
      updatedAt: "2026-09-10T16:30:00.000Z",
      loadAccountingOverride: { additionalLoadKg: 15 },
    };
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const operationStatus = operationStatusResponse(url, persisted);
      if (operationStatus) return operationStatus;
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session: persisted });
      if (url === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST") {
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: [...exercise.sets, concurrentSet] }
            : exercise),
        };
        return Response.json({ error: "set number conflict" }, { status: 409 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);
    await screen.findByTestId("active-exercise-pane");
    const pane = activePane();
    await user.clear(await pane.findByLabelText("Weight, kg"));
    await user.type(pane.getByLabelText("Weight, kg"), "25");
    await user.type(pane.getByLabelText("Reps"), "8");
    await user.click(pane.getByRole("button", { name: "Add set" }));

    expect(await screen.findByRole("button", { name: "Check status" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("conflicts with the current set state");
    expect(screen.queryByRole("status")).toBeNull();
    expect(draftOperations.size).toBeGreaterThan(0);
    const createAttempts = fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST"
    ));
    expect(createAttempts).toHaveLength(1);
  });

  it("uses the latest persisted row after a delayed successful PATCH response", async () => {
    const user = userEvent.setup();
    const initial = structuredClone(makeSession()) as StrengthSessionDto;
    const original = initial.exercises[0]!.sets[0]!;
    const bodyweightSession = {
      ...initial,
      exercises: initial.exercises.map((exercise) => exercise.id === 1
        ? {
          ...exercise,
          resistanceType: RESISTANCE.BODYWEIGHT,
          sets: [{ ...original, weightKg: null, loadAccountingOverride: { additionalLoadKg: 15 } }],
        }
        : exercise),
    } as StrengthSessionDto;
    let persisted = structuredClone(bodyweightSession) as StrengthSessionDto;
    const patchPayloads: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const operationStatus = operationStatusResponse(url, persisted);
      if (operationStatus) return operationStatus;
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session: persisted });
      if (url === "/api/v1/training/sessions/88/sets/9" && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchPayloads.push(payload);
        const prior = persisted.exercises[0]!.sets[0]!;
        const delayedResponseSet = { ...prior, reps: Number(payload.reps), updatedAt: "2026-09-10T16:25:00.000Z" };
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: [{ ...delayedResponseSet, loadAccountingOverride: { additionalLoadKg: 20 }, updatedAt: "2026-09-10T16:26:00.000Z" }] }
            : exercise),
        };
        return Response.json({ set: delayedResponseSet, modelPublicationStatus: "current" });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);
    const row = await screen.findByTestId("logged-set-9");
    await user.click(within(row).getByRole("button", { name: "Edit set 1" }));
    await user.clear(within(row).getByLabelText("Reps"));
    await user.type(within(row).getByLabelText("Reps"), "11");
    await user.click(within(row).getByRole("button", { name: "Update set" }));

    await waitFor(() => expect(within(row).getByText(/bodyweight \+20 kg × 11/)).toBeTruthy());
    expect(patchPayloads).toHaveLength(1);
    expect(patchPayloads[0]).not.toHaveProperty("loadAccountingOverride");
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88" && !init?.method
    ))).toHaveLength(2);
  });

  it("reconciles a POST committed before a postcommit server error without creating a duplicate set", async () => {
    const user = userEvent.setup();
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    const createdSet = {
      id: 10,
      sessionExerciseId: 1,
      setNumber: 2,
      reps: 8,
      weightKg: 25,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
      completedAt: "2026-09-10T16:30:00.000Z",
      createdAt: "2026-09-10T16:30:00.000Z",
      updatedAt: "2026-09-10T16:30:00.000Z",
      loadAccountingOverride: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const operationStatus = operationStatusResponse(url, persisted);
      if (operationStatus) return operationStatus;
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session: persisted });
      if (url === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST") {
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: [...exercise.sets, createdSet] }
            : exercise),
        };
        return Response.json({ error: "temporary postcommit response failure" }, { status: 500 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);
    await screen.findByTestId("active-exercise-pane");
    const pane = activePane();
    await user.clear(await pane.findByLabelText("Weight, kg"));
    await user.type(pane.getByLabelText("Weight, kg"), "25");
    await user.type(pane.getByLabelText("Reps"), "8");
    await user.click(pane.getByRole("button", { name: "Add set" }));

    expect(await screen.findByTestId("logged-set-10")).toBeTruthy();
    expect(persisted.exercises[0]?.sets).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST"
    ))).toHaveLength(1);
  });

  it("uses the server canonical digest for multi-key set overrides", async () => {
    const operation = {
      sessionId: 88,
      exerciseId: 1,
      payload: {
        reps: 8,
        weightKg: null,
        loadAccountingOverride: { loadInput: "per-implement-kg", loadedSides: 2 },
      },
    };
    const expected = sha256Canonical({
      version: 1,
      sessionId: operation.sessionId,
      exerciseId: operation.exerciseId,
      requestedSetNumber: null,
      reps: 8,
      weightKg: null,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
      completedAt: null,
      loadAccountingOverride: operation.payload.loadAccountingOverride,
    });
    await expect(editSetCreatePayloadDigest(operation)).resolves.toBe(expected);
  });

  it("retains a pre-write conflict draft and creates a fresh intent only after explicit action", async () => {
    const user = userEvent.setup();
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    const operationIds: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const status = operationStatusResponse(url, persisted);
      if (status) return status;
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session: persisted });
      if (url === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST") {
        operationIds.push((init.headers as Record<string, string>)["Idempotency-Key"]!);
        if (operationIds.length === 1) return Response.json({ error: "training_concurrent_mutation" }, { status: 409 });
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const created = {
          id: 101,
          sessionExerciseId: 1,
          ...payload,
          setNumber: 2,
          reps: payload.reps as number,
          rir: payload.rir as number | null,
          comment: payload.comment as string | null,
          weightKg: payload.weightKg as number,
          bandNominalResistanceKg: null,
          completedAt: "2026-09-10T16:30:00.000Z",
          createdAt: "2026-09-10T16:30:00.000Z",
          updatedAt: "2026-09-10T16:30:00.000Z",
          loadAccountingOverride: null,
        };
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: [...exercise.sets, created] }
            : exercise),
        };
        return Response.json({ set: created }, { status: 201 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionEditClient sessionId={88} />);
    await screen.findByTestId("active-exercise-pane");
    const pane = activePane();
    await user.clear(await pane.findByLabelText("Weight, kg"));
    await user.type(pane.getByLabelText("Weight, kg"), "25");
    await user.type(pane.getByLabelText("Reps"), "8");
    await user.click(pane.getByRole("button", { name: "Add set" }));
    const createAgain = await screen.findByRole("button", { name: "Create again" });
    expect(operationIds).toHaveLength(1);
    expect([...draftOperations.values()][0]?.terminalReason).toBe("not-committed");

    await user.click(createAgain);
    expect(await screen.findByTestId("logged-set-101")).toBeTruthy();
    expect(operationIds).toHaveLength(2);
    expect(operationIds[1]).not.toBe(operationIds[0]);
    expect(draftOperations.size).toBe(0);
  });

  it("turns a restored same-key pre-write 409 into an explicit fresh-intent state", async () => {
    const user = userEvent.setup();
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    const oldOperationId = "restored-pending-create";
    draftOperations.set(oldOperationId, {
      operationId: oldOperationId,
      sessionId: 88,
      exerciseId: 1,
      payload: { reps: 8, weightKg: 25, bandNominalResistanceKg: null, rir: null, comment: null },
      draft: {
        reps: "8", asymmetricRepsEnabled: false, leftReps: "", rightReps: "",
        weightKg: "25", additionalLoadKg: "", bandNominalResistanceKg: "", rir: "", comment: "",
      },
      createdAt: 1,
    });
    const operationIds: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const status = operationStatusResponse(url, persisted);
      if (status) return status;
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session: persisted });
      if (url === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST") {
        const operationId = (init.headers as Record<string, string>)["Idempotency-Key"]!;
        operationIds.push(operationId);
        if (operationIds.length === 1) {
          return Response.json({ error: "training_concurrent_mutation" }, { status: 409 });
        }
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const created = {
          id: 102,
          sessionExerciseId: 1,
          setNumber: 2,
          reps: payload.reps as number,
          weightKg: payload.weightKg as number,
          bandNominalResistanceKg: null,
          rir: null,
          comment: null,
          completedAt: "2026-09-10T16:30:00.000Z",
          createdAt: "2026-09-10T16:30:00.000Z",
          updatedAt: "2026-09-10T16:30:00.000Z",
          loadAccountingOverride: null,
        };
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: [...exercise.sets, created] }
            : exercise),
        };
        return Response.json({ set: created }, { status: 201 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionEditClient sessionId={88} />);
    await screen.findByRole("button", { name: "Check status" });
    await user.click(screen.getByRole("button", { name: "Check status" }));
    const createAgain = await screen.findByRole("button", { name: "Create again" });
    expect(operationIds).toEqual([oldOperationId]);
    expect(draftOperations.get(oldOperationId)).toMatchObject({ terminalReason: "not-committed" });

    await user.click(createAgain);
    expect(await screen.findByTestId("logged-set-102")).toBeTruthy();
    expect(operationIds).toHaveLength(2);
    expect(operationIds[1]).not.toBe(oldOperationId);
  });

  it("retains an ambiguous create across reload and reconciles it without a second POST", async () => {
    const user = userEvent.setup();
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    let operationStatusReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/v1/training/set-create-operations/")) {
        operationStatusReads += 1;
        if (operationStatusReads === 1) return Response.json({ error: "temporary operation read outage" }, { status: 503 });
      }
      const operationStatus = operationStatusResponse(url, persisted);
      if (operationStatus) return operationStatus;
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session: persisted });
      if (url === "/api/v1/training/sessions/88/exercises/1/sets" && init?.method === "POST") {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const created = {
          id: 10,
          sessionExerciseId: 1,
          setNumber: payload.setNumber as number,
          reps: payload.reps as number,
          weightKg: payload.weightKg as number,
          bandNominalResistanceKg: null,
          rir: payload.rir as number | null,
          comment: payload.comment as string | null,
          completedAt: "2026-09-10T16:30:00.000Z",
          createdAt: "2026-09-10T16:30:00.000Z",
          updatedAt: "2026-09-10T16:30:00.000Z",
          loadAccountingOverride: null,
        };
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: [...exercise.sets, created] }
            : exercise),
        };
        throw new Error("connection lost after commit");
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstMount = render(<SessionEditClient sessionId={88} />);
    await screen.findByTestId("active-exercise-pane");
    const pane = activePane();
    await user.clear(await pane.findByLabelText("Weight, kg"));
    await user.type(pane.getByLabelText("Weight, kg"), "25");
    await user.type(pane.getByLabelText("Reps"), "8");
    await user.click(pane.getByRole("button", { name: "Add set" }));
    await screen.findByRole("button", { name: "Check status" });
    expect(draftOperations.size).toBeGreaterThan(0);
    firstMount.unmount();

    render(<SessionEditClient sessionId={88} />);
    const checkStatus = await screen.findByRole("button", { name: "Check status" });
    await user.click(checkStatus);

    expect(await screen.findByTestId("logged-set-10")).toBeTruthy();
    expect(persisted.exercises[0]?.sets).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(draftOperations.size).toBe(0);
  });

  it("confirms current completed-session deletion after a 75 percent viewport-width swipe", async () => {
    setViewportWidth(360);
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88") return Response.json({ session: makeSession() });
      if (init?.method === "DELETE") return Response.json({ error: "unexpected DELETE" }, { status: 500 });
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);
    const row = await screen.findByTestId("logged-set-9");
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ width: 360 } as DOMRect);

    fireEvent.pointerDown(row, { pointerId: 1, pointerType: "touch", clientX: 350, clientY: 10 });
    fireEvent.pointerMove(row, { pointerId: 1, pointerType: "touch", clientX: 81, clientY: 10 });
    expect(row.getAttribute("data-delete-intent")).toBeNull();
    fireEvent.pointerUp(row, { pointerId: 1, pointerType: "touch", clientX: 81, clientY: 10 });
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.pointerDown(row, { pointerId: 2, pointerType: "touch", clientX: 350, clientY: 10 });
    fireEvent.pointerMove(row, { pointerId: 2, pointerType: "touch", clientX: 80, clientY: 10 });
    expect(row.getAttribute("data-delete-intent")).toBe("true");
    fireEvent.pointerUp(row, { pointerId: 2, pointerType: "touch", clientX: 80, clientY: 10 });
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    await user.click(within(row).getByRole("button", { name: "Delete set 1" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(screen.getByTestId("logged-set-9")).toBeTruthy();
  });

  it("removes a deleted completed-session set immediately without a model notice", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session: persisted });
      if (url === "/api/v1/training/sessions/88/sets/9" && init?.method === "DELETE") {
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: exercise.sets.filter((set) => set.id !== 9) }
            : exercise),
        };
        return Response.json({ deleted: true, modelPublicationStatus: "stale" });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);
    const row = await screen.findByTestId("logged-set-9");

    await user.click(within(row).getByRole("button", { name: "Delete set 1" }));

    await waitFor(() => expect(screen.queryByTestId("logged-set-9")).toBeNull());
    expect(screen.getByText("Set deleted.").getAttribute("role")).toBe("status");
    expect(screen.queryByText(/model publication|energy|glycogen|unified recalculation/i)).toBeNull();
    expect(persisted.exercises[0]?.sets).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88/sets/9" && init?.method === "DELETE"
    ))).toHaveLength(1);
  });

  it("reconciles a committed completed-session delete after a stale-fence response", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    let persisted = structuredClone(makeSession()) as StrengthSessionDto;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs") return Response.json({ programs: [] });
      if (url.includes("/history")) return Response.json({ entries: [] });
      if (url === "/api/v1/training/sessions/88" && !init?.method) return Response.json({ session: persisted });
      if (url === "/api/v1/training/sessions/88/sets/9" && init?.method === "DELETE") {
        persisted = {
          ...persisted,
          exercises: persisted.exercises.map((exercise) => exercise.id === 1
            ? { ...exercise, sets: exercise.sets.filter((set) => set.id !== 9) }
            : exercise),
        };
        return Response.json({ error: "strength_energy_source_stale", modelPublicationStatus: "stale" }, { status: 409 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionEditClient sessionId={88} />);
    const row = await screen.findByTestId("logged-set-9");

    await user.click(within(row).getByRole("button", { name: "Delete set 1" }));

    await waitFor(() => expect(screen.queryByTestId("logged-set-9")).toBeNull());
    expect(screen.getByText("Set deleted.").getAttribute("role")).toBe("status");
    expect(persisted.exercises[0]?.sets).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === "/api/v1/training/sessions/88/sets/9" && init?.method === "DELETE"
    ))).toHaveLength(1);
  });

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

    await user.click(activePane().getAllByRole("button", { name: /Edit set/i })[0]!);
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
    const loggedSet = await screen.findByTestId("logged-set-91");
    await user.click(within(loggedSet).getByRole("button", { name: "Edit set 1" }));
    const loadInput = activePane().getByLabelText("Additional load, kg (optional)");
    expect((loadInput as HTMLInputElement).value).toBe("2");
    await user.clear(loadInput);
    await user.type(loadInput, "15");
    await user.click(within(loggedSet).getByRole("button", { name: "Update set" }));

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

    await user.click(activePane().getAllByRole("button", { name: "Edit set 1" })[0]!);
    const clearInput = activePane().getByLabelText("Additional load, kg (optional)");
    expect((clearInput as HTMLInputElement).value).toBe("15");
    await user.clear(clearInput);
    await user.click(within(loggedSet).getByRole("button", { name: "Update set" }));
    await waitFor(() => expect(patchBody).toMatchObject({
      loadAccountingOverride: {
        reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
        equipmentSetupId: "rings",
      },
    }));
    await waitFor(() => expect(activePane().getByText(/bodyweight × 10/)).toBeTruthy());
    expect(patchBody).toMatchObject({
      loadAccountingOverride: {
        reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
        equipmentSetupId: "rings",
      },
    });

    await user.click(activePane().getAllByRole("button", { name: "Edit set 1" })[0]!);
    const oversizedInput = activePane().getByLabelText("Additional load, kg (optional)");
    await user.clear(oversizedInput);
    await user.type(oversizedInput, "1e308");
    await user.click(within(loggedSet).getByRole("button", { name: "Update set" }));
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
      await user.click((await screen.findAllByRole("button", { name: /Edit set/i }))[0]!);
      if (field === "rir") {
        const load = activePane().getByLabelText("Additional load, kg (optional)");
        await user.type(load, "0");
        await user.click(activePane().getByRole("button", { name: "Cancel" }));
        await user.click(activePane().getAllByRole("button", { name: /Edit set/i })[0]!);
        await user.clear(activePane().getByLabelText("RIR"));
        await user.type(activePane().getByLabelText("RIR"), "3");
      } else {
        await user.clear(activePane().getByLabelText("Comment"));
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

      await user.click(activePane().getAllByRole("button", { name: "Edit set 1" })[0]!);
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

    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
    expect(document.activeElement).toBe(within(historySet).getByLabelText("Reps"));
    expect(historySet.getAttribute("data-editing")).toBe("true");
    expect(historySet.querySelector("[class*='workoutHistorySwipeSurface']")?.getAttribute("style")).toContain("translateX(0px)");
    await user.click(within(historySet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(within(historySet).getByRole("button", { name: "Edit set 1" })));
    expect(historySet.getAttribute("data-open")).toBe("true");
    expect(historySet.querySelector("[class*='workoutHistorySwipeSurface']")?.getAttribute("style")).toContain("translateX(-104px)");
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());

    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
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

    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
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
    expect(screen.getByText("Set saved.").getAttribute("role")).toBe("status");
  });

  it("does not expose a skipped historical publication status", async () => {
    const user = userEvent.setup();
    stubFetch(makeSession(), { publicationStatus: "not-run" });
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
    await user.clear(within(historySet).getByLabelText("Comment"));
    await user.type(within(historySet).getByLabelText("Comment"), "updated note");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Set saved.")).toBeTruthy();
    expect(screen.queryByText(/model publication|currentness/i)).toBeNull();
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

    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
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

    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
    await user.clear(within(historySet).getByLabelText("Additional load, kg (optional)"));
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(historySet).getByText(/bodyweight/)).toBeTruthy());
    patchBody = JSON.parse(String(patchCalls().at(-1)?.[1]?.body)) as Record<string, unknown>;
    expect(patchBody.loadAccountingOverride).toEqual({
      reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
      equipmentSetupId: "rings",
    });
    expect(within(historySet).queryByText(/\+0(?:\.0+)? kg/)).toBeNull();

    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
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
    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
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
    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
    const load = within(historySet).getByLabelText("Additional load, kg (optional)");
    expect((load as HTMLInputElement).value).toBe("");
    await user.type(load, "0");
    await user.click(within(historySet).getByRole("button", { name: "Cancel" }));
    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
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
    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
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
      await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
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

    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
    await user.clear(within(historySet).getByLabelText("Reps"));
    await user.type(within(historySet).getByLabelText("Reps"), "11");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(historySet).getByText(/28 kg × 11/)).toBeTruthy());
    expect(screen.getByText("Set saved.").getAttribute("role")).toBe("status");
    expect(within(historySet).queryByRole("alert")).toBeNull();
  });

  it("reconciles a committed historical load edit at the database decimal precision", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    stubFetch(makeSession(), { mutationErrorStatus: 500 });
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
    await user.clear(within(historySet).getByLabelText("Weight, kg"));
    await user.type(within(historySet).getByLabelText("Weight, kg"), "28.126");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(historySet).getByText(/28\.13 kg/)).toBeTruthy());
    expect(screen.getByText("Set saved.").getAttribute("role")).toBe("status");
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => (
      url === "/api/v1/training/sessions/40/sets/71" && init?.method === undefined
    ))).toBe(true);
  });

  it("reconciles a malformed 2xx historical PATCH from the authoritative set GET", async () => {
    const user = userEvent.setup();
    stubFetch(makeSession(), { malformedSuccess: "patch" });
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Edit set 1" }));
    await user.clear(within(historySet).getByLabelText("Reps"));
    await user.type(within(historySet).getByLabelText("Reps"), "11");
    await user.click(within(historySet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(historySet).getByText(/28 kg × 11/)).toBeTruthy());
    expect(screen.getByText("Set saved.").getAttribute("role")).toBe("status");
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => (
      url === "/api/v1/training/sessions/40/sets/71" && init?.method === undefined
    ))).toBe(true);
  });

  it("reveals explicit history actions on a short left swipe", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    stubFetch();
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    fireEvent.pointerDown(historySet, { pointerId: 1, pointerType: "touch", clientX: 220, clientY: 20 });
    fireEvent.pointerMove(historySet, { pointerId: 1, pointerType: "touch", clientX: 140, clientY: 20 });
    expect(historySet.querySelector("[class*='workoutHistorySwipeSurface']")?.getAttribute("style")).toContain("translateX(-80px)");
    fireEvent.pointerUp(historySet, { pointerId: 1, pointerType: "touch", clientX: 140, clientY: 20 });

    expect(within(historySet).getByRole("button", { name: "Edit set 1" })).toBeTruthy();
    expect(within(historySet).getByRole("button", { name: "Delete set 1" })).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    fireEvent.pointerDown(historySet, { pointerId: 4, pointerType: "touch", clientX: 140, clientY: 20 });
    fireEvent.pointerMove(historySet, { pointerId: 4, pointerType: "touch", clientX: 130, clientY: 20 });
    expect(historySet.hasAttribute("data-delete-intent")).toBe(false);
    fireEvent.pointerUp(historySet, { pointerId: 4, pointerType: "touch", clientX: 130, clientY: 20 });
    expect(confirm).not.toHaveBeenCalled();
    expect(historySet.getAttribute("data-open")).toBe("true");

    await new Promise((resolve) => setTimeout(resolve, 140));
    fireEvent.click(within(historySet).getByRole("button", { name: "Use values from set 1" }));
    expect(historySet.hasAttribute("data-open")).toBe(false);
    expect(screen.queryByText("Fields filled — add the set when ready.")).toBeNull();
    fireEvent.click(within(historySet).getByRole("button", { name: "Use values from set 1" }));
    expect(screen.getByText("Fields filled — add the set when ready.").getAttribute("role")).toBe("status");
  });

  it("asks before deleting after a 75% viewport-width history swipe", async () => {
    setViewportWidth(360);
    stubFetch();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");
    vi.spyOn(historySet, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 360, height: 48, top: 0, right: 360, bottom: 48, left: 0, toJSON: () => ({}),
    });

    fireEvent.pointerDown(historySet, { pointerId: 2, pointerType: "touch", clientX: 350, clientY: 20 });
    fireEvent.pointerMove(historySet, { pointerId: 2, pointerType: "touch", clientX: 81, clientY: 20 });
    expect(historySet.hasAttribute("data-delete-intent")).toBe(false);
    fireEvent.pointerUp(historySet, { pointerId: 2, pointerType: "touch", clientX: 81, clientY: 20 });
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.pointerDown(historySet, { pointerId: 3, pointerType: "touch", clientX: 350, clientY: 20 });
    fireEvent.pointerMove(historySet, { pointerId: 3, pointerType: "touch", clientX: 80, clientY: 20 });
    expect(historySet.getAttribute("data-delete-intent")).toBe("true");
    fireEvent.pointerUp(historySet, { pointerId: 3, pointerType: "touch", clientX: 80, clientY: 20 });

    expect(confirm).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(within(activePane().getByRole("region", { name: "Exercise history" })).getByTestId("history-set-40-71")).toBeTruthy();
  });

  it("keeps completed-history vertical scrolling and pointer cancellation from deleting", async () => {
    stubFetch();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<SessionEditClient sessionId={88} />);
    await screen.findByTestId("active-exercise-pane");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    fireEvent.pointerDown(historySet, { pointerId: 20, pointerType: "touch", clientX: 180, clientY: 10 });
    fireEvent.pointerMove(historySet, { pointerId: 20, pointerType: "touch", clientX: 175, clientY: 80 });
    fireEvent.pointerUp(historySet, { pointerId: 20, pointerType: "touch", clientX: 174, clientY: 95 });
    expect(historySet.hasAttribute("data-open")).toBe(false);

    fireEvent.pointerDown(historySet, { pointerId: 21, pointerType: "touch", clientX: 180, clientY: 10 });
    fireEvent.pointerMove(historySet, { pointerId: 21, pointerType: "touch", clientX: 100, clientY: 10 });
    fireEvent.pointerCancel(historySet, { pointerId: 21, pointerType: "touch" });
    expect(historySet.hasAttribute("data-open")).toBe(false);
    expect(historySet.hasAttribute("data-dragging")).toBe(false);
    expect(historySet.hasAttribute("data-delete-intent")).toBe(false);
    expect(historySet.querySelector("[class*='workoutHistorySwipeSurface']")?.getAttribute("style")).toContain("translateX(0px)");
    expect(confirm).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("does not make a near-left short swipe a delete gesture", async () => {
    stubFetch();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<SessionEditClient sessionId={88} />);
    await screen.findByTestId("active-exercise-pane");
    const historySet = await within(activePane().getByRole("region", { name: "Exercise history" })).findByTestId("history-set-40-71");

    fireEvent.pointerDown(historySet, { pointerId: 22, pointerType: "touch", clientX: 30, clientY: 10 });
    fireEvent.pointerMove(historySet, { pointerId: 22, pointerType: "touch", clientX: 0, clientY: 10 });
    expect(historySet.hasAttribute("data-delete-intent")).toBe(false);
    fireEvent.pointerUp(historySet, { pointerId: 22, pointerType: "touch", clientX: 0, clientY: 10 });
    expect(confirm).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("reconciles a committed historical delete when dependent publication returns an error", async () => {
    const user = userEvent.setup();
    stubFetch(makeSession(), { mutationErrorStatus: 500 });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historyRegion = activePane().getByRole("region", { name: "Exercise history" });
    const historySet = await within(historyRegion).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Delete set 1" }));

    await waitFor(() => expect(within(historyRegion).queryByTestId("history-set-40-71")).toBeNull());
    expect(screen.getByText("The set is absent; the current history is shown.").getAttribute("role")).toBe("status");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => (
      url === "/api/v1/training/sessions/40/sets/71" && init?.method === undefined
    ))).toBe(true);
  });

  it("shows the ordinary delete result after a committed historical delete error", async () => {
    for (const status of ["stale", "not-run"] as const) {
      cleanup();
      const user = userEvent.setup();
      stubFetch(makeSession(), { mutationErrorStatus: 500, mutationErrorPublicationStatus: status });
      vi.stubGlobal("confirm", vi.fn(() => true));
      render(<SessionEditClient sessionId={88} />);
      await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
      const historyRegion = activePane().getByRole("region", { name: "Exercise history" });
      const historySet = await within(historyRegion).findByTestId("history-set-40-71");

      await user.click(within(historySet).getByRole("button", { name: "Delete set 1" }));

      await waitFor(() => expect(within(historyRegion).queryByTestId("history-set-40-71")).toBeNull());
      expect(screen.getByText("The set is absent; the current history is shown.").getAttribute("role")).toBe("status");
    }
  });

  it("reconciles a malformed 2xx historical DELETE from the authoritative 404", async () => {
    const user = userEvent.setup();
    stubFetch(makeSession(), { malformedSuccess: "delete" });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<SessionEditClient sessionId={88} />);
    await screen.findByText("Жим гантелей на похилій лаві вгору (30°)");
    const historyRegion = activePane().getByRole("region", { name: "Exercise history" });
    const historySet = await within(historyRegion).findByTestId("history-set-40-71");

    await user.click(within(historySet).getByRole("button", { name: "Delete set 1" }));

    await waitFor(() => expect(within(historyRegion).queryByTestId("history-set-40-71")).toBeNull());
    expect(screen.getByText("Set deleted.").getAttribute("role")).toBe("status");
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

    await user.click(within(historySet).getByRole("button", { name: "Delete set 1" }));

    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(within(activePane().getByRole("region", { name: "Exercise history" })).queryByTestId("history-set-40-71")).toBeNull());
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/training/sessions/40/sets/71",
      expect.objectContaining({ method: "DELETE" }),
    );
    const announcement = screen.getByText("Set deleted.");
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
