"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { DemoDataBadge } from "@/components/demo-data-badge";
import { useI18n } from "@/i18n/i18n-provider";
import type { DailyMetricField } from "@/modules/days/day.types";
import type { DashboardDto } from "@/modules/days/dashboard.types";
import { dashboardRecentRows, dashboardTrainingMetricCaption } from "@/modules/days/dashboard-presentation";
import { emptyTrainingDayFact } from "@/modules/days/training-day-fact-empty";
import type { TrainingDayEventFact } from "@/modules/days/training-day-fact";
import type { StrengthSessionSummaryDto } from "@/modules/training/training.types";
import type { WorkIntervalDto } from "@/modules/work-intervals/work-interval.repository";
import { OCCUPATIONAL_CATEGORIES, type OccupationalCategory } from "@/model/occupational-activity";
import { displayWorkoutType } from "@/modules/days/day-workout-presentation";
import { matchStatusLabel, trainingSessionTitle } from "@/app/training/training-labels";
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

type ActiveSessionPreview = { id: number; programName: string | null; webStartedAt: string | null; exerciseCount: number };

function workCategoryCopy(category: string, uk: boolean): string {
  if (!Object.hasOwn(OCCUPATIONAL_CATEGORIES, category)) return uk ? "Робоча активність" : "Work activity";
  if (!uk) return OCCUPATIONAL_CATEGORIES[category as OccupationalCategory].label;
  const labels: Record<OccupationalCategory, string> = {
    standingLight: "Дуже легка стояча",
    manualLight: "Легка ручна",
    standingLightModerate: "Активна легка",
    manualModerate: "Помірна ручна",
  };
  return labels[category as OccupationalCategory];
}

function eventTime(instant: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DEFAULT_TIME_ZONE,
  }).format(new Date(instant));
}

function workSourceCopy(source: TrainingDayEventFact["source"], uk: boolean): string {
  if (source === "matched") return uk ? "Garmin і щоденник тренування" : "Garmin and training diary";
  if (source === "diary") return uk ? "Щоденник тренування" : "Training diary";
  return uk ? "Запис активності" : "Activity record";
}

