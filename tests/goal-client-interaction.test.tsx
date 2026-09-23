/** @vitest-environment jsdom */
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  usePathname: () => "/goal",
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: () => <nav data-testid="app-nav" />,
}));

vi.mock("@/components/help-tip", () => ({
  HelpTip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/model-state-source", () => ({
  ModelStateSource: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("@/app/forecast/forecast-chart", () => ({
  ForecastChart: () => <div data-testid="goal-forecast-chart" />,
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

import { GoalClient } from "@/app/goal/goal-client";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";
import type { GoalPlanningResponse } from "@/modules/model-goal-planning/goal-planning.types";

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

function solvedGoal(): GoalPlanningResponse {
  return {
    status: "solved",
    solverStatus: "solved",
    solverVersion: "bodycast-target-solver-v1",
    modelVersion: "bodycast-physiology-v6",
    forecastVersion: "bodycast-forecast-v1",
    recoveryVersion: null,
    reason: null,
    goal: { metric: "weightKg", targetValueKg: 78, goalDate: "2026-12-01", horizonDays: 99 },
    control: {
      solvedCaloriesKcal: 2_100,
      constraintBoundary: null,
      boundaryReason: null,
    },
    terminal: {
      date: "2026-12-01",
      mean: 78, p05: 76, p25: 77, median: 78, p75: 79, p95: 80,
      targetErrorKg: 0,
      attainment: {
        direction: "loss",
        definition: "at-or-below-target",
        probability: 0.55,
        successes: 280,
        sampleCount: 512,
        probabilityMonteCarloInterval: {
          confidenceLevel: 0.95, lower: 0.5, upper: 0.6, method: "wilson-score",
        },
      },
    },
    feasibility: null,
    assumptions: {
      constraints: { minCaloriesKcal: 1_600, maxCaloriesKcal: 2_400 },
      scenarioMode: "target-centered",
      nutritionPolicy: "proportional-template",
      referenceNutrition: { caloriesKcal: 2_200, proteinG: 150, fatG: 70, carbsG: 200 },
      activity: {
        outsideWorkWalkingDistanceKm: 5,
        averageWalkingSpeedKmh: 5,
        defaultStrengthTrainingMinutes: 45,
        strengthByWeekday: null,
        defaultOccupation: [],
        scheduledOccupationDayCount: 0,
      },
    },
    numerical: {
      practicalResolutionKcal: 50,
      forecastQuality: "standard",
      solverToleranceKg: 0.05,
      goalToleranceKg: 0.5,
      localSensitivityKgPer100Kcal: 0.12,
      robustnessClassification: "stable",
      predictiveSpread90Kg: 4,
    },
    provenance: {
      initialStateQuality: "deterministic",
      forecastStatus: "ok",
    },
    warnings: [],
    forecast: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GoalClient interaction", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not crash or open the planner when latestModeledDate is null", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({
          status: modelStatus({ latestModeledDate: null }),
          history: [],
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    render(<GoalClient />);
    await waitFor(() => {
      expect(screen.getByText("No modeled state yet")).toBeTruthy();
    });
    expect(screen.queryByText("Target and date")).toBeNull();
    expect(screen.queryByRole("button", { name: "Calculate scenario" })).toBeNull();
    expect(screen.getByText(/latest modeled day is not available/i)).toBeTruthy();
  });

  it("opens the planner for a valid modeled date and renders solver success", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({ status: modelStatus(), history: [] });
      }
      if (url.includes("/api/goal") && init?.method === "POST") {
        return jsonResponse(solvedGoal());
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    const user = userEvent.setup();
    render(<GoalClient />);
    await waitFor(() => {
      expect(screen.getByText(/Latest modeled day:/i)).toBeTruthy();
    });
    expect((screen.getByLabelText(/Template energy/) as HTMLInputElement).value).toBe("2400");
    expect((screen.getByLabelText(/^Protein \(g\)/) as HTMLInputElement).value).toBe("128");
    expect(screen.getByRole("button", { name: "Calculate scenario" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Calculate scenario" }));
    await waitFor(() => {
      expect(screen.getByText("solved")).toBeTruthy();
    });
    expect(screen.getByText(/Modeled plan center/i)).toBeTruthy();
    expect(screen.getByText(/~2,?100/)).toBeTruthy();
  });

  it("uses the recommended template once and preserves manual macro edits in the legacy request contract", async () => {
    let posted: unknown;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/profile")) return jsonResponse({ profile: {
        id: 1, locale: "en", sex: "female", dateOfBirth: "1991-01-01", heightCm: 170,
        targetWeightKg: null, targetDate: null, autoAdvanceExercises: false,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      } });
      if (url.includes("/api/forecast/context")) return jsonResponse({ status: modelStatus(), history: [] });
      if (url.includes("/api/goal") && init?.method === "POST") {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(solvedGoal());
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    const user = userEvent.setup();
    render(<GoalClient />);
    await screen.findByText(/Latest modeled day:/i);
    expect(screen.getByText(/energy is anchored to current modeled expenditure/i)).toBeTruthy();
    await user.clear(screen.getByLabelText(/Template energy/));
    await user.type(screen.getByLabelText(/Template energy/), "2600");
    await user.clear(screen.getByLabelText(/^Protein \(g\)/));
    await user.type(screen.getByLabelText(/^Protein \(g\)/), "140");
    await user.click(screen.getByRole("button", { name: "Calculate scenario" }));
    await waitFor(() => expect(posted).toBeTruthy());
    const scenarioTemplate = (posted as { scenarioTemplate: { schedule: { defaultDay: { nutrition: unknown } } } }).scenarioTemplate;
    expect(scenarioTemplate.schedule.defaultDay.nutrition).toMatchObject({ caloriesKcal: 2600, proteinG: 140 });
  });

  it("updates the target-rate limitation as target inputs change without overwriting the nutrition template", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/forecast/context")) return jsonResponse({ status: modelStatus(), history: [] });
      return jsonResponse({ error: "optional profile unavailable" }, 404);
    }));

    const user = userEvent.setup();
    render(<GoalClient />);
    await screen.findByText(/Latest modeled day:/i);
    await user.clear(screen.getByLabelText(/Target weight/));
    await user.type(screen.getByLabelText(/Target weight/), "79.1");
    fireEvent.change(screen.getByLabelText(/Goal date/), { target: { value: "2026-08-31" } });

    expect(await screen.findByText(/entered pace exceeds the product review threshold/i)).toBeTruthy();
    expect((screen.getByLabelText(/Template energy/) as HTMLInputElement).value).toBe("2400");
    expect((screen.getByLabelText(/^Protein \(g\)/) as HTMLInputElement).value).toBe("128");
  });

  it("renders numerically-limited BodyCast status without crashing", async () => {
    const limited = solvedGoal();
    limited.status = "numerically-limited";
    limited.solverStatus = "numerically-limited";
    limited.control.solvedCaloriesKcal = null;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({ status: modelStatus(), history: [] });
      }
      if (url.includes("/api/goal") && init?.method === "POST") {
        return jsonResponse(limited);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    const user = userEvent.setup();
    render(<GoalClient />);
    await waitFor(() => screen.getByRole("button", { name: "Calculate scenario" }));
    await user.click(screen.getByRole("button", { name: "Calculate scenario" }));
    await waitFor(() => {
      expect(screen.getByText("Numerical precision is limited")).toBeTruthy();
    });
    expect(screen.getByText(/does not support a plan center/i)).toBeTruthy();
  });

  it("shows a controlled API error UI instead of crashing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({ status: modelStatus(), history: [] });
      }
      if (url.includes("/api/goal") && init?.method === "POST") {
        return jsonResponse({ error: "no_active_episode" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    const user = userEvent.setup();
    render(<GoalClient />);
    await waitFor(() => screen.getByRole("button", { name: "Calculate scenario" }));
    await user.click(screen.getByRole("button", { name: "Calculate scenario" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.getByText(/no active model/i)).toBeTruthy();
    expect(screen.queryByText("solved")).toBeNull();
  });
});
