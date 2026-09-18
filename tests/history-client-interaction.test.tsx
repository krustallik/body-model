/** @vitest-environment jsdom */
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  usePathname: () => "/history",
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: () => <nav data-testid="app-nav" />,
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

vi.mock("./history-charts", () => ({
  HistoryCharts: () => <div data-testid="history-charts" />,
}));

vi.mock("./heart-rate-day-chart", () => ({
  HeartRateDayChart: () => <div data-testid="heart-rate-day-chart" />,
}));

vi.mock("./sleep-night-chart", () => ({
  SleepNightChart: () => <div data-testid="sleep-night-chart" />,
}));

vi.mock("@/app/history/history-charts", () => ({
  HistoryCharts: () => <div data-testid="history-charts" />,
}));

vi.mock("@/app/history/heart-rate-day-chart", () => ({
  HeartRateDayChart: () => <div data-testid="heart-rate-day-chart" />,
}));

vi.mock("@/app/history/sleep-night-chart", () => ({
  SleepNightChart: () => <div data-testid="sleep-night-chart" />,
}));

vi.mock("@/app/history/work-activity-dialog", () => ({
  WorkActivityDialog: () => null,
}));

import { HistoryClient } from "@/app/history/history-client";
import type { DailyMetricDto } from "@/modules/days/day.types";

function day(date: string, overrides: Partial<DailyMetricDto> = {}): DailyMetricDto {
  return {
    date,
    weightKg: null,
    bodyFatPercent: null,
    caloriesKcal: null,
    proteinG: null,
    fatG: null,
    carbsG: null,
    steps: null,
    activeEnergyKcal: null,
    averageWalkingSpeedKmh: null,
    walkingDistanceKm: 3,
    strengthTrainingMinutes: null,
    workouts: [],
    totalWorkoutMinutes: null,
    workoutSource: "none",
    workoutFeedObserved: null,
    updatedAt: `${date}T10:00:00.000Z`,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HistoryClient workout cell interaction", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("makes workout minutes clickable only when details exist, opens dialog, and closes it", async () => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };

    const rows = [
      day("2026-09-03", {
        workoutSource: "workouts",
        totalWorkoutMinutes: 95,
        workouts: [
        {
          type: "Stair Climbing",
          canonicalType: "Stair Climbing",
          classification: "stair-climbing",
          startAt: "2026-09-03T08:00:00.000Z",
          endAt: "2026-09-03T08:20:00.000Z",
          durationMinutes: 20,
          activeEnergyKcal: 154,
        },
        {
          type: "Traditional Strength Training",
          canonicalType: "Traditional Strength Training",
          classification: "traditional-strength-training",
          startAt: "2026-09-03T17:00:00.000Z",
          endAt: "2026-09-03T18:15:00.000Z",
          durationMinutes: 75,
          activeEnergyKcal: 562,
        },
        ],
      }),
      day("2026-09-02", {
        workoutSource: "none",
        totalWorkoutMinutes: null,
      }),
      day("2026-09-01", {
        workoutSource: "legacy-strength",
        totalWorkoutMinutes: 45,
        strengthTrainingMinutes: 45,
      }),
    ];

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/days")) return jsonResponse({ days: rows });
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    const user = userEvent.setup();
    render(<HistoryClient />);
    await waitFor(() => {
      expect(screen.getByText("2026-09-03")).toBeTruthy();
    });

    const workoutLinks = screen.getAllByRole("button", { name: /95|45/ });
    expect(workoutLinks.length).toBe(2);
    // Rest day shows em dash, not a button with 0.
    expect(screen.queryByRole("button", { name: "0" })).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    await user.click(workoutLinks[0]!);
    await waitFor(() => {
      expect(screen.getByText(/Workouts on/i)).toBeTruthy();
    });
    expect(screen.getByText(/Stair/i)).toBeTruthy();
    expect(screen.getByText(/562/)).toBeTruthy();

    const dialog = screen.getByRole("dialog", { hidden: true }) ?? document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    const closes = within(dialog as HTMLElement).getAllByRole("button", { name: /Close/i });
    await user.click(closes[closes.length - 1]!);
    await waitFor(() => {
      expect(screen.queryByText(/Workouts on/i)).toBeNull();
    });
  });
});
