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
import type { ForecastMetric, } from "@/modules/model-forecast/forecast-ui";
import { chartRows, formatDate, formatValue } from "@/modules/model-forecast/forecast-ui";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";

type HistoricalDay = {
  date: string;
  modeledWeightKg: number | null;
  fatMassKg: number | null;
  leanTissueKg: number | null;
  glycogenKg: number | null;
  dataQuality: string;
};

const historyKeys: Record<ForecastMetric, keyof HistoricalDay> = {
  physiologicalBodyWeightKg: "modeledWeightKg",
  fatMassKg: "fatMassKg",
  leanTissueKg: "leanTissueKg",
  glycogenAssociatedMassKg: "glycogenKg",
};

function Tick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  return <text x={x} y={(y ?? 0) + 14} textAnchor="middle" fill="currentColor" fontSize="11">{payload ? formatDate(payload.value) : ""}</text>;
}

export function ForecastChart({ result, metric, history }: {
  result: ForecastResult;
  metric: ForecastMetric;
  history: HistoricalDay[];
}) {
  const historical = history
    .map((day) => ({ date: day.date, historical: day[historyKeys[metric]] as number | null }))
    .filter((day) => day.historical !== null);
  const rows = [...historical, ...chartRows(result, metric)];
  const firstForecastDate = result.dates[0]?.date;

  return (
    <div style={{ width: "100%", height: 360 }} role="img" aria-label="Historical model line followed by median forecast, likely range, and wider possible range">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 18, right: 14, bottom: 6, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={<Tick />} minTickGap={48} axisLine={false} tickLine={false} />
          <YAxis width={52} tickFormatter={(value) => Number(value).toFixed(1)} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip
            labelFormatter={(date) => formatDate(String(date), { year: "numeric" })}
            formatter={(value, name) => {
              if (Array.isArray(value)) return [`${formatValue(Number(value[0]))} – ${formatValue(Number(value[1]))}`, name];
              return [formatValue(Number(value)), name];
            }}
          />
          <Area type="monotone" dataKey="possible" name="Wider possible range (5–95%)" fill="var(--band-outer)" stroke="none" connectNulls={false} />
          <Area type="monotone" dataKey="likely" name="Likely range (25–75%)" fill="var(--band-inner)" stroke="none" connectNulls={false} />
          <Line type="monotone" dataKey="historical" name="Modeled history" stroke="var(--history-line)" strokeWidth={2} dot={false} connectNulls={false} />
          <Line type="monotone" dataKey="median" name="Expected estimate" stroke="var(--forecast-line)" strokeWidth={3} dot={false} connectNulls={false} />
          {firstForecastDate && <ReferenceLine x={firstForecastDate} stroke="var(--boundary)" strokeDasharray="4 4" label={{ value: "Forecast", position: "insideTopRight", fill: "var(--muted)", fontSize: 11 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
