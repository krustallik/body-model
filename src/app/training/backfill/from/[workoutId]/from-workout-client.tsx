"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import type {
  HistoricalStrengthWorkoutDto,
  StrengthSessionDto,
  TrainingProgramSummaryDto,
} from "@/modules/training/training.types";
import { formatClock, formatDateTime, readApiError } from "../../../training-labels";
import styles from "../../../training.module.css";

export function FromWorkoutClient({ workoutId }: { workoutId: number }) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const [workout, setWorkout] = useState<HistoricalStrengthWorkoutDto | null>(null);
  const [programs, setPrograms] = useState<TrainingProgramSummaryDto[]>([]);
  const [programId, setProgramId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [workoutsRes, programsRes] = await Promise.all([
        fetch("/api/v1/training/workouts/historical?limit=200", { cache: "no-store" }),
        fetch("/api/v1/training/programs", { cache: "no-store" }),
      ]);
      if (!workoutsRes.ok || !programsRes.ok) {
        setError(uk ? "Не вдалося завантажити дані." : "Could not load data.");
        return;
      }
      const workoutsBody = await workoutsRes.json() as { workouts: HistoricalStrengthWorkoutDto[] };
      const programsBody = await programsRes.json() as { programs: TrainingProgramSummaryDto[] };
      const found = workoutsBody.workouts.find((row) => row.workoutId === workoutId) ?? null;
      setWorkout(found);
      setPrograms(programsBody.programs);
      if (found?.linkedSessionId) {
        router.replace(`/training/sessions/${found.linkedSessionId}/edit`);
        return;
      }
      if (programsBody.programs[0] && programId === "") {
        setProgramId(programsBody.programs[0].id);
      }
    } catch {
      setError(uk ? "Не вдалося завантажити дані." : "Could not load data.");
    } finally {
      setLoading(false);
    }
  }, [programId, router, uk, workoutId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function create() {
    if (typeof programId !== "number") return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/training/sessions/from-workout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workoutId, programId }),
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      const body = await response.json() as { session: StrengthSessionDto };
      router.push(`/training/sessions/${body.session.id}/edit`);
    } catch {
      setError(uk ? "Не вдалося створити запис." : "Could not create diary entry.");
    } finally {
      setBusy(false);
    }
  }

  if (workoutId < 1) {
    return (
      <main className={styles.page}>
        <p className={styles.errorBanner}>{uk ? "Невірний workout." : "Invalid workout."}</p>
        <Link href="/training/backfill">{uk ? "Назад" : "Back"}</Link>
      </main>
    );
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
          <h1>{uk ? "Додати запис тренування" : "Add training diary entry"}</h1>
          <p className={styles.intro}>
            {uk
              ? "Оберіть актуальну програму. Час і ккал залишаються з Garmin."
              : "Pick the current program. Garmin time and kcal stay authoritative."}
          </p>
        </div>
        <Link className={styles.secondaryButton} href="/training/backfill">{uk ? "Назад" : "Back"}</Link>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.stack}>
        <section className={`${styles.panel} ${styles.panelInfo}`}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Garmin / пристрій" : "Garmin / device"}</h2>
              <p>{uk ? "Джерело не змінюється" : "Source stays unchanged"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {loading || !workout ? (
              <p className={styles.cardMeta}>{uk ? "Завантаження…" : "Loading…"}</p>
            ) : (
              <dl className={styles.metaGrid}>
                <div>
                  <dt>{uk ? "Дата" : "Date"}</dt>
                  <dd>{formatDateTime(workout.startAt, intlLocale)}</dd>
                </div>
                <div>
                  <dt>{uk ? "Початок" : "Start"}</dt>
                  <dd>{formatClock(workout.startAt, intlLocale)}</dd>
                </div>
                <div>
                  <dt>{uk ? "Тривалість" : "Duration"}</dt>
                  <dd>
                    {workout.durationMinutes == null
                      ? "—"
                      : `${workout.durationMinutes} ${uk ? "хв" : "min"}`}
                  </dd>
                </div>
                <div>
                  <dt>{uk ? "Активні ккал" : "Active kcal"}</dt>
                  <dd>{workout.activeEnergyKcal ?? "—"}</dd>
                </div>
              </dl>
            )}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Програма" : "Program"}</h2>
              <p>{uk ? "Завжди береться поточна версія шаблону" : "Always uses the program’s current version"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            <label className={styles.field}>
              <span>{uk ? "Програма" : "Program"}</span>
              <select
                value={programId}
                onChange={(event) => setProgramId(Number(event.target.value))}
              >
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>{program.name}</option>
                ))}
              </select>
            </label>
            <div className={styles.formActions}>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={busy || typeof programId !== "number" || programs.length === 0}
                onClick={() => void create()}
              >
                {busy
                  ? (uk ? "Створення…" : "Creating…")
                  : (uk ? "Створити запис і редагувати" : "Create diary and edit")}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
