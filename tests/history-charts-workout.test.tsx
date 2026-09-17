import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HistoryCharts } from "@/app/history/history-charts";
import type { DailyMetricDto } from "@/modules/days/day.types";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart">{children}</div>,
  LineChart: ({ children, data }: { children: React.ReactNode; data: unknown }) => (
    <div data-chart={JSON.stringify(data)}>{children}</div>
  ),
  Line: (props: Record<string, unknown>) => (
    <div
      data-line={String(props.dataKey)}
      data-connect-nulls={String(props.connectNulls ?? false)}
      data-name={String(props.name)}
      data-stroke={String(props.stroke ?? "")}
      data-stroke-dasharray={String(props.strokeDasharray ?? "")}
      data-y-axis-id={String(props.yAxisId ?? "")}
    />
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "uk", intlLocale: "uk-UA" }),
}));

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
    walkingDistanceKm: null,
    strengthTrainingMinutes: null,
    workouts: [],
    totalWorkoutMinutes: null,
    workoutSource: "none",
    updatedAt: `${date}T10:00:00.000Z`,
    ...overrides,
  };
}

describe("HistoryCharts workout series", () => {
  it("renders a resting-heart-rate trend from each day's latest sample", () => {
    const html = renderToStaticMarkup(<HistoryCharts days={[
      day("2026-09-01", { restingHeartRate: { sampleCount: 1, minBpm: 58, maxBpm: 58, avgBpm: 58, latestBpm: 58, latestTimestamp: "2026-09-01T00:00:00.000Z", samples: [] } }),
      day("2026-09-02", { restingHeartRate: { sampleCount: 1, minBpm: 56, maxBpm: 56, avgBpm: 56, latestBpm: 56, latestTimestamp: "2026-09-02T00:00:00.000Z", samples: [] } }),
    ]} />);
    expect(html).toContain("Пульс у спокої");
    expect(html).toContain('data-line="restingHeartRateLatest"');
  });

  it("merges calories into nutrition and body fat into weight with dual axes", () => {
    const html = renderToStaticMarkup(
      <HistoryCharts
        days={[
          day("2026-09-01", { weightKg: 80, bodyFatPercent: 18, caloriesKcal: 2100, proteinG: 140, fatG: 70, carbsG: 200 }),
          day("2026-09-02", { weightKg: 79.8, bodyFatPercent: 17.9, caloriesKcal: 2000, proteinG: 135, fatG: 65, carbsG: 190 }),
        ]}
      />,
    );

    expect(html).toContain("Вага і жир");
    expect(html).toContain('data-line="bodyFatPercent"');
    expect(html).toContain("Харчування");
    expect(html).not.toContain(">Калорії</h3>");
    expect(html).not.toContain(">Макронутрієнти</h3>");
    expect(html).toContain('data-line="caloriesKcal"');
    expect(html).toContain('data-stroke="#e07a2f"');
    expect(html).toContain('data-stroke-dasharray="7 4"');
    expect(html).toContain('data-stroke="#d4a017"');
    expect(html).toContain('data-stroke="#b45f9b"');
    expect(html).toContain('data-stroke="#1aabb8"');
  });
  it("connects every series across missing observations without zero-filling", () => {
    const html = renderToStaticMarkup(
      <HistoryCharts
        days={[
          day("2026-09-01", { walkingDistanceKm: 4, totalWorkoutMinutes: 60, workoutSource: "workouts" }),
          day("2026-09-02", { walkingDistanceKm: 3, totalWorkoutMinutes: null }),
          day("2026-09-03", { walkingDistanceKm: 5, totalWorkoutMinutes: 70, workoutSource: "workouts" }),
        ]}
      />,
    );
    expect(html).toContain("Рух і тренування");
    expect(html).toContain('data-line="totalWorkoutMinutes"');
    expect(html).toContain('data-name="Тренування"');
    expect(html).toContain('data-connect-nulls="true"');
    expect(html).toContain('data-line="walkingDistanceKm"');
    expect(html).not.toContain('data-connect-nulls="false"');
    expect(html).not.toContain("Рух і силові");
    expect(html).not.toContain("Силове");

    const chartPayloads = [...html.matchAll(/data-chart="([^"]*)"/g)].map((match) => (
      JSON.parse(match[1].replace(/&quot;/g, '"')) as Array<{
        date: string;
        totalWorkoutMinutes: number | null;
      }>
    ));
    expect(chartPayloads.length).toBeGreaterThan(0);
    const movementRows = chartPayloads.find((rows) => rows.some((row) => (
      Object.prototype.hasOwnProperty.call(row, "totalWorkoutMinutes")
    )));
    expect(movementRows).toBeDefined();
    expect(movementRows!.some((row) => row.totalWorkoutMinutes === null)).toBe(true);
    expect(movementRows!.some((row) => row.totalWorkoutMinutes === 60)).toBe(true);
    expect(movementRows!.every((row) => row.totalWorkoutMinutes !== 0)).toBe(true);
  });

  it("shows an empty-state message when the workout series has no observations", () => {
    const html = renderToStaticMarkup(
      <HistoryCharts
        days={[
          day("2026-09-01", { caloriesKcal: 2_100 }),
          day("2026-09-02", { caloriesKcal: 2_000 }),
        ]}
      />,
    );
    expect(html).toContain("За цей період даних немає");
  });
});
