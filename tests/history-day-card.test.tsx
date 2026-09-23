/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DailyMetricDto } from "@/modules/days/day.types";
import { historyRecordCount, historyWorkoutSummary } from "@/modules/days/history-card-presentation";
import { HistoryDayCard } from "@/app/history/history-day-card";

function day(overrides: Partial<DailyMetricDto> = {}): DailyMetricDto {
  return {
    date: "2026-09-03",
    updatedAt: "2026-09-03T10:00:00.000Z",
    weightKg: 72.4,
    bodyFatPercent: 24.8,
    caloriesKcal: 2140,
    proteinG: 132,
    fatG: 70,
    carbsG: 245,
    steps: 8100,
    activeEnergyKcal: 410,
    averageWalkingSpeedKmh: 4.6,
    walkingDistanceKm: 6.2,
    strengthTrainingMinutes: null,
    workouts: [
      {
        type: "Stair Climbing",
        canonicalType: "Stair Climbing",
        classification: "stair-climbing",
        startAt: "2026-09-03T08:00:00.000Z",
        endAt: "2026-09-03T08:20:00.000Z",
        durationMinutes: 20,
        activeEnergyKcal: 120,
      },
      {
        type: "Traditional Strength Training",
        canonicalType: "Traditional Strength Training",
        classification: "traditional-strength-training",
        startAt: "2026-09-03T17:00:00.000Z",
        endAt: "2026-09-03T18:15:00.000Z",
        durationMinutes: 75,
        activeEnergyKcal: null,
      },
    ],
    totalWorkoutMinutes: 95,
    workoutSource: "workouts",
    workoutFeedObserved: true,
    sleepMinutes: 462,
    restingHeartRateBpm: 58,
    ...overrides,
  };
}

describe("HistoryDayCard", () => {
  afterEach(cleanup);

  it("shows canonical workout, daily and expandable secondary values and calls the same actions", async () => {
    const user = userEvent.setup();
    const onDetails = vi.fn();
    const onWork = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <HistoryDayCard
        day={day()}
        intlLocale="en-US"
        uk={false}
        workActivityPresent
        onDetails={onDetails}
        onWork={onWork}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    const card = within(screen.getByTestId("mobile-day-card"));
    expect(card.getByText("Work activity recorded")).toBeTruthy();
    expect(card.getByText("2 workouts · stairs + strength · 1h 35m")).toBeTruthy();
    expect(card.getByText("72.4 kg")).toBeTruthy();
    expect(card.queryByText("—")).toBeNull();

    await user.click(card.getByText("Other measurements"));
    expect(card.getByText("24.8%")).toBeTruthy();
    expect(card.getByText("132 g")).toBeTruthy();
    expect(card.getByText("6.2 km")).toBeTruthy();
    expect(card.getByText("4.6 km/h")).toBeTruthy();
    expect(card.getByText("7:42")).toBeTruthy();
    expect(card.getByText("58 bpm")).toBeTruthy();

    await user.click(card.getByRole("button", { name: "Workout details for 2026-09-03" }));
    await user.click(card.getByRole("button", { name: "Work activity for 2026-09-03" }));
    await user.click(card.getByRole("button", { name: "Edit 2026-09-03" }));
    await user.click(card.getByRole("button", { name: "Delete 2026-09-03" }));
    expect(onDetails).toHaveBeenCalledOnce();
    expect(onWork).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("keeps rest, unavailable-feed, and legacy strength states distinct", () => {
    const restDay = day({ workouts: [], totalWorkoutMinutes: null, workoutSource: "none", workoutFeedObserved: true });
    const unavailableDay = day({ workouts: [], totalWorkoutMinutes: null, workoutSource: "none", workoutFeedObserved: false });
    const legacyDay = day({ workouts: [], totalWorkoutMinutes: 45, workoutSource: "legacy-strength", workoutFeedObserved: null });

    expect(historyWorkoutSummary(restDay, false)).toBe("Rest day");
    expect(historyWorkoutSummary(unavailableDay, false)).toBe("Workout data unavailable");
    expect(historyWorkoutSummary(legacyDay, false)).toBe("strength · 45m");
    expect(historyWorkoutSummary(restDay, true)).toBe("Відпочинок");
    expect(historyWorkoutSummary(unavailableDay, true)).toBe("Дані про тренування відсутні");
    expect(historyWorkoutSummary(legacyDay, true)).toBe("силове · 45 хв");
    expect(historyWorkoutSummary(day({ workouts: [], workoutFeedObserved: null }), false)).toBe("—");
  });

  it("uses localized Ukrainian units and plural forms", () => {
    const translated = day({
      workouts: [day().workouts[0]!, day().workouts[1]!, day().workouts[0]!, day().workouts[1]!, day().workouts[0]!],
      totalWorkoutMinutes: 150,
    });
    render(
      <HistoryDayCard
        day={translated}
        intlLocale="uk-UA"
        uk
        workActivityPresent={null}
        onDetails={() => undefined}
        onWork={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );

    const card = within(screen.getByTestId("mobile-day-card"));
    expect(card.getByText("Статус роботи недоступний")).toBeTruthy();
    expect(card.getByText("5 тренувань · сходи + силове · 2 год 30 хв")).toBeTruthy();
    expect(card.getByText("72,4 кг")).toBeTruthy();
    expect(historyRecordCount(1, true)).toBe("1 запис");
    expect(historyRecordCount(2, true)).toBe("2 записи");
    expect(historyRecordCount(5, true)).toBe("5 записів");
    expect(historyRecordCount(11, true)).toBe("11 записів");
    expect(historyRecordCount(21, true)).toBe("21 запис");
    expect(historyRecordCount(1, false)).toBe("1 record");
    expect(historyRecordCount(2, false)).toBe("2 records");
  });
});
