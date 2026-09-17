"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import type { NightlySleepSummaryDto } from "@/modules/days/day.types";
import { formatDurationMinutes } from "@/modules/days/metric-format";
import styles from "./history.module.css";

const PHASES = [
  { state: "awake", labelUk: "Без сну", labelEn: "Awake", color: "#d4a017" },
  { state: "rem", labelUk: "Швидкий", labelEn: "REM", color: "#7b6cc9" },
  { state: "core", labelUk: "Повільний", labelEn: "Core", color: "#4d8fd9" },
  { state: "deep", labelUk: "Глибокий", labelEn: "Deep", color: "#1f5fbf" },
] as const;

function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function formatClockAtOffset(iso: string, offsetMinutes: number | null): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const shifted = new Date(ms + (offsetMinutes ?? 0) * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

export function SleepNightChart() {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const today = localToday();
  const [date, setDate] = useState(today);
  const [sleep, setSleep] = useState<NightlySleepSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/sleep?date=${encodeURIComponent(date)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(uk ? `Помилка запиту (${response.status})` : `Request failed (${response.status})`);
        }
        const body = await response.json() as { sleep: NightlySleepSummaryDto | null };
        if (!active) return;
        setSleep(body.sleep);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setSleep(null);
        setError(loadError instanceof Error
          ? loadError.message
          : (uk ? "Не вдалося завантажити сон" : "Could not load sleep"));
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
    setSleep(null);
    setDate(nextDate);
  }

  const chartSegments = useMemo(() => {
    if (!sleep) return [];
    return sleep.segments.filter((segment) => (
      segment.state === "awake"
      || segment.state === "rem"
      || segment.state === "core"
      || segment.state === "deep"
    ));
  }, [sleep]);

  const chartWindow = useMemo(() => {
    if (!sleep || chartSegments.length === 0) return null;
    const startMs = Math.min(...chartSegments.map((segment) => Date.parse(segment.startAt)));
    const endMs = Math.max(...chartSegments.map((segment) => Date.parse(segment.endAt)));
    return { startMs, endMs, spanMs: Math.max(endMs - startMs, 1) };
  }, [chartSegments, sleep]);

  const tickLabels = useMemo(() => {
    if (!chartWindow || !sleep) return [];
    const ticks: string[] = [];
    const step = Math.max(Math.round(chartWindow.spanMs / 4), 30 * 60_000);
    for (let ms = chartWindow.startMs; ms <= chartWindow.endMs; ms += step) {
      ticks.push(formatClockAtOffset(new Date(ms).toISOString(), sleep.wakeOffsetMinutes));
    }
    return ticks;
  }, [chartWindow, sleep]);

  return (
    <article className={`${styles.chartCard} ${styles.heartRateDayCard}`} aria-labelledby="sleep-night-heading">
      <div className={styles.heartRateDayHeader}>
        <div className={styles.chartHeading}>
          <h3 id="sleep-night-heading">{uk ? "Фази сну" : "Sleep stages"}</h3>
          <p>{uk
            ? "Одна ніч · wake date · не залежить від діапазону дат"
            : "Single night · wake date · independent of the date range"}</p>
        </div>
        <label className={styles.chartDayPicker}>
          <span>{uk ? "Ніч" : "Night"}</span>
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
        <div className={styles.chartEmpty}>{uk ? "Завантаження сну…" : "Loading sleep…"}</div>
      ) : !sleep || chartSegments.length === 0 || !chartWindow ? (
        <div className={styles.chartEmpty}>{uk ? "За цю ніч даних сну немає" : "No sleep data for this night"}</div>
      ) : (
        <>
          <dl className={styles.heartRateDayMeta}>
            <div>
              <dt>{uk ? "Час у сні" : "Time asleep"}</dt>
              <dd>{formatDurationMinutes(sleep.totalSleepMinutes, uk ? "uk" : "en")}</dd>
            </div>
            <div>
              <dt>{uk ? "Час у ліжку" : "Time in bed"}</dt>
              <dd>{formatDurationMinutes(sleep.timeInBedMinutes, uk ? "uk" : "en")}</dd>
            </div>
            <div>
              <dt>{uk ? "Пробудження" : "Awake"}</dt>
              <dd>{formatDurationMinutes(sleep.awakeMinutes, uk ? "uk" : "en")}</dd>
            </div>
            <div>
              <dt>{uk ? "Повільний" : "Core"}</dt>
              <dd>{formatDurationMinutes(sleep.coreMinutes, uk ? "uk" : "en")}</dd>
            </div>
            <div>
              <dt>{uk ? "Глибокий" : "Deep"}</dt>
              <dd>{formatDurationMinutes(sleep.deepMinutes, uk ? "uk" : "en")}</dd>
            </div>
            <div>
              <dt>{uk ? "Швидкий" : "REM"}</dt>
              <dd>{formatDurationMinutes(sleep.remMinutes, uk ? "uk" : "en")}</dd>
            </div>
          </dl>

          <div className={styles.sleepHypnogram} role="img" aria-label={uk ? "Графік фаз сну" : "Sleep stage chart"}>
            <div className={styles.sleepHypnogramLabels}>
              {PHASES.map((phase) => (
                <span key={phase.state}>{uk ? phase.labelUk : phase.labelEn}</span>
              ))}
            </div>
            <div className={styles.sleepHypnogramTrack}>
              {PHASES.map((phase, rowIndex) => (
                <div key={phase.state} className={styles.sleepHypnogramRow}>
                  {chartSegments
                    .filter((segment) => segment.state === phase.state)
                    .map((segment) => {
                      const start = Date.parse(segment.startAt);
                      const end = Date.parse(segment.endAt);
                      const left = ((start - chartWindow.startMs) / chartWindow.spanMs) * 100;
                      const width = ((end - start) / chartWindow.spanMs) * 100;
                      return (
                        <span
                          key={`${segment.startAt}-${segment.state}-${rowIndex}`}
                          className={styles.sleepHypnogramBlock}
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(width, 0.35)}%`,
                            background: phase.color,
                          }}
                          title={`${uk ? phase.labelUk : phase.labelEn} · ${formatClockAtOffset(segment.startAt, sleep.wakeOffsetMinutes)}–${formatClockAtOffset(segment.endAt, sleep.wakeOffsetMinutes)}`}
                        />
                      );
                    })}
                </div>
              ))}
              {sleep.segments.some((segment) => segment.state === "inBed") && (
                <div className={styles.sleepInBedBand} aria-hidden="true">
                  {sleep.segments
                    .filter((segment) => segment.state === "inBed")
                    .map((segment) => {
                      const start = Date.parse(segment.startAt);
                      const end = Date.parse(segment.endAt);
                      const left = ((start - chartWindow.startMs) / chartWindow.spanMs) * 100;
                      const width = ((end - start) / chartWindow.spanMs) * 100;
                      return (
                        <span
                          key={`inbed-${segment.startAt}`}
                          style={{ left: `${left}%`, width: `${Math.max(width, 0.35)}%` }}
                        />
                      );
                    })}
                </div>
              )}
            </div>
            <div className={styles.sleepHypnogramTicks}>
              {tickLabels.map((label) => <span key={label}>{label}</span>)}
            </div>
            <p className={styles.sleepHypnogramNote}>
              {uk
                ? `Вікно: ${formatClockAtOffset(sleep.sleepStartAt, sleep.wakeOffsetMinutes)} → ${formatClockAtOffset(sleep.sleepEndAt, sleep.wakeOffsetMinutes)}`
                : `Window: ${formatClockAtOffset(sleep.sleepStartAt, sleep.wakeOffsetMinutes)} → ${formatClockAtOffset(sleep.sleepEndAt, sleep.wakeOffsetMinutes)}`}
            </p>
          </div>
        </>
      )}
    </article>
  );
}
