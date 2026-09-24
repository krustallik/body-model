"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import type { DailyMetricDto, DailyMetricField } from "@/modules/days/day.types";
import { DAILY_METRIC_FIELDS } from "@/modules/days/day.types";
import { todayInCalendarTimeZone } from "@/modules/days/calendar-range";
import { summarizeDayWorkouts } from "@/modules/days/day-workout-presentation";
import type { TrainingDayFact } from "@/modules/days/training-day-fact";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";
import {
  filterDaysByRange,
  rangeStartDate,
  sortDaysNewestFirst,
  type HistoryRange,
} from "@/modules/days/history-chart-data";
import { historyRecordCount } from "@/modules/days/history-card-presentation";
import { formatDurationClock, formatMetric } from "@/modules/days/metric-format";
import { HeartRateDayChart } from "./heart-rate-day-chart";
import { HistoryCharts } from "./history-charts";
import { SleepNightChart } from "./sleep-night-chart";
import { WorkActivityDialog } from "./work-activity-dialog";
import { WorkoutDetailsDialog } from "./workout-details-dialog";
import { HistoryDayCard } from "./history-day-card";
import styles from "./history.module.css";

type FormValues = Record<DailyMetricField, string> & { date: string };
type WorkoutForm = { type: string; startAt: string; durationMinutes: string; activeEnergyKcal: string };
type EditorState = {
  mode: "create" | "edit";
  values: FormValues;
  workouts: WorkoutForm[];
  legacyWorkoutFields: boolean;
} | null;

const metricFields: Array<{
  key: DailyMetricField;
  label: string;
  shortLabel: string;
  placeholder?: string;
}> = [
  { key: "weightKg", label: "Weight (kg)", shortLabel: "weightKg", placeholder: "89,4" },
  { key: "bodyFatPercent", label: "Body fat (%)", shortLabel: "bodyFatPercent", placeholder: "27,4" },
  { key: "caloriesKcal", label: "Calories (kcal)", shortLabel: "caloriesKcal" },
  { key: "proteinG", label: "Protein (g)", shortLabel: "proteinG" },
  { key: "fatG", label: "Fat (g)", shortLabel: "fatG" },
  { key: "carbsG", label: "Carbs (g)", shortLabel: "carbsG" },
  { key: "steps", label: "Steps", shortLabel: "steps" },
  { key: "activeEnergyKcal", label: "Active energy (kcal)", shortLabel: "activeEnergyKcal" },
  { key: "averageWalkingSpeedKmh", label: "Walking speed (km/h)", shortLabel: "averageWalkingSpeedKmh" },
  { key: "walkingDistanceKm", label: "Walking distance (km)", shortLabel: "walkingDistanceKm" },
  { key: "strengthTrainingMinutes", label: "Training (min)", shortLabel: "strengthTrainingMinutes" },
];

const tableFields = metricFields.filter(({ key }) => key !== "activeEnergyKcal");
const formMetricFields = metricFields.filter(({ key }) => (
  key !== "activeEnergyKcal" && key !== "strengthTrainingMinutes"
));
const compactTableKeys = new Set<DailyMetricField>([
  "averageWalkingSpeedKmh",
  "walkingDistanceKm",
  "strengthTrainingMinutes",
]);
const rangeOptions: Array<{ value: HistoryRange; label: string }> = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: "all", label: "All" },
];

function localizedMetricLabel(key: DailyMetricField, uk: boolean): string {
  const parts = headerParts(key, uk);
  return parts.unit ? `${parts.main} (${parts.unit})` : parts.main;
}

