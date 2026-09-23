/** @vitest-environment jsdom */
import {
  afterEach,
  beforeEach,
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
  ForecastChart: ({ history, observedWeights }: { history?: Array<{ filteredWeightKg?: number | null }>; observedWeights?: unknown[] }) => (
    <div data-testid="goal-forecast-chart" data-model-count={history?.filter((day) => day.filteredWeightKg != null).length ?? 0} data-observed-count={observedWeights?.length ?? 0} />
  ),
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

import { GoalClient } from "@/app/goal/goal-client";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";
import type { GoalPlanningResponse } from "@/modules/model-goal-planning/goal-planning.types";
import { GOAL_SETTINGS_KEY } from "@/modules/browser-settings/versioned-settings";
import { goalSettingsFromForm } from "@/modules/browser-settings/planning-settings";
import { defaultGoalForm } from "@/modules/model-goal-planning/goal-planning-ui";

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
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("restores scenario inputs but ignores legacy manual nutrition and keeps its template internal", async () => {
    const form = {
      ...defaultGoalForm("2026-08-24", 80),
      targetWeightKg: "77.4",
      goalDate: "2026-11-22",
      minCaloriesKcal: "1650",
      maxCaloriesKcal: "2550",
      mode: "fixed" as const,
      plan: {
        ...defaultGoalForm("2026-08-24", 80).plan,
        averageStepsPerDay: 9100,
        strengthDaysPerWeek: 4,
        strengthTrainingMinutes: 55,
        otherTrainingDaysPerWeek: 2,
        otherTrainingMinutes: 35,
        plannedWork: true,
        workDaysPerWeek: 4,
        workCategory: "manualModerate" as const,
        shiftHours: 7.5,
        breakHours: 0.75,
      },
    };
    const settings = goalSettingsFromForm(form, { caloriesKcal: 2345, proteinG: 165, fatG: 80, carbsG: 250 });
    localStorage.setItem(GOAL_SETTINGS_KEY, JSON.stringify({ version: 1, settings }));
    let posted: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/forecast/context")) return jsonResponse({ status: modelStatus(), history: [] });
      if (String(input).includes("/api/goal") && init?.method === "POST") {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(solvedGoal());
      }
      return jsonResponse({ error: "optional profile unavailable" }, 404);
    }));
    render(<GoalClient />);
    await screen.findByText(/Latest modeled day:/i);
    expect((screen.getByLabelText(/Target weight/) as HTMLInputElement).value).toBe("77.4");
    expect((screen.getByLabelText(/Goal date/) as HTMLInputElement).value).toBe("2026-11-22");
    expect((screen.getByLabelText(/Minimum calories/) as HTMLInputElement).value).toBe("1650");
    expect((screen.getByLabelText(/Maximum energy/) as HTMLInputElement).value).toBe("2550");
    expect((screen.getByLabelText(/Average steps/) as HTMLInputElement).value).toBe("9100");
    expect((screen.getByLabelText(/Strength sessions/) as HTMLInputElement).value).toBe("4");
    expect((screen.getByLabelText(/Other training.*per week/) as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("I have work days") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Work type") as HTMLSelectElement).value).toBe("manualModerate");
    expect(screen.queryByText("Recommended nutrition")).toBeNull();
    expect(screen.queryByText("Adjust nutrition manually")).toBeNull();
    expect(screen.queryByLabelText(/Starting calories/)).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Calculate scenario" }));
    await waitFor(() => expect(posted).toBeTruthy());
    const request = posted as unknown as { goal: { targetValueKg: number; goalDate: string }; constraints: { minCaloriesKcal: number; maxCaloriesKcal: number }; scenarioTemplate: { mode: string; schedule: { defaultDay: { nutrition: { caloriesKcal: number } }; byDate: Record<string, { occupation?: Array<{ category: string }> }> } } };
    expect(request.goal).toMatchObject({ targetValueKg: 77.4, goalDate: "2026-11-22" });
    expect(request.constraints).toMatchObject({ minCaloriesKcal: 1650, maxCaloriesKcal: 2550 });
    expect(request.scenarioTemplate.mode).toBe("fixed");
    expect(request.scenarioTemplate.schedule.defaultDay.nutrition.caloriesKcal).toBe(2400);
    expect(Object.values(request.scenarioTemplate.schedule.byDate).flatMap((day) => day.occupation ?? []).some((job) => job.category === "manualModerate")).toBe(true);
  });

  it("reset restores scenario defaults and removes only the goal settings key", async () => {
    localStorage.setItem("bodycast.forecast.settings.v1", "keep");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/api/forecast/context")
      ? jsonResponse({ status: modelStatus(), history: [] })
      : jsonResponse({ error: "optional profile unavailable" }, 404)));
    const user = userEvent.setup();
    render(<GoalClient />);
    await screen.findByText(/Latest modeled day:/i);
    await user.clear(screen.getByLabelText(/Target weight/));
    await user.type(screen.getByLabelText(/Target weight/), "78.5");
    expect(localStorage.getItem(GOAL_SETTINGS_KEY)).toContain('"targetWeightKg":"78.5"');
    await user.click(screen.getByRole("button", { name: "Reset settings" }));
    expect(localStorage.getItem(GOAL_SETTINGS_KEY)).toBeNull();
    expect(localStorage.getItem("bodycast.forecast.settings.v1")).toBe("keep");
    expect((screen.getByLabelText(/Target weight/) as HTMLInputElement).value).toBe("77");
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
    expect(screen.queryByText("Recommended nutrition")).toBeNull();
    expect(screen.queryByLabelText(/Starting calories/)).toBeNull();
    expect(screen.getByRole("button", { name: "Calculate scenario" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Calculate scenario" }));
    await waitFor(() => {
      expect(screen.getByText("Recommended nutrition")).toBeTruthy();
    });
    expect(screen.getByText(/Calories selected by the solver/)).toBeTruthy();
    expect(screen.getByText(/not account for body composition or clinical context/i)).toBeTruthy();
    expect(screen.getByText("2,100")).toBeTruthy();
    expect(screen.getByText("128")).toBeTruthy();
  });

  it("passes measured scale readings and filtered historical model estimates to the shared forecast chart", async () => {
    const chartResult = { ...solvedGoal(), forecast: {} as NonNullable<GoalPlanningResponse["forecast"]> };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) return jsonResponse({
        status: modelStatus(),
        history: [
          { date: "2026-08-23", modeledWeightKg: 80.4, filteredWeightKg: 80.1, fatMassKg: 16, leanTissueKg: 45, glycogenAssociatedMassKg: 1, dataQuality: "complete" },
          { date: "2026-08-24", modeledWeightKg: 80.2, filteredWeightKg: null, fatMassKg: 16, leanTissueKg: 45, glycogenAssociatedMassKg: 1, dataQuality: "complete" },
        ],
        observedWeights: [
          { date: "2026-08-23", weightKg: 80.8 },
          { date: "2026-08-24", weightKg: 80.3 },
        ],
      });
      if (url.includes("/api/goal") && init?.method === "POST") return jsonResponse(chartResult);
      return jsonResponse({ error: "optional profile unavailable" }, 404);
    }));

    const user = userEvent.setup();
    render(<GoalClient />);
    await user.click(await screen.findByRole("button", { name: "Calculate scenario" }));
    const chart = await screen.findByTestId("goal-forecast-chart");
    expect(chart.getAttribute("data-model-count")).toBe("1");
    expect(chart.getAttribute("data-observed-count")).toBe("2");
  });

  it("keeps reference nutrition internal and refreshes it from current context and activity inputs", async () => {
    let posted: unknown;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/profile")) return jsonResponse({ profile: {
        id: 1, locale: "en", sex: "female", dateOfBirth: "1991-01-01", heightCm: 170,
        targetWeightKg: 51, targetDate: "2030-01-01", autoAdvanceExercises: false,
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
    expect(screen.queryByText(/starting-template energy uses current modeled expenditure/i)).toBeNull();
    expect(screen.queryByText("Recommended nutrition")).toBeNull();
    expect((screen.getByLabelText(/Target weight/) as HTMLInputElement).value).toBe("77");
    expect((screen.getByLabelText(/Goal date/) as HTMLInputElement).value).toBe("2026-11-22");
    await user.clear(screen.getByLabelText(/Target weight/));
    await user.type(screen.getByLabelText(/Target weight/), "74.5");
    fireEvent.change(screen.getByLabelText(/Goal date/), { target: { value: "2026-12-10" } });
    await user.click(screen.getByRole("button", { name: "Calculate scenario" }));
    await waitFor(() => expect(posted).toBeTruthy());
    const request = posted as unknown as {
      goal: { targetValueKg: number; goalDate: string };
      scenarioTemplate: { schedule: { defaultDay: { nutrition: { caloriesKcal: number; proteinG: number } } } };
    };
    const scenarioTemplate = request.scenarioTemplate;
    expect(scenarioTemplate.schedule.defaultDay.nutrition).toMatchObject({ caloriesKcal: 2400, proteinG: 128 });
    expect(request.goal).toEqual({ metric: "weightKg", targetValueKg: 74.5, goalDate: "2026-12-10" });
  });

  it("shows target-rate review only with the post-solver macro recommendation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/profile")) return jsonResponse({ profile: {
        id: 1, locale: "en", sex: "female", dateOfBirth: "1991-01-01", heightCm: 170,
        targetWeightKg: 80, targetDate: "2030-01-01", autoAdvanceExercises: false,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      } });
      if (url.includes("/api/forecast/context")) return jsonResponse({ status: modelStatus(), history: [] });
      if (url.includes("/api/goal") && init?.method === "POST") return jsonResponse(solvedGoal());
      return jsonResponse({ error: "optional profile unavailable" }, 404);
    }));

    const user = userEvent.setup();
    render(<GoalClient />);
    await screen.findByText(/Latest modeled day:/i);
    await user.clear(screen.getByLabelText(/Target weight/));
    await user.type(screen.getByLabelText(/Target weight/), "79.1");
    fireEvent.change(screen.getByLabelText(/Goal date/), { target: { value: "2026-08-31" } });

    expect(screen.queryByText(/requested pace is above a product review guideline/i)).toBeNull();
    expect(screen.queryByText("Recommended nutrition")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Calculate scenario" }));
    expect(await screen.findByText(/requested pace exceeds a product review guideline/i)).toBeTruthy();
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
    expect(screen.getByText(/plan center is not available for this status/i)).toBeTruthy();
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

  it("guides work setup into the same canonical schedule used by the solver", async () => {
    let posted: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) return jsonResponse({ status: modelStatus(), history: [] });
      if (url.includes("/api/goal") && init?.method === "POST") {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(solvedGoal());
      }
      return jsonResponse({ error: "optional profile unavailable" }, 404);
    }));
    const user = userEvent.setup();
    render(<GoalClient />);
    await screen.findByText(/Latest modeled day:/i);
    await user.click(screen.getByLabelText("I have work days"));
    await user.click(screen.getByRole("button", { name: /Not sure — help me choose/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Mostly sitting or waiting" }));
    expect(screen.getByLabelText(/Breaks per shift/)).toBeTruthy();
    const breakInput = screen.getByLabelText(/Breaks per shift/);
    await user.clear(breakInput);
    await user.type(breakInput, "1");
    await user.click(screen.getByRole("button", { name: /I know my work type/ }));
    expect((screen.getByLabelText("Work type") as HTMLSelectElement).value).toBe("standingLight");
    expect((screen.getByLabelText(/Work days/) as HTMLInputElement).value).toBe("5");
    await user.click(screen.getByRole("button", { name: "Calculate scenario" }));
    await waitFor(() => expect(posted).toBeTruthy());
    const submitted = posted as unknown as { scenarioTemplate: { schedule: { byDate: Record<string, { occupation?: Array<{ category: string; durationHours: number; breakDurationHours: number }> }> } } };
    const schedule = submitted.scenarioTemplate.schedule;
    const work = Object.values(schedule.byDate).flatMap((day) => day.occupation ?? []);
    expect(work.length).toBeGreaterThan(0);
    expect(work[0]).toMatchObject({ category: "standingLight", durationHours: 8, breakDurationHours: 1 });
    expect(screen.getByText(/Calories selected by the solver/)).toBeTruthy();
  });

  it.each([
    ["2010-01-01", /not tailored for people under 18/i],
    ["1950-01-01", /specific guidance for people 65\+ is not modeled/i],
  ])("makes age-domain limitation obvious for birth date %s after solver result", async (dateOfBirth, limitation) => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/profile")) return jsonResponse({ profile: {
        id: 1, locale: "en", sex: "female", dateOfBirth, heightCm: 170,
        targetWeightKg: null, targetDate: null, autoAdvanceExercises: false,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      } });
      if (url.includes("/api/forecast/context")) return jsonResponse({ status: modelStatus(), history: [] });
      if (url.includes("/api/goal") && init?.method === "POST") return jsonResponse(solvedGoal());
      return jsonResponse({ error: "unexpected" }, 500);
    }));
    const user = userEvent.setup();
    render(<GoalClient />);
    await user.click(await screen.findByRole("button", { name: "Calculate scenario" }));
    expect(await screen.findByText(limitation)).toBeTruthy();
    expect(screen.getByText("Recommended nutrition")).toBeTruthy();
  });

  it("uses solver calories for result macros without exposing the fallback reference or walking internals", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/forecast/context")) {
        return jsonResponse({ status: modelStatus({ currentModeledTdeeKcalPerDay: null }), history: [] });
      }
      if (url.includes("/api/goal") && init?.method === "POST") return jsonResponse(solvedGoal());
      return jsonResponse({ error: "optional profile unavailable" }, 404);
    }));
    const user = userEvent.setup();
    render(<GoalClient />);
    await screen.findByRole("button", { name: "Calculate scenario" });
    expect(screen.queryByText("Recommended nutrition")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Calculate scenario" }));
    expect(await screen.findByText("Recommended nutrition")).toBeTruthy();
    expect(screen.getByText("2,100")).toBeTruthy();
    expect(screen.queryByText("2,200")).toBeNull();
    const userInputs = Array.from(document.querySelectorAll("input, select"));
    expect(userInputs.map((input) => input.getAttribute("aria-label") ?? input.id).join(" "))
      .not.toMatch(/walking distance|walking speed|km/i);
  });
});
