/** @vitest-environment jsdom */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/forecast",
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: () => <nav data-testid="app-nav" />,
}));

vi.mock("@/components/help-tip", () => ({
  HelpTip: ({ children }: { children: React.ReactNode }) => <span data-testid="help">{children}</span>,
}));

const localeMock = vi.hoisted(() => ({ value: "en" as "en" | "uk" }));

vi.mock("@/app/forecast/forecast-chart", () => ({
  ForecastChart: () => <div data-testid="forecast-chart" />,
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: localeMock.value, intlLocale: localeMock.value === "uk" ? "uk-UA" : "en-US", setLocale: () => undefined }),
}));

import { ForecastClient } from "@/app/forecast/forecast-client";
import { MIN_FORECAST_LOADING_MS } from "@/modules/model-forecast/forecast-ui";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";
import { FORECAST_SETTINGS_KEY } from "@/modules/browser-settings/versioned-settings";
import { DEFAULT_PLAN } from "@/modules/planning-scenario/planning-scenario";

function modelStatus(overrides: Partial<ModelStatusDto> = {}): ModelStatusDto {
  return {
    episodeId: 1,
    episodeStartDate: "2026-07-01",
    latestModeledDate: "2026-08-24",
    modelVersion: "bodycast-physiology-v6",
    calibrationStatus: "fully-calibrated",
    personalOffsetKcalPerDay: 0,
    activityCalibration: 1,
    daysModeled: 55,
    incompleteDays: 0,
    observedNutritionDays: 50,
    imputedNutritionDays: 5,
    unbridgeableNutritionDays: 0,
    currentPredictedWeightKg: 80,
    currentFilteredWeightKg: 80,
    currentFatMassKg: 16,
    currentLeanTissueKg: 45,
    currentDynamicRmrKcalPerDay: 1700,
    currentModeledTdeeKcalPerDay: 2400,
    continuityStatus: "resolved",
    lastResolvedDate: "2026-08-24",
    recoveryRequired: false,
    unknownIntervalCount: 0,
    unresolvedDayCount: 0,
    postGapObservedDayCount: 0,
    unknownIntervals: [],
    ...overrides,
  };
}

