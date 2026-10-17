/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildStepperWorkoutDiagnosticV7 } from "@/modules/profile/stepper-workout-diagnostic";

const stepperOperationStore = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue([]),
  store: vi.fn().mockResolvedValue(undefined),
  markTombstoned: vi.fn().mockResolvedValue(null),
  markRejected: vi.fn().mockResolvedValue(null),
  replace: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/app/training/set-create-operation-store", () => ({
  listStepperCreateOperations: (...args: unknown[]) => stepperOperationStore.list(...args),
  markStepperCreateOperationTombstoned: (...args: unknown[]) => stepperOperationStore.markTombstoned(...args),
  markStepperCreateOperationRejected: (...args: unknown[]) => stepperOperationStore.markRejected(...args),
  replaceStepperCreateOperation: (...args: unknown[]) => stepperOperationStore.replace(...args),
  storeStepperCreateOperation: (...args: unknown[]) => stepperOperationStore.store(...args),
  removeStepperCreateOperation: (...args: unknown[]) => stepperOperationStore.remove(...args),
}));

vi.mock("@/i18n/i18n-provider", () => ({ useI18n: () => ({ locale: "uk", intlLocale: "uk-UA" }) }));
vi.mock("@/components/app-nav", () => ({ AppNav: () => <nav aria-label="App navigation">BodyCast nav</nav> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { StepperDiagnosticClient } from "@/app/training/workouts/[id]/stepper-diagnostic/stepper-diagnostic-client";
import { TrainingClient } from "@/app/training/training-client";

const startAt = "2042-03-15T08:00:00.000Z";
const endAt = "2042-03-15T08:20:00.000Z";

function completeDiagnostic(sampleCount = 2) {
  const samples = Array.from({ length: sampleCount }, (_, index) => ({
    timestamp: new Date(Date.parse(startAt) + (index + 1) * 5_000).toISOString(),
    bpm: 100 + index,
    provenance: { provider: "Apple Health", device: "Watch" },
  }));
  return buildStepperWorkoutDiagnosticV7({
    workout: { id: 61, type: "Stair Climbing", startAt, endAt, durationMinutes: 20, activeEnergyKcal: 154 },
    bodyMassKg: 80,
    snapshots: [
      { id: 9, receivedAt: "2042-03-15T07:59:50.000Z", syncedAt: "2042-03-15T07:59:52.000Z", steps: 1000 },
      { id: 10, receivedAt: "2042-03-15T08:20:10.000Z", syncedAt: null, steps: 1300 },
    ],
    heartRateSamples: samples,
  })!;
}

const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  vi.stubGlobal("crypto", {
    subtle: webcrypto.subtle,
    randomUUID: webcrypto.randomUUID.bind(webcrypto),
  } as unknown as Crypto);
  stepperOperationStore.list.mockResolvedValue([]);
  stepperOperationStore.store.mockResolvedValue(undefined);
  stepperOperationStore.markTombstoned.mockResolvedValue(null);
  stepperOperationStore.markRejected.mockResolvedValue(null);
  stepperOperationStore.replace.mockResolvedValue(undefined);
  stepperOperationStore.remove.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  stepperOperationStore.list.mockClear().mockResolvedValue([]);
  stepperOperationStore.store.mockClear().mockResolvedValue(undefined);
  stepperOperationStore.markTombstoned.mockClear().mockResolvedValue(null);
  stepperOperationStore.markRejected.mockClear().mockResolvedValue(null);
  stepperOperationStore.replace.mockClear().mockResolvedValue(undefined);
  stepperOperationStore.remove.mockClear().mockResolvedValue(undefined);
});

describe("StepperDiagnosticClient", () => {
  it("presents the complete observed diagnostic contract and history navigation", async () => {
    const diagnostic = completeDiagnostic();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ diagnostic })));
    render(<StepperDiagnosticClient workoutId="61" />);

    expect(await screen.findByText("Степер")).toBeTruthy();
    expect(screen.getByText(/DOMYOS MS100 · фіксована конфігурація/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Активна енергія" })).toBeTruthy();
    expect(screen.getByText("Механічна оцінка BodyCast (не Garmin)")).toBeTruthy();
    expect(screen.getByText("Використано в розрахунку · активні ккал")).toBeTruthy();
    expect(screen.getByText("Оцінка пристрою · активні ккал")).toBeTruthy();
    expect(screen.getByText(/bodycast-stepper-mechanical в історії/)).toBeTruthy();
    expect(screen.queryByText("Workout ID")).toBeNull();
    expect(screen.queryByText("Summary basis")).toBeNull();
    expect(screen.getByText(/DOMYOS MS100/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Історія" }).getAttribute("href")).toBe("/history");
    expect(screen.getByRole("link", { name: "← Назад до тренувань" }).getAttribute("href")).toBe("/training");
    expect(document.querySelector("main")?.className).toContain("page");
  });

  it("shows the HR-aware result and its replacement impact when calibration passes", async () => {
    const samples = [
      { timestamp: "2042-03-15T08:00:05.000Z", bpm: 100, provenance: { provider: "Apple Health", device: "Watch" } },
      { timestamp: "2042-03-15T08:00:10.000Z", bpm: 101, provenance: { provider: "Apple Health", device: "Watch" } },
    ];
    const diagnostic = buildStepperWorkoutDiagnosticV7({
      workout: { id: 61, type: "Stair Climbing", startAt, endAt, durationMinutes: 20, activeEnergyKcal: 154 },
      bodyMassKg: 80,
      snapshots: [
        { id: 9, receivedAt: "2042-03-15T07:59:50.000Z", syncedAt: "2042-03-15T07:59:52.000Z", steps: 1_000 },
        { id: 10, receivedAt: "2042-03-15T08:20:10.000Z", syncedAt: null, steps: 1_300 },
      ],
      heartRateSamples: samples,
      heartRateCalibration: {
        contractVersion: "bodycast-ms100-hr-vo2-calibration-v1",
        validation: { status: "independent-holdout-validated", referenceMethod: "indirect-calorimetry", heldOutWorkoutCount: 1 },
        equipment: { machineFamily: "DOMYOS_MS100", configuration: "fixed" },
        heartRateSource: { provider: "Apple Health", device: "Watch" },
        effectiveFrom: "2042-01-01T00:00:00.000Z",
        effectiveUntil: null,
        model: {
          vo2InterceptMlKgMin: 0,
          vo2SlopeMlKgMinPerBpm: 0.2,
          restingVo2MlKgMin: 3.5,
          acceptedHeartRateBpm: { min: 90, max: 110 },
          acceptedStepRatePerMinute: { min: 0, max: 20 },
          acceptedDurationMinutes: { min: 1, max: 30 },
          maximumInterSampleGapSeconds: 10,
          maximumEdgeGapSeconds: 1_200,
        },
      },
    })!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ diagnostic })));
    render(<StepperDiagnosticClient workoutId="61" />);

    expect(await screen.findByText("Оцінка BodyCast (HR-калібрування MS100)")).toBeTruthy();
    expect(screen.getByText(/Default v7 diagnostic|Діагностика default v7/)).toBeTruthy();
    expect(screen.queryByText("Вплив пульсу на результат")).toBeNull();
  });

  it("renders unavailable interval steps, null values, unavailable energy, and loaded HR with no samples", async () => {
    const diagnostic = buildStepperWorkoutDiagnosticV7({
      workout: { id: 61, type: "Stair Climbing", startAt, endAt, durationMinutes: 20, activeEnergyKcal: null },
      bodyMassKg: 80,
      snapshots: [],
      stepIntervals: [],
      heartRateSamples: [],
    })!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ diagnostic })));
    render(<StepperDiagnosticClient workoutId="61" />);

    expect(await screen.findByText("Немає інтервалів кроків у межах тренування")).toBeTruthy();
    expect(screen.queryByText(/Немає знімка кроків/)).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Проміжки між зразками/)).toBeNull();
    expect(screen.getByText("Завантажено")).toBeTruthy();
  });

  it("shows HR-unavailable state and a null sampling topology", async () => {
    const diagnostic = {
      ...completeDiagnostic(0),
      heartRate: { availability: "unavailable" as const, summary: null, samplingTopology: null },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ diagnostic })));
    render(<StepperDiagnosticClient workoutId="61" />);

    expect(await screen.findByText("Топологія зразків недоступна.")).toBeTruthy();
    expect(screen.getByText(/DOMYOS MS100 · фіксована конфігурація/)).toBeTruthy();
  });

  it("does not expose HR sampling gaps in the user view", async () => {
    const base = completeDiagnostic(126);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ diagnostic: base })));
    render(<StepperDiagnosticClient workoutId="61" />);

    await screen.findByText("Максимум серед зразків · bpm");
    expect(screen.queryByText(/Проміжки між зразками/)).toBeNull();
    expect(screen.queryByText(/Leading gap|Trailing gap/)).toBeNull();
  });
});

