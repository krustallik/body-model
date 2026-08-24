"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastMetric } from "@/modules/model-forecast/forecast-ui";
import { chartRows, formatDate, formatValue } from "@/modules/model-forecast/forecast-ui";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import type { Locale } from "@/i18n/i18n-provider";
import styles from "./forecast.module.css";

type HistoricalDay = {
  date: string;
  modeledWeightKg: number | null;
  fatMassKg: number | null;
  leanTissueKg: number | null;
  glycogenAssociatedMassKg: number | null;
  dataQuality: string;
};

const historyKeys: Record<ForecastMetric, keyof HistoricalDay> = {
  physiologicalBodyWeightKg: "modeledWeightKg",
  fatMassKg: "fatMassKg",
  leanTissueKg: "leanTissueKg",
  glycogenAssociatedMassKg: "glycogenAssociatedMassKg",
};

type TooltipEntry = { name?: string; value?: number | readonly number[] };

function ForecastTooltip({ active, label, payload, metric, locale }: {
  active?: boolean;
  label?: string | number;
  payload?: readonly TooltipEntry[];
  metric: ForecastMetric;
  locale: Locale;
}) {
  if (!active || label === undefined || !payload?.length) return null;
  const uk = locale === "uk";
  const metricLabels: Record<ForecastMetric, string> = {
    physiologicalBodyWeightKg: uk ? "Оцінка ваги" : "Weight estimate",
    fatMassKg: uk ? "Оцінка жирової маси" : "Fat mass estimate",
    leanTissueKg: uk ? "Оцінка безжирової тканини" : "Lean tissue estimate",
    glycogenAssociatedMassKg: uk ? "Глікоген + пов’язана вода" : "Glycogen + associated water",
  };
  return <div className={styles.chartTooltip}>
    <strong>{metricLabels[metric]}</strong>
    <span>{formatDate(String(label), { year: "numeric" }, locale)}</span>
    <dl>{payload.map((entry) => {
      if (entry.value === undefined || !entry.name) return null;
      const value = Array.isArray(entry.value)
        ? `${formatValue(Number(entry.value[0]), "kg", locale)}–${formatValue(Number(entry.value[1]), "kg", locale)}`
        : formatValue(Number(entry.value), "kg", locale);
      return <div key={entry.name}><dt>{entry.name}</dt><dd>{value}</dd></div>;
    })}</dl>
  </div>;
}

function Tick({ x, y, payload, locale }: { x?: number; y?: number; payload?: { value: string }; locale: Locale }) {
  return <text x={x} y={(y ?? 0) + 14} textAnchor="middle" fill="currentColor" fontSize="11">{payload ? formatDate(payload.value, undefined, locale) : ""}</text>;
}

export function ForecastChart({ result, metric, history, locale }: {
  result: ForecastResult;
  metric: ForecastMetric;
  history: HistoricalDay[];
  locale: Locale;
}) {
  const uk = locale === "uk";
  const historical = history
    .map((day) => ({ date: day.date, historical: day[historyKeys[metric]] as number | null }))
    .filter((day) => day.historical !== null);
  const rows = [...historical, ...chartRows(result, metric)];
  const firstForecastDate = result.dates[0]?.date;

  return (
    <div style={{ width: "100%", height: 360 }} role="img" aria-label={uk ? "Історична лінія моделі, медіанний прогноз, імовірний і ширший можливий діапазони" : "Historical model line followed by median forecast, likely range, and wider possible range"}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 18, right: 14, bottom: 6, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={<Tick locale={locale} />} minTickGap={48} axisLine={false} tickLine={false} />
          <YAxis width={52} tickFormatter={(value) => Number(value).toFixed(1)} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip content={(props) => <ForecastTooltip active={props.active} label={props.label} payload={props.payload as readonly TooltipEntry[]} metric={metric} locale={locale} />} />
          <Area type="monotone" dataKey="possible" name={uk ? "Ширший можливий діапазон (5–95%)" : "Wider possible range (5–95%)"} fill="var(--band-outer)" stroke="none" connectNulls={false} />
          <Area type="monotone" dataKey="likely" name={uk ? "Імовірний діапазон (25–75%)" : "Likely range (25–75%)"} fill="var(--band-inner)" stroke="none" connectNulls={false} />
          <Line type="monotone" dataKey="historical" name={uk ? "Змодельована історія" : "Modeled history"} stroke="var(--history-line)" strokeWidth={2} dot={false} connectNulls={false} />
          <Line type="monotone" dataKey="median" name={uk ? "Очікувана оцінка" : "Expected estimate"} stroke="var(--forecast-line)" strokeWidth={3} dot={false} connectNulls={false} />
          {firstForecastDate && <ReferenceLine x={firstForecastDate} stroke="var(--boundary)" strokeDasharray="4 4" label={{ value: uk ? "Прогноз" : "Forecast", position: "insideTopRight", fill: "var(--muted)", fontSize: 11 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
