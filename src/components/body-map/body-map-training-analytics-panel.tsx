"use client";

import { useMemo } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import type { AnatomyIdV2 } from "@/modules/training/body-map-catalog-v2";
import type {
  BodyMapAnalyticsWeeksV1,
  BodyMapTrainingAnalyticsResponseV1,
} from "@/modules/training/body-map-training-analytics-v1";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import styles from "./body-map-training-analytics-panel.module.css";

type GroupReport = BodyMapTrainingAnalyticsResponseV1["groups"][number];
type ViewLevel = "OVERVIEW" | "GROUP_DETAIL" | "SUBREGION_DETAIL";

function count(value: number | null, uk: boolean): string {
  return value === null ? (uk ? "Недоступно" : "Unavailable") : new Intl.NumberFormat(uk ? "uk-UA" : "en-US").format(value);
}

function time(value: number | null, uk: boolean): string {
  if (value === null) return uk ? "Не вказано" : "Not reported";
  return `${new Intl.NumberFormat(uk ? "uk-UA" : "en-US", { maximumFractionDigits: 1 }).format(value)} ${uk ? "кг" : "kg"}`;
}

export function BodyMapTrainingAnalyticsPanel({
  level,
  weeks,
  onWeeksChange,
  analytics,
  requestState,
  groupLabel,
  anatomyId,
  anatomyLabel,
  groupReport,
}: {
  level: ViewLevel;
  weeks: BodyMapAnalyticsWeeksV1;
  onWeeksChange: (weeks: BodyMapAnalyticsWeeksV1) => void;
  analytics: BodyMapTrainingAnalyticsResponseV1 | null;
  requestState: "loading" | "ready" | "unauthorized" | "error";
  groupLabel: string | null;
  anatomyId: AnatomyIdV2 | null;
  anatomyLabel: string | null;
  groupReport: GroupReport | null;
}) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const contexts = useMemo(() => new Map((analytics?.sessionContexts ?? []).map((context) => [context.sessionId, context])), [analytics]);
  const maxWeeklySets = Math.max(1, ...(groupReport?.weekly ?? []).map(({ totalUniqueSetCount }) => totalUniqueSetCount));

  const trendLabel = (status: NonNullable<GroupReport>["exercises"][number]["performanceTrend"]["status"]) => {
    if (uk) {
      return status === "improving" ? "Записані показники зростають"
        : status === "declining" ? "Записані показники знизились"
          : status === "steady" ? "Без зміни у зіставлених підходах"
            : status === "mixed" ? "Змішані зміни"
              : "Замало зіставних записів";
    }
    return status === "improving" ? "Recorded performance is trending up"
      : status === "declining" ? "Recorded performance is trending down"
        : status === "steady" ? "No change in compared sets"
          : status === "mixed" ? "Mixed changes"
            : "Not enough comparable logs";
  };

  const exerciseLabel = (stableKey: string | null, fallback: string) => uk && stableKey
    ? CANONICAL_EXERCISE_IDENTITIES.find((exercise) => exercise.stableKey === stableKey)?.displayName ?? fallback
    : fallback;

  const coverageNote = () => {
    if (!analytics) return "";
    if (analytics.sessions.length === 0) return uk
      ? "У цьому періоді немає завершених сесій у щоденнику. Відсутність запису не доводить, що тренування не було."
      : "No completed diary sessions were logged in this window. Missing records do not prove that no workout occurred.";
    return analytics.coverage.mapping === "partial"
      ? uk
        ? "Підрахунок охоплює зіставлені підходи зі завершених сесій; частина записів має частковий або відсутній мапінг."
        : "Counts include mapped sets from completed sessions; some records have partial or missing mappings."
      : uk
        ? "Підрахунок охоплює лише зіставлені підходи із завершених сесій, а не активацію м’язів чи доказ бездіяльності."
        : "Counts describe mapped sets in completed sessions, not muscle activation or proof of inactivity.";
  };

  function dateLabel(date: string): string {
    return new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  }

  function periodControl() {
    return <div className={styles.periodRow}>
      <label className={styles.periodField}>
        <span>{uk ? "Період журналу" : "Diary window"}</span>
        <select value={weeks} onChange={(event) => onWeeksChange(Number(event.currentTarget.value) as BodyMapAnalyticsWeeksV1)}>
          <option value={4}>{uk ? "4 тижні" : "4 weeks"}</option>
          <option value={8}>{uk ? "8 тижнів" : "8 weeks"}</option>
          <option value={12}>{uk ? "12 тижнів" : "12 weeks"}</option>
        </select>
      </label>
      {analytics && <small>{dateLabel(analytics.period.from.slice(0, 10))} – {dateLabel(analytics.period.to.slice(0, 10))}</small>}
    </div>;
  }

  function requestNotice() {
    if (requestState === "loading") return <p className={styles.notice} role="status">{uk ? "Завантажую записи тренувань…" : "Loading training records…"}</p>;
    if (requestState === "unauthorized") return <p className={styles.notice} role="status">{uk ? "Увійдіть, щоб переглянути власний журнал. Публічні демодані не підміняють ваші записи." : "Sign in to view your diary. Public demo data is never shown as your records."}</p>;
    if (requestState === "error") return <p className={styles.notice} role="alert">{uk ? "Аналітика тимчасово недоступна. Записи тренувань не змінено." : "Analytics is temporarily unavailable. Your training records were not changed."}</p>;
    return null;
  }

  return <section className={styles.panel} data-testid="body-map-training-analytics">
    {periodControl()}
    {requestNotice()}
    {requestState === "ready" && analytics && <>
      {level === "OVERVIEW" && <>
        <div className={styles.summaryHeader}>
          <div>
            <p className={styles.kicker}>{uk ? "ЖУРНАЛ ТРЕНУВАНЬ" : "TRAINING DIARY"}</p>
            <h2>{uk ? "Записана робота за період" : "Logged work in this window"}</h2>
          </div>
          <span className={styles.coverageTag} data-coverage={analytics.coverage.mapping}>{analytics.coverage.mapping === "complete-for-input" ? (uk ? "Повна карта записів" : "Mapping complete for these entries") : analytics.coverage.mapping === "partial" ? (uk ? "Часткова карта" : "Partial mapping") : (uk ? "Даних немає" : "No diary data")}</span>
        </div>
        <p className={styles.provenance}>{coverageNote()}</p>
        <div className={styles.summaryMetrics}>
          <Metric label={uk ? "Завершені сесії" : "Completed sessions"} value={count(analytics.coverage.completedSessionCount, uk)} />
          <Metric label={uk ? "Записані підходи" : "Recorded sets"} value={count(analytics.coverage.recordedSetCount, uk)} />
          <Metric label={uk ? "Зіставлені підходи" : "Mapped sets"} value={count(analytics.coverage.mappedSetCount, uk)} />
          <Metric label={uk ? "Частковий мапінг" : "Partial mappings"} value={count(analytics.coverage.partiallyMappedSetCount, uk)} />
          <Metric label={uk ? "Підходи без мапінгу" : "Sets without mapping"} value={count(analytics.coverage.unmappedSetCount, uk)} />
        </div>
        {analytics.sessions.length === 0 && <p className={styles.emptyState}>{uk ? "За цей період немає завершених сесій у щоденнику. Це не доводить, що тренувань не було." : "No completed diary sessions are recorded for this period. This does not prove that no workouts occurred."}</p>}
      </>}

      {level === "GROUP_DETAIL" && groupReport && <>
        <div className={styles.summaryHeader}>
          <div>
            <p className={styles.kicker}>{uk ? "ЕКСПОЗИЦІЯ ЗА ЖУРНАЛОМ" : "DIARY EXPOSURE"}</p>
            <h2>{groupLabel}</h2>
          </div>
          <span className={styles.coverageTag} data-coverage={groupReport.mappingCoverage}>{groupReport.mappingCoverage === "complete-for-input" ? (uk ? "Повний мапінг записів" : "Mapped logged entries") : groupReport.mappingCoverage === "partial" ? (uk ? "Частковий мапінг" : "Partial mapping") : (uk ? "Недоступно" : "Unavailable")}</span>
        </div>
        <div className={styles.summaryMetrics}>
          <Metric label={uk ? "Прямі підходи" : "Direct sets"} value={count(groupReport.directUniqueSetCount, uk)} />
          <Metric label={uk ? "Допоміжні підходи" : "Indirect sets"} value={count(groupReport.indirectUniqueSetCount, uk)} />
          <Metric label={uk ? "Унікальні зіставлені підходи" : "Unique mapped sets"} value={count(groupReport.totalUniqueSetCount, uk)} />
          <Metric label={uk ? "Тренувальні дні з мапінгом" : "Logged exposure days"} value={count(groupReport.loggedTrainingDayCount, uk)} />
        </div>
        <LoggedExposureIntervals intervals={groupReport.loggedExposureIntervals} uk={uk} dateLabel={dateLabel} />
        <p className={styles.provenance}>{uk ? "Кількість описує зіставлені підходи з журналу, а не виміряну активацію чи ріст м’язів." : "The count describes mapped diary sets, not measured activation or muscle growth."}</p>

        <section className={styles.subsection} aria-label={uk ? "Тижневий журнал" : "Weekly log"}>
          <h3>{uk ? "Підходи за тижнями" : "Sets by week"}</h3>
          {groupReport.weekly.length === 0
            ? <p className={styles.emptyState}>{uk ? "Немає записаних тренувальних тижнів." : "No logged training weeks."}</p>
            : <ul className={styles.weekList}>{groupReport.weekly.map((week) => <li key={week.weekStart}>
              <div className={styles.weekMeta}><span>{uk ? "Тиждень від" : "Week of"} {dateLabel(week.weekStart)}</span><span>{week.totalUniqueSetCount} {uk ? "підх." : "sets"} · {week.loggedSessionCount} {uk ? "сес." : "sessions"}</span></div>
              <div className={styles.barTrack} aria-hidden="true"><span style={{ width: `${Math.max(2, week.totalUniqueSetCount / maxWeeklySets * 100)}%` }} /></div>
              <small>{uk ? "Прямі" : "Direct"}: {week.directUniqueSetCount} · {uk ? "допоміжні" : "indirect"}: {week.indirectUniqueSetCount}{week.mappingCoverage === "partial" ? ` · ${uk ? "мапінг частковий" : "partial mapping"}` : ""}</small>
            </li>)}</ul>}
        </section>

        <section className={styles.subsection}>
          <h3>{uk ? "Записаний RIR" : "Reported RIR"}</h3>
          {groupReport.rirCounts.length === 0
            ? <p className={styles.emptyState}>{uk ? "RIR не вказаний у зіставлених підходах." : "RIR was not reported for mapped sets."}</p>
            : <div className={styles.rirList}>{groupReport.rirCounts.map(({ rir, uniqueSetCount }) => <span key={rir}>RIR {rir}: <b>{uniqueSetCount}</b></span>)}</div>}
          <small className={styles.provenance}>{uk ? `RIR записаний у ${groupReport.reportedRirSetCount} підходах; не вказаний у ${groupReport.unreportedRirSetCount}. Значення є самозвітом і не перетворюється на «ефективні підходи».` : `RIR is recorded for ${groupReport.reportedRirSetCount} sets and unreported for ${groupReport.unreportedRirSetCount}. It is self-reported and is not converted into “effective sets.”`}</small>
        </section>

        <section className={styles.subsection}>
          <h3>{uk ? "Вправи та зіставний тренд" : "Exercises and comparable trend"}</h3>
          {groupReport.exercises.length === 0
            ? <p className={styles.emptyState}>{uk ? "Немає зіставлених вправ у цьому періоді." : "No mapped exercises were logged in this window."}</p>
            : <div className={styles.exerciseList}>{groupReport.exercises.map((exercise) => {
              const bySession = new Map<number, typeof exercise.sets>();
              for (const set of exercise.sets) bySession.set(set.sessionId, [...(bySession.get(set.sessionId) ?? []), set]);
              return <details className={styles.exercise} key={`${exercise.stableKey ?? exercise.exerciseName}:${exercise.resistanceType}`}>
                <summary>
                  <span><strong>{exerciseLabel(exercise.stableKey, exercise.exerciseName)}</strong><small>{exercise.totalUniqueSetCount} {uk ? "унікальних підходів" : "unique sets"} · {exercise.sessions} {uk ? "сесій" : "sessions"}</small></span>
                  <span className={styles.trendPill} data-trend={exercise.performanceTrend.status}>{trendLabel(exercise.performanceTrend.status)}</span>
                </summary>
                <div className={styles.exerciseBody}>
                  <p className={styles.provenance}>{uk
                    ? `${exercise.performanceTrend.segments.length > 1 ? "Підсумок лише для останньої фази. " : ""}${exercise.performanceTrend.comparableSessionCount} зіставні сесії · ${exercise.performanceTrend.comparedSetPairs} пар підходів. Це опис записаної ваги/повторень, не росту м’яза.`
                    : `${exercise.performanceTrend.segments.length > 1 ? "Summary is for the latest phase only. " : ""}${exercise.performanceTrend.comparableSessionCount} comparable sessions · ${exercise.performanceTrend.comparedSetPairs} set pairs. This describes logged load/reps, not muscle growth.`}</p>
                  {exercise.performanceTrend.segments.length > 1 && <div className={styles.trendSegments} aria-label={uk ? "Тренди за фазами тренування" : "Trends by training phase"}>
                    {exercise.performanceTrend.segments.map((segment) => <article className={styles.trendSegment} key={`${segment.phaseNumber}:${segment.fromDate}`}>
                      <div>
                        <strong>{segment.blockLabel || (uk ? "Блок без назви" : "Unnamed block")}</strong>
                        <small>{dateLabel(segment.fromDate)}–{dateLabel(segment.toDate)}</small>
                      </div>
                      <span className={styles.trendPill} data-trend={segment.status}>{trendLabel(segment.status)}</span>
                      <small>{segment.sessionIntent
                        ? sessionIntentLabel(segment.sessionIntent, uk)
                        : (uk ? "Намір не вказано" : "Intent not recorded")}
                        {` · ${segment.comparableSessionCount} ${uk ? "сес." : "sessions"} · ${segment.comparedSetPairs} ${uk ? "пар підх." : "set pairs"}`}</small>
                    </article>)}
                  </div>}
                  {[...bySession.entries()].sort((a, b) => a[1][0]!.sessionDate.localeCompare(b[1][0]!.sessionDate)).map(([sessionId, sessionSets]) => {
                    const first = sessionSets[0]!;
                    const context = contexts.get(sessionId);
                    return <article className={styles.session} key={sessionId}>
                      <div className={styles.sessionHeading}>
                        <strong>{dateLabel(first.sessionDate)}</strong>
                        <span>{first.exerciseIndex}/{first.exercisesInSession} {uk ? "вправ" : "exercises"}</span>
                      </div>
                      <p className={styles.sessionPlan}>
                        {first.sessionIntent ? sessionIntentLabel(first.sessionIntent, uk) : (uk ? "Намір не вказано" : "Intent not recorded")}
                        {first.trainingBlockLabel ? ` · ${first.trainingBlockLabel}` : ""}
                        {first.trainingWeekNumber ? ` · ${uk ? "тиждень" : "week"} ${first.trainingWeekNumber}` : ""}
                      </p>
                      <p className={styles.sessionPlan}>
                        {uk ? "План" : "Plan"}: {first.plannedSets} {uk ? "підх." : "sets"}
                        {first.plannedRepsMin !== null || first.plannedRepsMax !== null ? ` · ${first.plannedRepsMin ?? "…"}–${first.plannedRepsMax ?? "…"} ${uk ? "повт." : "reps"}` : ""}
                        {first.plannedRir !== null ? ` · RIR ${first.plannedRir}` : ""}
                        {" · "}{uk ? "Факт" : "Actual"}: {first.actualExerciseSetCount} {uk ? "записаних підх." : "logged sets"}
                      </p>
                      {first.precedingExercises.length > 0 && <p className={styles.preceding}>
                        {uk ? "Перед цією вправою" : "Earlier in this session"}: {first.precedingExercises.map((previous) => `${exerciseLabel(previous.stableKey, previous.name)} (${previous.loggedSets})`).join(" · ")}
                      </p>}
                      <div className={styles.setList}>
                        {[...sessionSets].sort((a, b) => a.setNumber - b.setNumber).map((set) => <div className={styles.setRow} key={set.id}>
                          <span>{uk ? "Підхід" : "Set"} {set.setNumber}</span>
                          <span>{set.reps} {uk ? "повт." : "reps"}</span>
                          <span>{set.resistanceType === "RESISTANCE_BAND" ? `${time(set.bandNominalResistanceKg, uk)} ${uk ? "опору гумки" : "band"}` : set.resistanceType === "BODYWEIGHT" ? (uk ? "власна вага" : "bodyweight") : time(set.weightKg, uk)}</span>
                          <span>RIR {set.rir === null ? (uk ? "не вказано" : "—") : set.rir}</span>
                          <span
                            aria-label={set.restBeforeSeconds === null
                              ? (uk ? "Відпочинок перед підходом не записаний" : "Rest before set not recorded")
                              : `${uk ? "Відпочинок перед підходом" : "Rest before set"}: ${count(set.restBeforeSeconds, uk)} ${uk ? "секунд" : "seconds"}`}
                            title={set.restBeforeSeconds === null
                              ? (uk ? "Відпочинок перед підходом не записаний" : "Rest before set not recorded")
                              : undefined}
                          >{set.restBeforeSeconds === null
                            ? "—"
                            : `${count(set.restBeforeSeconds, uk)} ${uk ? "с" : "s"}`}</span>
                        </div>)}
                      </div>
                      <div className={styles.contextGrid}>
                        <div><b>{uk ? "Сон за цю календарну дату" : "Sleep on this calendar date"}</b>
                          {context?.sleep
                            ? <small>{(context.sleep.totalSleepMinutes / 60).toLocaleString(intlLocale, { maximumFractionDigits: 1 })} {uk ? "год" : "h"} · {context.sleep.segmentCount} {uk ? "сегм." : "segments"}{context.sleep.source.length ? ` · ${context.sleep.source.join(", ")}` : ""}</small>
                            : <small>{uk ? "Запису сну немає; це не означає нуль сну." : "No sleep record found; this does not mean zero sleep."}</small>}
                        </div>
                        <div><b>{uk ? "Харчовий запис за день тренування" : "Nutrition record for training day"}</b>
                          {context?.nutrition.status === "recorded"
                            ? <small>{context.nutrition.caloriesKcal === null ? "—" : `${count(context.nutrition.caloriesKcal, uk)} kcal`} · {context.nutrition.proteinG === null ? "—" : `${count(context.nutrition.proteinG, uk)} g ${uk ? "білка" : "protein"}`} · {uk ? "щоденний запис здоров’я" : "daily health record"}</small>
                            : <small>{uk ? "Калорії та білок за цю дату не записані." : "Calories and protein were not recorded for this date."}</small>}
                        </div>
                      </div>
                    </article>;
                  })}
                </div>
              </details>;
            })}</div>}
        </section>
      </>}

      {level === "SUBREGION_DETAIL" && groupReport && anatomyId && <>
        <div className={styles.summaryHeader}>
          <div><p className={styles.kicker}>{uk ? "АНАТОМІЧНА ЧАСТИНА" : "ANATOMY DETAIL"}</p><h2>{anatomyLabel}</h2></div>
        </div>
        {(() => {
          const anatomy = groupReport.anatomy.find((row) => row.anatomyId === anatomyId);
          return anatomy ? <>
            <div className={styles.summaryMetrics}>
              <Metric label={uk ? "Прямі підходи" : "Direct sets"} value={count(anatomy.directUniqueSetCount, uk)} />
              <Metric label={uk ? "Допоміжні підходи" : "Indirect sets"} value={count(anatomy.indirectUniqueSetCount, uk)} />
              <Metric label={uk ? "Унікальні зіставлені підходи" : "Unique mapped sets"} value={count(anatomy.totalUniqueSetCount, uk)} />
              <Metric label={uk ? "Тренувальні дні з мапінгом" : "Logged exposure days"} value={count(anatomy.loggedTrainingDayCount, uk)} />
            </div>
            <LoggedExposureIntervals intervals={anatomy.loggedExposureIntervals} uk={uk} dateLabel={dateLabel} />
            <p className={styles.provenance}>{anatomy.mappingCoverage === "partial"
              ? (uk ? "Підрахунок неповний: частина записів має часткове або відсутнє анатомічне зіставлення." : "Count is incomplete: some records have partial or missing anatomy mappings.")
              : (uk ? "Кількість показує лише підходи зіставлені саме з цією частиною; вона не розподіляє батьківську групу довільно." : "This count includes only sets mapped to this specific structure; it does not arbitrarily distribute parent-group sets.")}</p>
          </> : <div className={styles.emptyState}>
            <strong>{uk ? "Експозиція недоступна" : "Exposure unavailable"}</strong>
            <p>{uk ? "У поточних мапінгах немає достатньої підстави призначити підхід цій анатомічній частині. Це не нуль." : "Current mappings do not support assigning a set to this anatomy detail. This is not zero."}</p>
          </div>;
        })()}
      </>}

      <details className={styles.method}>
        <summary>{uk ? "Як читати ці дані та їхні межі" : "How to interpret these records"}</summary>
        <p>{uk
          ? "Це журнал вправ і зіставлення рухів з анатомічними групами, а не вимір активації чи росту. RIR є суб’єктивним звітом. Намір легкого дня зберігається явно; порядок вправ показаний як контекст без штрафу в балах. Сон і харчування показані поруч із сесією, але система не приписує їм причину зміни результату."
          : "This is a training diary mapped to anatomy groups, not a measurement of activation or growth. RIR is self-reported. Easy-day intent is explicit; exercise order is shown as context without a fatigue penalty score. Sleep and nutrition are shown alongside a session without claiming they caused a performance change."}</p>
        <ul>
          <li><a href="https://pubmed.ncbi.nlm.nih.gov/38970765/" target="_blank" rel="noreferrer">{uk ? "RIR і тренувальні результати: метарегресії з обережними висновками" : "RIR and training outcomes: exploratory meta-regressions"}</a></li>
          <li><a href="https://pubmed.ncbi.nlm.nih.gov/32077380/" target="_blank" rel="noreferrer">{uk ? "Систематичний огляд порядку вправ і результатів тренування" : "Exercise order and training outcomes systematic review"}</a></li>
          <li><a href="https://pubmed.ncbi.nlm.nih.gov/38274324/" target="_blank" rel="noreferrer">{uk ? "Рандомізоване дослідження тижневого розвантаження" : "Randomized study of a one-week deload"}</a></li>
        </ul>
      </details>
    </>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>;
}

