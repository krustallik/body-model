"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import type { DailyMetricField } from "@/modules/days/day.types";
import type { DashboardDto } from "@/modules/days/dashboard.types";
import { dashboardRecentRows, dashboardTrainingMetricCaption } from "@/modules/days/dashboard-presentation";
import { emptyTrainingDayFact } from "@/modules/days/training-day-fact";
import { todayInCalendarTimeZone } from "@/modules/days/calendar-range";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import { formatDateTime, formatDurationMinutes, formatMetric } from "@/modules/days/metric-format";
import styles from "./dashboard.module.css";

function localToday(): string {
  return todayInCalendarTimeZone();
}

function emptyDashboard(): DashboardDto {
  return {
    today: null,
    todayTrainingDay: emptyTrainingDayFact(localToday()),
    recentDays: [],
    recentTrainingDays: [],
    hasToday: false,
    lastSync: { at: null, status: null },
    restingHeartRate: { latestBpm: null, timestamp: null },
    sleep: null,
  };
}

async function loadDashboard(uk: boolean): Promise<DashboardDto> {
  const response = await fetch(`/api/v1/dashboard?date=${localToday()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(uk ? `Не вдалося завантажити огляд (${response.status})` : `Could not load dashboard (${response.status})`);
  return response.json() as Promise<DashboardDto>;
}

export function DashboardClient() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const metricCards: Array<{ key: DailyMetricField | "totalWorkoutMinutes"; label: string; unit?: string }> = [
    { key: "weightKg", label: uk ? "Вага" : "Weight", unit: "kg" },
    { key: "bodyFatPercent", label: uk ? "Жирова маса" : "Body Fat", unit: "%" },
    { key: "caloriesKcal", label: uk ? "Калорії" : "Calories", unit: "kcal" },
    { key: "proteinG", label: uk ? "Білки" : "Protein", unit: "g" },
    { key: "fatG", label: uk ? "Жири" : "Fat", unit: "g" },
    { key: "carbsG", label: uk ? "Вуглеводи" : "Carbs", unit: "g" },
    { key: "steps", label: uk ? "Кроки" : "Steps" },
    { key: "walkingDistanceKm", label: uk ? "Дистанція ходьби" : "Walking Distance", unit: "km" },
    { key: "averageWalkingSpeedKmh", label: uk ? "Середня швидкість ходьби" : "Average Walking Speed", unit: "km/h" },
    { key: "totalWorkoutMinutes", label: uk ? "Тренування" : "Training", unit: "min" },
  ];
  const [dashboard, setDashboard] = useState<DashboardDto>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const restingHeartRate = dashboard.restingHeartRate;
  const sleep = dashboard.sleep;
  const sleepLocale = uk ? "uk" : "en";
  const recentRows = dashboardRecentRows(dashboard);
  const hasRecentHealthOrTraining = dashboard.recentDays.length > 0
    || dashboard.recentTrainingDays.some((fact) => fact.eventCount > 0);

  useEffect(() => {
    let active = true;
    loadDashboard(uk)
      .then((result) => {
        if (active) setDashboard(result);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : uk ? "Не вдалося завантажити огляд" : "Could not load dashboard");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [uk]);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <LinkBrand uk={uk} />
        <AppNav active="dashboard" />
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Сьогодні" : "Today"} · {localToday()}</p>
          <h1>{uk ? "Ваш день у цифрах" : "Your daily snapshot"}</h1>
          <p>{uk ? "Огляд сьогоднішніх показників здоров’я та тренувань за останні сім днів." : "A clear view of today’s health data and training events over the last seven days."}</p>
        </div>
        <div className={`${styles.todayBadge} ${dashboard.hasToday ? styles.ready : styles.waiting}`}>
          <span aria-hidden="true" />
          {loading ? (uk ? "Перевіряємо дані…" : "Checking today…") : dashboard.hasToday ? (uk ? "Сьогодні синхронізовано" : "Today is synced") : (uk ? "Запису за сьогодні немає" : "No record for today")}
        </div>
      </section>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <section className={styles.metricGrid} aria-busy={loading}>
        {metricCards.map(({ key, label, unit }) => {
          const value = key === "totalWorkoutMinutes"
            ? (dashboard.todayTrainingDay
              ? dashboard.todayTrainingDay.durationMinutes
              : dashboard.today?.totalWorkoutMinutes ?? 0)
            : dashboard.today?.[key] ?? null;
          return (
            <article className={styles.metricCard} key={key}>
              <p>{label}</p>
              <strong>{formatMetric(value, intlLocale)}</strong>
            <span>{key === "totalWorkoutMinutes"
              ? dashboardTrainingMetricCaption(dashboard.todayTrainingDay, uk)
              : value === null ? (uk ? "Немає даних" : "No data") : unit ?? (uk ? "сьогодні" : "today")}</span>
            </article>
          );
        })}
      </section>

      <section className={styles.heartRateCard} aria-label={uk ? "Пульс у спокої" : "Resting Heart Rate"}>
        <div><p>{uk ? "Пульс у спокої" : "Resting Heart Rate"}</p><strong>{formatMetric(restingHeartRate.latestBpm, intlLocale)}{restingHeartRate.latestBpm === null ? "" : " bpm"}</strong></div>
        <span>{restingHeartRate.timestamp ? (instantToLocalDateTime(new Date(restingHeartRate.timestamp), DEFAULT_TIME_ZONE).date === localToday() ? (uk ? "Сьогодні" : "Today") : (uk ? "Останнє значення" : "Latest")) : (uk ? "Немає даних" : "No data")}</span>
      </section>

      <section className={styles.sleepCard} aria-label={uk ? "Сон" : "Sleep"}>
        {sleep ? (
          <>
            <div className={styles.sleepPrimary}>
              <div>
                <p>{uk ? "Сон" : "Sleep"}</p>
                <strong>{formatDurationMinutes(sleep.totalSleepMinutes, sleepLocale)}</strong>
              </div>
              <div>
                <p>{uk ? "Час у ліжку" : "Time in bed"}</p>
                <strong>{formatDurationMinutes(sleep.timeInBedMinutes, sleepLocale)}</strong>
              </div>
            </div>
            <dl className={styles.sleepStages}>
              <div>
                <dt>{uk ? "Глибокий" : "Deep"}</dt>
                <dd>{formatDurationMinutes(sleep.deepMinutes, sleepLocale)}</dd>
              </div>
              <div>
                <dt>{uk ? "Швидкий" : "REM"}</dt>
                <dd>{formatDurationMinutes(sleep.remMinutes, sleepLocale)}</dd>
              </div>
              <div>
                <dt>{uk ? "Без сну" : "Awake"}</dt>
                <dd>{formatDurationMinutes(sleep.awakeMinutes, sleepLocale)}</dd>
              </div>
            </dl>
            <span className={styles.sleepMeta}>
              {uk ? `Ніч · ${sleep.sleepDate}` : `Night · ${sleep.sleepDate}`}
            </span>
          </>
        ) : (
          <div className={styles.sleepEmpty}>
            <p>{uk ? "Сон" : "Sleep"}</p>
            <strong>{uk ? "Немає даних про сон" : "No sleep data"}</strong>
          </div>
        )}
      </section>

      <section className={styles.lowerGrid}>
        <article className={styles.syncCard}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>{uk ? "Актуальність даних" : "Data freshness"}</p>
              <h2>{uk ? "Стан синхронізації" : "Sync status"}</h2>
            </div>
          </div>
          <dl>
            <div><dt>{uk ? "Останнє оновлення даних" : "Latest data update"}</dt><dd>{formatDateTime(dashboard.lastSync.at, intlLocale)}</dd></div>
            <div><dt>{uk ? "Запис за сьогодні" : "Today’s record"}</dt><dd>{dashboard.hasToday ? (uk ? "Доступний" : "Available") : (uk ? "Відсутній" : "Missing")}</dd></div>
            <div><dt>{uk ? "Сьогодні оновлено" : "Today updatedAt"}</dt><dd>{formatDateTime(dashboard.today?.updatedAt ?? null, intlLocale)}</dd></div>
            <div><dt>{uk ? "Статус події синхронізації" : "Sync event status"}</dt><dd>{dashboard.lastSync.status ?? (uk ? "Не відстежується" : "Not tracked")}</dd></div>
          </dl>
          <p className={styles.syncNote}>{uk ? "Окремі події синхронізації ще не зберігаються; час останнього оновлення взято з денних показників." : "Dedicated sync events are not stored yet; latest update uses daily metrics timestamps."}</p>
        </article>

        <article className={styles.historyCard}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>{uk ? "Останні записи" : "Recent records"}</p>
              <h2>{uk ? "Останні 7 днів" : "Last 7 days"}</h2>
            </div>
          </div>
          {!hasRecentHealthOrTraining ? (
            <div className={styles.emptyHistory}>{uk ? "Останніх денних показників немає." : "No recent daily metrics."}</div>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>{uk ? "дата" : "date"}</th><th>{uk ? "вага" : "weight"}</th><th>{uk ? "калорії" : "calories"}</th><th>{uk ? "білки" : "protein"}</th><th>{uk ? "кроки" : "steps"}</th><th>{uk ? "тренування" : "training"}</th></tr></thead>
                <tbody>
                  {recentRows.map((day) => {
                    const duration = day.trainingDay.durationMinutes;
                    const durationText = duration === null
                      ? "—"
                      : `${formatMetric(duration, intlLocale)} ${uk ? "хв" : "min"}`;
                    const eventText = day.trainingDay.eventCount === 0
                      ? ""
                      : ` · ${uk ? "подій" : "events"}: ${day.trainingDay.eventCount}`;
                    return (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{formatMetric(day.weightKg, intlLocale)}</td>
                      <td>{formatMetric(day.caloriesKcal, intlLocale)}</td>
                      <td>{formatMetric(day.proteinG, intlLocale)}</td>
                      <td>{formatMetric(day.steps, intlLocale)}</td>
                      <td>{durationText}{eventText}</td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

function LinkBrand({ uk }: { uk: boolean }) {
  return <Link className={styles.brand} href="/dashboard">BodyCast<span>{uk ? "Панель здоров’я" : "Health console"}</span></Link>;
}
