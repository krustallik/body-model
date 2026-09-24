/** @vitest-environment jsdom */
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

import { WorkoutDetailsDialog } from "@/app/history/workout-details-dialog";
import { HistoryCharts } from "@/app/history/history-charts";
import type { DailyMetricDto } from "@/modules/days/day.types";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children, data }: { children: React.ReactNode; data: unknown }) => (
    <div data-chart={JSON.stringify(data)}>{children}</div>
  ),
  Line: (props: Record<string, unknown>) => (
    <div
      data-line={String(props.dataKey)}
      data-connect-nulls={String(props.connectNulls ?? false)}
      data-name={String(props.name)}
    />
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

function day(date: string, overrides: Partial<DailyMetricDto> = {}): DailyMetricDto {
  const result: DailyMetricDto = {
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
    walkingDistanceKm: null,
    strengthTrainingMinutes: null,
    workouts: [],
    totalWorkoutMinutes: null,
    workoutSource: "none",
    workoutFeedObserved: null,
    updatedAt: `${date}T10:00:00.000Z`,
    ...overrides,
  };
  return {
    ...result,
    trainingDayFact: result.trainingDayFact ?? {
      date,
      eventCount: result.workoutSource === "workouts" ? Math.max(1, result.workouts.length) : 0,
      durationMinutes: result.workoutSource === "workouts" ? result.totalWorkoutMinutes : 0,
      hiddenEventCount: 0,
      events: [],
    },
  };
}

describe("WorkoutDetailsDialog interaction", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens a modal dialog for mixed Stair + Strength workouts and closes on button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const mixed = day("2026-09-16", {
      workoutSource: "workouts",
      totalWorkoutMinutes: 90,
      workouts: [
        {
          id: 11,
          type: "Stair Climbing",
          canonicalType: "Stair Climbing",
          classification: "stair-climbing",
          startAt: "2026-09-16T08:00:00.000Z",
          endAt: "2026-09-16T08:20:00.000Z",
          durationMinutes: 20,
          activeEnergyKcal: 154,
        },
        {
          id: 12,
          type: "Traditional Strength Training",
          canonicalType: "Traditional Strength Training",
          classification: "traditional-strength-training",
          startAt: "2026-09-16T17:00:00.000Z",
          endAt: "2026-09-16T18:15:00.000Z",
          durationMinutes: 75,
          activeEnergyKcal: null,
          linkedTrainingSessionId: null,
        },
      ],
    });

    // jsdom lacks HTMLDialogElement.showModal; polyfill for the component effect.
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };

    render(<WorkoutDetailsDialog day={mixed} onClose={onClose} />);
    expect(screen.getByText(/Workouts on/i)).toBeTruthy();
    expect(screen.getByText(/Stair/i)).toBeTruthy();
    expect(screen.getByText(/Strength/i)).toBeTruthy();
    expect(screen.getByText(/154/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Add training diary entry/i }).getAttribute("href")).toBe(
      "/training/backfill/from/12",
    );
    // Optional active kcal renders as em dash, not invented zero.
    const cards = screen.getAllByRole("article");
    expect(within(cards[1]!).getByText("—")).toBeTruthy();

    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    await user.click(closeButtons[closeButtons.length - 1]!);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows edit diary CTA when a strength workout is already linked", () => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    render(
      <WorkoutDetailsDialog
        day={day("2026-09-16", {
          workoutSource: "workouts",
          totalWorkoutMinutes: 75,
          workouts: [{
            id: 44,
            type: "Traditional Strength Training",
            canonicalType: "Traditional Strength Training",
            classification: "traditional-strength-training",
            startAt: "2026-09-16T17:00:00.000Z",
            endAt: "2026-09-16T18:15:00.000Z",
            durationMinutes: 75,
            activeEnergyKcal: 200,
            linkedTrainingSessionId: 99,
            linkedTrainingProgramName: "Push A",
          }],
        })}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole("link", { name: /Traditional Strength Training/i }).getAttribute("href"))
      .toBe("/training/sessions/99");
    const link = screen.getByRole("link", { name: /Edit training diary entry/i });
    expect(link.getAttribute("href")).toBe("/training/sessions/99/edit");
    expect(screen.getByText(/Push A/)).toBeTruthy();
  });

  it("does not render legacy duration as workout detail", () => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    render(
      <WorkoutDetailsDialog
        day={day("2026-09-10", {
          workoutSource: "legacy-strength",
          totalWorkoutMinutes: 45,
          strengthTrainingMinutes: 45,
        })}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/No training events recorded/i)).toBeTruthy();
    expect(screen.getByText(/Training events: 0/i)).toBeTruthy();
  });
});

describe("history workout detail eligibility", () => {
  it("uses eventCount for workout detail eligibility", () => {
    const rule = (row: DailyMetricDto) => (
      (row.trainingDayFact?.eventCount ?? row.workouts.length) > 0
    );
    expect(rule(day("2026-09-01"))).toBe(false);
    expect(rule(day("2026-09-02", {
      workoutSource: "workouts",
      totalWorkoutMinutes: 60,
    }))).toBe(true);
    expect(rule(day("2026-09-03", { workoutSource: "legacy-strength", totalWorkoutMinutes: 40 }))).toBe(false);
  });
});

describe("HistoryCharts workout gaps", () => {
  it("shows zero training on days with no event and preserves unknown duration for events", () => {
    const html = renderToStaticMarkup(
      <HistoryCharts
        days={[
          day("2026-09-01", {
            walkingDistanceKm: 4,
            totalWorkoutMinutes: 60,
            workoutSource: "workouts",
          }),
          day("2026-09-02", {
            walkingDistanceKm: 3,
            totalWorkoutMinutes: null,
            workoutSource: "workouts",
          }),
          day("2026-09-03", {
            walkingDistanceKm: 5,
            totalWorkoutMinutes: 70,
            workoutSource: "workouts",
          }),
        ]}
      />,
    );
    expect(html).toContain('data-line="totalWorkoutMinutes"');
    expect(html).toContain('data-connect-nulls="true"');
    const charts = [...html.matchAll(/data-chart="([^"]*)"/g)].map((match) => (
      JSON.parse(match[1]!.replace(/&quot;/g, '"')) as Array<{ totalWorkoutMinutes: number | null }>
    ));
    const movement = charts.find((rows) => rows.some((row) => (
      Object.prototype.hasOwnProperty.call(row, "totalWorkoutMinutes")
    )));
    expect(movement?.some((row) => row.totalWorkoutMinutes === null)).toBe(true);
    expect(movement?.some((row) => row.totalWorkoutMinutes === 0)).toBe(true);
  });
});