function forecastOk(): ForecastResult {
  const summary = { mean: 80, p05: 78, p25: 79, median: 80, p75: 81, p95: 82 };
  return {
    status: "ok",
    forecastVersion: "bodycast-forecast-v1",
    modelVersion: "test",
    recoveryVersion: null,
    sourceFingerprint: "source-fingerprint-abcdef",
    scenarioFingerprint: "scenario",
    initialStateQuality: "deterministic",
    horizonDays: 30,
    scenarioProvenance: {
      mode: "fixed",
      nutrition: "fixed",
      activity: "fixed-scheduled",
      donorEvidence: {
        donorDayCount: 20,
        source: "observed-history",
        nutritionLogStandardDeviation: 0.1,
        macroCompositionLogStandardDeviation: 0.1,
        walkingLogStandardDeviation: 0.1,
      },
    },
    dates: [{
      date: "2026-09-23",
      physiologicalBodyWeightKg: summary,
      fatMassKg: summary,
      leanTissueKg: summary,
      glycogenKg: summary,
      glycogenWaterKg: summary,
      glycogenAssociatedMassKg: summary,
      extracellularFluidDeviationLiters: summary,
      adaptiveThermogenesisKcalPerDay: summary,
      dynamicRmrKcalPerDay: summary,
      tdeeKcalPerDay: summary,
      energyIntakeKcal: summary,
      netActivityKcalPerDay: summary,
    }],
    diagnostics: {
      seed: 1,
      generatedPathCount: 512,
      validPathCount: 512,
      invalidPathCount: 0,
      invalidPathReasons: {},
      startingParticleCount: 1,
      startingParticleResampling: "none-single-state",
      uncertaintySources: {
        initialState: false, futureBehavior: true, measurement: false, modelParameters: false,
      },
      ecfPolicy: "hold-ecf",
      ecfLimitation: null,
      latentPhysiologicalWeightOnly: true,
      current: true,
      numericalQuality: {
        classification: "standard",
        pathCount: 512,
        recommendedMinimumPathCount: 512,
        pathCountAdequateForHorizon: true,
        uniqueStartingStateCount: 1,
        availableStartingStateCount: 1,
        outerQuantileRankStandardErrorProbability: 0.01,
        note: "ok",
      },
    },
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ForecastClient interaction", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localeMock.value = "en";
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("atomically restores planned settings before one initial request and keeps them when switching recent then planned", async () => {
    const plan = { ...DEFAULT_PLAN, caloriesKcal: 2050, proteinG: 155, averageStepsPerDay: 9600, strengthDaysPerWeek: 4, strengthTrainingMinutes: 50, otherTrainingDaysPerWeek: 2, otherTrainingMinutes: 35, plannedWork: true, workDaysPerWeek: 4, workCategory: "manualModerate" as const, shiftHours: 7, breakHours: 1 };
    localStorage.setItem(FORECAST_SETTINGS_KEY, JSON.stringify({ version: 1, settings: { horizon: 90, mode: "fixed", plan } }));
    const requests: Array<{ horizonDays: number; scenario: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) return jsonResponse({ status: modelStatus(), history: [], unknownIntervals: [] });
      if (url.includes("/api/forecast") && !url.includes("action")) {
        requests.push(JSON.parse(String(init?.body)) as typeof requests[number]);
        return jsonResponse(forecastOk());
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
    render(<ForecastClient />);
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS + 50); });
    await screen.findByTestId("forecast-chart");
    expect(screen.getByText("Measured weight")).toBeTruthy();
    expect(screen.getByText("Model estimate")).toBeTruthy();
    expect(screen.getByText("Future forecast")).toBeTruthy();
    expect(screen.getByText("25–75% forecast interval")).toBeTruthy();
    expect(screen.getByText("5–95% forecast interval")).toBeTruthy();
    expect(screen.getByText(/historical model estimate uses measurements available/i)).toBeTruthy();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.horizonDays).toBe(90);
    expect(requests[0]?.scenario.mode).toBe("fixed");
    expect(JSON.stringify(requests[0]?.scenario)).toContain("manualModerate");
    expect((screen.getByLabelText(/Energy/) as HTMLInputElement).value).toBe("2050");

    await user.click(screen.getByRole("button", { name: /As lately/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const recent = requests.at(-1)!;
    expect(recent.horizonDays).toBe(90);
    expect(recent.scenario).toEqual({ mode: "recent-behavior" });
    await user.click(screen.getByRole("button", { name: /Exact daily plan/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const planned = requests.at(-1)!;
    expect(planned.scenario.mode).toBe("fixed");
    expect(JSON.stringify(planned.scenario)).toContain("manualModerate");
    expect(JSON.stringify(planned.scenario)).toContain('"caloriesKcal":2050');
  });

  it("shows Ukrainian chart labels and explains filtered history separately from the future forecast", async () => {
    localeMock.value = "uk";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/api/forecast/context")
      ? jsonResponse({ status: modelStatus(), history: [], observedWeights: [], unknownIntervals: [] })
      : jsonResponse(forecastOk())));
    render(<ForecastClient />);
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS + 50); });
    await screen.findByTestId("forecast-chart");
    expect(screen.getByText("Вага з вагів")).toBeTruthy();
    expect(screen.getByText("Оцінка моделі")).toBeTruthy();
    expect(screen.getByText("Майбутній прогноз")).toBeTruthy();
    expect(screen.getByText("25–75% прогнозу")).toBeTruthy();
    expect(screen.getByText("5–95% прогнозу")).toBeTruthy();
    expect(screen.getByText(/історична оцінка моделі враховує вимірювання/i)).toBeTruthy();
    expect(screen.getByText(/це не прогноз, зроблений до вимірювання/i)).toBeTruthy();
  });

  it("reset clears only forecast settings and restores recent defaults without reloading", async () => {
    localStorage.setItem("bodycast.goal.settings.v1", "keep");
    localStorage.setItem(FORECAST_SETTINGS_KEY, JSON.stringify({ version: 1, settings: { horizon: 90, mode: "fixed", plan: { ...DEFAULT_PLAN, caloriesKcal: 2000 } } }));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/api/forecast/context")
      ? jsonResponse({ status: modelStatus(), history: [], unknownIntervals: [] })
      : jsonResponse(forecastOk())));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
    render(<ForecastClient />);
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS + 50); });
    await screen.findByTestId("forecast-chart");
    expect((screen.getByLabelText(/Energy/) as HTMLInputElement).value).toBe("2000");
    await user.click(screen.getByRole("button", { name: "Reset settings" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(localStorage.getItem(FORECAST_SETTINGS_KEY)).toBeNull();
    expect(localStorage.getItem("bodycast.goal.settings.v1")).toBe("keep");
    expect(screen.getByRole("button", { name: "30d" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /As lately/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows loading on mount, keeps fast success hidden until ~800ms, then renders result", async () => {
    const forecastGate = deferred<ForecastResult>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({ status: modelStatus(), history: [], unknownIntervals: [] });
      }
      if (url.includes("/api/forecast") && !url.includes("action")) {
        const result = await forecastGate.promise;
        return jsonResponse(result);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    render(<ForecastClient />);
    expect(screen.getByText("Calculating possible weight paths")).toBeTruthy();
    const runButton = screen.getByRole("button", { name: /Run updated forecast|Run forecast/i });
    expect((runButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      forecastGate.resolve(forecastOk());
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByTestId("forecast-chart")).toBeNull();
    expect(screen.getByText("Calculating possible weight paths")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS);
    });
    await waitFor(() => {
      expect(screen.getByTestId("forecast-chart")).toBeTruthy();
    });
    expect(screen.queryByText("Calculating possible weight paths")).toBeNull();
    expect((screen.getByRole("button", { name: "Run forecast" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("shows a slow (>800ms) success immediately after the request completes", async () => {
    const forecastGate = deferred<ForecastResult>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({ status: modelStatus(), history: [], unknownIntervals: [] });
      }
      if (url.includes("/api/forecast") && !url.includes("action")) {
        return jsonResponse(await forecastGate.promise);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    render(<ForecastClient />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS + 200);
    });
    expect(screen.queryByTestId("forecast-chart")).toBeNull();

    await act(async () => {
      forecastGate.resolve(forecastOk());
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("forecast-chart")).toBeTruthy();
    });
  });

  it("exposes steps, training, and work settings without manual walking km or speed fields", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({ status: modelStatus(), history: [], unknownIntervals: [] });
      }
      if (url.includes("/api/forecast") && !url.includes("action")) {
        // The request body is asserted after toggling work below.
        requests.push(JSON.parse(String(init?.body)));
        return jsonResponse(forecastOk());
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
    render(<ForecastClient />);
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS + 100); });
    await screen.findByTestId("forecast-chart");
    await user.click(screen.getByRole("button", { name: /Exact daily plan/ }));

    expect(screen.getByLabelText(/Average steps/)).toBeTruthy();
    expect(screen.getByLabelText(/^Strength sessions/)).toBeTruthy();
    expect(screen.getByLabelText(/^Strength session \(min\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Other sessions/)).toBeTruthy();
    expect(screen.getByLabelText(/^Other session \(min\)/)).toBeTruthy();
    expect(screen.queryByLabelText(/Walking outside work|Walking speed|Walking at work|Work walking speed/i))
      .toBeNull();

    await user.click(screen.getByLabelText("Include work days"));
    expect(screen.getByLabelText(/Work days/)).toBeTruthy();
    expect(screen.getByLabelText(/Work intensity/)).toBeTruthy();
    expect(screen.getByLabelText(/Shift/)).toBeTruthy();
    expect(screen.getByLabelText(/Breaks/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    const workRequest = requests.at(-1) as { scenario: { schedule: { byDate?: Record<string, { occupation?: unknown[] }> } } };
    expect(Object.values(workRequest.scenario.schedule.byDate ?? {}).some((day) => (day.occupation?.length ?? 0) > 0)).toBe(true);
  });

  it("shows numbered forecast steps, hides ignored plan fields in recent mode, and omits them from its request", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) return jsonResponse({ status: modelStatus(), history: [], unknownIntervals: [] });
      if (url.includes("/api/forecast") && !url.includes("action")) {
        requests.push(JSON.parse(String(init?.body)));
        return jsonResponse(forecastOk());
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
    render(<ForecastClient />);
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS + 100); });
    await screen.findByTestId("forecast-chart");
    expect(screen.getByRole("heading", { name: "Forecast horizon" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What happens next?" })).toBeTruthy();
    expect(screen.getByText(/Manual food, movement, and work fields do not apply/)).toBeTruthy();
    expect(screen.queryByLabelText(/Average steps/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Exact daily plan/ }));
    expect(screen.getByRole("heading", { name: "Planned nutrition" })).toBeTruthy();
    expect(screen.getByLabelText(/Average steps/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const recentRequest = requests[0] as { scenario: unknown };
    expect(recentRequest.scenario).toEqual({ mode: "recent-behavior" });
    expect(JSON.stringify(recentRequest)).not.toMatch(/averageSteps|caloriesKcal|plannedWork/);
    const plannedRequest = requests.at(-1) as { scenario: { mode: string; schedule?: { defaultDay: { nutrition: unknown; outsideWorkWalkingDistanceKm: number } } } };
    expect(plannedRequest.scenario.mode).toBe("fixed");
    expect(plannedRequest.scenario.schedule?.defaultDay).toMatchObject({
      nutrition: { caloriesKcal: 2200, proteinG: 150, fatG: 75, carbsG: 240 },
      outsideWorkWalkingDistanceKm: 6,
    });
    fireEvent.change(screen.getByLabelText(/^Energy/), { target: { value: "2100" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    const editedRequest = requests.at(-1) as typeof plannedRequest;
    expect(editedRequest.scenario.schedule?.defaultDay.nutrition).toMatchObject({ caloriesKcal: 2100 });
  });

  it("surfaces API errors without waiting for the minimum loading delay", async () => {
    const forecastGate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({ status: modelStatus(), history: [], unknownIntervals: [] });
      }
      if (url.includes("/api/forecast") && !url.includes("action")) {
        return forecastGate.promise;
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    render(<ForecastClient />);
    await act(async () => {
      forecastGate.resolve(jsonResponse({
        error: "insufficient_scenario_evidence",
        message: "Need more history",
      }, 422));
      await vi.advanceTimersByTimeAsync(40);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.queryByTestId("forecast-chart")).toBeNull();
    // Error path must not still be waiting on the 800ms spinner as the only UI.
    expect(screen.getByText(/can’t calculate this option yet|cannot calculate/i)).toBeTruthy();
  });

  it("ignores a stale slower first response after a newer request starts", async () => {
    const first = deferred<ForecastResult>();
    const second = deferred<ForecastResult>();
    let forecastCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({ status: modelStatus(), history: [], unknownIntervals: [] });
      }
      if (url.includes("/api/forecast") && !url.includes("action")) {
        forecastCalls += 1;
        const body = forecastCalls === 1
          ? await first.promise
          : await second.promise;
        if (init?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return jsonResponse(body);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
    render(<ForecastClient />);

    // Let auto-run start (call 1), then change horizon to invalidate and require manual rerun.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await user.click(screen.getByRole("button", { name: "7d" }));
    // Pending card after invalidate (heading + hint both match loosely).
    expect(screen.getByText("Settings changed")).toBeTruthy();

    const runButton = screen.getByRole("button", { name: "Run forecast" });
    await user.click(runButton);

    const stale = forecastOk();
    stale.sourceFingerprint = "stale-first-response-zzzz";
    stale.dates[0]!.physiologicalBodyWeightKg = {
      mean: 99, p05: 99, p25: 99, median: 99, p75: 99, p95: 99,
    };
    const fresh = forecastOk();
    fresh.sourceFingerprint = "fresh-second-response-aaaa";

    await act(async () => {
      second.resolve(fresh);
      await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS);
    });
    await waitFor(() => {
      expect(screen.getByTestId("forecast-chart")).toBeTruthy();
    });

    await act(async () => {
      first.resolve(stale);
      await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS);
    });
    // Stale median 99 must not appear in the summary.
    expect(screen.queryByText(/99/)).toBeNull();
    expect(screen.getByTestId("forecast-chart")).toBeTruthy();
  });

  it("renders quality/provenance chips and workout-scenario notes without shadow fat truth", async () => {
    const forecastGate = deferred<ForecastResult>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({
          status: modelStatus(),
          history: [],
          unknownIntervals: [],
          provenance: {
            v7Cache: {
              key: "v7-cache",
              tone: "estimated",
              label: "v7: stale",
              detail: "v7 cache needs refresh after source changes.",
            },
            v7Compartments: [{
              key: "skeletal-muscle",
              tone: "unavailable",
              label: "Skeletal muscle: unavailable",
              detail: "Unavailable ≠ 0. The value is not replaced with zero.",
            }],
            latestDay: {
              date: "2026-08-24",
              dataQuality: {
                key: "data-quality",
                tone: "estimated",
                label: "Estimated",
                detail: "Some fields were estimated.",
              },
              nutrition: {
                key: "nutrition",
                tone: "observed",
                label: "Nutrition observed",
                detail: "Calories/macros from the day’s records.",
              },
              workoutFeed: {
                key: "workout-feed",
                tone: "unavailable",
                label: "Workout feed missing",
                detail: "Missing feed ≠ rest day.",
              },
            },
          },
        });
      }
      if (url.includes("/api/forecast") && !url.includes("action")) {
        return jsonResponse(await forecastGate.promise);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    render(<ForecastClient />);
    await act(async () => {
      forecastGate.resolve(forecastOk());
      await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS);
    });
    await waitFor(() => {
      expect(screen.getByTestId("forecast-chart")).toBeTruthy();
    });
    expect(screen.getByText("Quality and provenance")).toBeTruthy();
    expect(screen.getByText("v7: stale")).toBeTruthy();
    expect(screen.getByText("Skeletal muscle: unavailable")).toBeTruthy();
    expect(screen.getByText("Workout feed missing")).toBeTruthy();
    expect(screen.getByText(/Hall\/Forbes aggregate lean/i)).toBeTruthy();
    expect(screen.getByText(/Fat\/weight shadow is not shown as production truth/i)).toBeTruthy();
    expect(screen.queryByText(/recovery score/i)).toBeNull();
  });
});
