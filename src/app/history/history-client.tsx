"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import type { DailyMetricDto, DailyMetricField } from "@/modules/days/day.types";
import {
  filterDaysByRange,
  rangeStartDate,
  sortDaysNewestFirst,
  type HistoryRange,
} from "@/modules/days/history-chart-data";
import { formatDateTime, formatMetric } from "@/modules/days/metric-format";
import { HistoryCharts } from "./history-charts";
import styles from "./history.module.css";

type FormValues = Record<DailyMetricField, string> & { date: string };
type EditorState = { mode: "create" | "edit"; values: FormValues } | null;

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
  { key: "strengthTrainingMinutes", label: "Strength training (min)", shortLabel: "strengthTrainingMinutes" },
];

const tableFields = metricFields.filter(({ key }) => key !== "activeEnergyKcal");
const rangeOptions: Array<{ value: HistoryRange; label: string }> = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: "all", label: "All" },
];

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

async function responseError(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;
  try {
    const body = await response.json() as { error?: string; details?: Array<{ message?: string }> };
    return body.details?.[0]?.message ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function fetchDays(range: HistoryRange): Promise<DailyMetricDto[]> {
  const today = localToday();
  const collected: DailyMetricDto[] = [];
  let offset = 0;

  do {
    const query = new URLSearchParams({ to: today, limit: "100", offset: String(offset) });
    if (range !== "all") query.set("from", rangeStartDate(range, today));

    const response = await fetch(`/api/v1/days?${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await responseError(response));
    const body = await response.json() as { days: DailyMetricDto[] };
    collected.push(...body.days);
    offset += body.days.length;
    if (range !== "all" || body.days.length < 100) break;
  } while (true);

  return sortDaysNewestFirst(filterDaysByRange(collected, range, today));
}

export function HistoryClient() {
  const [days, setDays] = useState<DailyMetricDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [range, setRange] = useState<HistoryRange>(30);

  const loadDays = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDays(await fetchDays(range));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load history");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    let active = true;
    fetchDays(range)
      .then((loadedDays) => {
        if (active) setDays(loadedDays);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load history");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range]);

  function selectRange(nextRange: HistoryRange) {
    if (nextRange === range) return;
    setLoading(true);
    setError(null);
    setRange(nextRange);
  }

  async function deleteDay(date: string) {
    if (!window.confirm(`Delete daily metrics for ${date}?`)) return;
    setError(null);
    const response = await fetch(`/api/v1/days/${encodeURIComponent(date)}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await responseError(response));
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
          <p className={styles.eyebrow}>BodyCast · Daily metrics</p>
          <h1>Health history</h1>
          <p className={styles.intro}>Review Apple Health records and make careful manual corrections.</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => setEditor({ mode: "create", values: emptyForm() })}>
          Add day
        </button>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <section className={styles.rangeBar} aria-label="History date range">
        <div>
          <strong>Date range</strong>
          <span>Charts and table stay in sync</span>
        </div>
        <div className={styles.rangeSwitch}>
          {rangeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={range === option.value}
              onClick={() => selectRange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <div className={styles.chartsLoading}>Loading charts…</div>
      ) : (
        <HistoryCharts days={days} />
      )}

      <section className={styles.panel} aria-busy={loading}>
        <div className={styles.panelHeader}>
          <div>
            <h2>{range === "all" ? "All records" : `Last ${range} days`}</h2>
            <p>{loading ? "Refreshing…" : `${days.length} ${days.length === 1 ? "record" : "records"}`}</p>
          </div>
          <button className={styles.secondaryButton} type="button" onClick={() => void loadDays()} disabled={loading}>
            Refresh
          </button>
        </div>

        {!loading && days.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>No daily metrics yet</strong>
            <span>Add a day manually or wait for the next iPhone sync.</span>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>date</th>
                  {tableFields.map(({ key, shortLabel }) => <th key={key}>{shortLabel}</th>)}
                  <th>updatedAt</th>
                  <th>actions</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date}>
                    <td data-label="date"><strong>{day.date}</strong></td>
                    {tableFields.map(({ key, shortLabel }) => (
                      <td key={key} data-label={shortLabel}>{formatMetric(day[key])}</td>
                    ))}
                    <td data-label="updatedAt" className={styles.updatedCell}>{formatDateTime(day.updatedAt)}</td>
                    <td data-label="actions">
                      <div className={styles.actions}>
                        <button type="button" onClick={() => setEditor({ mode: "edit", values: editForm(day) })}>Edit</button>
                        <button className={styles.deleteButton} type="button" onClick={() => void deleteDay(day.date)}>Delete</button>
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
    </main>
  );
}

function DayDialog({ editor, onClose, onSaved }: {
  editor: NonNullable<EditorState>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState(editor.values);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  function setValue(key: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    const metrics = Object.fromEntries(metricFields.map(({ key }) => [key, values[key].trim() || null]));
    const isCreate = editor.mode === "create";
    const response = await fetch(
      isCreate ? "/api/v1/days" : `/api/v1/days/${encodeURIComponent(values.date)}`,
      {
        method: isCreate ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isCreate ? { date: values.date, ...metrics } : metrics),
      },
    );

    if (!response.ok) {
      setFormError(await responseError(response));
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
            <p className={styles.eyebrow}>{editor.mode === "create" ? "New record" : "Manual correction"}</p>
            <h2>{editor.mode === "create" ? "Add a day" : `Edit ${values.date}`}</h2>
          </div>
          <button className={styles.closeButton} type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>

        {formError && <div className={styles.formError} role="alert">{formError}</div>}

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Date</span>
            <input type="date" value={values.date} disabled={editor.mode === "edit"} required onChange={(event) => setValue("date", event.target.value)} />
          </label>
          {metricFields.map(({ key, label, placeholder }) => (
            <label className={styles.field} key={key}>
              <span>{label}</span>
              <input
                type="text"
                inputMode={key === "steps" ? "numeric" : "decimal"}
                value={values[key]}
                placeholder={placeholder ?? "Optional"}
                onChange={(event) => setValue(key, event.target.value)}
              />
            </label>
          ))}
        </div>

        <p className={styles.formHint}>Empty fields are saved as unavailable, not as zero.</p>
        <div className={styles.dialogActions}>
          <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "Saving…" : "Save day"}</button>
        </div>
      </form>
    </dialog>
  );
}
