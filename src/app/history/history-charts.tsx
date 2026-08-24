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
import { useI18n, type Locale } from "@/i18n/i18n-provider";
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
  days: DailyMetricDto[];
  series: Series[];
  dualAxis?: boolean;
  locale: Locale;
}) {
  if (!hasChartData(days, series.map(({ key }) => key))) {
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
  const { locale } = useI18n();
  const uk = locale === "uk";
  const chronologicalDays = sortDaysChronologically(days);

  return (
    <section className={styles.chartsSection} aria-labelledby="charts-heading">
      <div className={styles.chartsTitle}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Лише фактичні дані" : "Actual data only"}</p>
          <h2 id="charts-heading">{uk ? "Графіки" : "Charts"}</h2>
        </div>
        <p>{uk ? "Відсутні значення залишаються порожніми; явний нуль залишається видимим." : "Missing values stay empty; explicit zero remains visible."}</p>
      </div>
      <div className={styles.chartsGrid}>
        <HistoryLineChart
          title={uk ? "Вага" : "Weight"}
          description={uk ? "Маса тіла · кг" : "Body weight · kg"}
          days={chronologicalDays}
          locale={locale}
          series={[{ key: "weightKg", label: uk ? "Вага" : "Weight", unit: "kg", color: "#176b4d" }]}
        />
        <HistoryLineChart
          title={uk ? "Калорії" : "Calories"}
          description={uk ? "Добове споживання · ккал" : "Daily intake · kcal"}
          days={chronologicalDays}
          locale={locale}
          series={[{ key: "caloriesKcal", label: uk ? "Калорії" : "Calories", unit: "kcal", color: "#d77a2a" }]}
        />
        <HistoryLineChart
          title={uk ? "Макронутрієнти" : "Macros"}
          description={uk ? "Білки, жири та вуглеводи · г" : "Protein, fat and carbs · g"}
          days={chronologicalDays}
          locale={locale}
          series={[
            { key: "proteinG", label: uk ? "Білки" : "Protein", unit: "g", color: "#2878bd" },
            { key: "fatG", label: uk ? "Жири" : "Fat", unit: "g", color: "#b45f9b" },
            { key: "carbsG", label: uk ? "Вуглеводи" : "Carbs", unit: "g", color: "#d49a1f" },
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
          title={uk ? "Рух і силові" : "Movement & strength"}
          description={uk ? "Дистанція ходьби та силові тренування" : "Walking distance and strength training"}
          days={chronologicalDays}
          dualAxis
          locale={locale}
          series={[
            { key: "walkingDistanceKm", label: uk ? "Ходьба" : "Walking", unit: "km", color: "#168ca3", yAxisId: "left" },
            { key: "strengthTrainingMinutes", label: uk ? "Силове" : "Strength", unit: "min", color: "#bf5b45", yAxisId: "right" },
          ]}
        />
      </div>
    </section>
  );
}