describe("stepper section in Training", () => {
  it("releases Stepper controls after a delete request times out", async () => {
    const row = { id: 70, type: "Stair Climbing", startAt, endAt, durationMinutes: 20, activeEnergyKcal: 155, source: "health" as const, syncProtected: false, editable: true };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/v1/training/stepper-workouts") && method === "GET") return response({ workouts: [row] });
      if (url.endsWith("/api/v1/training/stepper-workouts/70") && method === "DELETE") return new Promise<Response>(() => undefined);
      if (url.includes("/api/v1/training/sessions/active")) return response({ session: null });
      if (url.includes("/api/v1/training/programs")) return response({ programs: [] });
      if (url.includes("/api/v1/training/sessions/recent") || url.includes("/api/v1/training/sessions/match-attention")) return response({ sessions: [] });
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TrainingClient />);
    await screen.findByText("Apple Health");
    const add = screen.getByRole("button", { name: "Додати степер" });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getAllByRole("button", { name: "Видалити" })[0]!);
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(screen.getByText("Не вдалося видалити тренування.")).toBeTruthy();
      expect(add).toHaveProperty("disabled", false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows editing and deleting an Apple Health stepper workout", async () => {
    const user = userEvent.setup();
    const row = { id: 70, type: "Stair Climbing", startAt, endAt, durationMinutes: 20, activeEnergyKcal: 155, source: "health" as const, syncProtected: false, editable: true };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/v1/training/stepper-workouts") && method === "GET") return response({ workouts: [row] });
      if (url.endsWith("/api/v1/training/stepper-workouts/70") && method === "PUT") return response({ workout: { ...row, syncProtected: true } });
      if (url.endsWith("/api/v1/training/stepper-workouts/70") && method === "DELETE") return response(null, 204);
      if (url.includes("/api/v1/training/sessions/active")) return response({ session: null });
      if (url.includes("/api/v1/training/programs")) return response({ programs: [] });
      if (url.includes("/api/v1/training/sessions/recent")) return response({ sessions: [] });
      if (url.includes("/api/v1/training/sessions/match-attention")) return response({ sessions: [] });
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TrainingClient />);

    await screen.findByText("Apple Health");
    await user.click(screen.getByRole("button", { name: "Редагувати" }));
    await user.clear(screen.getByRole("spinbutton", { name: "Тривалість степера" }));
    await user.type(screen.getByRole("spinbutton", { name: "Тривалість степера" }), "25");
    await user.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/stepper-workouts/70"), expect.objectContaining({ method: "PUT" })));
    await user.click(screen.getByRole("button", { name: "Редагувати" }));
    await user.click(screen.getAllByRole("button", { name: "Видалити" })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/stepper-workouts/70"), expect.objectContaining({ method: "DELETE" })));
  });

  it("creates, updates, and deletes stepper sessions from manual and Health sources", async () => {
    const user = userEvent.setup();
    let rows = [
      { id: 50, type: "Stair Climbing", startAt, endAt, durationMinutes: 20, activeEnergyKcal: null, source: "manual" as const, syncProtected: false, editable: true },
      { id: 49, type: "Stair Climbing", startAt: "2042-03-15T07:00:00.000Z", endAt: "2042-03-15T07:10:00.000Z", durationMinutes: 10, activeEnergyKcal: 44, source: "health" as const, syncProtected: false, editable: true },
    ];
    let operationStatusReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/api/v1/training/stepper-create-operations/") && method === "GET") {
        operationStatusReads += 1;
        return operationStatusReads === 1
          ? response({ state: "NOT_FOUND" }, 404)
          : response({ state: "COMMITTED", workout: rows[0] });
      }
      if (url.startsWith("/api/v1/training/stepper-workouts") && method === "GET") return response({ workouts: rows });
      if (url.endsWith("/api/v1/training/stepper-workouts") && method === "POST") {
        const value = JSON.parse(String(init?.body)) as { startAt: string; durationMinutes: number };
        const created = { id: 51, type: "Stair Climbing", ...value, endAt: new Date(Date.parse(value.startAt) + value.durationMinutes * 60_000).toISOString(), activeEnergyKcal: null, source: "manual" as const, syncProtected: false, editable: true };
        rows = [created, ...rows];
        throw new TypeError("synthetic lost HTTP response after durable commit");
      }
      if (url.includes("/api/v1/training/stepper-workouts/") && method === "PUT") {
        const value = JSON.parse(String(init?.body)) as { startAt: string; durationMinutes: number };
        rows = rows.map((row) => row.id === 51 ? { ...row, ...value, endAt: new Date(Date.parse(value.startAt) + value.durationMinutes * 60_000).toISOString() } : row);
        return response({ workout: rows.find((row) => row.id === 51) });
      }
      if (url.includes("/api/v1/training/stepper-workouts/") && method === "DELETE") {
        rows = rows.filter((row) => row.id !== 51);
        return response(null, 204);
      }
      if (url.includes("/api/v1/training/sessions/active")) return response({ session: null });
      if (url.includes("/api/v1/training/programs")) return response({ programs: [] });
      if (url.includes("/api/v1/training/sessions/recent")) return response({ sessions: [] });
      if (url.includes("/api/v1/training/sessions/match-attention")) return response({ sessions: [] });
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TrainingClient />);

    await screen.findByText("Ручний запис");
    expect(screen.getByText("Apple Health")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Додати степер" }));
    await user.clear(screen.getByLabelText("Дата й час степера"));
    await user.type(screen.getByLabelText("Дата й час степера"), "2042-03-15T10:00");
    await user.clear(screen.getByRole("spinbutton", { name: "Тривалість степера" }));
    await user.type(screen.getByRole("spinbutton", { name: "Тривалість степера" }), "30");
    await user.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(rows).toHaveLength(3));
    await waitFor(() => expect(screen.getAllByText("Степер")).toHaveLength(3));
    const storedOperation = stepperOperationStore.store.mock.calls[0]?.[0] as { operationId: string; payload: unknown } | undefined;
    expect(storedOperation?.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/stepper-create-operations/${storedOperation?.operationId}`),
      expect.objectContaining({ cache: "no-store" }),
    );
    const createRequest = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/stepper-workouts") && init?.method === "POST");
    expect(new Headers(createRequest?.[1]?.headers).get("Idempotency-Key")).toBe(storedOperation?.operationId);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/stepper-workouts") && init?.method === "POST")).toHaveLength(1);
    expect(operationStatusReads).toBe(2);
    expect(stepperOperationStore.remove).toHaveBeenCalledWith(storedOperation?.operationId);

    await user.click(screen.getAllByRole("button", { name: "Редагувати" })[0]!);
    const duration = screen.getByRole("spinbutton", { name: "Тривалість степера" });
    await user.clear(duration);
    await user.type(duration, "35");
    await user.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(rows.find((row) => row.id === 51)?.durationMinutes).toBe(35));

    await user.click(screen.getAllByRole("button", { name: "Редагувати" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Видалити" })[0]!);
    await waitFor(() => expect(rows.map((row) => row.id)).toEqual([50, 49]));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/training/stepper-workouts/51"), expect.objectContaining({ method: "DELETE" }));
  });

  it("bounds an ambiguous create request and retries only with the retained operation key", async () => {
    const user = userEvent.setup();
    const operationId = "b12d7a23-f87f-46bc-a713-316ab4da5638";
    const committed = { id: 92, type: "Stair Climbing", startAt, endAt, durationMinutes: 20, activeEnergyKcal: null, source: "manual" as const, syncProtected: false, editable: true };
    let statusReads = 0;
    let postRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/stepper-create-operations/") && method === "GET") {
        statusReads += 1;
        if (statusReads === 1) return Promise.resolve(response({ state: "NOT_FOUND" }, 404));
        if (statusReads === 2) return Promise.resolve(response({ state: "NOT_FOUND" }, 404));
        return Promise.resolve(response({ state: "COMMITTED", workout: committed }));
      }
      if (url.endsWith("/stepper-workouts") && method === "POST") {
        postRequests += 1;
        return new Promise<Response>(() => undefined);
      }
      if (url.startsWith("/api/v1/training/stepper-workouts")) return Promise.resolve(response({ workouts: [] }));
      if (url.includes("/api/v1/training/sessions/active")) return Promise.resolve(response({ session: null }));
      if (url.includes("/api/v1/training/programs")) return Promise.resolve(response({ programs: [] }));
      if (url.includes("/api/v1/training/sessions/recent") || url.includes("/api/v1/training/sessions/match-attention")) return Promise.resolve(response({ sessions: [] }));
      return Promise.reject(new Error(`Unexpected fetch ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
    render(<TrainingClient />);

    const add = await screen.findByRole("button", { name: "Додати степер" });
    await user.click(add);
    await user.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(screen.getByText(/Результат запису не підтверджений/)).toBeTruthy(), { timeout: 20_000 });
    const retry = screen.getByRole("button", { name: "Перевірити / повторити запис" });
    expect(retry).toHaveProperty("disabled", false);
    expect(screen.getByText(/Результат запису не підтверджений/)).toBeTruthy();
    expect(stepperOperationStore.store).toHaveBeenCalledWith(expect.objectContaining({ operationId }));
    expect(postRequests).toBe(1);

    await user.click(retry);
    await waitFor(() => expect(stepperOperationStore.remove).toHaveBeenCalledWith(operationId));
    expect(statusReads).toBe(3);
    expect(postRequests).toBe(1);
  }, 45_000);

  it("archives a definitive pre-write 400 and requires an explicit fresh intent", async () => {
    const user = userEvent.setup();
    const rejectedId = "b12d7a23-f87f-46bc-a713-316ab4da5638";
    const freshId = "e7b9b67a-ffbf-4c60-98b1-8c8532e67d91";
    const archived: Array<Record<string, unknown>> = [];
    stepperOperationStore.list.mockImplementation(async () => archived as never);
    stepperOperationStore.markRejected.mockImplementation(async (operation: Record<string, unknown>) => {
      archived.push({ ...operation, terminalState: "rejected" });
      return archived.at(-1) as never;
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(rejectedId).mockReturnValueOnce(freshId);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/stepper-create-operations/") && method === "GET") return response({ state: "NOT_FOUND" }, 404);
      if (url.endsWith("/stepper-workouts") && method === "POST") return response({ error: "invalid_stepper_payload" }, 400);
      if (url.startsWith("/api/v1/training/stepper-workouts")) return response({ workouts: [] });
      if (url.includes("/api/v1/training/sessions/active")) return response({ session: null });
      if (url.includes("/api/v1/training/programs")) return response({ programs: [] });
      if (url.includes("/api/v1/training/sessions/recent") || url.includes("/api/v1/training/sessions/match-attention")) return response({ sessions: [] });
      return Promise.reject(new Error(`Unexpected fetch ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TrainingClient />);

    await user.click(await screen.findByRole("button", { name: "Додати степер" }));
    await user.click(screen.getByRole("button", { name: "Зберегти" }));
    expect(await screen.findByText(/Сервер відхилив запит до запису/)).toBeTruthy();
    expect(stepperOperationStore.markRejected).toHaveBeenCalledWith(expect.objectContaining({ operationId: rejectedId }));
    expect(screen.getByRole("spinbutton", { name: "Тривалість степера" }).hasAttribute("disabled")).toBe(false);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/stepper-workouts") && init?.method === "POST")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Підтвердити новий намір із чернетки" }));
    await waitFor(() => expect(stepperOperationStore.replace).toHaveBeenCalledWith(rejectedId, expect.objectContaining({ operationId: freshId })));
    expect(screen.getByRole("button", { name: "Перевірити / повторити запис" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/stepper-workouts") && init?.method === "POST")).toHaveLength(1);
  });

  it("restores a committed create after reopening and reconciles it without another POST", async () => {
    const user = userEvent.setup();
    const operationId = "f02c9bd4-26f5-42df-b268-cd3719767f81";
    const payload = {
      startAt: "2042-03-15T09:00:00.000Z",
      durationMinutes: 24,
      manualStepCount: 1800,
      manualActiveEnergyKcal: null,
    };
    const committed = {
      id: 52,
      type: "Stair Climbing",
      startAt: payload.startAt,
      endAt: "2042-03-15T09:24:00.000Z",
      durationMinutes: payload.durationMinutes,
      activeEnergyKcal: null,
      source: "manual" as const,
      syncProtected: false,
      editable: true,
    };
    let rows = [committed];
    stepperOperationStore.list.mockResolvedValue([{ operationId, payload, createdAt: 1 }]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes(`/stepper-create-operations/${operationId}`) && method === "GET") {
        return response({ state: "COMMITTED", workout: committed });
      }
      if (url.includes("/api/v1/training/stepper-workouts") && method === "GET") return response({ workouts: rows });
      if (url.includes("/api/v1/training/sessions/active")) return response({ session: null });
      if (url.includes("/api/v1/training/programs")) return response({ programs: [] });
      if (url.includes("/api/v1/training/sessions/recent")) return response({ sessions: [] });
      if (url.includes("/api/v1/training/sessions/match-attention")) return response({ sessions: [] });
      if (url.endsWith("/stepper-workouts") && method === "POST") {
        rows = [committed, ...rows];
        return response({ operationId, state: "COMMITTED", workout: committed }, 201);
      }
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TrainingClient />);

    expect(await screen.findByText("Ручний запис")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Перевірити / повторити запис" }));
    await waitFor(() => expect(stepperOperationStore.remove).toHaveBeenCalledWith(operationId));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/stepper-workouts") && init?.method === "POST")).toBe(false);
    expect(stepperOperationStore.store).not.toHaveBeenCalled();
  });

  it("keeps a same-key draft unresolved when the ledger reports a different payload", async () => {
    const user = userEvent.setup();
    const operationId = "d41ae7f0-d57e-44f3-b834-956fb3b0e315";
    const operation = {
      operationId,
      payload: {
        startAt: "2042-03-15T09:00:00.000Z",
        durationMinutes: 24,
        manualStepCount: 1800,
        manualActiveEnergyKcal: null,
      },
      createdAt: 1,
    };
    stepperOperationStore.list.mockResolvedValue([operation]);
    const statusUrls: string[] = [];
    let postRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes(`/stepper-create-operations/${operationId}`) && method === "GET") {
        statusUrls.push(url);
        return Promise.resolve(response({ state: "CONFLICT" }, 409));
      }
      if (url.endsWith("/stepper-workouts") && method === "POST") {
        postRequests += 1;
        return Promise.resolve(response({ state: "COMMITTED" }, 201));
      }
      if (url.startsWith("/api/v1/training/stepper-workouts")) return Promise.resolve(response({ workouts: [] }));
      if (url.includes("/api/v1/training/sessions/active")) return Promise.resolve(response({ session: null }));
      if (url.includes("/api/v1/training/programs")) return Promise.resolve(response({ programs: [] }));
      if (url.includes("/api/v1/training/sessions/recent") || url.includes("/api/v1/training/sessions/match-attention")) {
        return Promise.resolve(response({ sessions: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TrainingClient />);

    await user.click(await screen.findByRole("button", { name: "Перевірити / повторити запис" }));
    await waitFor(() => expect(statusUrls.length).toBeGreaterThanOrEqual(2));
    const expectedDigest = createHash("sha256").update(JSON.stringify({
      durationMinutes: 24,
      manualActiveEnergyKcal: null,
      manualStepCount: 1800,
      startAt: operation.payload.startAt,
      version: 1,
    })).digest("hex");
    expect(statusUrls.map((url) => new URL(url, "http://localhost").searchParams.get("payloadDigest")))
      .toEqual([expectedDigest, expectedDigest]);
    expect(await screen.findByText(/Результат запису не підтверджений/)).toBeTruthy();
    expect(stepperOperationStore.remove).not.toHaveBeenCalledWith(operationId);
    expect(stepperOperationStore.list).toHaveBeenCalled();
    expect(postRequests).toBe(0);
  });

  it("archives a tombstone and prevents it from replaying after its fresh replacement commits", async () => {
    const user = userEvent.setup();
    const oldOperation = {
      operationId: "f02c9bd4-26f5-42df-b268-cd3719767f81",
      payload: { startAt: "2042-03-15T09:00:00.000Z", durationMinutes: 24, manualStepCount: 1800, manualActiveEnergyKcal: null },
      createdAt: 1,
    };
    const archived = { ...oldOperation, terminalState: "tombstoned" as const };
    const newOperationId = "a03d7a23-f87f-46bc-a713-316ab4da5638";
    let operations: Array<{ operationId: string; payload: Record<string, unknown>; createdAt: number; terminalState?: "tombstoned"; replacementOperationId?: string }> = [oldOperation];
    stepperOperationStore.list.mockImplementation(async () => operations);
    stepperOperationStore.markTombstoned.mockImplementation(async () => {
      operations = [archived];
      return archived;
    });
    stepperOperationStore.replace.mockImplementation(async (previousId: string, operation: { operationId: string; payload: unknown; createdAt: number }) => {
      expect(previousId).toBe(oldOperation.operationId);
      operations = [{ ...archived, replacementOperationId: operation.operationId }, operation as typeof oldOperation];
    });
    stepperOperationStore.remove.mockImplementation(async (id: string) => {
      operations = operations.filter((operation) => operation.operationId !== id);
    });
    const committed = { id: 88, startAt: oldOperation.payload.startAt, durationMinutes: 24 };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(`/stepper-create-operations/${oldOperation.operationId}`)) return response({ state: "TOMBSTONED" }, 410);
      if (url.includes(`/stepper-create-operations/${newOperationId}`)) return response({ state: "NOT_FOUND" }, 404);
      if (url.endsWith("/stepper-workouts") && init?.method === "POST") return response({ state: "COMMITTED", workout: committed }, 201);
      if (url.startsWith("/api/v1/training/stepper-workouts")) return response({ workouts: [] });
      if (url.includes("/api/v1/training/sessions/active")) return response({ session: null });
      if (url.includes("/api/v1/training/programs")) return response({ programs: [] });
      if (url.includes("/api/v1/training/sessions/recent") || url.includes("/api/v1/training/sessions/match-attention")) return response({ sessions: [] });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(newOperationId);
    render(<TrainingClient />);

    await screen.findByText("Ручний запис").catch(() => undefined);
    await waitFor(() => expect(screen.getByRole("button", { name: "Перевірити / повторити запис" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Перевірити / повторити запис" }));
    await waitFor(() => expect(stepperOperationStore.markTombstoned).toHaveBeenCalledWith(oldOperation));
    expect(screen.getByText(/підтверджені видалені наміри/i)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/stepper-workouts"))).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Підтвердити новий намір із чернетки" }));
    const newOperation = stepperOperationStore.replace.mock.calls[0]?.[1] as { operationId: string } | undefined;
    expect(newOperation?.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(newOperation?.operationId).not.toBe(oldOperation.operationId);
    expect(stepperOperationStore.store).not.toHaveBeenCalled();
    expect(operations).toContainEqual({ ...archived, replacementOperationId: newOperationId });
    expect(screen.getByRole("button", { name: "Перевірити / повторити запис" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Перевірити / повторити запис" }));
    await waitFor(() => expect(stepperOperationStore.remove).toHaveBeenCalledWith(newOperationId));
    expect(operations).toContainEqual({ ...archived, replacementOperationId: newOperationId });
    expect(screen.queryByRole("button", { name: "Підтвердити новий намір із чернетки" })).toBeNull();
    expect(screen.queryByText(/підтверджені видалені наміри/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Зберегти" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/stepper-workouts") && init?.method === "POST")).toHaveLength(1);
  });

  it("fails closed when IndexedDB recovery cannot be read, then permits create after successful recovery", async () => {
    const user = userEvent.setup();
    stepperOperationStore.list.mockRejectedValueOnce(new Error("synthetic IndexedDB read failure")).mockResolvedValue([]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/stepper-create-operations/")) return response({ state: "NOT_FOUND" }, 404);
      if (url.endsWith("/stepper-workouts") && init?.method === "POST") return response({ state: "COMMITTED", workout: { id: 90 } }, 201);
      if (url.includes("/sessions/start-dynamic") && init?.method === "POST") return response({ session: { id: 91 } }, 201);
      if (url.startsWith("/api/v1/training/stepper-workouts")) return response({ workouts: [] });
      if (url.includes("/api/v1/training/sessions/active")) return response({ session: null });
      if (url.includes("/api/v1/training/programs")) return response({ programs: [] });
      if (url.includes("/api/v1/training/sessions/recent") || url.includes("/api/v1/training/sessions/match-attention")) return response({ sessions: [] });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TrainingClient />);

    const add = await screen.findByRole("button", { name: "Додати степер" });
    await screen.findByRole("button", { name: "Повторити відновлення" });
    expect(add).toHaveProperty("disabled", true);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/stepper-workouts") && init?.method === "POST")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Почати без програми" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/training/sessions/start-dynamic", expect.objectContaining({ method: "POST" })));
    expect(add).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Повторити відновлення" }));
    await waitFor(() => expect(add).toHaveProperty("disabled", false));
    await user.click(add);
    await user.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/stepper-workouts") && init?.method === "POST")).toHaveLength(1));
    expect(stepperOperationStore.store).toHaveBeenCalledTimes(1);
  });

  it("adopts a same-origin tab's winning tombstone replacement after IndexedDB serialization conflict", async () => {
    const user = userEvent.setup();
    const unresolved = {
      operationId: "f02c9bd4-26f5-42df-b268-cd3719767f81",
      payload: { startAt: "2042-03-15T09:00:00.000Z", durationMinutes: 24, manualStepCount: 1800, manualActiveEnergyKcal: null },
      createdAt: 1,
    };
    const oldOperation = { ...unresolved, terminalState: "tombstoned" as const };
    const winner: { operationId: string; payload: Record<string, unknown>; createdAt: number } = { ...unresolved, operationId: "a03d7a23-f87f-46bc-a713-316ab4da5638", createdAt: 2 };
    let operations: Array<{ operationId: string; payload: Record<string, unknown>; createdAt: number; terminalState?: "tombstoned"; replacementOperationId?: string }> = [unresolved];
    stepperOperationStore.list.mockImplementation(async () => operations);
    stepperOperationStore.markTombstoned.mockImplementation(async () => {
      operations = [oldOperation];
      return oldOperation;
    });
    stepperOperationStore.replace.mockImplementation(async () => {
      operations = [{ ...oldOperation, replacementOperationId: winner.operationId }, winner];
      throw new Error("replacement already claimed by another tab");
    });
    stepperOperationStore.remove.mockImplementation(async (id: string) => { operations = operations.filter((item) => item.operationId !== id); });
    let postRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") postRequests += 1;
      const url = String(input);
      if (url.includes(`/stepper-create-operations/${oldOperation.operationId}`)) return response({ state: "TOMBSTONED" }, 410);
      if (url.includes(`/stepper-create-operations/${winner.operationId}`)) return response({ state: "COMMITTED", workout: { id: 91 } });
      if (url.startsWith("/api/v1/training/stepper-workouts")) return response({ workouts: [] });
      if (url.includes("/api/v1/training/sessions/active")) return response({ session: null });
      if (url.includes("/api/v1/training/programs")) return response({ programs: [] });
      if (url.includes("/api/v1/training/sessions/recent") || url.includes("/api/v1/training/sessions/match-attention")) return response({ sessions: [] });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TrainingClient />);

    await screen.findByRole("button", { name: "Перевірити / повторити запис" });
    await user.click(screen.getByRole("button", { name: "Перевірити / повторити запис" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Підтвердити новий намір із чернетки" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Підтвердити новий намір із чернетки" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Перевірити / повторити запис" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Перевірити / повторити запис" }));
    await waitFor(() => expect(stepperOperationStore.remove).toHaveBeenCalledWith(winner.operationId));
    expect(postRequests).toBe(0);
  });

  it("drains multiple recovered ambiguous intents one at a time", async () => {
    const user = userEvent.setup();
    const first = { operationId: "11111111-1111-4111-8111-111111111111", payload: { startAt: "2042-03-15T09:00:00.000Z", durationMinutes: 20, manualStepCount: null, manualActiveEnergyKcal: null }, createdAt: 1 };
    const second = { operationId: "22222222-2222-4222-8222-222222222222", payload: { startAt: "2042-03-15T10:00:00.000Z", durationMinutes: 24, manualStepCount: 100, manualActiveEnergyKcal: null }, createdAt: 2 };
    let operations = [first, second];
    stepperOperationStore.list.mockImplementation(async () => operations);
    stepperOperationStore.remove.mockImplementation(async (id: string) => { operations = operations.filter((item) => item.operationId !== id); });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/stepper-create-operations/${first.operationId}`)) return response({ state: "COMMITTED", workout: { id: 51 } });
      if (url.startsWith("/api/v1/training/stepper-workouts")) return response({ workouts: [] });
      if (url.includes("/api/v1/training/sessions/active")) return response({ session: null });
      if (url.includes("/api/v1/training/programs")) return response({ programs: [] });
      if (url.includes("/api/v1/training/sessions/recent") || url.includes("/api/v1/training/sessions/match-attention")) return response({ sessions: [] });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TrainingClient />);

    await waitFor(() => expect((screen.getByRole("spinbutton", { name: "Тривалість степера" }) as HTMLInputElement).value).toBe("20"));
    expect(screen.getByText(/Збережено незавершених намірів: 2/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Перевірити / повторити запис" }));
    await waitFor(() => expect(stepperOperationStore.remove).toHaveBeenCalledWith(first.operationId));
    await waitFor(() => expect((screen.getByRole("spinbutton", { name: "Тривалість степера" }) as HTMLInputElement).value).toBe("24"));
    expect(screen.getByText(/Збережено незавершених намірів: 1/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`/stepper-create-operations/${second.operationId}`))).toBe(false);
  });
});