export function DashboardClient({ demoMode = false }: { demoMode?: boolean } = {}) {
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
  const metricGroups: Array<{
    key: string;
    label: string;
    metricKeys: Set<DailyMetricField | "totalWorkoutMinutes">;
  }> = [
    {
      key: "body",
      label: uk ? "Тіло" : "Body",
      metricKeys: new Set(["weightKg", "bodyFatPercent"]),
    },
    {
      key: "nutrition",
      label: uk ? "Харчування" : "Nutrition",
      metricKeys: new Set(["caloriesKcal", "proteinG", "fatG", "carbsG"]),
    },
    {
      key: "movement",
      label: uk ? "Рух і тренування" : "Movement & training",
      metricKeys: new Set(["steps", "walkingDistanceKm", "averageWalkingSpeedKmh", "totalWorkoutMinutes"]),
    },
  ];
  const groupedMetrics = metricGroups.map((group) => ({
    ...group,
    metrics: metricCards.filter(({ key }) => group.metricKeys.has(key)),
  }));
  const [dashboard, setDashboard] = useState<DashboardDto>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSessionPreview | null>(null);
  const [activeSessionLoading, setActiveSessionLoading] = useState(() => !demoMode);
  const [activeSessionError, setActiveSessionError] = useState(false);
  const [attentionSessions, setAttentionSessions] = useState<StrengthSessionSummaryDto[]>([]);
  const [attentionCount, setAttentionCount] = useState(0);
  const [attentionLoading, setAttentionLoading] = useState(() => !demoMode);
  const [attentionError, setAttentionError] = useState(false);
  const [workIntervals, setWorkIntervals] = useState<WorkIntervalDto[]>([]);
  const [workLoading, setWorkLoading] = useState(true);
  const [workError, setWorkError] = useState(false);
  const restingHeartRate = dashboard.restingHeartRate;
  const sleep = dashboard.sleep;
  const sleepLocale = uk ? "uk" : "en";
  const recentRows = dashboardRecentRows(dashboard);
  const hasRecentHealthOrTraining = dashboard.recentDays.length > 0
    || dashboard.recentTrainingDays.some((fact) => fact.eventCount > 0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
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
    if (!demoMode) {
      void fetch("/api/v1/training/sessions/active", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("active_session_unavailable");
          const body = await response.json() as { session: { id: number; programName: string | null; webStartedAt: string | null; exercises: unknown[] } | null };
          if (active) {
            setActiveSessionError(false);
            setActiveSession(body.session ? {
              id: body.session.id,
              programName: body.session.programName,
              webStartedAt: body.session.webStartedAt,
              exerciseCount: body.session.exercises.length,
            } : null);
          }
        })
        .catch(() => { if (active && !controller.signal.aborted) setActiveSessionError(true); })
        .finally(() => { if (active) setActiveSessionLoading(false); });
      void fetch("/api/v1/training/sessions/match-attention?limit=3&offset=0", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("match_attention_unavailable");
          const body = await response.json() as { sessions: StrengthSessionSummaryDto[]; totalCount: number };
          if (active) {
            setAttentionError(false);
            setAttentionSessions(body.sessions);
            setAttentionCount(body.totalCount);
          }
        })
        .catch(() => { if (active && !controller.signal.aborted) setAttentionError(true); })
        .finally(() => { if (active) setAttentionLoading(false); });
    }
    void fetch(`/api/v1/work-intervals?date=${encodeURIComponent(localToday())}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("work_activity_unavailable");
        const body = await response.json() as { intervals: WorkIntervalDto[] };
        if (active) {
          setWorkError(false);
          setWorkIntervals(body.intervals);
        }
      })
      .catch(() => { if (active && !controller.signal.aborted) setWorkError(true); })
      .finally(() => { if (active) setWorkLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [demoMode, uk]);

  const todayTrainingDay = dashboard.recentTrainingDays.find((fact) => fact.date === localToday())
    ?? dashboard.todayTrainingDay;
  const showMatchPriority = !demoMode && (attentionLoading || attentionError || attentionCount > 0);
  const showActiveSessionPriority = !demoMode && (activeSessionLoading || activeSessionError || Boolean(activeSession));

  const matchAttentionCard = (
    <section className={`${styles.priorityCard} ${styles.matchAttentionCard}`} data-priority={attentionCount > 0 ? "present" : "empty"} aria-label={uk ? "Увага до зіставлення" : "Match attention"} aria-busy={attentionLoading}>
      <div className={styles.priorityCardHeader}>
        <div><p className={styles.eyebrow}>{uk ? "Потрібна увага" : "Needs attention"}</p><h2>{uk ? "Увага до зіставлення" : "Match attention"}</h2></div>
        {!attentionLoading && !attentionError && <span className={styles.priorityCount}>{attentionCount}</span>}
      </div>
      {attentionLoading ? <p role="status">{uk ? "Перевіряємо записи Garmin…" : "Checking Garmin matches…"}</p>
        : attentionError ? <p role="alert">{uk ? "Не вдалося перевірити зіставлення." : "Could not check workout matches."}</p>
          : attentionCount > 0 ? <>
            <ul className={styles.priorityList}>{attentionSessions.map((session) => <li key={session.id}><span>{trainingSessionTitle(session.programName, uk)}</span><b>{matchStatusLabel(session.matchStatus, uk)}</b></li>)}</ul>
            <Link className={styles.priorityLink} href="/training?attentionPage=1">{uk ? `Переглянути всі (${attentionCount})` : `Review all (${attentionCount})`}</Link>
          </>
            : <p>{uk ? "Немає сесій, що потребують зіставлення." : "No sessions need matching."}</p>}
    </section>
  );
  const activeSessionCard = (
    <section className={`${styles.priorityCard} ${styles.activeSessionCard}`} data-priority={activeSession ? "present" : "empty"} aria-label={uk ? "Активна сесія" : "Active session"} aria-busy={activeSessionLoading}>
      <div className={styles.priorityCardHeader}><div><p className={styles.eyebrow}>{uk ? "Тренування" : "Training"}</p><h2>{uk ? "Активна сесія" : "Active workout"}</h2></div></div>
      {activeSessionLoading ? <p role="status">{uk ? "Перевіряємо активне тренування…" : "Checking active workout…"}</p>
        : activeSessionError ? <p role="alert">{uk ? "Не вдалося перевірити активну сесію." : "Could not check the active workout."}</p>
          : activeSession ? <>
            <strong className={styles.activeSessionName}>{trainingSessionTitle(activeSession.programName, uk)}</strong>
            <p>{uk ? `${activeSession.exerciseCount} вправ · розпочато ${formatDateTime(activeSession.webStartedAt, intlLocale)}` : `${activeSession.exerciseCount} exercises · started ${formatDateTime(activeSession.webStartedAt, intlLocale)}`}</p>
            <Link className={styles.priorityLink} href={`/training/sessions/${activeSession.id}`}>{uk ? "Продовжити тренування" : "Resume workout"}</Link>
          </>
            : <><p>{uk ? "Зараз немає активного тренування." : "There is no active workout right now."}</p><Link className={styles.priorityLink} href="/training">{uk ? "Перейти до тренувань" : "Go to training"}</Link></>}
    </section>
  );

  return (
    <main className={styles.page} data-priority={!demoMode && (activeSession || attentionCount > 0) ? "present" : "empty"}>
      <a className={styles.skipLink} href="#daily-overview">{uk ? "Перейти до показників дня" : "Skip to today’s measurements"}</a>
      <header className={styles.topbar}>
        <LinkBrand uk={uk} />
        <AppNav active="dashboard" />
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Поточний огляд" : "Daily record"}<DemoDataBadge active={demoMode} /></p>
          <h1>{uk ? "Ваш день у цифрах" : "Your daily snapshot"}</h1>
          <p>{uk ? "Огляд сьогоднішніх показників здоров’я та тренувань за останні сім днів." : "A clear view of today’s health data and training events over the last seven days."}</p>
        </div>
        <div className={styles.heroAside}>
          <time className={styles.heroDate} dateTime={localToday()}>{localToday()}</time>
          <div className={`${styles.todayBadge} ${dashboard.hasToday ? styles.ready : styles.waiting}`}>
            <span aria-hidden="true" />
            {loading ? (uk ? "Перевіряємо дані…" : "Checking today…") : dashboard.hasToday ? (uk ? "Сьогодні синхронізовано" : "Today is synced") : (uk ? "Запису за сьогодні немає" : "No record for today")}
          </div>
        </div>
      </section>

      {showMatchPriority && matchAttentionCard}
      {showActiveSessionPriority && activeSessionCard}

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <section className={styles.metricLedger} id="daily-overview" tabIndex={-1} aria-busy={loading}>
        <div className={styles.ledgerHeading}>
          <div>
            <p className={styles.eyebrow}>{uk ? "Запис за день" : "Today’s record"}</p>
            <h2>{uk ? "Показники" : "Measurements"}</h2>
          </div>
          <span>{uk ? "Дані здоров’я та активності" : "Health and activity data"}</span>
        </div>
        <div className={styles.metricGroups}>
          {groupedMetrics.map(({ key: groupKey, label: groupLabel, metrics }) => (
            <section className={styles.metricGroup} key={groupKey} aria-label={groupLabel} data-group={groupKey}>
              <h3>{groupLabel}</h3>
              <dl className={styles.metricRows}>
                {metrics.map(({ key, label, unit }) => {
                  const value = key === "totalWorkoutMinutes"
                    ? (dashboard.todayTrainingDay
                      ? dashboard.todayTrainingDay.durationMinutes
                      : dashboard.today?.totalWorkoutMinutes ?? 0)
                    : dashboard.today?.[key] ?? null;
                  return (
                    <div className={styles.metricRow} key={key}>
                      <dt>{label}</dt>
                      <dd
                        className={styles.metricReading}
                        data-primary-metric={key === "weightKg" || key === "caloriesKcal" || key === "steps" ? key : undefined}
                      >
                        <strong>{formatMetric(value, intlLocale)}</strong>
                        <span>{key === "totalWorkoutMinutes"
                          ? dashboardTrainingMetricCaption(dashboard.todayTrainingDay, uk)
                          : value === null ? (uk ? "Немає даних" : "No data") : unit ?? (uk ? "сьогодні" : "today")}</span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {groupKey === "movement" && (
                <div className={styles.todayActivity}>
                  <h4>{uk ? "Сьогоднішні тренування" : "Today’s workouts"}</h4>
                  {todayTrainingDay.events.length > 0 ? todayTrainingDay.events.map((event) => (
                    <details className={styles.todayWorkout} key={event.eventId}>
                      <summary>
                        <span>{displayWorkoutType({ type: event.type, canonicalType: null })}</span>
                        <time dateTime={event.occurrenceAt}>{eventTime(event.occurrenceAt, intlLocale)}</time>
                      </summary>
                      <dl>
                        <div><dt>{uk ? "Джерело" : "Source"}</dt><dd>{workSourceCopy(event.source, uk)}</dd></div>
                        <div><dt>{uk ? "Тривалість" : "Duration"}</dt><dd>{event.durationMinutes === null ? (uk ? "Невідома" : "Unknown") : `${formatMetric(event.durationMinutes, intlLocale)} ${uk ? "хв" : "min"}`}</dd></div>
                        <div><dt>{uk ? "Активна енергія" : "Active energy"}</dt><dd>{event.activeEnergyKcal === null ? "—" : `${formatMetric(event.activeEnergyKcal, intlLocale)} kcal`}</dd></div>
                        {event.diarySessionId !== null && <div><dt>{uk ? "Запис" : "Diary"}</dt><dd><Link href={`/training/sessions/${event.diarySessionId}`}>{uk ? "Відкрити деталі" : "Open details"}</Link></dd></div>}
                      </dl>
                    </details>
                  )) : todayTrainingDay.hiddenEventCount > 0
                    ? <p>{uk ? `Є ${todayTrainingDay.hiddenEventCount} прихованих подій тренування.` : `${todayTrainingDay.hiddenEventCount} workout events are hidden.`}</p>
                    : <p>{uk ? "Тренувань за сьогодні ще немає." : "No workouts recorded today."}</p>}
                  <h4>{uk ? "Робоча активність" : "Work activity"}</h4>
                  {workLoading ? <p role="status">{uk ? "Завантажуємо інтервали…" : "Loading work intervals…"}</p>
                    : workError ? <p role="alert">{uk ? "Не вдалося завантажити робочу активність." : "Could not load work activity."}</p>
                      : workIntervals.length > 0 ? <ul className={styles.workIntervalList}>{workIntervals.map((interval) => <li key={interval.id}><span>{interval.startTime}–{interval.endTime}</span><b>{workCategoryCopy(interval.category, uk)}</b></li>)}</ul>
                        : <p>{uk ? "Робочі інтервали за сьогодні не записані." : "No work intervals recorded today."}</p>}
                </div>
              )}
            </section>
          ))}
        </div>
      </section>

      <section className={styles.signalGrid} aria-label={uk ? "Сон і пульс у спокої" : "Sleep and resting heart rate"}>
        <article className={styles.heartRateCard} aria-label={uk ? "Пульс у спокої" : "Resting Heart Rate"}>
          <div><p>{uk ? "Пульс у спокої" : "Resting Heart Rate"}</p><strong>{formatMetric(restingHeartRate.latestBpm, intlLocale)}{restingHeartRate.latestBpm === null ? "" : " bpm"}</strong></div>
          <span>{restingHeartRate.timestamp ? (instantToLocalDateTime(new Date(restingHeartRate.timestamp), DEFAULT_TIME_ZONE).date === localToday() ? (uk ? "Сьогодні" : "Today") : (uk ? "Останнє значення" : "Latest")) : (uk ? "Немає даних" : "No data")}</span>
        </article>

        <article className={styles.sleepCard} aria-label={uk ? "Сон" : "Sleep"}>
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
        </article>
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
      {!demoMode && !showMatchPriority && matchAttentionCard}
      {!demoMode && !showActiveSessionPriority && activeSessionCard}
    </main>
  );
}

function LinkBrand({ uk }: { uk: boolean }) {
  return <Link className={styles.brand} href="/dashboard">BodyCast<span>{uk ? "Панель здоров’я" : "Health console"}</span></Link>;
}
