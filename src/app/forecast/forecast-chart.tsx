"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastMetric } from "@/modules/model-forecast/forecast-ui";
import { formatDate } from "@/modules/model-forecast/forecast-ui";
import {
  buildForecastChartRows,
  formatForecastChartValue,
  forecastChartLabels,
  type ForecastChartHistoryDay,
  type ForecastChartObservedDay,
} from "@/modules/model-forecast/forecast-chart-data";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import type { Locale } from "@/i18n/i18n-provider";
import styles from "./forecast.module.css";

type TooltipEntry = { name?: string; value?: unknown };

export function ForecastTooltip({ active, label, payload, metric, locale }: {
  active?: boolean;
  label?: string | number;
  payload?: readonly TooltipEntry[];
  metric: ForecastMetric;
  locale: Locale;
}) {
  if (!active || label === undefined || !payload?.length) return null;
  const uk = locale === "uk";
  const metricLabels: Record<ForecastMetric, string> = {
    physiologicalBodyWeightKg: uk ? "Вага" : "Weight",
    fatMassKg: uk ? "Жир" : "Fat mass",
    leanTissueKg: uk ? "Безжирова тканина" : "Lean tissue",
    glycogenAssociatedMassKg: uk ? "Глікоген і пов’язана вода" : "Glycogen + associated water",
  };
  const rows = payload.flatMap((entry) => {
    const value = formatForecastChartValue(entry.value, locale);
    return value && entry.name ? [{ name: entry.name, value }] : [];
  });
  if (rows.length === 0) return null;
  return <div className={styles.chartTooltip}>
    <strong>{metricLabels[metric]}</strong>
    <span>{formatDate(String(label), { year: "numeric" }, locale)}</span>
    <dl>{rows.map((entry, index) => <div key={`${entry.name}-${index}`}><dt>{entry.name}</dt><dd>{entry.value}</dd></div>)}</dl>
  </div>;
}

function Tick({ x, y, payload, locale }: { x?: number; y?: number; payload?: { value: string }; locale: Locale }) {
  return <text x={x} y={(y ?? 0) + 14} textAnchor="middle" fill="currentColor" fontSize="11">{payload ? formatDate(payload.value, undefined, locale) : ""}</text>;
}

export function ForecastChart({ result, metric, history, observedWeights = [], locale, target }: {
  result: ForecastResult;
  metric: ForecastMetric;
  history: ForecastChartHistoryDay[];
  observedWeights?: ForecastChartObservedDay[];
  locale: Locale;
  target?: { date: string; weightKg: number };
}) {
  const uk = locale === "uk";
  const rows = buildForecastChartRows({ result, metric, history, observedWeights });
  const bodyWeight = metric === "physiologicalBodyWeightKg";
  const engineeringRange = result.forecastVersion === "experimental-forecast-v1";
  const labels = forecastChartLabels(locale, metric, engineeringRange);
  const accessibleDescription = bodyWeight
    ? `${labels.measuredWeight}, ${labels.modelEstimate}, ${uk ? "майбутній прогноз" : "future forecast"}${target ? (uk ? ", введена ціль" : ", submitted target") : ""}`
    : `${labels.historicalEstimate}, ${uk ? "майбутній прогноз" : "future forecast"}${target ? (uk ? ", введена ціль" : ", submitted target") : ""}`;

  return (
    <div className={styles.chartViewport} role="img" aria-label={accessibleDescription}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 18, right: 14, bottom: 6, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={<Tick locale={locale} />} minTickGap={48} axisLine={false} tickLine={false} />
          <YAxis width={52} tickFormatter={(value) => Number(value).toFixed(1)} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip content={(props) => <ForecastTooltip active={props.active} label={props.label} payload={props.payload as readonly TooltipEntry[]} metric={metric} locale={locale} />} />
          {engineeringRange
            ? <Area type="monotone" dataKey="engineeringRangeKg" name={labels.engineeringDescription} fill="var(--band-outer)" stroke="none" connectNulls={false} />
            : <>
              <Area type="monotone" dataKey="outerIntervalKg" name={labels.outerInterval ?? undefined} fill="var(--band-outer)" stroke="none" connectNulls={false} />
              <Area type="monotone" dataKey="innerIntervalKg" name={labels.innerInterval ?? undefined} fill="var(--band-inner)" stroke="none" connectNulls={false} />
            </>}
          {bodyWeight
            ? <>
              <Line type="monotone" dataKey="modelEstimateKg" name={labels.modelEstimate} stroke="var(--history-line)" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="measuredWeightKg" name={labels.measuredWeight} stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            </>
            : <Line type="monotone" dataKey="historicalCompartmentKg" name={labels.historicalEstimate} stroke="var(--history-line)" strokeWidth={2} dot={false} connectNulls={false} />}
          <Line type="monotone" dataKey="futureMedianKg" name={labels.futureMedian} stroke="var(--forecast-line)" strokeWidth={3} dot={false} connectNulls={false} />
          {result.dates[0]?.date && <ReferenceLine x={result.dates[0].date} stroke="var(--boundary)" strokeDasharray="4 4" label={{ value: uk ? "Прогноз" : "Forecast", position: "insideTopRight", fill: "var(--muted)", fontSize: 11 }} />}
          {target && <ReferenceLine y={target.weightKg} stroke="var(--target, #b35b36)" strokeDasharray="6 4" />}
          {target && <ReferenceLine x={target.date} stroke="var(--target, #b35b36)" strokeDasharray="6 4" />}
          {target && <ReferenceDot x={target.date} y={target.weightKg} r={5} fill="var(--surface)" stroke="var(--target, #b35b36)" strokeWidth={3} label={{ value: uk ? "Ціль" : "Target", position: "top", fill: "var(--target, #b35b36)", fontSize: 11 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
