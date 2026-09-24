"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";
import { useI18n } from "@/i18n/i18n-provider";
import type { StepperWorkoutDto } from "@/modules/training/stepper-workout.repository";
import type {
  StrengthSessionDto,
  StrengthSessionSummaryDto,
  TrainingProgramSummaryDto,
} from "@/modules/training/training.types";
import {
  formatDateTime,
  formatDurationMinutes,
  matchStatusBadgeTone,
  matchStatusLabel,
  planCompletionPillClass,
  readApiError,
} from "./training-labels";
import styles from "./training.module.css";

function nowLocalDateTime(): string {
  const { date, time } = instantToLocalDateTime(new Date(), DEFAULT_TIME_ZONE);
  return `${date}T${time}`;
}

function workoutLocalDateTime(value: string): string {
  const { date, time } = instantToLocalDateTime(new Date(value), DEFAULT_TIME_ZONE);
  return `${date}T${time}`;
}

function formatStepperDateTime(value: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    timeZone: DEFAULT_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function matchBadgeClass(status: StrengthSessionSummaryDto["matchStatus"]): string {
  switch (matchStatusBadgeTone(status)) {
    case "ok":
      return styles.badgeSuccess;
    case "warn":
      return styles.badgeWarning;
    case "info":
      return styles.badgeInfo;
    case "danger":
      return styles.badgeDanger;
    case "neutral":
      return styles.badgeNeutral;
    default:
      return styles.badgeMuted;
  }
}

export function TrainingClient() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const [active, setActive] = useState<StrengthSessionDto | null>(null);
  const [programs, setPrograms] = useState<TrainingProgramSummaryDto[]>([]);
  const [recent, setRecent] = useState<StrengthSessionSummaryDto[]>([]);
  const [attention, setAttention] = useState<StrengthSessionSummaryDto[]>([]);
  const [stepperWorkouts, setStepperWorkouts] = useState<StepperWorkoutDto[]>([]);
  const [stepperFormOpen, setStepperFormOpen] = useState(false);
  const [editingStepper, setEditingStepper] = useState<StepperWorkoutDto | null>(null);
  const [stepperStartAt, setStepperStartAt] = useState(nowLocalDateTime);
  const [stepperDuration, setStepperDuration] = useState("20");
  const [stepperBusy, setStepperBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busySessionId, setBusySessionId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [activeRes, programsRes, recentRes, attentionRes, stepperRes] = await Promise.all([
        fetch("/api/v1/training/sessions/active", { cache: "no-store" }),
        fetch("/api/v1/training/programs", { cache: "no-store" }),
        fetch("/api/v1/training/sessions/recent?limit=12", { cache: "no-store" }),
        fetch("/api/v1/training/sessions/match-attention", { cache: "no-store" }),
        fetch("/api/v1/training/stepper-workouts", { cache: "no-store" }),
      ]);
      if (!activeRes.ok || !programsRes.ok || !recentRes.ok || !attentionRes.ok || !stepperRes.ok) {
        setError(uk ? "Не вдалося завантажити тренування." : "Could not load training data.");
        return;
      }
      const activeBody = await activeRes.json() as { session: StrengthSessionDto | null };
      const programsBody = await programsRes.json() as { programs: TrainingProgramSummaryDto[] };
      const recentBody = await recentRes.json() as { sessions: StrengthSessionSummaryDto[] };
      const attentionBody = await attentionRes.json() as { sessions: StrengthSessionSummaryDto[] };
      const stepperBody = await stepperRes.json() as { workouts: StepperWorkoutDto[] };
      setActive(activeBody.session);
      setPrograms(programsBody.programs);
      setRecent(recentBody.sessions);
      setAttention(attentionBody.sessions);
      setStepperWorkouts(stepperBody.workouts);
    } catch {
      setError(uk ? "Не вдалося завантажити тренування." : "Could not load training data.");
    } finally {
      setLoading(false);
    }
  }, [uk]);

  function openNewStepperForm() {
    setEditingStepper(null);
    setStepperStartAt(nowLocalDateTime());
    setStepperDuration("20");
    setStepperFormOpen(true);
  }

  function openEditStepperForm(workout: StepperWorkoutDto) {
    setEditingStepper(workout);
    setStepperStartAt(workoutLocalDateTime(workout.startAt));
    setStepperDuration(String(workout.durationMinutes ?? 20));
    setStepperFormOpen(true);
  }

  async function saveStepperWorkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStepperBusy(true);
    setError(null);
    try {
      const [date, time] = stepperStartAt.split("T");
      const instant = localDateTimeToInstant(date!, time!, DEFAULT_TIME_ZONE).toISOString();
      const response = await fetch(editingStepper
        ? `/api/v1/training/stepper-workouts/${editingStepper.id}`
        : "/api/v1/training/stepper-workouts", {
        method: editingStepper ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startAt: instant, durationMinutes: Number(stepperDuration) }),
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      setStepperFormOpen(false);
      setEditingStepper(null);
      await load();
    } catch {
      setError(uk ? "Перевірте дату й час тренування." : "Check the workout date and time.");
    } finally {
      setStepperBusy(false);
    }
  }

  async function deleteStepperWorkout(workout: StepperWorkoutDto) {
    if (!window.confirm(uk ? "Видалити цей запис степера?" : "Delete this stepper workout?")) return;
    setStepperBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/stepper-workouts/${workout.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      if (editingStepper?.id === workout.id) setStepperFormOpen(false);
      await load();
    } catch {
      setError(uk ? "Не вдалося видалити тренування." : "Could not delete the workout.");
    } finally {
      setStepperBusy(false);
    }
  }

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

  async function startProgram(programId: number) {
    setBusyId(programId);
    setError(null);
    try {
      const response = await fetch("/api/v1/training/sessions/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId }),
      });
      if (response.status === 409) {
        const body = await response.json() as { activeSessionId?: number };
        if (body.activeSessionId) {
          router.push(`/training/sessions/${body.activeSessionId}`);
          return;
        }
      }
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      const body = await response.json() as { session: StrengthSessionDto };
      router.push(`/training/sessions/${body.session.id}`);
    } catch {
      setError(uk ? "Не вдалося почати тренування." : "Could not start the session.");
    } finally {
      setBusyId(null);
    }
  }

  async function archiveProgram(programId: number) {
    if (!window.confirm(uk ? "Архівувати програму?" : "Archive this program?")) return;
    setBusyId(programId);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/programs/${programId}/archive`, { method: "POST" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      await load();
    } catch {
      setError(uk ? "Не вдалося архівувати програму." : "Could not archive the program.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteCancelledSession(sessionId: number) {
    if (!window.confirm(
      uk
        ? "Видалити скасований запис? Дані Garmin залишаться без змін."
        : "Delete this cancelled diary entry? Garmin data will remain unchanged.",
    )) return;
    setBusySessionId(sessionId);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${sessionId}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      await load();
    } catch {
      setError(uk ? "Не вдалося видалити скасоване тренування." : "Could not delete the cancelled workout.");
    } finally {
      setBusySessionId(null);
    }
  }

  const attentionHasItems = attention.length > 0;

  function renderAttention(): ReactNode {
    if (attentionHasItems) {
      return (
        <section className={`${styles.panel} ${styles.panelAttention}`} aria-label={uk ? "Увага до зіставлення" : "Match attention"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Увага до зіставлення" : "Match attention"}</h2>
              <p>{uk ? "Неоднозначні або довго очікують Garmin" : "Ambiguous or long-pending Garmin links"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.list}>
              {attention.map((session) => (
                <article className={styles.card} key={session.id}>
                  <div className={styles.cardTop}>
                    <div>
                      <strong>{session.programName}</strong>
                      <p className={styles.cardMeta}>
                        {formatDateTime(session.webStartedAt, intlLocale)}
                        {" · "}
                        {formatDurationMinutes(session.webStartedAt, session.webEndedAt, intlLocale, uk)}
                      </p>
                    </div>
                    <span className={matchBadgeClass(session.matchStatus)}>
                      {matchStatusLabel(session.matchStatus, uk)}
                    </span>
                  </div>
                  <Link className={styles.linkLike} href={`/training/sessions/${session.id}`}>
                    {uk ? "Відкрити" : "Open"}
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      );
    }

    return (
      <section
        className={`${styles.panel} ${styles.panelCompact}`}
        aria-label={uk ? "Увага до зіставлення" : "Match attention"}
      >
        <div className={styles.panelHeader}>
          <div>
            <h2>{uk ? "Увага до зіставлення" : "Match attention"}</h2>
          </div>
        </div>
        <div className={styles.panelBody}>
          <p className={styles.emptyCompact}>
            {uk ? "Немає сесій, що потребують уваги." : "No sessions need attention."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <main className={`${styles.page} ${styles.trainingHubPage}`}>
      <div className={styles.navRow}>
        <strong>BodyCast</strong>
        <AppNav active="training" />
      </div>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Щоденник тренувань" : "Training diary"}</p>
          <h1>{uk ? "Тренування" : "Training"}</h1>
          <p className={styles.intro}>
            {uk
              ? "Силові програми, степер, історичні записи та зіставлення з Garmin."
              : "Strength programs, stepper workouts, historical backfill, and Garmin matching."}
          </p>
        </div>
        <div className={styles.rowActions}>
          <Link className={styles.infoButton} href="/training/backfill">
            {uk ? "Історія Garmin" : "Garmin history"}
          </Link>
          <Link className={styles.primaryButton} href="/training/programs/new">
            {uk ? "Нова програма" : "New program"}
          </Link>
        </div>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.stack}>
        {attentionHasItems && renderAttention()}

        <section className={`${styles.panel} ${styles.panelInfo}`} aria-label={uk ? "Тренування на степері" : "Stepper workouts"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Тренування на степері" : "Stepper workouts"}</h2>
              <p>{uk ? "Apple Health і власні записи · час, тривалість, діагностика" : "Apple Health and manual entries · time, duration, diagnostics"}</p>
            </div>
            <button className={styles.primaryButton} type="button" onClick={openNewStepperForm}>
              {uk ? "Додати степер" : "Add stepper"}
            </button>
          </div>
          <div className={styles.panelBody}>
            {stepperFormOpen && (
              <form className={`${styles.exerciseRow} ${styles.stepperForm}`} onSubmit={(event) => void saveStepperWorkout(event)}>
                <div className={styles.exerciseRowHeader}>
                  <strong>{editingStepper ? (uk ? "Редагувати запис" : "Edit workout") : (uk ? "Нове тренування" : "New workout")}</strong>
                  <button className={styles.textButton} type="button" onClick={() => setStepperFormOpen(false)}>
                    {uk ? "Закрити" : "Close"}
                  </button>
                </div>
                <p className={styles.cardMeta}>
                  {uk
                    ? "Для ручного запису зберігаються дата, час і тривалість. Калорії, кроки та пульс додаються лише з фактичних даних Apple Health."
                    : "Manual entries store date, time, and duration. Calories, steps, and heart rate come only from observed Apple Health data."}
                </p>
                <div className={`${styles.exerciseFields} ${styles.stepperFields}`}>
                  <label className={styles.field}>
                    <span>{uk ? "Дата й час · Europe/Bratislava" : "Date and time · Europe/Bratislava"}</span>
                    <input aria-label={uk ? "Дата й час степера" : "Stepper date and time"} type="datetime-local" required value={stepperStartAt} onChange={(event) => setStepperStartAt(event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>{uk ? "Тривалість · хвилини" : "Duration · minutes"}</span>
                    <input aria-label={uk ? "Тривалість степера" : "Stepper duration"} type="number" min="1" max="1440" step="1" required value={stepperDuration} onChange={(event) => setStepperDuration(event.target.value)} />
                  </label>
                </div>
                <div className={styles.denseCardActions}>
                  <button className={styles.primaryButton} type="submit" disabled={stepperBusy}>
                    {stepperBusy ? (uk ? "Збереження…" : "Saving…") : (uk ? "Зберегти" : "Save")}
                  </button>
                  {editingStepper && <button className={styles.secondaryButton} type="button" disabled={stepperBusy} onClick={() => void deleteStepperWorkout(editingStepper)}>{uk ? "Видалити" : "Delete"}</button>}
                </div>
              </form>
            )}
            {loading ? (
              <p className={styles.cardMeta}>{uk ? "Завантаження…" : "Loading…"}</p>
            ) : stepperWorkouts.length === 0 ? (
              <div className={styles.empty}>
                <strong>{uk ? "Записів степера поки немає" : "No stepper workouts yet"}</strong>
                <span>{uk ? "Додайте тренування вручну або синхронізуйте Apple Health." : "Add one manually or sync Apple Health."}</span>
              </div>
            ) : (
              <div className={styles.list}>
                {stepperWorkouts.map((workout) => (
                  <article className={styles.card} key={workout.id}>
                    <div className={styles.cardTop}>
                      <div>
                        <strong>{uk ? "Степер" : "Stepper"}</strong>
                        <p className={styles.cardMeta}>
                          <span>{formatStepperDateTime(workout.startAt, intlLocale)}</span>
                          <span>{formatDurationMinutes(workout.startAt, workout.endAt, intlLocale, uk)}</span>
                          <span>{workout.activeEnergyKcal === null ? (uk ? "Енергія не записана" : "No energy recorded") : `${workout.activeEnergyKcal} ${uk ? "активних ккал · пристрій" : "active kcal · device"}`}</span>
                        </p>
                      </div>
                      <span className={workout.source === "manual" ? styles.badgePrimary : styles.badgeInfo}>
                        {workout.source === "manual" ? (uk ? "Ручний запис" : "Manual entry") : "Apple Health"}
                      </span>
                    </div>
                    <div className={styles.denseCardActions}>
                      <Link className={styles.linkLike} href={`/training/workouts/${workout.id}/stepper-diagnostic`}>
                        {uk ? "Енергія · діагностика" : "Energy · diagnostics"}
                      </Link>
                      {workout.editable && <button className={styles.linkLike} type="button" disabled={stepperBusy} onClick={() => openEditStepperForm(workout)}>{uk ? "Редагувати" : "Edit"}</button>}
                      {workout.editable && <button className={styles.dangerButton} type="button" disabled={stepperBusy} onClick={() => void deleteStepperWorkout(workout)}>{uk ? "Видалити" : "Delete"}</button>}
                      {!workout.editable && <span className={styles.cardMeta}>{uk ? "Зв’язано із записом щоденника" : "Linked to a training diary entry"}</span>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className={styles.trainingHubGrid}>
        <section className={`${styles.panel} ${styles.panelActive}`} aria-label={uk ? "Активна сесія" : "Active session"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Активна сесія" : "Active session"}</h2>
              <p>{uk ? "Продовжити або почати нове тренування" : "Resume or start a workout"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {loading ? (
              <p className={styles.cardMeta}>{uk ? "Завантаження…" : "Loading…"}</p>
            ) : active ? (
              <article className={styles.card}>
                <div className={styles.cardTop}>
                  <div>
                    <strong>{active.programName}</strong>
                    <p className={styles.cardMeta}>
                      {uk ? "Почато" : "Started"} {formatDateTime(active.webStartedAt, intlLocale)}
                    </p>
                  </div>
                  <span className={styles.badgePrimary}>{uk ? "Активна" : "Active"}</span>
                </div>
                <div className={styles.denseCardActions}>
                  <Link className={styles.primaryButton} href={`/training/sessions/${active.id}`}>
                    {uk ? "Продовжити" : "Resume"}
                  </Link>
                </div>
              </article>
            ) : (
              <div className={styles.empty}>
                <strong>{uk ? "Немає активної сесії" : "No active session"}</strong>
                <span>{uk ? "Оберіть програму нижче, щоб почати." : "Pick a program below to start."}</span>
              </div>
            )}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.panelPrograms}`} aria-label={uk ? "Програми" : "Programs"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Програми" : "Programs"}</h2>
              <p>{uk ? "Створення, редагування та старт" : "Create, edit, and start"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {programs.length === 0 ? (
              <div className={styles.empty}>
                <strong>{uk ? "Поки немає програм" : "No programs yet"}</strong>
                <Link className={styles.linkLike} href="/training/programs/new">
                  {uk ? "Створити першу" : "Create the first one"}
                </Link>
              </div>
            ) : (
              <div className={styles.list}>
                {programs.map((program) => (
                  <article className={styles.card} key={program.id}>
                    <div className={styles.cardTop}>
                      <div>
                        <strong>{program.name}</strong>
                        <p className={styles.cardMeta}>
                          {uk
                            ? `${program.exerciseCount} вправ · v${program.currentVersionNumber ?? "—"}`
                            : `${program.exerciseCount} exercises · v${program.currentVersionNumber ?? "—"}`}
                        </p>
                      </div>
                    </div>
                    <div className={styles.denseCardActions}>
                      <button
                        className={styles.primaryButton}
                        type="button"
                        disabled={busyId === program.id || Boolean(active)}
                        aria-busy={busyId === program.id || undefined}
                        onClick={() => void startProgram(program.id)}
                      >
                        {uk ? "Почати" : "Start"}
                      </button>
                      <Link className={styles.secondaryButton} href={`/training/programs/${program.id}`}>
                        {uk ? "Редагувати" : "Edit"}
                      </Link>
                      <button
                        className={styles.archiveButton}
                        type="button"
                        disabled={busyId === program.id}
                        onClick={() => void archiveProgram(program.id)}
                      >
                        {uk ? "Архів" : "Archive"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
        </div>

        <div className={styles.trainingHubGrid}>
        <section className={`${styles.panel} ${styles.panelRecent}`} aria-label={uk ? "Нещодавні силові сесії" : "Recent strength sessions"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Нещодавні силові сесії" : "Recent strength sessions"}</h2>
              <p>{uk ? "Дата, програма, тривалість, зіставлення" : "Date, program, duration, match state"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {recent.length === 0 ? (
              <div className={styles.empty}>
                <span>{uk ? "Ще немає завершених сесій." : "No sessions yet."}</span>
              </div>
            ) : (
              <div className={styles.list}>
                {recent.map((session) => (
                  <article className={styles.card} key={session.id}>
                    <div className={styles.cardTop}>
                      <div>
                        <strong>{session.programName}</strong>
                        <p className={styles.cardMeta}>
                          <span>
                            {formatDateTime(session.occurrenceAt ?? session.webStartedAt, intlLocale)}
                            {" · "}
                            {formatDurationMinutes(session.webStartedAt, session.webEndedAt, intlLocale, uk)}
                          </span>
                          {session.planCompletionPercent != null && (
                            <span className={planCompletionPillClass(session.planCompletionPercent, styles)}>
                              {uk
                                ? `${session.planCompletionPercent}% плану`
                                : `${session.planCompletionPercent}% of plan`}
                            </span>
                          )}
                        </p>
                      </div>
                      <span className={matchBadgeClass(session.matchStatus)}>
                        {matchStatusLabel(session.matchStatus, uk)}
                      </span>
                    </div>
                    <div className={styles.denseCardActions}>
                      <Link className={styles.linkLike} href={`/training/sessions/${session.id}`}>
                        {uk ? "Деталі" : "Details"}
                      </Link>
                      {(session.status === "COMPLETED" || session.status === "CANCELLED") && (
                        <Link className={styles.linkLike} href={`/training/sessions/${session.id}/edit`}>
                          {uk ? "Редагувати" : "Edit"}
                        </Link>
                      )}
                      {session.status === "CANCELLED" && (
                        <button
                          className={styles.dangerButton}
                          type="button"
                          disabled={busySessionId === session.id}
                          onClick={() => void deleteCancelledSession(session.id)}
                        >
                          {busySessionId === session.id
                            ? (uk ? "Видалення…" : "Deleting…")
                            : (uk ? "Видалити" : "Delete")}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        {!attentionHasItems && renderAttention()}
        </div>
      </div>
    </main>
  );
}