function headerParts(key: DailyMetricField, uk: boolean): { main: string; unit: string } {
  if (key === "weightKg") return { main: uk ? "Вага" : "Weight", unit: uk ? "кг" : "kg" };
  if (key === "bodyFatPercent") return { main: uk ? "Жирова маса" : "Body fat", unit: "%" };
  if (key === "caloriesKcal") return { main: uk ? "Калорії" : "Calories", unit: uk ? "ккал" : "kcal" };
  if (key === "proteinG") return { main: uk ? "Білки" : "Protein", unit: uk ? "г" : "g" };
  if (key === "fatG") return { main: uk ? "Жири" : "Fat", unit: uk ? "г" : "g" };
  if (key === "carbsG") return { main: uk ? "Вуглеводи" : "Carbs", unit: uk ? "г" : "g" };
  if (key === "steps") return { main: uk ? "Кроки" : "Steps", unit: "" };
  if (key === "activeEnergyKcal") return { main: uk ? "Активна енергія" : "Active energy", unit: uk ? "ккал" : "kcal" };
  if (key === "averageWalkingSpeedKmh") return { main: uk ? "Швидкість ходьби" : "Walking speed", unit: uk ? "км/год" : "km/h" };
  if (key === "walkingDistanceKm") return { main: uk ? "Дистанція ходьби" : "Walking distance", unit: uk ? "км" : "km" };
  return { main: uk ? "Тренування" : "Training", unit: uk ? "хв" : "min" };
}

function dayHasWorkoutDetail(day: DailyMetricDto): boolean {
  return (day.trainingDayFact?.eventCount ?? day.workouts.length) > 0;
}

function tableMetricValue(day: DailyMetricDto, key: DailyMetricField): number | null {
  if (key !== "strengthTrainingMinutes") return day[key];
  if (day.trainingDayFact) return day.trainingDayFact.durationMinutes;
  return day.workoutSource === "none" || day.workoutSource === "legacy-strength"
    ? 0
    : day.totalWorkoutMinutes;
}

function localToday(): string {
  return todayInCalendarTimeZone();
}

function eventOnlyHistoryDay(fact: TrainingDayFact): DailyMetricDto {
  const summary = summarizeDayWorkouts({
    workouts: fact.events.map((event) => ({
      id: event.workoutId ?? undefined,
      type: event.type,
      startAt: event.occurrenceAt,
      endAt: event.endAt,
      durationMinutes: event.durationMinutes,
      activeEnergyKcal: event.activeEnergyKcal,
      energySource: event.energySource,
      diaryOnly: event.diaryOnly,
      matchedDiarySession: event.diarySessionId === null ? null : {
        id: event.diarySessionId,
        program: event.diaryProgramName === null ? null : { name: event.diaryProgramName },
      },
      exerciseDetailAvailability: event.exerciseDetailAvailability,
      loggedSetCount: event.loggedSetCount,
    })),
    legacyStrengthTrainingMinutes: null,
    trainingDayFact: fact,
  });
  const emptyMetrics = Object.fromEntries(DAILY_METRIC_FIELDS.map((field) => [field, null])) as Record<DailyMetricField, number | null>;
  return {
    ...emptyMetrics,
    date: fact.date,
    updatedAt: null,
    hasHealthRecord: false,
    workouts: summary.workouts,
    totalWorkoutMinutes: fact.durationMinutes,
    workoutSource: fact.eventCount > 0 ? "workouts" : "none",
    workoutFeedObserved: null,
    trainingDayFact: fact,
    heartRate: { sampleCount: 0, minBpm: null, maxBpm: null, avgBpm: null, latestBpm: null, latestTimestamp: null, samples: [] },
    restingHeartRate: { sampleCount: 0, minBpm: null, maxBpm: null, avgBpm: null, latestBpm: null, latestTimestamp: null, samples: [] },
    restingHeartRateBpm: null,
    sleepMinutes: null,
    sleep: null,
  } as DailyMetricDto;
}

function emptyForm(): FormValues {
  return Object.fromEntries([
    ["date", localToday()],
    ...metricFields.map(({ key }) => [key, ""]),
  ]) as FormValues;
}

function editForm(day: DailyMetricDto): FormValues {
  return Object.fromEntries([
    ["date", day.date],
    ...metricFields.map(({ key }) => [key, day[key] === null ? "" : String(day[key])]),
  ]) as FormValues;
}

function toLocalDateTime(iso: string): string {
  const local = instantToLocalDateTime(new Date(iso), DEFAULT_TIME_ZONE);
  return `${local.date}T${local.time}`;
}

