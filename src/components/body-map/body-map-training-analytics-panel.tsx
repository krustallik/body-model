"use client";

import { useMemo } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import type { AnatomyIdV2 } from "@/modules/training/body-map-catalog-v2";
import type {
  BodyMapAnalyticsMonthsV1,
  BodyMapTrainingAnalyticsResponseV1,
} from "@/modules/training/body-map-training-analytics-v1";
import type { BodyMapMuscleProgressStatusV1, BodyMapExerciseProgressV1 } from "@/modules/training/body-map-training-performance-v1";
import { assessBodyMapMusclePerformanceV1 } from "@/modules/training/body-map-training-performance-v1";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import { bodyMapAnatomyLabel } from "./body-map-localization";
import styles from "./body-map-training-analytics-panel.module.css";

type GroupReport = BodyMapTrainingAnalyticsResponseV1["groups"][number];
type ViewLevel = "OVERVIEW" | "GROUP_DETAIL" | "SUBREGION_DETAIL";

function statusLabel(status: BodyMapMuscleProgressStatusV1, uk: boolean): string {
  if (uk) {
    if (status === "progress") return "Показники прогресують";
    if (status === "regression") return "Показники знижуються";
    if (status === "stable") return "Без виразних змін";
    if (status === "mixed") return "Вправи змінюються по-різному";
    if (status === "ambiguous") return "Результат неоднозначний";
    return "Недостатньо даних";
  }
  if (status === "progress") return "Recorded performance is improving";
  if (status === "regression") return "Recorded performance is declining";
  if (status === "stable") return "No clear change";
  if (status === "mixed") return "Exercises are moving in different directions";
  if (status === "ambiguous") return "The result is unclear";
  return "Not enough data";
}

function statusGlyph(status: BodyMapMuscleProgressStatusV1): string {
  if (status === "progress") return "↗";
  if (status === "regression") return "↘";
  if (status === "stable") return "=";
  if (status === "mixed") return "↕";
  if (status === "ambiguous") return "?";
  return "·";
}

