"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OCCUPATIONAL_CATEGORIES,
  type OccupationalCategory,
} from "@/model/occupational-activity";
import { useI18n } from "@/i18n/i18n-provider";
import {
  loadWorkActivityDay,
  removeWorkInterval,
  saveWorkInterval,
  type WorkIntervalFormValues,
} from "@/modules/work-intervals/work-activity.client";
import type { WorkActivityResponseDto } from "@/modules/work-intervals/work-activity.service";
import {
  durationMinutes,
  dailyActivityView,
  formatDuration,
  reconstructionQuality,
} from "@/modules/work-intervals/work-activity-view";
import type { WorkIntervalDto } from "@/modules/work-intervals/work-interval.repository";
import styles from "./history.module.css";

type Editor = { id?: number; values: WorkIntervalFormValues } | null;
const emptyValues: WorkIntervalFormValues = {
  startTime: "08:00",
  endTime: "16:00",
  category: "manualLight",
  breakMinutes: 30,
};

function categoryCopy(category: OccupationalCategory, uk: boolean): { label: string; description: string } {
  if (!uk) return OCCUPATIONAL_CATEGORIES[category];
  return ({
    standingLight: { label: "Дуже легка стояча", description: "Переважно стояння, очікування та легкі рухи." },
    manualLight: { label: "Легка ручна", description: "Легке переміщення, пакування або робота руками." },
    standingLightModerate: { label: "Активна легка", description: "Активна стояча робота з регулярними легкими зусиллями." },
    manualModerate: { label: "Помірна ручна", description: "Регулярне переміщення вантажів і помірні фізичні зусилля." },
  } satisfies Record<OccupationalCategory, { label: string; description: string }>)[category];
}

