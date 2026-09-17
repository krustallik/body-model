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
import type { DailyMetricDto } from "@/modules/days/day.types";
import {
  sortDaysChronologically,
} from "@/modules/days/history-chart-data";
import { useI18n, type Locale } from "@/i18n/i18n-provider";
import styles from "./history.module.css";

type Series = {
  key: string;
  label: string;
  unit: string;
  color: string;
  yAxisId?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  dot?: boolean;
};

const tooltipStyle = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "10px",
  color: "var(--ink)",
  fontSize: "12px",
};

function shortDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function longDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function HistoryLineChart({
  title,
  description,
  days,
  series,
  dualAxis = false,
  locale,
}: {
  title: string;
  description: string;
  days: Array<Record<string, unknown>>;
  series: Series[];
  dualAxis?: boolean;
  locale: Locale;
}) {
  if (!series.some(({ key }) => days.some((day) => typeof day[key] === "number"))) {
    return (
      <article className={styles.chartCard}>
        <ChartHeading title={title} description={description} />
        <div className={styles.chartEmpty}>{locale === "uk" ? "За цей період даних немає" : "No data for this period"}</div>
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
              tickFormatter={(value) => shortDate(value, locale)}
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
              labelFormatter={(label) => longDate(String(label), locale)}
              formatter={(value, name) => {
                const item = series.find(({ label }) => label === name);
                return [`${value} ${item?.unit ?? ""}`.trim(), String(name)];
              }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />}
            {series.map(({ key, label, color, yAxisId, strokeWidth = 2.4, strokeDasharray, dot = true }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                yAxisId={dualAxis ? yAxisId ?? "left" : undefined}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                connectNulls
                dot={dot ? { r: 2.5, fill: color, strokeWidth: 0 } : false}
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
  const { locale } = useI18n();
  const uk = locale === "uk";
  const chronologicalDays = sortDaysChronologically(days);
  const restingDays = chronologicalDays.map((day) => ({
    ...day,
    restingHeartRateLatest: day.restingHeartRate?.latestBpm ?? null,
  }));

  return (
    <section className={styles.chartsSection} aria-labelledby="charts-heading">
      <div className={styles.chartsTitle}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Лише фактичні дані" : "Actual data only"}</p>
          <h2 id="charts-heading">{uk ? "Графіки" : "Charts"}</h2>
        </div>
        <p>{uk ? "Нульові та відсутні значення означають відсутність запису й не показуються на графіку." : "Zero and missing values mean no record and are omitted from the chart."}</p>
      </div>
      <div className={styles.chartsGrid}>
        <HistoryLineChart
          title={uk ? "Вага і жир" : "Weight & body fat"}
          description={uk ? "Маса тіла · кг та жирова маса · %" : "Body weight · kg and body fat · %"}
          days={chronologicalDays}
          dualAxis
          locale={locale}
          series={[
            { key: "weightKg", label: uk ? "Вага" : "Weight", unit: "kg", color: "#176b4d", yAxisId: "left" },
            {
              key: "bodyFatPercent",
              label: uk ? "Жир" : "Body fat",
              unit: "%",
              color: "#b45f45",
              yAxisId: "right",
            },
          ]}
        />
        <HistoryLineChart
          title={uk ? "Пульс у спокої" : "Resting heart rate"}
          description={uk ? "Останнє значення кожного дня · bpm" : "Latest value on each day · bpm"}
          days={restingDays}
          locale={locale}
          series={[{ key: "restingHeartRateLatest", label: uk ? "Пульс у спокої" : "Resting HR", unit: "bpm", color: "#b45f45" }]}
        />
        <HistoryLineChart
          title={uk ? "Харчування" : "Nutrition"}
          description={uk ? "Калорії · ккал та макронутрієнти · г" : "Calories · kcal and macros · g"}
          days={chronologicalDays}
          dualAxis
          locale={locale}
          series={[
            {
              key: "caloriesKcal",
              label: uk ? "Калорії" : "Calories",
              unit: "kcal",
              color: "#e07a2f",
              yAxisId: "right",
              strokeWidth: 2.8,
              strokeDasharray: "7 4",
              dot: false,
            },
            { key: "proteinG", label: uk ? "Білки" : "Protein", unit: "g", color: "#d4a017", yAxisId: "left" },
            { key: "fatG", label: uk ? "Жири" : "Fat", unit: "g", color: "#b45f9b", yAxisId: "left" },
            { key: "carbsG", label: uk ? "Вуглеводи" : "Carbs", unit: "g", color: "#1aabb8", yAxisId: "left" },
          ]}
        />
        <HistoryLineChart
          title={uk ? "Кроки" : "Steps"}
          description={uk ? "Кількість кроків за день" : "Daily step count"}
          days={chronologicalDays}
          locale={locale}
          series={[{ key: "steps", label: uk ? "Кроки" : "Steps", unit: uk ? "кроків" : "steps", color: "#5b69c9" }]}
        />
        <HistoryLineChart
          title={uk ? "Рух і тренування" : "Movement & training"}
          description={uk ? "Дистанція ходьби та сумарна тривалість тренувань" : "Walking distance and total workout duration"}
          days={chronologicalDays}
          dualAxis
          locale={locale}
          series={[
            { key: "walkingDistanceKm", label: uk ? "Ходьба" : "Walking", unit: "km", color: "#168ca3", yAxisId: "left" },
            {
              key: "totalWorkoutMinutes",
              label: uk ? "Тренування" : "Training",
              unit: "min",
              color: "#bf5b45",
              yAxisId: "right",
            },
          ]}
        />
      </div>
    </section>
  );
}
