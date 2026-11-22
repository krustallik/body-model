/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

import { BodyMapTrainingAnalyticsPanel } from "@/components/body-map/body-map-training-analytics-panel";
import { trainingExerciseMappingSnapshotJsonV1 } from "@/modules/training/exercise-mapping-snapshot";
import { buildBodyMapTrainingAnalyticsV1, type BodyMapAnalyticsSessionInputV1, type BodyMapTrainingAnalyticsResponseV1 } from "@/modules/training/body-map-training-analytics-v1";

function session(input: {
  id: number;
  date: string;
  weightKg: number;
  rir: number | null;
  stableKey?: string;
  exerciseName?: string;
  trainingBlockLabel?: string | null;
}): BodyMapAnalyticsSessionInputV1 {
  const at = new Date(input.date + "T17:00:00.000Z");
  const stableKey = input.stableKey ?? "incline_dumbbell_press_30deg";
  return {
    id: input.id,
    effectiveAccountingAt: at,
    matchedWorkout: null,
    webStartedAt: at,
    createdAt: at,
    accountingTimeZone: "UTC",
    sessionIntent: null,
    trainingBlockLabel: input.trainingBlockLabel ?? null,
    trainingWeekNumber: null,
    exercises: [{
      id: input.id * 10,
      snapshotExerciseName: input.exerciseName ?? "Incline dumbbell press",
      sortOrder: 1,
      plannedSets: 3,
      plannedRepsMin: 8,
      plannedRepsMax: 10,
      plannedRir: 2,
      resistanceType: "EXTERNAL_WEIGHT",
      muscleMappingSnapshot: trainingExerciseMappingSnapshotJsonV1(stableKey),
      sourceExerciseCatalog: { stableKey },
      sets: Array.from({ length: 2 }, (_, index) => ({
        id: input.id * 100 + index,
        setNumber: index + 1,
        reps: 8,
        weightKg: input.weightKg,
        bandNominalResistanceKg: null,
        rir: input.rir,
        restBeforeSeconds: 90,
        completedAt: at,
      })),
    }],
  };
}

function analytics(sessions: BodyMapAnalyticsSessionInputV1[]): BodyMapTrainingAnalyticsResponseV1 {
  return {
    ...buildBodyMapTrainingAnalyticsV1({ sessions, weeks: 12, now: new Date("2026-09-10T00:00:00.000Z") }),
    sessionContexts: [],
  };
}

function renderGroup(data: BodyMapTrainingAnalyticsResponseV1, onRefresh = vi.fn()) {
  const groupReport = data.groups.find(({ groupId }) => groupId === "chest")!;
  return render(<BodyMapTrainingAnalyticsPanel
    level="GROUP_DETAIL"
    weeks={12}
    onWeeksChange={vi.fn()}
    analytics={data}
    requestState="ready"
    groupLabel="Chest"
    anatomyId={null}
    anatomyLabel={null}
    groupReport={groupReport}
    onRefresh={onRefresh}
  />);
}