function LoggedExposureIntervals({
  intervals,
  uk,
  dateLabel,
}: {
  intervals: BodyMapTrainingAnalyticsResponseV1["groups"][number]["loggedExposureIntervals"];
  uk: boolean;
  dateLabel: (date: string) => string;
}) {
  return <section className={styles.subsection} aria-label={uk ? "Проміжки між записаними тренувальними днями" : "Intervals between logged training days"}>
    <h3>{uk ? "Проміжки між записаними днями" : "Intervals between logged days"}</h3>
    {intervals.length === 0
      ? <p className={styles.emptyState}>{uk ? "Потрібні щонайменше два дні зіставлених записів, щоб показати проміжок." : "At least two days with mapped records are needed to show an interval."}</p>
      : <ul className={styles.weekList}>{intervals.map(({ previousDate, nextDate, calendarDays }) => <li key={`${previousDate}:${nextDate}`}>
        <div className={styles.weekMeta}>
          <span>{dateLabel(previousDate)} → {dateLabel(nextDate)}</span>
          <b>{calendarDays} {uk ? "дн." : "days"}</b>
        </div>
      </li>)}</ul>}
    <small className={styles.provenance}>{uk ? "Це календарні проміжки в журналі, а не оцінка відновлення." : "These are calendar gaps in the diary, not a recovery score."}</small>
  </section>;
}

function sessionIntentLabel(intent: NonNullable<BodyMapTrainingAnalyticsResponseV1["groups"][number]["exercises"][number]["sets"][number]["sessionIntent"]>, uk: boolean): string {
  const labels = {
    regular: uk ? "Звичайне тренування" : "Regular session",
    "easy-deload": uk ? "Легкий / розвантажувальний день" : "Easy / deload day",
    strength: uk ? "Силовий акцент" : "Strength focus",
    test: uk ? "Тестування" : "Test",
    "return-from-break": uk ? "Повернення після перерви" : "Return after a break",
  };
  return labels[intent];
}
