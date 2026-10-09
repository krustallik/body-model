/** @vitest-environment jsdom */
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  WorkActivityDialog: ({ date, onClose }: { date: string; onClose: () => void }) => (
    <div role="dialog" aria-label={`Work activity for ${date}`}>
      <button type="button" onClick={onClose}>Close work activity</button>
    </div>
  ),
}));

import { HistoryClient } from "@/app/history/history-client";
import type { DailyMetricDto } from "@/modules/days/day.types";
import type { TrainingDayFact } from "@/modules/days/training-day-fact";

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

function eventFact(date: string, id: string): TrainingDayFact {
  return {
    date,
    eventCount: 1,
    durationMinutes: null,
    hiddenEventCount: 0,
    events: [{
      eventId: id,
      source: "workout",
      type: "Traditional Strength Training",
      occurrenceAt: `${date}T22:30:00.000Z`,
      endAt: null,
      durationMinutes: null,
      activeEnergyKcal: null,
      energySource: "unavailable",
      executionStatus: "unknown",
      workoutId: Number(id),
      diarySessionId: null,
      diaryProgramName: null,
      diaryOnly: false,
      exerciseDetailAvailability: "unavailable",
      loggedSetCount: null,
    }],
  };
}

function shiftDate(date: string, days: number): string {
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, dayOfMonth! + days)).toISOString().slice(0, 10);
}

