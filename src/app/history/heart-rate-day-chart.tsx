"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/i18n/i18n-provider";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { todayInCalendarTimeZone } from "@/modules/days/calendar-range";
import type { HeartRateDayDto } from "@/modules/days/day.types";
import styles from "./history.module.css";

const EMPTY_HEART_RATE: HeartRateDayDto = {
  sampleCount: 0,
  minBpm: null,
  maxBpm: null,
  avgBpm: null,
  latestBpm: null,
  latestTimestamp: null,
  samples: [],
};

const tooltipStyle = {
  backgroundColor: "var(--surface-2)",
  border: "1px solid var(--line)",
  borderRadius: "10px",
  color: "var(--ink)",
  fontSize: "13px",
};

function localToday(): string {
  return todayInCalendarTimeZone();
}

function formatClock(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DEFAULT_TIME_ZONE,
  }).format(new Date(iso));
}

export function HeartRateDayChart() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const today = localToday();
  const [date, setDate] = useState(today);
  const [heartRate, setHeartRate] = useState<HeartRateDayDto>(EMPTY_HEART_RATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetch(`/api/v1/heart-rate?date=${encodeURIComponent(date)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(uk ? `Помилка запиту (${response.status})` : `Request failed (${response.status})`);
        }
        const body = await response.json() as { heartRate: HeartRateDayDto };
        if (!active) return;
        setHeartRate(body.heartRate ?? EMPTY_HEART_RATE);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setHeartRate(EMPTY_HEART_RATE);
        setError(loadError instanceof Error
          ? loadError.message
          : (uk ? "Не вдалося завантажити пульс" : "Could not load heart rate"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [date, uk]);

  function selectDate(nextDate: string) {
    if (nextDate === date) return;
    setLoading(true);
    setError(null);
    setHeartRate(EMPTY_HEART_RATE);
    setDate(nextDate);
  }

  return (
    <article className={`${styles.chartCard} ${styles.heartRateDayCard}`} aria-labelledby="heart-rate-day-heading">
      <div className={styles.heartRateDayHeader}>
        <div className={styles.chartHeading}>
          <h3 id="heart-rate-day-heading">{uk ? "Пульс за день" : "Heart rate by day"}</h3>
          <p>{uk
            ? "Окремий день · не залежить від діапазону дат вище"
            : "Single day · independent of the date range above"}</p>
        </div>
        <label className={styles.chartDayPicker}>
          <span>{uk ? "День" : "Day"}</span>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(event) => selectDate(event.target.value)}
          />
        </label>
      </div>

      {error && <div className={styles.chartInlineError} role="alert">{error}</div>}

      {loading ? (
        <div className={styles.chartEmpty}>{uk ? "Завантаження пульсу…" : "Loading heart rate…"}</div>
      ) : heartRate.sampleCount === 0 ? (
        <div className={styles.chartEmpty}>{uk ? "За цей день даних пульсу немає" : "No heart rate data for this day"}</div>
      ) : (
        <>
          <dl className={styles.heartRateDayMeta}>
            <div>
              <dt>{uk ? "Середній" : "Mean"}</dt>
              <dd>{heartRate.avgBpm === null ? "—" : Math.round(heartRate.avgBpm)}</dd>
            </div>
            <div>
              <dt>{uk ? "Максимальний" : "Maximum"}</dt>
              <dd>{heartRate.maxBpm === null ? "—" : Math.round(heartRate.maxBpm)}</dd>
            </div>
            <div>
              <dt>{uk ? "Мінімальний" : "Minimum"}</dt>
              <dd>{heartRate.minBpm === null ? "—" : Math.round(heartRate.minBpm)}</dd>
            </div>
          </dl>
          <div className={styles.chartCanvas}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={heartRate.samples} margin={{ top: 10, right: 6, left: 4, bottom: 4 }} accessibilityLayer>
                <CartesianGrid stroke="var(--line)" strokeDasharray="4 5" vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(value) => formatClock(String(value), intlLocale)}
                  tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--line)" }}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={76}
                  domain={["auto", "auto"]}
                  unit=" bpm"
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(label) => formatClock(String(label), intlLocale)}
                  formatter={(value) => [`${value} bpm`, uk ? "Пульс" : "Heart rate"]}
                />
                <Line
                  type="monotone"
                  dataKey="bpm"
                  name={uk ? "Пульс" : "Heart rate"}
                  stroke="var(--health-heart)"
                  strokeWidth={2.4}
                  connectNulls
                  dot={{ r: 2, fill: "var(--health-heart)", strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </article>
  );
}
