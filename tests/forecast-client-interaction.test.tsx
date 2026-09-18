/** @vitest-environment jsdom */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
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

vi.mock("@/app/forecast/forecast-chart", () => ({
  ForecastChart: () => <div data-testid="forecast-chart" />,
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

import { ForecastClient } from "@/app/forecast/forecast-client";
import { MIN_FORECAST_LOADING_MS } from "@/modules/model-forecast/forecast-ui";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";

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
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
