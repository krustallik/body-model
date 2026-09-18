import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", t: (value: string) => value }),
}));

import { WorkoutDetailsDialog } from "@/app/history/workout-details-dialog";
import type { DailyMetricDto, DayWorkoutDto } from "@/modules/days/day.types";

function workout(overrides: Partial<DayWorkoutDto> = {}): DayWorkoutDto {
  return {
    id: 1,
    type: "Traditional Strength Training",
    canonicalType: "traditionalStrengthTraining",
    classification: "traditional-strength-training",
    startAt: "2026-08-24T17:00:00.000Z",
    endAt: "2026-08-24T18:00:00.000Z",
    durationMinutes: 60,
    activeEnergyKcal: null,
    linkedTrainingSessionId: null,
    linkedTrainingProgramName: null,
    ...overrides,
  };
}

function day(overrides: Partial<DailyMetricDto> = {}): DailyMetricDto {
  return {
    date: "2026-08-24",
    updatedAt: "2026-08-24T20:00:00.000Z",
    weightKg: 80,
    bodyFatPercent: null,
    caloriesKcal: 2200,
    proteinG: 160,
    fatG: 70,
    carbsG: 220,
    steps: 8000,
    activeEnergyKcal: null,
    averageWalkingSpeedKmh: 5,
    walkingDistanceKm: 5,
    strengthTrainingMinutes: null,
    totalWorkoutMinutes: 60,
    workoutSource: "workouts",
    workoutFeedObserved: false,
    workouts: [workout()],
    ...overrides,
  };
}

describe("History provenance UI", () => {
  it("shows missing workout-feed and unavailable energy without inventing zero burn", () => {
    const html = renderToStaticMarkup(
      <WorkoutDetailsDialog day={day()} onClose={() => undefined} />,
    );
    expect(html).toMatch(/Workout feed missing/);
    expect(html).toMatch(/Missing feed ≠ rest day/);
    expect(html).toMatch(/Energy unavailable/);
    expect(html).toMatch(/not 0 kcal/);
    expect(html).not.toMatch(/>0</);
  });

  it("labels device active energy as an estimate when present", () => {
    const html = renderToStaticMarkup(
      <WorkoutDetailsDialog
        day={day({
          workoutFeedObserved: true,
          workouts: [workout({ activeEnergyKcal: 280, id: 2 })],
        })}
        onClose={() => undefined}
      />,
    );
    expect(html).toMatch(/Workout feed observed/);
    expect(html).toMatch(/Device estimate/);
    expect(html).toMatch(/280/);
  });
});