function formatValue(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

function resultLine(exercise: BodyMapExerciseProgressV1, slice: BodyMapExerciseProgressV1["early"], locale: string, uk: boolean): string {
  if (!slice) return uk ? "Ще немає зіставних результатів" : "Not enough comparable results yet";
  const reps = `${formatValue(slice.reps, locale)} ${uk ? "повт." : "reps"}`;
  if (exercise.resistanceType !== "EXTERNAL_WEIGHT" || slice.loadKg === null) return reps;
  return `${formatValue(slice.loadKg, locale)} ${uk ? "кг" : "kg"} × ${reps}`;
}

function localizedExerciseName(exercise: BodyMapExerciseProgressV1, uk: boolean): string {
  if (uk && exercise.stableKey) {
    return CANONICAL_EXERCISE_IDENTITIES.find((item) => item.stableKey === exercise.stableKey)?.displayName ?? exercise.name;
  }
  return exercise.name;
}

function explanation(
  assessment: ReturnType<typeof assessBodyMapMusclePerformanceV1>,
  uk: boolean,
): string {
  const progressed = assessment.exercises.filter(({ status }) => status === "progress");
  const regressed = assessment.exercises.filter(({ status }) => status === "regression");
  const stable = assessment.exercises.filter(({ status }) => status === "stable");
  const evaluatedCount = progressed.length + regressed.length + stable.length + assessment.mixedExerciseCount + assessment.ambiguousExerciseCount;
  if (assessment.status === "progress") return uk
    ? `У ${progressed.length} з ${evaluatedCount} вправ типові результати на початку й наприкінці періоду змінилися вгору; разова сесія не визначає висновок.`
    : `${progressed.length} of ${evaluatedCount} exercises show higher typical results from the start to the end of the window; one session does not decide the result.`;
  if (assessment.status === "regression") return uk
    ? `У ${regressed.length} з ${evaluatedCount} вправ типові результати знизилися; висновок спирається на повторювані сесії, а не один невдалий день.`
    : `${regressed.length} of ${evaluatedCount} exercises show lower typical results; the result uses repeated sessions, not one poor day.`;
  if (assessment.status === "stable") return uk
    ? "У зіставних вправах типові результати залишилися близькими; окремі відхилення не змінили загальної картини."
    : "Typical results stayed close across comparable exercises; isolated changes did not shift the overall picture.";
  if (assessment.status === "mixed") {
    const upName = progressed[0] ? localizedExerciseName(progressed[0], uk) : null;
    const downName = regressed[0] ? localizedExerciseName(regressed[0], uk) : null;
    if (upName && downName) return uk
      ? `${upName} покращилася, але ${downName} знизилася — тому спільний напрямок не підтверджений.`
      : `${upName} improved while ${downName} declined, so there is no single shared direction.`;
    return uk
      ? "У частині вправ зміни різноспрямовані; зводити їх до одного позитивного чи негативного тренду було б оманливо."
      : "Some exercises moved in different directions; reducing them to one positive or negative trend would be misleading.";
  }
  if (assessment.status === "ambiguous") return uk
    ? "Записані вага, повторення, зусилля або порядок виконання відрізнялися настільки, що надійно зіставити типові результати не вдалося."
    : "Load, reps, effort, or exercise order changed enough that typical results could not be compared reliably.";
  if (assessment.exercises.length === 0) return uk
    ? "У цьому періоді немає зіставлених записів тренувань для вибраного м’яза."
    : "There are no matched training records for this muscle in the selected period.";
  if (assessment.exercises.every(({ stableKey }) => stableKey === null)) return uk
    ? "Не вдалося підтвердити, що це ті самі вправи між сесіями, тому напрямок не визначався."
    : "The log does not reliably identify the same exercises across sessions, so no direction was assigned.";
  return uk
    ? "Потрібно щонайменше чотири зіставні тренування, розподілені протягом періоду."
    : "At least four comparable workouts spread across the period are needed.";
}

function statusCaveats(
  assessment: ReturnType<typeof assessBodyMapMusclePerformanceV1>,
  uk: boolean,
): string[] {
  const exercises = assessment.exercises;
  const comparabilityChanged = exercises.some(({ hasOrderShift, hasDuplicateOccurrences, hasProgramChange, hasLongGap }) =>
    hasOrderShift || hasDuplicateOccurrences || hasProgramChange || hasLongGap);
  const recordsIncomplete = assessment.mappingIncomplete
    || exercises.some(({ hasUnreportedRir, hasEffortMismatch, hasUncertainSessionLoad, lighterSessionCount, hasConflictingLoadAndReps }) =>
      hasUnreportedRir || hasEffortMismatch || hasUncertainSessionLoad || lighterSessionCount > 0 || hasConflictingLoadAndReps);
  return [
    assessment.mappingIncomplete ? (uk
      ? "Висновок охоплює лише вправи, які вдалося зіставити з цим м’язом."
      : "The result includes only exercises that could be matched to this muscle.") : null,
    comparabilityChanged ? (uk
      ? "Порядок або програма місцями змінювалися; повторні появи тієї самої вправи в одному тренуванні не порівнювалися."
      : "Exercise order or program changed; repeated appearances of one exercise in a workout were excluded from comparison.") : null,
    recordsIncomplete && !assessment.mappingIncomplete ? (uk
      ? "Частина записів мала неповний або незвичний контекст зусилля чи навантаження."
      : "Some records had incomplete or unusual effort or load context.") : null,
  ].filter((note): note is string => note !== null).slice(0, 2);
}

function energyContextText(
  analytics: BodyMapTrainingAnalyticsResponseV1,
  uk: boolean,
  locale: string,
): string | null {
  const context = analytics.energyBalanceContext;
  if (context?.status !== "available" || !context.early || !context.late) return null;
  const changedSign = context.early.medianKcalPerDay < 0 && context.late.medianKcalPerDay >= 0
    || context.early.medianKcalPerDay >= 0 && context.late.medianKcalPerDay < 0;
  if (!changedSign) return null;
  const early = formatValue(context.early.medianKcalPerDay, locale);
  const late = formatValue(context.late.medianKcalPerDay, locale);
  return uk
    ? `Оцінений енергетичний баланс змінився з ${early} на ${late} ккал/день. Це контекст журналу, а не доведена причина зміни силових результатів.`
    : `Estimated energy balance changed from ${early} to ${late} kcal/day. This is diary context, not a proven cause of performance change.`;
}

function Sparkline({ values, label, kind }: { values: number[]; label: string; kind: "load" | "reps" }) {
  if (values.length < 3) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1e-9, max - min);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 116 + 2;
    const y = 25 - ((value - min) / spread) * 20;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <div className={styles.sparklineRow}>
    <span>{label}</span>
    <svg className={styles.sparkline} data-kind={kind} role="img" aria-label={label} viewBox="0 0 120 30" preserveAspectRatio="none">
      <polyline points={points} />
    </svg>
  </div>;
}

