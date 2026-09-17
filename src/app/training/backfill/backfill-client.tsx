"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import { DIARY_COMPLETENESS } from "@/modules/training/training.constants";
import type {
  HistoricalStrengthWorkoutDto,
  TrainingProgramSummaryDto,
} from "@/modules/training/training.types";
import { formatClock, formatDateTime, readApiError } from "../training-labels";
import styles from "../training.module.css";

function completenessLabel(
  value: HistoricalStrengthWorkoutDto["diaryCompleteness"],
  uk: boolean,
): string {
  switch (value) {
    case DIARY_COMPLETENESS.NO_DIARY:
      return uk ? "Немає запису" : "No diary";
    case DIARY_COMPLETENESS.DIARY_EMPTY:
      return uk ? "Запис без підходів" : "Diary, no sets";
    case DIARY_COMPLETENESS.DIARY_PARTIAL:
      return uk ? "Частково заповнено" : "Partially filled";
    case DIARY_COMPLETENESS.DIARY_WITH_SETS:
      return uk ? "Є підходи" : "Has sets";
    default:
      return value;
  }
}

export function BackfillClient() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const [workouts, setWorkouts] = useState<HistoricalStrengthWorkoutDto[]>([]);
  const [programs, setPrograms] = useState<TrainingProgramSummaryDto[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkProgramId, setBulkProgramId] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query = onlyMissing ? "?limit=100&onlyMissingDiary=true" : "?limit=100";
      const programsQuery = showArchived ? "?includeArchived=true" : "";
      const [workoutsRes, programsRes] = await Promise.all([
        fetch(`/api/v1/training/workouts/historical${query}`, { cache: "no-store" }),
        fetch(`/api/v1/training/programs${programsQuery}`, { cache: "no-store" }),
      ]);
      if (!workoutsRes.ok || !programsRes.ok) {
        setError(uk ? "Не вдалося завантажити історію." : "Could not load history.");
        return;
      }
      const workoutsBody = await workoutsRes.json() as { workouts: HistoricalStrengthWorkoutDto[] };
      const programsBody = await programsRes.json() as { programs: TrainingProgramSummaryDto[] };
      setWorkouts(workoutsBody.workouts);
      setPrograms(programsBody.programs);
      if (programsBody.programs[0] && bulkProgramId === "") {
        setBulkProgramId(programsBody.programs[0].id);
      }
    } catch {
      setError(uk ? "Не вдалося завантажити історію." : "Could not load history.");
    } finally {
      setLoading(false);
    }
  }, [bulkProgramId, onlyMissing, showArchived, uk]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const missingIds = useMemo(
    () => workouts.filter((row) => row.linkedSessionId == null).map((row) => row.workoutId),
    [workouts],
  );

  function toggle(workoutId: number) {
    setSelected((current) => (
      current.includes(workoutId)
        ? current.filter((id) => id !== workoutId)
        : [...current, workoutId]
    ));
  }

  async function runBulk() {
    if (typeof bulkProgramId !== "number" || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/training/sessions/from-workouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workoutIds: selected, programId: bulkProgramId }),
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      setSelected([]);
      await load();
    } catch {
      setError(uk ? "Не вдалося створити записи." : "Could not create diary entries.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.navRow}>
        <strong>BodyCast</strong>
        <AppNav active="training" />
      </div>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Ретроспектива" : "Retrospective"}</p>
          <h1>{uk ? "Історичні силові" : "Historical strength"}</h1>
          <p className={styles.intro}>
            {uk
              ? "Garmin workouts без підходів — додайте програму й сети. Джерело Garmin не змінюється."
              : "Garmin workouts without sets — attach a program and fill sets. Garmin source stays untouched."}
          </p>
        </div>
        <Link className={styles.secondaryButton} href="/training">{uk ? "Назад" : "Back"}</Link>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.stack}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Фільтри" : "Filters"}</h2>
              <p>{uk ? "Працюйте системно по старих workout" : "Work through old workouts systematically"}</p>
            </div>
          </div>
          <div className={`${styles.panelBody} ${styles.formActions}`}>
            <label className={styles.field}>
              <span>
                <input
                  type="checkbox"
                  checked={onlyMissing}
                  onChange={(event) => setOnlyMissing(event.target.checked)}
                />
                {" "}
                {uk ? "Лише без запису" : "Only missing diary"}
              </span>
            </label>
            <label className={styles.field}>
              <span>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                {" "}
                {uk ? "Показати архівні програми" : "Show archived programs"}
              </span>
            </label>
          </div>
        </section>

        {missingIds.length > 0 && programs.length > 0 && (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>{uk ? "Масове призначення програми" : "Bulk program assignment"}</h2>
                <p>
                  {uk
                    ? "Створює лише знімок програми без підходів"
                    : "Creates program snapshots only — no fabricated sets"}
                </p>
              </div>
            </div>
            <div className={`${styles.panelBody} ${styles.formActions}`}>
              <label className={styles.field}>
                <span>{uk ? "Програма" : "Program"}</span>
                <select
                  value={bulkProgramId}
                  onChange={(event) => setBulkProgramId(Number(event.target.value))}
                >
                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name}
                      {program.archivedAt ? (uk ? " (архів)" : " (archived)") : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setSelected(missingIds)}
              >
                {uk ? "Вибрати всі без запису" : "Select all missing"}
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={busy || selected.length === 0 || typeof bulkProgramId !== "number"}
                onClick={() => void runBulk()}
              >
                {busy
                  ? (uk ? "Створення…" : "Creating…")
                  : (uk ? `Створити записи (${selected.length})` : `Create diaries (${selected.length})`)}
              </button>
            </div>
          </section>
        )}

        <section className={styles.panel} aria-label={uk ? "Історичні workout" : "Historical workouts"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Силові Garmin" : "Garmin strength"}</h2>
              <p>{loading ? (uk ? "Завантаження…" : "Loading…") : `${workouts.length}`}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {workouts.length === 0 ? (
              <div className={styles.empty}>
                <span>{uk ? "Немає канонічних силових workout." : "No canonical strength workouts."}</span>
              </div>
            ) : (
              <div className={styles.list}>
                {workouts.map((workout) => {
                  const hasDiary = workout.linkedSessionId != null;
                  return (
                    <article className={styles.card} key={workout.workoutId}>
                      <div className={styles.cardTop}>
                        <div>
                          {!hasDiary && (
                            <label className={styles.field}>
                              <span>
                                <input
                                  type="checkbox"
                                  checked={selected.includes(workout.workoutId)}
                                  onChange={() => toggle(workout.workoutId)}
                                />
                                {" "}
                                {formatDateTime(workout.startAt, intlLocale)}
                              </span>
                            </label>
                          )}
                          {hasDiary && (
                            <strong>{formatDateTime(workout.startAt, intlLocale)}</strong>
                          )}
                          <p className={styles.cardMeta}>
                            {formatClock(workout.startAt, intlLocale)}
                            {" · "}
                            {workout.durationMinutes == null
                              ? "—"
                              : `${workout.durationMinutes} ${uk ? "хв" : "min"}`}
                            {" · "}
                            {workout.activeEnergyKcal == null
                              ? (uk ? "ккал —" : "kcal —")
                              : `${workout.activeEnergyKcal} ${uk ? "активних ккал" : "active kcal"}`}
                          </p>
                          <p className={styles.cardMeta}>
                            {hasDiary
                              ? (workout.linkedProgramName ?? (uk ? "Є запис" : "Has diary"))
                              : completenessLabel(workout.diaryCompleteness, uk)}
                          </p>
                        </div>
                        <span className={hasDiary ? styles.badge : styles.badgeMuted}>
                          {completenessLabel(workout.diaryCompleteness, uk)}
                        </span>
                      </div>
                      <div className={styles.rowActions}>
                        {hasDiary ? (
                          <button
                            className={styles.primaryButton}
                            type="button"
                            onClick={() => router.push(`/training/sessions/${workout.linkedSessionId}/edit`)}
                          >
                            {uk ? "Редагувати" : "Edit"}
                          </button>
                        ) : (
                          <button
                            className={styles.primaryButton}
                            type="button"
                            onClick={() => router.push(`/training/backfill/from/${workout.workoutId}`)}
                          >
                            {uk ? "Додати запис" : "Add diary"}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
