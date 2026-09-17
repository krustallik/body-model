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
import {
  diaryCompletenessBadgeTone,
  formatClock,
  formatDateTime,
  readApiError,
} from "../training-labels";
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

function completenessBadgeClass(
  value: HistoricalStrengthWorkoutDto["diaryCompleteness"],
): string {
  switch (diaryCompletenessBadgeTone(value)) {
    case "ok":
      return styles.badgeOk;
    case "warn":
      return styles.badgeWarn;
    case "neutral":
      return styles.badgeNeutral;
    default:
      return styles.badgeMuted;
  }
}

export function BackfillClient() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const [workouts, setWorkouts] = useState<HistoricalStrengthWorkoutDto[]>([]);
  const [programs, setPrograms] = useState<TrainingProgramSummaryDto[]>([]);
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
      const [workoutsRes, programsRes] = await Promise.all([
        fetch(`/api/v1/training/workouts/historical${query}`, { cache: "no-store" }),
        fetch("/api/v1/training/programs", { cache: "no-store" }),
      ]);
      if (!workoutsRes.ok || !programsRes.ok) {
        setError(uk ? "Не вдалося завантажити історію." : "Could not load history.");
        return;
      }
      const workoutsBody = await workoutsRes.json() as { workouts: HistoricalStrengthWorkoutDto[] };
      const programsBody = await programsRes.json() as { programs: TrainingProgramSummaryDto[] };
      setWorkouts(workoutsBody.workouts);
      setPrograms(programsBody.programs);
      setSelected((current) => current.filter((id) => (
        workoutsBody.workouts.some((row) => row.workoutId === id && row.linkedSessionId == null)
      )));
      if (programsBody.programs[0] && bulkProgramId === "") {
        setBulkProgramId(programsBody.programs[0].id);
      }
    } catch {
      setError(uk ? "Не вдалося завантажити історію." : "Could not load history.");
    } finally {
      setLoading(false);
    }
  }, [bulkProgramId, onlyMissing, uk]);

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

  const eligibleIds = useMemo(
    () => workouts.filter((row) => row.linkedSessionId == null).map((row) => row.workoutId),
    [workouts],
  );

  const canBulk = programs.length > 0 && eligibleIds.length > 0;
  const createDisabled = busy || selected.length === 0 || typeof bulkProgramId !== "number";

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
              <h2>{uk ? "Фільтр списку" : "List filter"}</h2>
              <p>
                {uk
                  ? "Показує лише Garmin workouts без веб-запису"
                  : "Show only Garmin workouts that still need a diary"}
              </p>
            </div>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.toggleRow}>
              <button
                type="button"
                className={styles.togglePill}
                aria-pressed={onlyMissing}
                onClick={() => setOnlyMissing((value) => !value)}
              >
                {uk ? "Лише без запису" : "Missing diary only"}
              </button>
              <button
                type="button"
                className={styles.togglePill}
                aria-pressed={!onlyMissing}
                onClick={() => setOnlyMissing(false)}
              >
                {uk ? "Усі силові" : "All strength"}
              </button>
            </div>
          </div>
        </section>

        {canBulk && (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>{uk ? "Масове створення записів" : "Bulk create diaries"}</h2>
                <p>
                  {uk
                    ? "Крок 1: оберіть workouts нижче → 2: програму → 3: створити. Підходи не вигадуються."
                    : "Step 1: select workouts below → 2: pick program → 3: create. Sets are never fabricated."}
                </p>
              </div>
            </div>
            <div className={styles.panelBody}>
              <div className={styles.bulkSteps}>
                <div className={styles.bulkStep}>
                  <p className={styles.bulkStepLabel}>
                    {uk
                      ? `1 · Вибрано ${selected.length} з ${eligibleIds.length}`
                      : `1 · Selected ${selected.length} of ${eligibleIds.length}`}
                  </p>
                  <div className={styles.rowActions}>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() => setSelected(eligibleIds)}
                    >
                      {uk ? "Вибрати всі без запису" : "Select all missing"}
                    </button>
                    <button
                      className={styles.textButton}
                      type="button"
                      disabled={selected.length === 0}
                      onClick={() => setSelected([])}
                    >
                      {uk ? "Скинути" : "Clear"}
                    </button>
                  </div>
                </div>
                <div className={styles.bulkStep}>
                  <p className={styles.bulkStepLabel}>{uk ? "2 · Програма" : "2 · Program"}</p>
                  <label className={styles.field}>
                    <span>{uk ? "Програма" : "Program"}</span>
                    <select
                      value={bulkProgramId}
                      onChange={(event) => setBulkProgramId(Number(event.target.value))}
                    >
                      {programs.map((program) => (
                        <option key={program.id} value={program.id}>{program.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className={styles.bulkStep}>
                  <p className={styles.bulkStepLabel}>{uk ? "3 · Створити" : "3 · Create"}</p>
                  <button
                    className={styles.primaryButton}
                    type="button"
                    disabled={createDisabled}
                    aria-busy={busy || undefined}
                    onClick={() => void runBulk()}
                  >
                    {busy
                      ? (uk ? "Створення…" : "Creating…")
                      : (uk
                        ? `Створити записи (${selected.length})`
                        : `Create diaries (${selected.length})`)}
                  </button>
                  {createDisabled && !busy && (
                    <p className={styles.selectHint}>
                      {selected.length === 0
                        ? (uk
                          ? "Спочатку позначте workouts у списку нижче."
                          : "Select workouts in the list below first.")
                        : (uk ? "Оберіть програму." : "Pick a program.")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        <section className={styles.panel} aria-label={uk ? "Історичні workout" : "Historical workouts"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Силові Garmin" : "Garmin strength"}</h2>
              <p>
                {loading
                  ? (uk ? "Завантаження…" : "Loading…")
                  : (uk
                    ? `${workouts.length} · галочка лише для bulk-створення`
                    : `${workouts.length} · checkbox is for bulk create only`)}
              </p>
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
                  const eligible = workout.linkedSessionId == null;
                  const checked = selected.includes(workout.workoutId);
                  return (
                    <article className={styles.card} key={workout.workoutId}>
                      <div className={styles.workoutSelectRow}>
                        <input
                          type="checkbox"
                          checked={eligible ? checked : false}
                          disabled={!eligible}
                          aria-label={
                            eligible
                              ? (uk ? "Вибрати для масового створення" : "Select for bulk create")
                              : (uk ? "Уже має запис — недоступно для bulk" : "Already has diary — not bulk-eligible")
                          }
                          onChange={() => {
                            if (eligible) toggle(workout.workoutId);
                          }}
                        />
                        <div>
                          <strong>{formatDateTime(workout.startAt, intlLocale)}</strong>
                          <p className={styles.cardMeta}>
                            {formatClock(workout.startAt, intlLocale)}
                            {" · "}
                            {workout.durationMinutes == null
                              ? "—"
                              : `${workout.durationMinutes} ${uk ? "хв" : "min"}`}
                            {" · "}
                            {workout.activeEnergyKcal == null
                              ? (uk ? "ккал —" : "kcal —")
                              : `${workout.activeEnergyKcal} ${uk ? "ккал" : "kcal"}`}
                          </p>
                          {!eligible && (
                            <p className={styles.selectHint}>
                              {uk
                                ? `Уже є запис${workout.linkedProgramName ? ` · ${workout.linkedProgramName}` : ""} — bulk недоступний`
                                : `Diary exists${workout.linkedProgramName ? ` · ${workout.linkedProgramName}` : ""} — not for bulk`}
                            </p>
                          )}
                        </div>
                        <span className={completenessBadgeClass(workout.diaryCompleteness)}>
                          {completenessLabel(workout.diaryCompleteness, uk)}
                        </span>
                      </div>
                      <div className={styles.denseCardActions}>
                        {eligible ? (
                          <button
                            className={styles.primaryButton}
                            type="button"
                            onClick={() => router.push(`/training/backfill/from/${workout.workoutId}`)}
                          >
                            {uk ? "Додати запис" : "Add diary"}
                          </button>
                        ) : (
                          <button
                            className={styles.secondaryButton}
                            type="button"
                            onClick={() => router.push(`/training/sessions/${workout.linkedSessionId}/edit`)}
                          >
                            {uk ? "Редагувати" : "Edit"}
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