function ExerciseDisclosure({ exercise, locale, uk }: { exercise: BodyMapExerciseProgressV1; locale: string; uk: boolean }) {
  const name = localizedExerciseName(exercise, uk);
  const trendPoints = exercise.points.filter((point) => !point.lighter && !point.uncertainSessionLoad);
  const repValues = trendPoints.map(({ reps }) => reps);
  const loadValues = exercise.resistanceType === "EXTERNAL_WEIGHT"
    ? trendPoints.flatMap(({ loadKg }) => loadKg === null ? [] : [loadKg])
    : [];
  const note = exercise.status === "insufficient-data"
    ? uk ? "Для цієї вправи ще немає достатньої кількості повторюваних записів." : "There are not enough repeated records for this exercise yet."
    : exercise.status === "ambiguous"
      ? uk ? "Зміни навантаження, повторень, зусилля або порядку не дали надійного зіставлення." : "Changes in load, reps, effort, or order prevented a reliable comparison."
      : exercise.resistanceType === "BODYWEIGHT"
        ? uk ? "Порівняння використовує повторення; зовнішня вага у записах не вказана." : "This comparison uses reps; external load is not recorded."
        : exercise.resistanceType === "RESISTANCE_BAND"
          ? uk ? "Порівнюються повторення за тієї самої позначки резинки; її номінал не є прямим виміром сили." : "Reps are compared at the same band setting; its nominal rating is not a direct strength measurement."
          : uk ? "Це підсумок записаних підходів цієї вправи." : "This summarizes the recorded set results for this exercise.";
  return <details className={styles.exercise} data-testid="body-map-exercise-progress">
    <summary>
      <span className={styles.exerciseHeading}>
        <strong>{name}</strong>
        <span>{resultLine(exercise, exercise.early, locale, uk)} <i aria-hidden="true">→</i> {resultLine(exercise, exercise.late, locale, uk)}</span>
      </span>
      <span className={styles.exerciseStatus} data-status={exercise.status}>{statusLabel(exercise.status, uk)}</span>
    </summary>
    <div className={styles.exerciseBody}>
      <p>{note}</p>
      {exercise.role === "assisting" && <small>{uk ? "Вправа навантажує цей м’яз як допоміжний." : "This exercise involves the muscle as an assisting mover."}</small>}
      {exercise.hasOrderShift && <small>{uk ? "Позиція вправи змінилася; її результати порівнюються обережно." : "Exercise position changed; its results are compared cautiously."}</small>}
      {exercise.hasDuplicateOccurrences && <small>{uk ? "Повторні появи цієї вправи в одному тренуванні виключено, щоб не змішувати різні позиції." : "Repeated appearances in one workout were excluded so different exercise positions are not combined."}</small>}
      {exercise.hasProgramChange && <small>{uk ? "У періоді змінювалися програма або цілі цієї вправи." : "The program or targets for this exercise changed during the period."}</small>}
      {exercise.hasLongGap && <small>{uk ? "Між записами є тривала перерва." : "There is a long gap between records."}</small>}
      {exercise.hasUnreportedRir && <small>{uk ? "Частина підходів не має запису запасу повторень." : "Some sets do not include a reps-in-reserve entry."}</small>}
      <div className={styles.charts}>
        {exercise.resistanceType === "EXTERNAL_WEIGHT" && <Sparkline values={loadValues} kind="load" label={uk ? "Зміна робочої ваги" : "Logged load trend"} />}
        <Sparkline values={repValues} kind="reps" label={uk ? "Зміна повторень" : "Logged reps trend"} />
      </div>
    </div>
  </details>;
}