describe("HistoryClient workout cell interaction", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("makes workout minutes clickable only when details exist, opens dialog, and closes it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));

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
      if (url.includes("/api/v1/days")) return jsonResponse({
        days: rows,
        trainingDays: [{
          date: "2026-09-04",
          eventCount: 0,
          durationMinutes: 0,
          hiddenEventCount: 0,
          events: [],
        }, {
          date: "2026-09-05",
          eventCount: 1,
          durationMinutes: null,
          hiddenEventCount: 0,
          events: [{
            eventId: "diary:99",
            source: "diary",
            type: "Traditional Strength Training",
            occurrenceAt: "2026-09-05T10:00:00.000Z",
            endAt: null,
            durationMinutes: null,
            activeEnergyKcal: null,
            energySource: "unavailable",
            executionStatus: "in-progress",
            workoutId: null,
            diarySessionId: 99,
            diaryProgramName: "Live session",
            diaryOnly: true,
            exerciseDetailAvailability: "no-logged-sets",
            loggedSetCount: 0,
          }],
        }],
      });
      if (url.includes("/api/v1/work-intervals")) {
        return jsonResponse({ intervals: [{ date: "2026-09-03" }] });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }));

    const user = userEvent.setup();
    render(<HistoryClient />);
    await waitFor(() => {
      expect(within(screen.getByTestId("desktop-history-table")).getByText("2026-09-03")).toBeTruthy();
      expect(within(screen.getByTestId("desktop-history-table")).getByText("2026-09-05")).toBeTruthy();
    });

    const desktop = within(screen.getByTestId("desktop-history-table"));
    const cards = within(screen.getByTestId("mobile-history-cards"));
    expect(desktop.queryByText("2026-09-04")).toBeNull();
    expect(desktop.getByText("2026-09-05")).toBeTruthy();
    const workoutLinks = desktop.getAllByRole("button", { name: /95/ });
    expect(workoutLinks.length).toBe(1);
    // Legacy duration alone is not evidence that a workout event exists.
    expect(desktop.queryByRole("button", { name: /45/ })).toBeNull();
    // Rest day shows em dash, not a button with 0.
    expect(screen.queryByRole("button", { name: "0" })).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    await user.click(workoutLinks[0]!);
    await waitFor(() => {
      expect(screen.getByText(/Workouts on/i)).toBeTruthy();
    });
    const dialog = screen.getByRole("dialog", { hidden: true }) ?? document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(within(dialog as HTMLElement).getByText(/Stair/i)).toBeTruthy();
    expect(within(dialog as HTMLElement).getByText(/562/)).toBeTruthy();
    const closes = within(dialog as HTMLElement).getAllByRole("button", { name: /Close/i });
    await user.click(closes[closes.length - 1]!);
    await waitFor(() => {
      expect(screen.queryByText(/Workouts on/i)).toBeNull();
    });

    await user.click(cards.getByRole("button", { name: "Workout details for 2026-09-03" }));
    await waitFor(() => expect(screen.getByText(/Workouts on/i)).toBeTruthy());
    const cardDialog = screen.getByRole("dialog", { hidden: true });
    await user.click(within(cardDialog).getAllByRole("button", { name: /Close/i }).at(-1)!);
    await waitFor(() => expect(screen.queryByText(/Workouts on/i)).toBeNull());

    await user.click(cards.getByRole("button", { name: "Work activity for 2026-09-03" }));
    expect(screen.getByRole("dialog", { name: "Work activity for 2026-09-03" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close work activity" }));
    await user.click(cards.getByRole("button", { name: "Edit 2026-09-03" }));
    expect(screen.getByRole("dialog", { hidden: true })).toBeTruthy();
  });

  it("paginates all Health history without losing or duplicating event-only dates", async () => {
    const healthDates = Array.from({ length: 200 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 0, 1 - index * 5));
      return date.toISOString().slice(0, 10);
    });
    const healthPages = [healthDates.slice(0, 100), healthDates.slice(100)];
    const pageBoundaryEventDate = shiftDate(healthDates[100]!, 2);
    const afterLatestHealthEventDate = shiftDate(healthDates[0]!, 9);
    const noHealthRowsEventDate = shiftDate(healthDates.at(-1)!, -30);
    const allHistoryFacts = [
      eventFact(noHealthRowsEventDate, "901"),
      eventFact(pageBoundaryEventDate, "902"),
      eventFact(afterLatestHealthEventDate, "903"),
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/v1/days") {
        if (url.searchParams.has("from")) return jsonResponse({ days: [], trainingDays: [] });
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const page = offset / 100;
        return jsonResponse({
          days: (healthPages[page] ?? []).map((date) => day(date)),
          trainingDays: offset === 0 ? allHistoryFacts : [],
        });
      }
      if (url.pathname === "/api/v1/work-intervals") return jsonResponse({ intervals: [] });
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HistoryClient />);
    const user = userEvent.setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "All" }));

    const desktop = within(screen.getByTestId("desktop-history-table"));
    await waitFor(() => {
      expect(desktop.getByText(noHealthRowsEventDate)).toBeTruthy();
      expect(desktop.getByText(pageBoundaryEventDate)).toBeTruthy();
      expect(desktop.getByText(afterLatestHealthEventDate)).toBeTruthy();
      expect(desktop.getByText(healthDates.at(-1)!)).toBeTruthy();
    });

    const dayRequests = fetchMock.mock.calls
      .map(([input]) => new URL(String(input), "http://localhost"))
      .filter((url) => url.pathname === "/api/v1/days" && !url.searchParams.has("from"));
    expect(dayRequests.map((url) => url.searchParams.get("offset"))).toEqual(["0", "100", "200"]);
    expect(dayRequests.slice(1).every((url) => url.searchParams.get("includeTrainingDays") === "false")).toBe(true);
    expect(desktop.getAllByText(pageBoundaryEventDate)).toHaveLength(1);
    expect(desktop.getAllByText(afterLatestHealthEventDate)).toHaveLength(1);
    expect(healthDates[0]).toBe("2025-01-01");
    expect(Date.parse(`${healthDates[0]}T00:00:00Z`) - Date.parse(`${healthDates.at(-1)}T00:00:00Z`))
      .toBeGreaterThan(366 * 86_400_000);
  });

  it("keeps the selected range when the earlier history request resolves later", async () => {
    const staleDate = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const selectedDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    let resolveInitial!: (response: Response) => void;
    const initialDaysResponse = new Promise<Response>((resolve) => { resolveInitial = resolve; });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/v1/days") {
        if (url.searchParams.has("from")) return initialDaysResponse;
        return Promise.resolve(jsonResponse({ days: [day(selectedDate, { weightKg: 80 })], trainingDays: [] }));
      }
      if (url.pathname === "/api/v1/work-intervals") return Promise.resolve(jsonResponse({ intervals: [] }));
      return Promise.resolve(jsonResponse({ error: "unexpected" }, 500));
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<HistoryClient />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "All" }));

    const table = within(screen.getByTestId("desktop-history-table"));
    await waitFor(() => expect(table.getByText(selectedDate)).toBeTruthy());
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      resolveInitial(jsonResponse({ days: [day(staleDate, { weightKg: 79 })], trainingDays: [] }));
      await initialDaysResponse;
      await Promise.resolve();
    });

    expect(table.getByText(selectedDate)).toBeTruthy();
    expect(table.queryByText(staleDate)).toBeNull();
  });

  it("renders an unavailable measurement as a dash while retaining an observed value", async () => {
    const unavailableDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const measuredDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/v1/days") return jsonResponse({
        days: [day(unavailableDate, { weightKg: null }), day(measuredDate, { weightKg: 80 })],
        trainingDays: [],
      });
      if (url.pathname === "/api/v1/work-intervals") return jsonResponse({ intervals: [] });
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HistoryClient />);
    const table = within(screen.getByTestId("desktop-history-table"));
    await waitFor(() => expect(table.getByText(unavailableDate)).toBeTruthy());

    const weightColumn = table.getAllByRole("columnheader")
      .findIndex((header) => header.textContent?.includes("Weight"));
    expect(weightColumn).toBeGreaterThan(0);
    const unavailableRow = table.getByRole("row", { name: new RegExp(unavailableDate) });
    const measuredRow = table.getByRole("row", { name: new RegExp(measuredDate) });

    expect(within(unavailableRow).getAllByRole("cell")[weightColumn]?.textContent).toBe("—");
    expect(within(measuredRow).getAllByRole("cell")[weightColumn]?.textContent).toBe("80");
  });
});
