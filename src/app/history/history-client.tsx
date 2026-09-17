"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import type { DailyMetricDto, DailyMetricField } from "@/modules/days/day.types";
import {
  filterDaysByRange,
  rangeStartDate,
  sortDaysNewestFirst,
  type HistoryRange,
} from "@/modules/days/history-chart-data";
import { formatDateTime, formatDurationClock, formatMetric } from "@/modules/days/metric-format";
import { HeartRateDayChart } from "./heart-rate-day-chart";
import { HistoryCharts } from "./history-charts";
import { SleepNightChart } from "./sleep-night-chart";
import { WorkActivityDialog } from "./work-activity-dialog";
import { WorkoutDetailsDialog } from "./workout-details-dialog";
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
  if (!uk) return metricFields.find((field) => field.key === key)?.label ?? key;
  return ({
    weightKg: "Вага (кг)", bodyFatPercent: "Жирова маса (%)", caloriesKcal: "Калорії (ккал)",
    proteinG: "Білки (г)", fatG: "Жири (г)", carbsG: "Вуглеводи (г)", steps: "Кроки",
    activeEnergyKcal: "Активна енергія (ккал)", averageWalkingSpeedKmh: "Швидкість ходьби (км/год)",
    walkingDistanceKm: "Дистанція ходьби (км)", strengthTrainingMinutes: "Тренування (хв)",
  } satisfies Record<DailyMetricField, string>)[key];
}

function compactHeaderParts(key: DailyMetricField, uk: boolean): { main: string; unit: string } | null {
  if (!compactTableKeys.has(key)) return null;
  if (key === "averageWalkingSpeedKmh") return { main: uk ? "Швидкість ходьби" : "Walking speed", unit: uk ? "км/год" : "km/h" };
  if (key === "walkingDistanceKm") return { main: uk ? "Дистанція ходьби" : "Walking distance", unit: uk ? "км" : "km" };
  return { main: uk ? "Тренування" : "Training", unit: uk ? "хв" : "min" };
}

function dayHasWorkoutDetail(day: DailyMetricDto): boolean {
  return day.workoutSource !== "none" && day.totalWorkoutMinutes !== null;
}

function tableMetricValue(day: DailyMetricDto, key: DailyMetricField): number | null {
  return key === "strengthTrainingMinutes" ? day.totalWorkoutMinutes : day[key];
}

function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
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
  const value = new Date(iso);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function workoutForm(day: DailyMetricDto): WorkoutForm[] {
  return day.workouts.map((workout) => ({
    type: workout.type,
    startAt: toLocalDateTime(workout.startAt),
    durationMinutes: String(workout.durationMinutes ?? Math.max(1, Math.round((new Date(workout.endAt).getTime() - new Date(workout.startAt).getTime()) / 60_000))),
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
  let offset = 0;

  do {
    const query = new URLSearchParams({ to: today, limit: "100", offset: String(offset) });
    if (range !== "all") query.set("from", rangeStartDate(range, today));

    const response = await fetch(`/api/v1/days?${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await responseError(response, uk));
    const body = await response.json() as { days: DailyMetricDto[] };
    collected.push(...body.days);
    offset += body.days.length;
    if (range !== "all" || body.days.length < 100) break;
  } while (true);

  return sortDaysNewestFirst(filterDaysByRange(collected, range, today));
}

export function HistoryClient() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const [days, setDays] = useState<DailyMetricDto[]>([]);
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
      setDays(await fetchDays(range, uk));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : uk ? "Не вдалося завантажити історію" : "Could not load history");
    } finally {
      setLoading(false);
    }
  }, [range, uk]);

  useEffect(() => {
    let active = true;
    fetchDays(range, uk)
      .then((loadedDays) => {
        if (active) setDays(loadedDays);
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
        <HistoryCharts days={days} />
      )}

      <section className={styles.panel} aria-busy={loading}>
        <div className={styles.panelHeader}>
          <div>
            <h2>{range === "all" ? (uk ? "Усі записи" : "All records") : (uk ? `Останні ${range} днів` : `Last ${range} days`)}</h2>
            <p>{loading ? (uk ? "Оновлення…" : "Refreshing…") : (uk ? `${days.length} записів` : `${days.length} ${days.length === 1 ? "record" : "records"}`)}</p>
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
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{uk ? "дата" : "date"}</th>
                  {tableFields.map(({ key, shortLabel }) => {
                    const compact = compactHeaderParts(key, uk);
                    if (compact) {
                      return (
                        <th key={key} className={styles.compactCol}>
                          <span className={styles.thStack}>
                            <span className={styles.thMain}>{compact.main}</span>
                            <span className={styles.thUnit}>{compact.unit}</span>
                          </span>
                        </th>
                      );
                    }
                    return <th key={key}>{uk ? localizedMetricLabel(key, true) : shortLabel}</th>;
                  })}
                  <th className={styles.compactCol}>
                    <span className={styles.thStack}>
                      <span className={styles.thMain}>{uk ? "Тривалість сну" : "Sleep duration"}</span>
                    </span>
                  </th>
                  <th className={styles.compactCol}>
                    <span className={styles.thStack}>
                      <span className={styles.thMain}>{uk ? "Пульс у спокої" : "Resting HR"}</span>
                      <span className={styles.thUnit}>bpm</span>
                    </span>
                  </th>
                  <th>{uk ? "оновлено" : "updatedAt"}</th>
                  <th>{uk ? "дії" : "actions"}</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date}>
                    <td data-label="date"><strong>{day.date}</strong></td>
                    {tableFields.map(({ key, shortLabel }) => {
                      const value = tableMetricValue(day, key);
                      const label = uk ? localizedMetricLabel(key, true) : shortLabel;
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
                        </td>
                      );
                    })}
                    <td data-label={uk ? "Тривалість сну" : "Sleep duration"} className={styles.compactCol}>
                      {formatDurationClock(day.sleepMinutes ?? null)}
                    </td>
                    <td data-label={uk ? "Пульс у спокої" : "Resting HR"} className={styles.compactCol}>
                      {day.restingHeartRateBpm == null
                        ? "—"
                        : `${formatMetric(day.restingHeartRateBpm, intlLocale)} bpm`}
                    </td>
                    <td data-label={uk ? "оновлено" : "updatedAt"} className={styles.updatedCell}>{formatDateTime(day.updatedAt, intlLocale)}</td>
                    <td data-label="actions">
                      <div className={styles.actions}>
                        <button type="button" onClick={() => setWorkoutDay(day)}>{uk ? "Деталі" : "Details"}</button>
                        <button type="button" onClick={() => setWorkDate(day.date)}>{uk ? "Робота" : "Work"}</button>
                        <button type="button" onClick={() => setEditor({
                          mode: "edit",
                          values: editForm(day),
                          workouts: workoutForm(day),
                          legacyWorkoutFields: day.workoutSource !== "workouts",
                        })}>{uk ? "Редагувати" : "Edit"}</button>
                        <button className={styles.deleteButton} type="button" onClick={() => void deleteDay(day.date)}>{uk ? "Видалити" : "Delete"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      {workDate && <WorkActivityDialog date={workDate} onClose={() => setWorkDate(null)} />}
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
    const workoutPayload = legacyWorkoutFields ? {} : {
      workouts: workouts.map((workout) => ({
        type: workout.type.trim(),
        startAt: new Date(workout.startAt).toISOString(),
        durationMinutes: workout.durationMinutes.trim(),
        activeEnergyKcal: workout.activeEnergyKcal.trim() || null,
      })),
    };
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