describe("Body Map analytics panel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a compact muscle result and evidence while keeping the diary collapsed", () => {
    const data = analytics([
      session({ id: 1, date: "2026-07-01", weightKg: 20, rir: 2 }),
      session({ id: 2, date: "2026-07-20", weightKg: 22, rir: 2 }),
      session({ id: 3, date: "2026-08-10", weightKg: 24, rir: 2 }),
    ]);
    renderGroup(data);

    expect(screen.getAllByText("Recorded performance is trending up").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/20 kg × 8/)).toBeTruthy();
    expect(screen.getAllByText(/22 kg × 8/).length).toBeGreaterThanOrEqual(1);
    const progressCard = screen.getByRole("region", { name: "Diary progress summary" });
    expect(progressCard.querySelector("ul")?.children).toHaveLength(2);
    const detailedRecords = screen.getByText("Detailed diary records and sources").closest("details");
    expect(detailedRecords?.open).toBe(false);
  });

  it("asks for a manual assessment only when the latest mapped session is uncertain", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const fetchMock = vi.fn(async () => Response.json({ saved: true, assessment: "LIGHTER" }));
    vi.stubGlobal("fetch", fetchMock);
    const data = analytics([session({ id: 8, date: "2026-08-30", weightKg: 20, rir: null })]);

    renderGroup(data, onRefresh);
    expect(screen.getByText("There are not enough diary records yet. Was this session easier than usual?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Yes, it was easier" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/training/sessions/8/load-assessment",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: "lighter" }) }),
    ));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("builds a group summary only from the latest shared training phase", () => {
    const data = analytics([
      session({ id: 1, date: "2026-07-01", weightKg: 20, rir: 2, trainingBlockLabel: "Base" }),
      session({ id: 2, date: "2026-07-15", weightKg: 22, rir: 2, trainingBlockLabel: "Base" }),
      session({ id: 3, date: "2026-07-31", weightKg: 24, rir: 2, trainingBlockLabel: "Base" }),
      session({ id: 4, date: "2026-08-10", weightKg: 30, rir: 2, stableKey: "flat_dumbbell_fly", exerciseName: "Flat dumbbell fly", trainingBlockLabel: "Deload" }),
      session({ id: 5, date: "2026-08-25", weightKg: 28, rir: 2, stableKey: "flat_dumbbell_fly", exerciseName: "Flat dumbbell fly", trainingBlockLabel: "Deload" }),
      session({ id: 6, date: "2026-09-09", weightKg: 26, rir: 2, stableKey: "flat_dumbbell_fly", exerciseName: "Flat dumbbell fly", trainingBlockLabel: "Deload" }),
    ]);
    const { unmount: unmountInitial } = renderGroup(data);

    const progressCard = screen.getByRole("region", { name: "Diary progress summary" });
    expect(progressCard.getAttribute("data-progress")).toBe("declining");
    expect(progressCard.textContent).toContain("Flat dumbbell fly");
    expect(progressCard.textContent).toMatch(/30 kg × 8 → 28 kg × 8/);
    expect(progressCard.textContent).not.toMatch(/20 kg × 8/);
    expect(progressCard.textContent).toContain("The summary uses only the latest phase; earlier phases are kept separate.");
    unmountInitial();

    const latestSessions = data.sessions.slice(-2);
    expect(latestSessions.map(({ phaseNumber }) => phaseNumber)).toEqual([2, 2]);

    const withLaterUnmappedMusclePhase = analytics([
      session({ id: 1, date: "2026-07-01", weightKg: 20, rir: 2, trainingBlockLabel: "Base" }),
      session({ id: 2, date: "2026-07-15", weightKg: 22, rir: 2, trainingBlockLabel: "Base" }),
      session({ id: 3, date: "2026-07-31", weightKg: 24, rir: 2, trainingBlockLabel: "Base" }),
      session({ id: 4, date: "2026-08-10", weightKg: 30, rir: 2, stableKey: "flat_dumbbell_fly", exerciseName: "Flat dumbbell fly", trainingBlockLabel: "Deload" }),
      session({ id: 5, date: "2026-08-25", weightKg: 28, rir: 2, stableKey: "flat_dumbbell_fly", exerciseName: "Flat dumbbell fly", trainingBlockLabel: "Deload" }),
      session({ id: 6, date: "2026-09-09", weightKg: 26, rir: 2, stableKey: "flat_dumbbell_fly", exerciseName: "Flat dumbbell fly", trainingBlockLabel: "Deload" }),
      session({ id: 7, date: "2026-09-09", weightKg: 40, rir: 2, stableKey: "one_arm_seated_cable_row", exerciseName: "One-arm seated cable row", trainingBlockLabel: "Accumulation" }),
    ]);
    expect(withLaterUnmappedMusclePhase.sessions.at(-1)?.phaseNumber).toBe(3);
    const onRefresh = vi.fn();
    const { unmount } = renderGroup(withLaterUnmappedMusclePhase, onRefresh);

    const staleTrendCard = screen.getByRole("region", { name: "Diary progress summary" });
    expect(staleTrendCard.getAttribute("data-progress")).toBe("insufficient-data");
    expect(staleTrendCard.textContent).toContain("There are no records for this muscle group in the latest phase; earlier phases are not shown as the current trend.");
    expect(staleTrendCard.textContent).not.toMatch(/30 kg × 8/);
    unmount();
  });
});