function localDateTimeInputToIso(value: string): string {
  const separator = value.indexOf("T");
  if (separator < 1) throw new RangeError("local date and time are required");
  return localDateTimeToInstant(value.slice(0, separator), value.slice(separator + 1), DEFAULT_TIME_ZONE).toISOString();
}

function workoutForm(day: DailyMetricDto): WorkoutForm[] {
  return day.workouts.map((workout) => ({
    type: workout.type,
    startAt: toLocalDateTime(workout.startAt),
    durationMinutes: workout.durationMinutes === null
      ? workout.endAt === null ? "" : String(Math.max(1, Math.round((new Date(workout.endAt).getTime() - new Date(workout.startAt).getTime()) / 60_000)))
      : String(workout.durationMinutes),
    activeEnergyKcal: workout.activeEnergyKcal === null ? "" : String(workout.activeEnergyKcal),
  }));
}

function newWorkout(date: string): WorkoutForm {
  return { type: "", startAt: `${date}T12:00`, durationMinutes: "", activeEnergyKcal: "" };
}

async function responseError(response: Response, uk = false): Promise<string> {
  const fallback = uk ? `Помилка запиту (${response.status})` : `Request failed (${response.status})`;
  try {
    const body = await response.json() as { error?: string; details?: Array<{ message?: string }> };
    const code = body.error;
    if (uk && code === "date_conflict") return "Запис за цю дату вже існує.";
    if (uk && code === "internal_error") return "Внутрішня помилка. Спробуйте ще раз.";
    return body.details?.[0]?.message ?? code ?? fallback;
  } catch {
    return fallback;
  }
}