export function WorkActivityDialog({ date, onClose }: { date: string; onClose: () => void }) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const number = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [intervals, setIntervals] = useState<WorkIntervalDto[]>([]);
  const [activity, setActivity] = useState<WorkActivityResponseDto | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadWorkActivityDay(date);
      setIntervals(loaded.intervals);
      setActivity(loaded.activity);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : uk ? "Не вдалося завантажити робочу активність." : "Could not load work activity.");
    } finally {
      setLoading(false);
    }
  }, [date, uk]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const refreshTimer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(refreshTimer);
  }, [refresh]);

  const totalMinutes = useMemo(() => intervals.reduce(
    (sum, interval) => sum + durationMinutes(interval.startAt, interval.endAt),
    0,
  ), [intervals]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setError(null);
    try {
      await saveWorkInterval(date, editor.values, editor.id);
      setEditor(null);
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : uk ? "Не вдалося зберегти робочий проміжок." : "Could not save work interval.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(interval: WorkIntervalDto) {
    if (!window.confirm(uk ? `Видалити робочий проміжок ${interval.startTime}–${interval.endTime}?` : `Delete work interval ${interval.startTime}–${interval.endTime}?`)) return;
    setDeletingId(interval.id);
    setError(null);
    try {
      await removeWorkInterval(interval.id);
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : uk ? "Не вдалося видалити робочий проміжок." : "Could not delete work interval.");
    } finally {
      setDeletingId(null);
    }
  }

  const diagnostics = activity?.diagnostics ?? null;
  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.workDialog}`} onCancel={onClose} onClose={onClose}>
      <div className={styles.workDialogBody}>
        <div className={styles.dialogHeader}>
          <div>
            <p className={styles.eyebrow}>{uk ? "Робоча активність" : "Work Activity"} · {date}</p>
            <h2>{uk ? "Робочі проміжки" : "Work intervals"}</h2>
            <p className={styles.workSubhead}>{intervals.length > 0 ? (uk ? `${formatDuration(totalMinutes, locale)} загалом` : `${formatDuration(totalMinutes, locale)} total`) : (uk ? "Підтвердженої робочої активності немає" : "No confirmed work activity")}</p>
          </div>
          <button className={styles.closeButton} type="button" aria-label={uk ? "Закрити робочу активність" : "Close work activity"} onClick={onClose}>×</button>
        </div>

        {error && <div className={styles.formError} role="alert">{error}</div>}

        <div className={styles.workToolbar}>
          <p>{uk ? "Час показано для Europe/Bratislava. Введіть загальний час перерв; 30 хв — лише початкове значення для нового запису." : "Times shown in Europe/Bratislava. Enter total break time; 30 min is only a new-entry convenience default."}</p>
          <button className={styles.primaryButton} type="button" onClick={() => setEditor({ values: emptyValues })}>
            {uk ? "Додати робочий проміжок" : "Add work interval"}
          </button>
        </div>

        {editor && (
          <form className={styles.workForm} onSubmit={(event) => void submit(event)}>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>{uk ? "Початок" : "Start"}</span>
                <input type="time" required value={editor.values.startTime} onChange={(event) => setEditor({ ...editor, values: { ...editor.values, startTime: event.target.value } })} />
              </label>
              <label className={styles.field}>
                <span>{uk ? "Кінець" : "End"}</span>
                <input type="time" required value={editor.values.endTime} onChange={(event) => setEditor({ ...editor, values: { ...editor.values, endTime: event.target.value } })} />
              </label>
              <label className={styles.field}>
                <span>{uk ? "Перерва (хвилини)" : "Break (minutes)"}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  required={editor.id === undefined}
                  placeholder={editor.id === undefined ? "30" : (uk ? "Не вказано (старий запис)" : "Not reported (legacy)")}
                  value={editor.values.breakMinutes ?? ""}
                  onChange={(event) => setEditor({
                    ...editor,
                    values: {
                      ...editor.values,
                      breakMinutes: event.target.value === "" ? null : Number(event.target.value),
                    },
                  })}
                />
                <small>{uk ? "Вкажіть 0, якщо перерви не було. Перерва не додає робочої активності, але базовий метаболізм враховується." : "Use 0 if there was no break. Break time adds no work activity; resting metabolism is still counted."}</small>
              </label>
              <label className={`${styles.field} ${styles.categoryField}`}>
                <span>{uk ? "Робота між визначеною ходьбою та перервою" : "Work between detected walking and break"}</span>
                <select value={editor.values.category} onChange={(event) => setEditor({ ...editor, values: { ...editor.values, category: event.target.value as OccupationalCategory } })}>
                  {Object.entries(OCCUPATIONAL_CATEGORIES).map(([key]) => (
                    <option key={key} value={key}>{categoryCopy(key as OccupationalCategory, uk).label}</option>
                  ))}
                </select>
                <small>{uk ? "Ходьба визначається автоматично із синхронізованої дистанції." : "Walking is automatic from synced distance."} {categoryCopy(editor.values.category, uk).description}</small>
              </label>
            </div>
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} type="button" onClick={() => setEditor(null)} disabled={saving}>{uk ? "Скасувати" : "Cancel"}</button>
              <button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? (uk ? "Збереження…" : "Saving…") : (uk ? "Зберегти проміжок" : "Save interval")}</button>
            </div>
          </form>
        )}

        {loading ? (
          <div className={styles.workEmpty}>{uk ? "Завантаження робочої активності…" : "Loading work activity…"}</div>
        ) : intervals.length === 0 ? (
          <div className={styles.workEmpty}>
            <strong>{uk ? "За цей день робочу активність не записано." : "No work activity recorded for this day."}</strong>
            <span>{uk ? "Відсутність проміжку не вважається сидячою поведінкою." : "Absence of an interval is not treated as sedentary behavior."}</span>
          </div>
        ) : (
          <div className={styles.workCards}>
            {intervals.map((interval) => {
              const category = categoryCopy(interval.category as OccupationalCategory, uk);
              const walking = diagnostics?.walking.intervals.find(({ intervalId }) => intervalId === interval.id);
              const occupation = diagnostics?.occupationalIntervals.find(({ id }) => id === interval.id);
              const quality = walking ? reconstructionQuality(walking, locale) : null;
              const remainingWorkMinutes = occupation?.method === "category-only-fallback"
                ? occupation.activeWorkMinutes
                : occupation?.residualWorkMinutes ?? null;
              return (
                <article className={styles.workCard} key={interval.id}>
                  <div className={styles.workCardHeading}>
                    <div>
                      <strong>{interval.startTime} – {interval.endTime}</strong>
                      <span>{formatDuration(durationMinutes(interval.startAt, interval.endAt), locale)}</span>
                    </div>
                    <div className={styles.actions}>
                      <button type="button" onClick={() => setEditor({ id: interval.id, values: {
                        startTime: interval.startTime,
                        endTime: interval.endTime,
                        category: interval.category as OccupationalCategory,
                        breakMinutes: interval.breakMinutes,
                      } })}>{uk ? "Редагувати" : "Edit"}</button>
                      <button className={styles.deleteButton} type="button" disabled={deletingId === interval.id} onClick={() => void remove(interval)}>
                        {deletingId === interval.id ? (uk ? "Видалення…" : "Deleting…") : (uk ? "Видалити" : "Delete")}
                      </button>
                    </div>
                  </div>
                  <div className={styles.categorySummary}>
                    <strong>{category?.label ?? interval.category}</strong>
                    <span>{uk ? "Залишкова робота" : "Residual work"}</span>
                    {category && <p>{category.description}</p>}
                    {occupation?.method === "hybrid-walking-residual" && (
                      <p>{uk ? "Ходьба й залишкова робота не перетинаються; введену перерву виключено з обох." : "Walking and residual work are mutually exclusive; the entered break is excluded from both."}</p>
                    )}
                    {occupation?.method === "category-only-fallback" && (
                      <p>{uk ? "Резервна оцінка лише за категорією" : "Category-only fallback"}: {occupation.fallbackReason?.replaceAll("-", " ")}.</p>
                    )}
                  </div>
                  <div className={styles.shiftFlow} aria-label={uk ? "Розподіл часу зміни" : "Shift time breakdown"}>
                    <div><span>{uk ? "Тривалість зміни" : "Clock shift"}</span><strong>{formatDuration(durationMinutes(interval.startAt, interval.endAt), locale)}</strong></div>
                    <div><span>{uk ? "Перерва" : "Break"}</span><strong>{interval.breakMinutes === null ? (uk ? "Не вказано (старий запис)" : "Not reported (legacy)") : formatDuration(interval.breakMinutes, locale)}</strong></div>
                    <div><span>{uk ? "Визначена ходьба" : "Detected walking"}</span><strong>{occupation?.walkingMinutes === null || occupation === undefined ? (uk ? "Недоступно" : "Unavailable") : formatDuration(occupation.walkingMinutes, locale)}</strong></div>
                    <div><span>{occupation?.method === "category-only-fallback" ? (uk ? "Резервна категорія" : "Category fallback") : (uk ? "Решта" : "Remaining")} {category?.label ?? (uk ? "роботи" : "work")}</span><strong>{remainingWorkMinutes === null ? (uk ? "Недоступно" : "Unavailable") : formatDuration(remainingWorkMinutes, locale)}</strong></div>
                  </div>
                  <div className={styles.estimateGrid}>
                    <div><span>{uk ? "Оцінені кроки" : "Estimated steps"}</span><strong>{walking?.estimatedSteps.value === null || walking === undefined ? "—" : `~${number.format(walking.estimatedSteps.value)}`}</strong></div>
                    <div><span>{uk ? "Оцінена ходьба" : "Estimated walking"}</span><strong>{walking?.estimatedWalkingDistanceKm.value === null || walking === undefined ? "—" : `~${decimal.format(walking.estimatedWalkingDistanceKm.value)} km`}</strong></div>
                    <div><span>{uk ? "Загальна робоча активність" : "Total work activity"}</span><strong>{occupation ? `~${number.format(occupation.activityKcal)} kcal` : "—"}</strong></div>
                  </div>
                  {quality && (
                    <div className={`${styles.quality} ${styles[quality.tone]}`}>
                      <strong>{quality.label}</strong>
                      {quality.startGapMinutes !== null && quality.endGapMinutes !== null && (
                        <span>{uk ? "Проміжок на початку" : "Start gap"}: {decimal.format(quality.startGapMinutes)} {uk ? "хв" : "min"} · {uk ? "наприкінці" : "End gap"}: {decimal.format(quality.endGapMinutes)} {uk ? "хв" : "min"}</span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <WorkSummary activity={activity} />
      </div>
    </dialog>
  );
}

function WorkSummary({ activity }: { activity: WorkActivityResponseDto | null }) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const number = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 });
  const diagnostics = activity?.diagnostics;
  if (!diagnostics) {
    return <section className={styles.activitySummary}><h3>{uk ? "Діагностика активності" : "Activity diagnostics"}</h3><p>{uk ? "Для оцінки ккал потрібні профіль і денна вага." : "Profile and daily weight are required for kcal estimates."}</p></section>;
  }
  const summary = dailyActivityView(diagnostics);
  return (
    <section className={styles.activitySummary}>
      <div><h3>{uk ? "Розподіл денної активності" : "Daily activity breakdown"}</h3><span>{uk ? "Оцінка; ходьба під час роботи врахована лише в розділі «Робота»." : "Estimated; walking during work appears only inside Work."}</span></div>
      <dl>
        <div><dt>{uk ? "Ходьба під час роботи" : "Walking during work"}</dt><dd>{summary.workWalkingDistanceKm === null ? "—" : `~${decimal.format(summary.workWalkingDistanceKm)} km`}</dd></div>
        <div><dt>{uk ? "Ходьба поза роботою" : "Walking outside work"}</dt><dd>{summary.outsideWorkWalkingDistanceKm === null ? "—" : `~${decimal.format(summary.outsideWorkWalkingDistanceKm)} km`}</dd></div>
        <div><dt>{uk ? "Активність ходьби на роботі" : "Work walking activity"}</dt><dd>{summary.workWalkingActivityKcal === null ? "—" : `~${number.format(summary.workWalkingActivityKcal)} kcal`}</dd></div>
        <div><dt>{uk ? "Робота без ходьби" : "Non-walking work"}</dt><dd>{summary.residualWorkActivityKcal === null ? "—" : `~${number.format(summary.residualWorkActivityKcal)} kcal`}</dd></div>
        <div><dt>{uk ? "Робота загалом" : "Work total"}</dt><dd>{summary.occupationalActivityKcal === null ? "—" : `~${number.format(summary.occupationalActivityKcal)} kcal`}</dd></div>
        <div><dt>{uk ? "Активність ходьби поза роботою" : "Walking outside work"}</dt><dd>{summary.outsideWorkWalkingActivityKcal === null ? "—" : `~${number.format(summary.outsideWorkWalkingActivityKcal)} kcal`}</dd></div>
        <div><dt>{uk ? "Силове тренування" : "Strength"}</dt><dd>{summary.strengthActivityKcal === null ? "—" : `~${number.format(summary.strengthActivityKcal)} kcal`}</dd></div>
        <div className={styles.activityTotal}><dt>{uk ? "Оцінена активність" : "Estimated activity"}</dt><dd>{summary.totalActivityKcal === null ? "—" : `~${number.format(summary.totalActivityKcal)} kcal`}</dd></div>
      </dl>
    </section>
  );
}
