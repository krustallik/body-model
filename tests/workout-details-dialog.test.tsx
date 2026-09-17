import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkoutDetailsDialog } from "@/app/history/workout-details-dialog";
import type { DailyMetricDto } from "@/modules/days/day.types";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "uk", intlLocale: "uk-UA" }),
}));

function baseDay(overrides: Partial<DailyMetricDto> = {}): DailyMetricDto {
  return {
    date: "2026-09-16",
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
    updatedAt: "2026-09-16T10:00:00.000Z",
    ...overrides,
  };
}

describe("WorkoutDetailsDialog", () => {
  it("renders a single workout with active calories", () => {
    const html = renderToStaticMarkup(
      <WorkoutDetailsDialog
        day={baseDay({
          workoutSource: "workouts",
          totalWorkoutMinutes: 62,
          workouts: [{
            type: "Stair Climbing",
            canonicalType: "Stair Climbing",
            classification: "stair-climbing",
            startAt: "2026-09-16T08:44:00.000Z",
            endAt: "2026-09-16T09:46:00.000Z",
            durationMinutes: 62,
            activeEnergyKcal: 154,
          }],
        })}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Тренування за");
    expect(html).toContain("Stair Climbing");
    expect(html).toContain("активних ккал");
    expect(html).toContain("Закрити");
  });

  it("renders mixed workout types without calling everything strength", () => {
    const html = renderToStaticMarkup(
      <WorkoutDetailsDialog
        day={baseDay({
          workoutSource: "workouts",
          totalWorkoutMinutes: 107,
          workouts: [
            {
              type: "Stair Climbing",
              canonicalType: "Stair Climbing",
              classification: "stair-climbing",
              startAt: "2026-09-16T08:44:00.000Z",
              endAt: "2026-09-16T09:46:00.000Z",
              durationMinutes: 62,
              activeEnergyKcal: 154,
            },
            {
              type: "Traditional Strength Training",
              canonicalType: "Traditional Strength Training",
              classification: "traditional-strength-training",
              startAt: "2026-09-16T17:00:00.000Z",
              endAt: "2026-09-16T17:45:00.000Z",
              durationMinutes: 45,
              activeEnergyKcal: null,
            },
          ],
        })}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Stair Climbing");
    expect(html).toContain("Traditional Strength Training");
    expect(html.match(/Силове тренування/g) ?? []).toHaveLength(0);
  });

  it("explains legacy strength fallback without inventing timestamps", () => {
    const html = renderToStaticMarkup(
      <WorkoutDetailsDialog
        day={baseDay({
          workoutSource: "legacy-strength",
          totalWorkoutMinutes: 62,
          strengthTrainingMinutes: 62,
        })}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Силове тренування");
    expect(html).toContain("62");
    expect(html).toContain("legacy");
    expect(html).not.toContain("–");
  });

  it("still lists workout timing when active energy is missing", () => {
    const html = renderToStaticMarkup(
      <WorkoutDetailsDialog
        day={baseDay({
          workoutSource: "workouts",
          totalWorkoutMinutes: 40,
          workouts: [{
            type: "Yoga",
            canonicalType: "Yoga",
            classification: "other",
            startAt: "2026-09-16T07:00:00.000Z",
            endAt: "2026-09-16T07:40:00.000Z",
            durationMinutes: 40,
            activeEnergyKcal: null,
          }],
        })}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Yoga");
    expect(html).toContain("40");
    expect(html).toContain("Активні ккал");
    expect(html).not.toContain("активних ккал");
    expect(html).toMatch(/<dd>—<\/dd>/);
  });
});