async function fetchDays(range: HistoryRange, uk = false): Promise<DailyMetricDto[]> {
  const today = localToday();
  const collected: DailyMetricDto[] = [];
  const trainingFacts = new Map<string, TrainingDayFact>();
  let offset = 0;

  do {
    const query = new URLSearchParams({ to: today, limit: "100", offset: String(offset) });
    if (range !== "all") query.set("from", rangeStartDate(range, today));
    if (offset > 0) query.set("includeTrainingDays", "false");

    const response = await fetch(`/api/v1/days?${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await responseError(response, uk));
    const body = await response.json() as { days: DailyMetricDto[]; trainingDays?: TrainingDayFact[] };
    collected.push(...body.days);
    for (const fact of body.trainingDays ?? []) trainingFacts.set(fact.date, fact);
    offset += body.days.length;
    if (range !== "all" || body.days.length < 100) break;
  } while (true);

  const healthDays = new Map<string, DailyMetricDto>();
  for (const day of collected) {
    const fact = trainingFacts.get(day.date) ?? day.trainingDayFact;
    healthDays.set(day.date, fact ? { ...day, trainingDayFact: fact, totalWorkoutMinutes: fact.durationMinutes } : day);
  }
  for (const fact of trainingFacts.values()) {
    if (fact.eventCount > 0 && !healthDays.has(fact.date)) healthDays.set(fact.date, eventOnlyHistoryDay(fact));
  }
  return sortDaysNewestFirst(filterDaysByRange([...healthDays.values()], range, today));
}

async function fetchWorkActivityDates(): Promise<Set<string> | null> {
  try {
    const response = await fetch("/api/v1/work-intervals", { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json() as { intervals?: Array<{ date?: unknown }> };
    return new Set((body.intervals ?? []).flatMap(({ date }) => (
      typeof date === "string" ? [date] : []
    )));
  } catch {
    return null;
  }
}

async function fetchHistoryData(range: HistoryRange, uk: boolean): Promise<{
  days: DailyMetricDto[];
  workActivityDates: Set<string> | null;
}> {
  const [days, allWorkDates] = await Promise.all([fetchDays(range, uk), fetchWorkActivityDates()]);
  if (allWorkDates === null) return { days, workActivityDates: null };
  const visibleDates = new Set(days.map(({ date }) => date));
  return {
    days,
    workActivityDates: new Set([...allWorkDates].filter((date) => visibleDates.has(date))),
  };
}

export function HistoryClient() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const [days, setDays] = useState<DailyMetricDto[]>([]);
  const [workActivityDates, setWorkActivityDates] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [range, setRange] = useState<HistoryRange>(30);
  const [workDate, setWorkDate] = useState<string | null>(null);
  const [workoutDay, setWorkoutDay] = useState<DailyMetricDto | null>(null);

  const loadDays = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await fetchHistoryData(range, uk);
      setDays(loaded.days);
      setWorkActivityDates(loaded.workActivityDates);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : uk ? "Не вдалося завантажити історію" : "Could not load history");
    } finally {
      setLoading(false);
    }
  }, [range, uk]);

  useEffect(() => {
    let active = true;
    fetchHistoryData(range, uk)
      .then((loaded) => {
        if (!active) return;
        setDays(loaded.days);
        setWorkActivityDates(loaded.workActivityDates);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : uk ? "Не вдалося завантажити історію" : "Could not load history");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range, uk]);

  function selectRange(nextRange: HistoryRange) {
    if (nextRange === range) return;
    setLoading(true);
    setError(null);
    setRange(nextRange);
  }

  async function deleteDay(date: string) {
    if (!window.confirm(uk ? `Видалити денні показники за ${date}?` : `Delete daily metrics for ${date}?`)) return;
    setError(null);
    const response = await fetch(`/api/v1/days/${encodeURIComponent(date)}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await responseError(response, uk));
      return;
    }
    await loadDays();
  }

  function editDay(day: DailyMetricDto) {
    setEditor({
      mode: "edit",
      values: editForm(day),
      workouts: workoutForm(day),
      legacyWorkoutFields: (day.trainingDayFact?.eventCount ?? (day.workoutSource === "workouts" ? 1 : 0)) === 0
        && day.strengthTrainingMinutes !== null,
    });
  }

  function renderDayActions(day: DailyMetricDto) {
    return (
      <div className={styles.actions}>
        <button type="button" onClick={() => setWorkoutDay(day)}>{uk ? "Деталі" : "Details"}</button>
        <button type="button" onClick={() => setWorkDate(day.date)}>{uk ? "Робота" : "Work"}</button>
        {day.hasHealthRecord !== false && <button type="button" onClick={() => editDay(day)}>{uk ? "Редагувати" : "Edit"}</button>}
        {day.hasHealthRecord !== false && <button className={styles.deleteButton} type="button" onClick={() => void deleteDay(day.date)}>{uk ? "Видалити" : "Delete"}</button>}
      </div>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.navRow}>
        <strong>BodyCast</strong>
        <AppNav active="history" />
      </div>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{uk ? "BodyCast · Денні показники" : "BodyCast · Daily metrics"}</p>
          <h1>{uk ? "Історія здоров’я" : "Health history"}</h1>
          <p className={styles.intro}>{uk ? "Переглядайте записи Apple Health і обережно вносьте ручні виправлення." : "Review Apple Health records and make careful manual corrections."}</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => {
          const values = emptyForm();
          setEditor({ mode: "create", values, workouts: [], legacyWorkoutFields: false });
        }}>
          {uk ? "Додати день" : "Add day"}
        </button>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <section className={styles.rangeBar} aria-label={uk ? "Діапазон дат історії" : "History date range"}>
        <div>
          <strong>{uk ? "Діапазон дат" : "Date range"}</strong>
          <span>{uk ? "Графіки й таблиця синхронізовані" : "Charts and table stay in sync"}</span>
        </div>
        <div className={styles.rangeSwitch}>
          {rangeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={range === option.value}
              onClick={() => selectRange(option.value)}
            >
              {uk ? (option.value === "all" ? "Усі" : `${option.value} днів`) : option.label}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.heartRateDaySection} aria-label={uk ? "Пульс за обраний день" : "Heart rate for selected day"}>
        <HeartRateDayChart />
      </section>

      <section className={styles.heartRateDaySection} aria-label={uk ? "Сон за обрану ніч" : "Sleep for selected night"}>
        <SleepNightChart />
      </section>

      {loading ? (
        <div className={styles.chartsLoading}>{uk ? "Завантаження графіків…" : "Loading charts…"}</div>
      ) : (
        <HistoryCharts days={days} range={range} />
      )}

      <section className={styles.panel} aria-busy={loading}>
        <div className={styles.panelHeader}>
          <div>
            <h2>{range === "all" ? (uk ? "Усі записи" : "All records") : (uk ? `Останні ${range} днів` : `Last ${range} days`)}</h2>
            <p>{loading ? (uk ? "Оновлення…" : "Refreshing…") : historyRecordCount(days.length, uk)}</p>
          </div>
          <button className={styles.secondaryButton} type="button" onClick={() => void loadDays()} disabled={loading}>
            {uk ? "Оновити" : "Refresh"}
          </button>
        </div>

        {!loading && days.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>{uk ? "Денних показників ще немає" : "No daily metrics yet"}</strong>
            <span>{uk ? "Додайте день вручну або дочекайтеся наступної синхронізації iPhone." : "Add a day manually or wait for the next iPhone sync."}</span>
          </div>
        ) : (
          <>
          <div className={styles.desktopTable} data-testid="desktop-history-table">
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{uk ? "дата" : "date"}</th>
                  {tableFields.map(({ key }) => {
                    const parts = headerParts(key, uk);
                    return (
                      <th key={key} className={compactTableKeys.has(key) ? styles.compactCol : undefined}>
                        <span className={styles.thStack}>
                          <span className={styles.thMain}>{parts.main}</span>
                          {parts.unit ? <span className={styles.thUnit}>{parts.unit}</span> : null}
                        </span>
                      </th>
                    );
                  })}
                  <th className={styles.compactCol}>
                    <span className={styles.thStack}>
                      <span className={styles.thMain}>{uk ? "Тривалість сну" : "Sleep duration"}</span>
                      <span className={styles.thUnit}>{uk ? "год:хв" : "h:mm"}</span>
                    </span>
                  </th>
                  <th className={styles.compactCol}>
                    <span className={styles.thStack}>
                      <span className={styles.thMain}>{uk ? "Пульс у спокої" : "Resting HR"}</span>
                      <span className={styles.thUnit}>bpm</span>
                    </span>
                  </th>
                  <th>{uk ? "дії" : "actions"}</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date}>
                    <td data-label="date"><strong>{day.date}</strong></td>
                    {tableFields.map(({ key }) => {
                      const value = tableMetricValue(day, key);
                      const label = localizedMetricLabel(key, uk);
                      const display = formatMetric(value, intlLocale);
                      const isWorkout = key === "strengthTrainingMinutes";
                      const clickable = isWorkout && dayHasWorkoutDetail(day);
                      return (
                        <td
                          key={key}
                          data-label={label}
                          className={compactTableKeys.has(key) ? styles.compactCol : undefined}
                        >
                          {clickable ? (
                            <button
                              type="button"
                              className={styles.workoutLink}
                              onClick={() => setWorkoutDay(day)}
                            >
                              {display}
                            </button>
                          ) : display}
                          {isWorkout && day.workoutSource === "workouts"
                            && day.workouts.some((workout) => workout.activeEnergyKcal === null) && (
                            <small className={styles.provenanceHint} data-tone="unavailable">
                              {uk ? "енергія недоступна ≠ 0" : "energy unavailable ≠ 0"}
                            </small>
                          )}
                        </td>
                      );
                    })}
                    <td data-label={uk ? "Тривалість сну" : "Sleep duration"} className={styles.compactCol}>
                      {formatDurationClock(day.sleepMinutes ?? null)}
                    </td>
                    <td data-label={uk ? "Пульс у спокої" : "Resting HR"} className={styles.compactCol}>
                      {day.restingHeartRateBpm == null
                        ? "—"
                        : formatMetric(day.restingHeartRateBpm, intlLocale)}
                    </td>
                    <td data-label="actions">
                      {renderDayActions(day)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
          <section className={styles.mobileDayCards} data-testid="mobile-history-cards" aria-label={uk ? "Денні записи" : "Daily entries"}>
            {days.map((day) => (
              <HistoryDayCard
                key={day.date}
                day={day}
                intlLocale={intlLocale}
                uk={uk}
                workActivityPresent={workActivityDates === null ? null : workActivityDates.has(day.date)}
                onDetails={() => setWorkoutDay(day)}
                onWork={() => setWorkDate(day.date)}
                onEdit={() => editDay(day)}
                onDelete={() => void deleteDay(day.date)}
              />
            ))}
          </section>
          </>
        )}
      </section>

      {editor && (
        <DayDialog
          editor={editor}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await loadDays();
          }}
        />
      )}
      {workDate && <WorkActivityDialog date={workDate} onClose={() => {
        setWorkDate(null);
        void fetchWorkActivityDates().then(setWorkActivityDates);
      }} />}
      {workoutDay && <WorkoutDetailsDialog day={workoutDay} onClose={() => setWorkoutDay(null)} />}
    </main>
  );
}

