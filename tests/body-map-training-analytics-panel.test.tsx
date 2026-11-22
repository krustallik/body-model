/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

import { BodyMapTrainingAnalyticsPanel } from "@/components/body-map/body-map-training-analytics-panel";
import { trainingExerciseMappingSnapshotJsonV1 } from "@/modules/training/exercise-mapping-snapshot";
import {
  buildBodyMapTrainingAnalyticsV1,
  type BodyMapAnalyticsSessionInputV1,
  type BodyMapAnalyticsMonthsV1,
  type BodyMapTrainingAnalyticsResponseV1,
} from "@/modules/training/body-map-training-analytics-v1";

function session(input: { id: number; date: string; weightKg: number; rir?: number | null; stableKey?: string; name?: string }): BodyMapAnalyticsSessionInputV1 {
  const at = new Date(`${input.date}T17:00:00.000Z`);
  const stableKey = input.stableKey ?? "flat_dumbbell_bench_press";
  return {
    id: input.id,
    effectiveAccountingAt: at,
    matchedWorkout: null,
    webStartedAt: at,
    createdAt: at,
    accountingTimeZone: "UTC",
    sessionIntent: "regular",
    sessionLoadAssessment: "NOT_LIGHTER",
    trainingBlockLabel: null,
    trainingWeekNumber: null,
    exercises: [{
      id: input.id * 10,
      snapshotExerciseName: input.name ?? "Dumbbell bench press",
      sortOrder: 1,
      plannedSets: 3,
      plannedRepsMin: 8,
      plannedRepsMax: 10,
      plannedRir: 2,
      resistanceType: "EXTERNAL_WEIGHT",
      muscleMappingSnapshot: trainingExerciseMappingSnapshotJsonV1(stableKey),
      sourceExerciseCatalog: { stableKey },
      sets: Array.from({ length: 3 }, (_, index) => ({
        id: input.id * 100 + index,
        setNumber: index + 1,
        reps: 8,
        weightKg: input.weightKg,
        bandNominalResistanceKg: null,
        rir: input.rir === undefined ? 2 : input.rir,
        restBeforeSeconds: 90,
        completedAt: at,
      })),
    }],
  };
}

const dates = ["2026-06-20", "2026-07-05", "2026-07-20", "2026-08-05", "2026-08-20", "2026-09-05"];

function analytics(sessions: BodyMapAnalyticsSessionInputV1[]): BodyMapTrainingAnalyticsResponseV1 {
  return {
    ...buildBodyMapTrainingAnalyticsV1({ sessions, weeks: 12, now: new Date("2026-09-10T00:00:00.000Z") }),
    sessionContexts: [],
  };
}

function renderMuscle(data: BodyMapTrainingAnalyticsResponseV1, onMonthsChange = vi.fn()) {
  const groupReport = data.groups.find(({ groupId }) => groupId === "chest")!;
  return render(<BodyMapTrainingAnalyticsPanel
    level="GROUP_DETAIL"
    months={3}
    onMonthsChange={onMonthsChange}
    analytics={data}
    requestState="ready"
    groupLabel="Chest"
    anatomyId={null}
    anatomyLabel={null}
    groupReport={groupReport}
  />);
}

describe("Body Map training analytics panel", () => {
  afterEach(() => cleanup());

  it("shows one muscle-level result and keeps all exercise evidence compact and collapsed", () => {
    const data = analytics([20, 20, 22, 22, 24, 24].map((weightKg, index) => session({ id: index + 1, date: dates[index]!, weightKg })));
    renderMuscle(data);

    expect(screen.getByRole("heading", { name: "Chest" })).toBeTruthy();
    expect(screen.getAllByText("Recorded performance is improving")).toHaveLength(2);
    expect(screen.getByText(/1 of 1 exercises show higher typical results/)).toBeTruthy();
    expect(screen.getByText(/Logged-set trend; warm-ups are not marked separately/)).toBeTruthy();
    expect(screen.getByText(/does not measure muscle growth/)).toBeTruthy();
    const details = screen.getByTestId("body-map-exercise-progress");
    expect(details.querySelector("summary")?.textContent).toMatch(/20 kg × 8 reps\s*→\s*24 kg × 8 reps/);
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(screen.queryByText(/RIR\s*[:=]/i)).toBeNull();
    expect(screen.queryByText(/matched set pairs|unmapped sets|mapping coverage/i)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Analysis period" })).toBeTruthy();
  });

  it("lists every analyzed exercise and reveals only a short summary when expanded", async () => {
    const user = userEvent.setup();
    const sessions = dates.map((date, index) => ({
      ...session({ id: index + 1, date, weightKg: 20 + index * 2 }),
      exercises: [
        session({ id: index + 1, date, weightKg: 20 + index * 2 }).exercises[0]!,
        {
          ...session({ id: index + 1, date, weightKg: 12 + index * 2, stableKey: "flat_dumbbell_fly", name: "Dumbbell fly" }).exercises[0]!,
          sortOrder: 2,
        },
      ],
    }));
    renderMuscle(analytics(sessions));

    expect(screen.getByText("2")).toBeTruthy();
    const exercise = screen.getByText("Dumbbell fly").closest("details") as HTMLDetailsElement;
    expect(exercise.open).toBe(false);
    await user.click(exercise.querySelector("summary")!);
    expect(exercise.open).toBe(true);
    expect(within(exercise).getByText(/summarizes the recorded set results/)).toBeTruthy();
    expect(within(exercise).getByRole("img", { name: "Logged load trend" })).toBeTruthy();
  });

  it("offers the four requested calendar periods", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderMuscle(analytics([]), onChange);
    await user.selectOptions(screen.getByRole("combobox", { name: "Analysis period" }), "6");
    expect(onChange).toHaveBeenCalledWith(6 satisfies BodyMapAnalyticsMonthsV1);
    expect(within(screen.getByRole("combobox")).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "1 month", "2 months", "3 months", "6 months",
    ]);
  });
});
