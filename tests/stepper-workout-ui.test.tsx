/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildStepperWorkoutDiagnosticV7 } from "@/modules/profile/stepper-workout-diagnostic";

vi.mock("@/i18n/i18n-provider", () => ({ useI18n: () => ({ locale: "uk", intlLocale: "uk-UA" }) }));
vi.mock("@/components/app-nav", () => ({ AppNav: () => <nav aria-label="App navigation">BodyCast nav</nav> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

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
    snapshots: [
      { id: 9, receivedAt: "2042-03-15T07:59:50.000Z", syncedAt: "2042-03-15T07:59:52.000Z", steps: 1000 },
      { id: 10, receivedAt: "2042-03-15T08:20:10.000Z", syncedAt: null, steps: 1300 },
    ],
    heartRateSamples: samples,
  })!;
}

const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StepperDiagnosticClient", () => {
  it("presents the complete observed diagnostic contract and history navigation", async () => {
    const diagnostic = completeDiagnostic();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ diagnostic })));
    render(<StepperDiagnosticClient workoutId="61" />);

    expect(await screen.findByText("Степер")).toBeTruthy();
    expect(screen.getByText(/DOMYOS MS100 · фіксована конфігурація/)).toBeTruthy();
    expect(screen.getByText("Активна енергія")).toBeTruthy();
    expect(screen.queryByText("Workout ID")).toBeNull();
    expect(screen.queryByText("Summary basis")).toBeNull();
    expect(screen.getByText(/DOMYOS MS100/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Історія" }).getAttribute("href")).toBe("/history");
    expect(screen.getByRole("link", { name: "Тренування" }).getAttribute("href")).toBe("/training");
    expect(document.querySelector("main")?.className).toContain("page");
  });

  it("renders unavailable interval steps, null values, unavailable energy, and loaded HR with no samples", async () => {
    const base = completeDiagnostic(0);
    const diagnostic = {
      ...base,
      bracketedSteps: {
        availability: "unavailable" as const,
        availabilityReason: "no-before-snapshot" as const,
        before: null,
        after: null,
        preGapSeconds: null,
        postGapSeconds: null,
        derivedStepDelta: null,
        derivedStepRatePerMinute: null,
      },
      deviceEnergy: { availability: "unavailable" as const, availabilityReason: "no-device-active-energy" as const },
    };
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
  it("allows editing and deleting an Apple Health stepper workout", async () => {
    const user = userEvent.setup();
    const row = { id: 70, type: "Stair Climbing", startAt, endAt, durationMinutes: 20, activeEnergyKcal: 155, source: "health" as const, syncProtected: false, editable: true };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/v1/training/stepper-workouts") && method === "GET") return response({ workouts: [row] });
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/v1/training/stepper-workouts") && method === "GET") return response({ workouts: rows });
      if (url.endsWith("/api/v1/training/stepper-workouts") && method === "POST") {
        const value = JSON.parse(String(init?.body)) as { startAt: string; durationMinutes: number };
        const created = { id: 51, type: "Stair Climbing", ...value, endAt: new Date(Date.parse(value.startAt) + value.durationMinutes * 60_000).toISOString(), activeEnergyKcal: null, source: "manual" as const, syncProtected: false, editable: true };
        rows = [created, ...rows];
        return response({ workout: created }, 201);
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
    expect(await screen.findAllByText("Степер")).toHaveLength(3);

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
});