function DayDialog({ editor, onClose, onSaved }: {
  editor: NonNullable<EditorState>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState(editor.values);
  const [workouts, setWorkouts] = useState(editor.workouts);
  const [legacyWorkoutFields, setLegacyWorkoutFields] = useState(editor.legacyWorkoutFields);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function setValue(key: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function setWorkout(index: number, key: keyof WorkoutForm, value: string) {
    setWorkouts((current) => current.map((workout, workoutIndex) => (
      workoutIndex === index ? { ...workout, [key]: value } : workout
    )));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    const metrics = Object.fromEntries([
      ...formMetricFields.map(({ key }) => [key, values[key].trim() || null]),
      ...(legacyWorkoutFields ? [
        ["strengthTrainingMinutes", values.strengthTrainingMinutes.trim() || null],
        ["activeEnergyKcal", values.activeEnergyKcal.trim() || null],
      ] : []),
    ]);
    let workoutPayload: Record<string, unknown>;
    try {
      workoutPayload = legacyWorkoutFields ? {} : {
        workouts: workouts.map((workout) => ({
          type: workout.type.trim(),
          startAt: localDateTimeInputToIso(workout.startAt),
          durationMinutes: workout.durationMinutes.trim(),
          activeEnergyKcal: workout.activeEnergyKcal.trim() || null,
        })),
      };
    } catch {
      setFormError(uk
        ? "Цей місцевий час не існує або повторюється під час переходу на літній/зимовий час."
        : "This local time is nonexistent or ambiguous during a daylight-saving transition.");
      setSaving(false);
      return;
    }
    const isCreate = editor.mode === "create";
    const response = await fetch(
      isCreate ? "/api/v1/days" : `/api/v1/days/${encodeURIComponent(values.date)}`,
      {
        method: isCreate ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isCreate ? { date: values.date, ...metrics, ...workoutPayload } : { ...metrics, ...workoutPayload }),
      },
    );

    if (!response.ok) {
      setFormError(await responseError(response, uk));
      setSaving(false);
      return;
    }

    await onSaved();
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <div className={styles.dialogHeader}>
          <div>
            <p className={styles.eyebrow}>{editor.mode === "create" ? (uk ? "Новий запис" : "New record") : (uk ? "Ручне виправлення" : "Manual correction")}</p>
            <h2>{editor.mode === "create" ? (uk ? "Додати день" : "Add a day") : (uk ? `Редагувати ${values.date}` : `Edit ${values.date}`)}</h2>
          </div>
          <button className={styles.closeButton} type="button" aria-label={uk ? "Закрити" : "Close"} onClick={onClose}>×</button>
        </div>

        {formError && <div className={styles.formError} role="alert">{formError}</div>}

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>{uk ? "Дата" : "Date"}</span>
            <input type="date" value={values.date} disabled={editor.mode === "edit"} required onChange={(event) => setValue("date", event.target.value)} />
          </label>
          {formMetricFields.map(({ key, placeholder }) => (
            <label className={styles.field} key={key}>
              <span>{localizedMetricLabel(key, uk)}</span>
              <input
                type="text"
                inputMode={key === "steps" ? "numeric" : "decimal"}
                value={values[key]}
                placeholder={placeholder ?? (uk ? "Необов’язково" : "Optional")}
                onChange={(event) => setValue(key, event.target.value)}
              />
            </label>
          ))}
        </div>

        {legacyWorkoutFields ? (
          <section className={styles.legacyWorkoutSection}>
            <div>
              <strong>{uk ? "Легасі-запис тренування" : "Legacy workout record"}</strong>
              <p>{uk ? "Цей старий запис містить лише денну суму. Можна виправити її або перетворити на окреме тренування." : "This older record only has a daily total. You can correct it or convert it into one workout."}</p>
            </div>
            <div className={styles.formGrid}>
              {(["strengthTrainingMinutes", "activeEnergyKcal"] as const).map((key) => (
                <label className={styles.field} key={key}>
                  <span>{localizedMetricLabel(key, uk)}</span>
                  <input type="text" inputMode="decimal" value={values[key]} placeholder={uk ? "Необов’язково" : "Optional"} onChange={(event) => setValue(key, event.target.value)} />
                </label>
              ))}
            </div>
            <button className={styles.secondaryButton} type="button" onClick={() => {
              setWorkouts([{
                type: uk ? "Силове тренування" : "Strength training",
                startAt: `${values.date}T12:00`,
                durationMinutes: values.strengthTrainingMinutes,
                activeEnergyKcal: values.activeEnergyKcal,
              }]);
              setLegacyWorkoutFields(false);
            }}>{uk ? "Перетворити на окреме тренування" : "Convert to an individual workout"}</button>
          </section>
        ) : (
          <section className={styles.workoutEditor}>
            <div className={styles.workoutEditorHeader}>
              <div>
                <strong>{uk ? "Тренування" : "Workouts"}</strong>
                <p>{uk ? "Кожне тренування має свою тривалість і активну енергію." : "Each workout has its own duration and active energy."}</p>
              </div>
              <button className={styles.secondaryButton} type="button" onClick={() => setWorkouts((current) => [...current, newWorkout(values.date)])}>{uk ? "Додати тренування" : "Add workout"}</button>
            </div>
            {workouts.length === 0 ? <p className={styles.workoutEmpty}>{uk ? "Тренувань за цей день немає." : "There are no workouts for this day."}</p> : (
              <div className={styles.workoutRows}>
                {workouts.map((workout, index) => (
                  <div className={styles.workoutRow} key={`${index}-${workout.startAt}`}>
                    <label className={styles.field}><span>{uk ? "Тип" : "Type"}</span><input type="text" required value={workout.type} placeholder={uk ? "Напр. силове" : "E.g. strength training"} onChange={(event) => setWorkout(index, "type", event.target.value)} /></label>
                    <label className={styles.field}><span>{uk ? "Початок" : "Start"}</span><input type="datetime-local" required value={workout.startAt} onChange={(event) => setWorkout(index, "startAt", event.target.value)} /></label>
                    <label className={styles.field}><span>{uk ? "Тривалість (хв)" : "Duration (min)"}</span><input type="text" required inputMode="decimal" value={workout.durationMinutes} onChange={(event) => setWorkout(index, "durationMinutes", event.target.value)} /></label>
                    <label className={styles.field}><span>{uk ? "Активна енергія (ккал)" : "Active energy (kcal)"}</span><input type="text" inputMode="decimal" value={workout.activeEnergyKcal} placeholder={uk ? "Необов’язково" : "Optional"} onChange={(event) => setWorkout(index, "activeEnergyKcal", event.target.value)} /></label>
                    <button className={styles.deleteWorkoutButton} type="button" onClick={() => setWorkouts((current) => current.filter((_, workoutIndex) => workoutIndex !== index))}>{uk ? "Прибрати" : "Remove"}</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <p className={styles.formHint}>{uk ? "Порожнє поле або 0 означає, що запису немає. У таблиці показується —." : "An empty field or 0 means no record. The table displays —."}</p>
        <div className={styles.dialogActions}>
          <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={saving}>{uk ? "Скасувати" : "Cancel"}</button>
          <button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? (uk ? "Збереження…" : "Saving…") : (uk ? "Зберегти день" : "Save day")}</button>
        </div>
      </form>
    </dialog>
  );
}
