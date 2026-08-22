"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyMetricDto, DailyMetricField } from "@/modules/days/day.types";
import { hasChartData, sortDaysChronologically } from "@/modules/days/history-chart-data";
import styles from "./history.module.css";

type Series = {
  key: DailyMetricField;
  label: string;
  unit: string;
  color: string;
  yAxisId?: string;
};

const tooltipStyle = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "10px",
  color: "var(--ink)",
  fontSize: "12px",
};

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function longDate(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function HistoryLineChart({
  title,
  description,
  days,
  series,
  dualAxis = false,
}: {
  title: string;
  description: string;
  days: DailyMetricDto[];
  series: Series[];
  dualAxis?: boolean;
}) {
  if (!hasChartData(days, series.map(({ key }) => key))) {
    return (
      <article className={styles.chartCard}>
        <ChartHeading title={title} description={description} />
        <div className={styles.chartEmpty}>No data for this period</div>
      </article>
    );
  }

  return (
    <article className={styles.chartCard}>
      <ChartHeading title={title} description={description} />
      <div className={styles.chartCanvas}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={days} margin={{ top: 8, right: dualAxis ? 8 : 18, left: -18, bottom: 0 }} accessibilityLayer>
            <CartesianGrid stroke="var(--line)" strokeDasharray="4 5" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              minTickGap={24}
            />
            <YAxis
              yAxisId={dualAxis ? "left" : undefined}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
              domain={["auto", "auto"]}
            />
            {dualAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={42}
                domain={["auto", "auto"]}
              />
            )}
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(label) => longDate(String(label))}
              formatter={(value, name) => {
                const item = series.find(({ label }) => label === name);
                return [`${value} ${item?.unit ?? ""}`.trim(), String(name)];
              }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />}
            {series.map(({ key, label, color, yAxisId }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                yAxisId={dualAxis ? yAxisId ?? "left" : undefined}
                stroke={color}
                strokeWidth={2.4}
                connectNulls={false}
                dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function ChartHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.chartHeading}>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function HistoryCharts({ days }: { days: DailyMetricDto[] }) {
  const chronologicalDays = sortDaysChronologically(days);

  return (
    <section className={styles.chartsSection} aria-labelledby="charts-heading">
      <div className={styles.chartsTitle}>
        <div>
          <p className={styles.eyebrow}>Actual data only</p>
          <h2 id="charts-heading">Charts</h2>
        </div>
        <p>Missing values stay empty; explicit zero remains visible.</p>
      </div>
      <div className={styles.chartsGrid}>
        <HistoryLineChart
          title="Weight"
          description="Body weight · kg"
          days={chronologicalDays}
          series={[{ key: "weightKg", label: "Weight", unit: "kg", color: "#176b4d" }]}
        />
        <HistoryLineChart
          title="Calories"
          description="Daily intake · kcal"
          days={chronologicalDays}
          series={[{ key: "caloriesKcal", label: "Calories", unit: "kcal", color: "#d77a2a" }]}
        />
        <HistoryLineChart
          title="Macros"
          description="Protein, fat and carbs · g"
          days={chronologicalDays}
          series={[
            { key: "proteinG", label: "Protein", unit: "g", color: "#2878bd" },
            { key: "fatG", label: "Fat", unit: "g", color: "#b45f9b" },
            { key: "carbsG", label: "Carbs", unit: "g", color: "#d49a1f" },
          ]}
        />
        <HistoryLineChart
          title="Steps"
          description="Daily step count"
          days={chronologicalDays}
          series={[{ key: "steps", label: "Steps", unit: "steps", color: "#5b69c9" }]}
        />
        <HistoryLineChart
          title="Movement & strength"
          description="Walking distance and strength training"
          days={chronologicalDays}
          dualAxis
          series={[
            { key: "walkingDistanceKm", label: "Walking", unit: "km", color: "#168ca3", yAxisId: "left" },
            { key: "strengthTrainingMinutes", label: "Strength", unit: "min", color: "#bf5b45", yAxisId: "right" },
          ]}
        />
      </div>
    </section>
  );
}