function PeriodField({ months, onChange, uk }: { months: BodyMapAnalyticsMonthsV1; onChange: (months: BodyMapAnalyticsMonthsV1) => void; uk: boolean }) {
  return <label className={styles.periodField}>
    <span>{uk ? "Період аналізу" : "Analysis period"}</span>
    <select value={months} onChange={(event) => onChange(Number(event.currentTarget.value) as BodyMapAnalyticsMonthsV1)}>
      <option value={1}>{uk ? "1 місяць" : "1 month"}</option>
      <option value={2}>{uk ? "2 місяці" : "2 months"}</option>
      <option value={3}>{uk ? "3 місяці" : "3 months"}</option>
      <option value={6}>{uk ? "6 місяців" : "6 months"}</option>
    </select>
  </label>;
}

export function BodyMapTrainingAnalyticsPanel({
  level,
  months,
  onMonthsChange,
  analytics,
  requestState,
  groupLabel,
  anatomyId,
  anatomyLabel,
  groupReport,
}: {
  level: ViewLevel;
  months: BodyMapAnalyticsMonthsV1;
  onMonthsChange: (months: BodyMapAnalyticsMonthsV1) => void;
  analytics: BodyMapTrainingAnalyticsResponseV1 | null;
  requestState: "loading" | "ready" | "unauthorized" | "error";
  groupLabel: string | null;
  anatomyId: AnatomyIdV2 | null;
  anatomyLabel: string | null;
  groupReport: GroupReport | null;
}) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const assessment = useMemo(() => assessBodyMapMusclePerformanceV1({ groupReport, anatomyId }), [groupReport, anatomyId]);
  const title = level === "SUBREGION_DETAIL" && anatomyId
    ? bodyMapAnatomyLabel(anatomyId, anatomyLabel ?? "", locale)
    : groupLabel ?? (uk ? "Вибраний м’яз" : "Selected muscle");
  const dateRange = analytics ? new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;
  const dateFrom = analytics && dateRange ? dateRange.format(new Date(analytics.period.from)) : null;
  const dateTo = analytics && dateRange ? dateRange.format(new Date(analytics.period.to)) : null;
  const energyLine = analytics ? energyContextText(analytics, uk, intlLocale) : null;

  return <section className={styles.panel} data-testid="body-map-training-analytics">
    <header className={styles.panelHeader}>
      <div>
        <p className={styles.kicker}>{level === "OVERVIEW" ? (uk ? "ПРОГРЕС ТРЕНУВАНЬ" : "TRAINING PROGRESS") : (uk ? "АНАЛІТИКА М’ЯЗА" : "MUSCLE PROGRESS")}</p>
        <h2>{level === "OVERVIEW" ? (uk ? "Прогрес м’язів" : "Muscle progress") : title}</h2>
      </div>
      <PeriodField months={months} onChange={onMonthsChange} uk={uk} />
    </header>
    {dateFrom && dateTo && <p className={styles.dateRange}>{uk ? "Період" : "Window"}: {dateFrom} – {dateTo}</p>}
    {requestState === "loading" && <p className={styles.notice} role="status">{uk ? "Завантажую тренувальні записи…" : "Loading training records…"}</p>}
    {requestState === "unauthorized" && <p className={styles.notice} role="status">{uk ? "Увійди, щоб переглянути власну історію тренувань." : "Sign in to view your training history."}</p>}
    {requestState === "error" && <p className={styles.notice} role="alert">{uk ? "Аналітика тимчасово недоступна. Записи тренувань не змінено." : "Analytics is temporarily unavailable. Training records were not changed."}</p>}
    {requestState === "ready" && level === "OVERVIEW" && <p className={styles.overviewPrompt}>{uk ? "Вибери м’яз на карті або в списку, щоб одразу побачити підсумок його тренувального прогресу." : "Select a muscle on the map or in the list to see its training progress."}</p>}
    {requestState === "ready" && level !== "OVERVIEW" && analytics && <>
      <article className={styles.resultCard} data-status={assessment.status} aria-live="polite" aria-label={uk ? `Підсумок тренувального прогресу: ${title}` : `Training progress summary: ${title}`}>
        <div className={styles.resultHeading}>
          <span className={styles.statusGlyph} aria-hidden="true">{statusGlyph(assessment.status)}</span>
          <strong>{statusLabel(assessment.status, uk)}</strong>
        </div>
        <p className={styles.explanation}>{explanation(assessment, uk)}</p>
        {assessment.status !== "insufficient-data" && <p className={styles.scopeLine}>
          {uk
            ? `${assessment.progressExerciseCount} прогресують · ${assessment.stableExerciseCount} без виразних змін · ${assessment.regressionExerciseCount} знижуються${assessment.mixedExerciseCount ? ` · ${assessment.mixedExerciseCount} різноспрямовано` : ""}${assessment.ambiguousExerciseCount ? ` · ${assessment.ambiguousExerciseCount} неоднозначно` : ""}${assessment.insufficientExerciseCount ? ` · ${assessment.insufficientExerciseCount} без достатніх даних` : ""}`
            : `${assessment.progressExerciseCount} improving · ${assessment.stableExerciseCount} stable · ${assessment.regressionExerciseCount} declining${assessment.mixedExerciseCount ? ` · ${assessment.mixedExerciseCount} mixed` : ""}${assessment.ambiguousExerciseCount ? ` · ${assessment.ambiguousExerciseCount} unclear` : ""}${assessment.insufficientExerciseCount ? ` · ${assessment.insufficientExerciseCount} with too little data` : ""}`}
        </p>}
        {statusCaveats(assessment, uk).map((note) => <p className={styles.caveat} key={note}>{note}</p>)}
        {energyLine && <p className={styles.energyContext}>{energyLine}</p>}
        <small className={styles.measurementNote}>{uk
          ? "Тенденція записаних підходів; розминка окремо не позначається. Це не вимір росту м’язів."
          : "Logged-set trend; warm-ups are not marked separately. This does not measure muscle growth."}</small>
      </article>
      <section className={styles.exerciseSection} aria-label={uk ? "Вправи, що враховані у висновку" : "Exercises included in the summary"}>
        <div className={styles.sectionHeading}>
          <h3>{uk ? "Вправи за період" : "Exercises in this period"}</h3>
          <span>{assessment.exercises.length}</span>
        </div>
        {assessment.exercises.length > 0
          ? <div className={styles.exerciseList}>
            {assessment.exercises.map((exercise) => <ExerciseDisclosure key={exercise.key} exercise={exercise} locale={intlLocale} uk={uk} />)}
          </div>
          : <p className={styles.emptyState}>{uk ? "Для цього м’яза у вибраному періоді немає вправ із завершеними підходами." : "No exercises with completed sets were found for this muscle in the selected period."}</p>}
      </section>
    </>}
  </section>;
}
