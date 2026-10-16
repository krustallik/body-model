"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";
import { useI18n } from "@/i18n/i18n-provider";
import type { StepperWorkoutDto } from "@/modules/training/stepper-workout.repository";
import type { StrengthSessionDto, TrainingProgramSummaryDto } from "@/modules/training/training.types";
import { TrainingAttentionPanel, TrainingRecentSessionsPanel, TrainingStepperList } from "./training-paginated-sections";
import { TrainingFinishPublicationNotice } from "./training-finish-publication-notice";
import {
  formatDateTime,
  readApiError,
  trainingSessionTitle,
} from "./training-labels";
import { currentTrainingHref, useTrainingSearchParam } from "./training-url-state";
import styles from "./training.module.css";

function nowLocalDateTime(): string {
  const { date, time } = instantToLocalDateTime(new Date(), DEFAULT_TIME_ZONE);
  return `${date}T${time}`;
}

function workoutLocalDateTime(value: string): string {
  const { date, time } = instantToLocalDateTime(new Date(value), DEFAULT_TIME_ZONE);
  return `${date}T${time}`;
}

export function TrainingClient() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const [active, setActive] = useState<StrengthSessionDto | null>(null);
  const [programs, setPrograms] = useState<TrainingProgramSummaryDto[]>([]);
  const [listsRevision, setListsRevision] = useState(0);
  const [stepperFormOpen, setStepperFormOpen] = useState(false);
  const [editingStepper, setEditingStepper] = useState<StepperWorkoutDto | null>(null);
  const [stepperStartAt, setStepperStartAt] = useState(nowLocalDateTime);
  const [stepperDuration, setStepperDuration] = useState("20");
  const [stepperSteps, setStepperSteps] = useState("");
  const [stepperKcal, setStepperKcal] = useState("");
  const [stepperBusy, setStepperBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busySessionId, setBusySessionId] = useState<number | null>(null);
  const [reconBusyId, setReconBusyId] = useState<number | null>(null);
  const { value: programsRefresh, ready: programsRefreshReady } = useTrainingSearchParam("programsRefresh");
  const hubReturnHref = programsRefreshReady ? currentTrainingHref() : "/training";

  const load = useCallback(async () => {
    try {
      const [activeRes, programsRes] = await Promise.all([
        fetch("/api/v1/training/sessions/active", { cache: "no-store" }),
        fetch("/api/v1/training/programs", { cache: "no-store" }),
      ]);
      if (!activeRes.ok || !programsRes.ok) {
        setError(uk ? "Не вдалося завантажити тренування." : "Could not load training data.");
        return;
      }
      const activeBody = await activeRes.json() as { session: StrengthSessionDto | null };
      const programsBody = await programsRes.json() as { programs: TrainingProgramSummaryDto[] };
      setError(null);
      setActive(activeBody.session);
      setPrograms(programsBody.programs);
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
    setStepperSteps("");
    setStepperKcal("");
    setStepperFormOpen(true);
  }

  function openEditStepperForm(workout: StepperWorkoutDto) {
    setEditingStepper(workout);
    setStepperStartAt(workoutLocalDateTime(workout.startAt));
    setStepperDuration(String(workout.durationMinutes ?? 20));
    setStepperSteps(workout.manualStepCount === null ? "" : String(workout.manualStepCount));
    setStepperKcal(workout.manualActiveEnergyKcal === null ? "" : String(workout.manualActiveEnergyKcal));
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
        body: JSON.stringify({
          startAt: instant,
          durationMinutes: Number(stepperDuration),
          manualStepCount: stepperSteps.trim() === "" ? null : Number(stepperSteps),
          manualActiveEnergyKcal: stepperKcal.trim() === "" ? null : Number(stepperKcal),
        }),
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      setStepperFormOpen(false);
      setEditingStepper(null);
      setListsRevision((current) => current + 1);
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
      setListsRevision((current) => current + 1);
    } catch {
      setError(uk ? "Не вдалося видалити тренування." : "Could not delete the workout.");
    } finally {
      setStepperBusy(false);
    }
  }

  async function confirmStepperReconciliation(workout: StepperWorkoutDto) {
    if (workout.reconciliationPeerWorkoutId === null || workout.reconciliationRole === null) return;
    const manualWorkoutId = workout.reconciliationRole === "manual" ? workout.id : workout.reconciliationPeerWorkoutId;
    const garminWorkoutId = workout.reconciliationRole === "garmin" ? workout.id : workout.reconciliationPeerWorkoutId;
    if (!window.confirm(uk
      ? "Підтвердити пару? Garmin лишається канонічним джерелом; ручний запис — для аудиту. Visibility не змінюється."
      : "Confirm this pair? Garmin stays the canonical source; the manual row remains for audit. Visibility does not change.")) return;
    setReconBusyId(workout.id);
    setError(null);
    try {
      const response = await fetch("/api/v1/training/stepper-reconciliation/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manualWorkoutId,
          garminWorkoutId,
          // Confirm only. Authorized activation is a separate operator step.
          activateVisibility: false,
        }),
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      setListsRevision((current) => current + 1);
    } catch {
      setError(uk ? "Не вдалося підтвердити узгодження." : "Could not confirm reconciliation.");
    } finally {
      setReconBusyId(null);
    }
  }

  async function rejectStepperReconciliation(workout: StepperWorkoutDto) {
    if (workout.reconciliationGroupId === null) return;
    if (!window.confirm(uk
      ? "Відхилити цю пару узгодження?"
      : "Reject this reconciliation pair?")) return;
    setReconBusyId(workout.id);
    setError(null);
    try {
      const response = await fetch("/api/v1/training/stepper-reconciliation/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: workout.reconciliationGroupId }),
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      setListsRevision((current) => current + 1);
    } catch {
      setError(uk ? "Не вдалося відхилити узгодження." : "Could not reject reconciliation.");
    } finally {
      setReconBusyId(null);
    }
  }

  useEffect(() => {
    if (!programsRefreshReady) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load, programsRefresh, programsRefreshReady]);

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
          router.push(`/training/sessions/${body.activeSessionId}?returnTo=${encodeURIComponent(hubReturnHref)}`);
          return;
        }
      }
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      const body = await response.json() as { session: StrengthSessionDto };
      router.push(`/training/sessions/${body.session.id}?returnTo=${encodeURIComponent(hubReturnHref)}`);
    } catch {
      setError(uk ? "Не вдалося почати тренування." : "Could not start the session.");
    } finally {
      setBusyId(null);
    }
  }

  async function startDynamicSession() {
    setBusyId(-1);
    setError(null);
    try {
      const response = await fetch("/api/v1/training/sessions/start-dynamic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE }),
      });
      if (response.status === 409) {
        const body = await response.json() as { activeSessionId?: number };
        if (body.activeSessionId) {
          router.push(`/training/sessions/${body.activeSessionId}?returnTo=${encodeURIComponent(hubReturnHref)}`);
          return;
        }
      }
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      const body = await response.json() as { session: StrengthSessionDto };
      router.push(`/training/sessions/${body.session.id}?returnTo=${encodeURIComponent(hubReturnHref)}`);
    } catch {
      setError(uk ? "Не вдалося почати вільне тренування." : "Could not start a free workout.");
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
        const apiError = await readApiError(response, uk);
        try {
          const programsResponse = await fetch("/api/v1/training/programs", { cache: "no-store" });
          if (!programsResponse.ok) throw new Error("Could not verify archived program.");
          const body = await programsResponse.json() as { programs: TrainingProgramSummaryDto[] };
          setPrograms(body.programs);
          if (!body.programs.some((program) => program.id === programId)) {
            setError(null);
            setListsRevision((current) => current + 1);
            setNotice(uk ? "Програму архівовано, хоча відповідь сервера повідомила про помилку." : "Program archived, although the server reported an error.");
            return;
          }
        } catch {
          // Keep the draft state visible until an authoritative list can be read.
        }
        setError(apiError);
        return;
      }
      setPrograms((current) => current.filter((program) => program.id !== programId));
      setListsRevision((current) => current + 1);
    } catch {
      try {
        const programsResponse = await fetch("/api/v1/training/programs", { cache: "no-store" });
        if (!programsResponse.ok) throw new Error("Could not verify archived program.");
        const body = await programsResponse.json() as { programs: TrainingProgramSummaryDto[] };
        setPrograms(body.programs);
        if (!body.programs.some((program) => program.id === programId)) {
          setListsRevision((current) => current + 1);
          setNotice(uk ? "Програму архівовано, але початкову відповідь не отримано." : "Program archived, but the original response was not received.");
          setError(null);
          return;
        }
      } catch {
        // The request outcome stays visible as unresolved; it is never replayed here.
      }
      setError(uk ? "Не вдалося підтвердити архівування програми. Перевірте список перед повторною дією." : "Could not confirm program archival. Check the list before trying again.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSession(sessionId: number) {
    if (!window.confirm(
      uk
        ? "Назавжди видалити запис BodyCast разом із вправами, підходами та знімками обліку? Зіставлені записи тренувань Garmin та Apple Health залишаться без змін."
        : "Permanently delete this BodyCast diary session, including its exercises, sets, and accounting snapshots? Matched Garmin and Apple Health workout records will remain unchanged.",
    )) return;
    setBusySessionId(sessionId);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${sessionId}`, { method: "DELETE" });
      const publicationStatus = await response.clone().json().then((body: { modelPublicationStatus?: unknown }) => body.modelPublicationStatus).catch(() => undefined);
      if (!response.ok) {
        const apiError = await readApiError(response, uk);
        try {
          const current = await fetch(`/api/v1/training/sessions/${sessionId}`, { cache: "no-store" });
          if (current.status === 404) {
            setListsRevision((revision) => revision + 1);
            setError(null);
            setNotice(publicationStatus === "stale"
              ? (uk ? "Тренування видалено, але публікація моделі ще не актуальна." : "Session deleted, but model publication is not current yet.")
              : (uk ? "Запис тренування відсутній; журнал показує актуальний стан." : "The workout record is absent; the diary shows the current state."));
            return;
          }
        } catch {
          // Preserve a visible error if the authoritative check is unavailable.
        }
        setError(apiError);
        return;
      }
      setListsRevision((current) => current + 1);
      setNotice(publicationStatus === "stale"
        ? (uk ? "Запис видалено. Публікація моделі ще оновлюється; дані можуть тимчасово бути неактуальними." : "Session deleted. Model publication is still updating, so derived data may be temporarily stale.")
        : null);
    } catch {
      setListsRevision((current) => current + 1);
      try {
        const current = await fetch(`/api/v1/training/sessions/${sessionId}`, { cache: "no-store" });
        if (current.status === 404) {
          setError(null);
          setNotice(uk ? "Тренування видалено, але початкову відповідь не отримано." : "Session deleted, but the original response was not received.");
          return;
        }
      } catch {
        // No retry: retain the unresolved-outcome message below.
      }
      setError(uk ? "Не вдалося підтвердити видалення. Перевірте журнал перед повторною дією." : "Could not confirm deletion. Check the diary before trying again.");
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <main className={`${styles.page} ${styles.trainingHubPage}`}>
      <div className={styles.navRow}>
        <strong>BodyCast</strong>
        <AppNav active="training" />
      </div>
      <TrainingFinishPublicationNotice />

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
          <Link className={styles.infoButton} href={`/training/backfill?returnTo=${encodeURIComponent(hubReturnHref)}`}>
            {uk ? "Історія Garmin" : "Garmin history"}
          </Link>
          <Link className={styles.primaryButton} href={`/training/programs/new?returnTo=${encodeURIComponent(hubReturnHref)}`}>
            {uk ? "Нова програма" : "New program"}
          </Link>
        </div>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}
      {notice && <p className={styles.emptyCompact} role="status">{notice}</p>}

      <div className={styles.stack}>
        <TrainingAttentionPanel uk={uk} intlLocale={intlLocale} refreshVersion={listsRevision} />
        <div className={`${styles.trainingHubGrid} ${styles.trainingPrimaryGrid}`}>
        {active ? <section className={`${styles.panel} ${styles.panelActive}`} aria-label={uk ? "Активна сесія" : "Active session"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Активна сесія" : "Active session"}</h2>
              <p>{uk ? "Продовжити або почати нове тренування" : "Resume or start a workout"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            <article className={styles.card}>
                <div className={styles.cardTop}>
                  <div>
                    <strong>{trainingSessionTitle(active.programName, uk)}</strong>
                    <p className={styles.cardMeta}>
                      {uk ? "Почато" : "Started"} {formatDateTime(active.webStartedAt, intlLocale)}
                    </p>
                  </div>
                  <span className={styles.badgePrimary}>{uk ? "Активна" : "Active"}</span>
                </div>
                <div className={styles.denseCardActions}>
                  <Link className={styles.primaryButton} href={`/training/sessions/${active.id}?returnTo=${encodeURIComponent(hubReturnHref)}`}>
                    {uk ? "Продовжити" : "Resume"}
                  </Link>
                </div>
              </article>
          </div>
        </section> : !loading && !error && <section className={`${styles.panel} ${styles.panelActive} ${styles.panelStartDynamic}`} aria-label={uk ? "Почати тренування" : "Start a workout"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Почати без програми" : "Start without a program"}</h2>
              <p>{uk ? "Додай вправи під час тренування — запис збережеться як вільна сесія." : "Choose exercises as you go; the workout is saved as a free session."}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={busyId !== null}
              aria-busy={busyId === -1 || undefined}
              onClick={() => void startDynamicSession()}
            >
              {uk ? "Почати без програми" : "Start without a program"}
            </button>
          </div>
        </section>}

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
                <Link className={styles.linkLike} href={`/training/programs/new?returnTo=${encodeURIComponent(hubReturnHref)}`}>
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
                      <Link className={styles.secondaryButton} href={`/training/programs/${program.id}?returnTo=${encodeURIComponent(hubReturnHref)}`}>
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

        <div className={`${styles.trainingHubGrid} ${styles.trainingHistoryGrid}`}>
        <TrainingRecentSessionsPanel
          uk={uk}
          intlLocale={intlLocale}
          refreshVersion={listsRevision}
          busySessionId={busySessionId}
          onDeleteSession={deleteSession}
        />

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
                    ? "Дата, час і тривалість обов’язкові. Кроки та активні ккал можна вказати окремо: вони не є спостереженням Apple Health. Якщо вказані ккал, кроки їх не перераховують."
                    : "Date, time, and duration are required. Steps and active kcal are optional declarations, not Apple Health observations. Entered kcal are not recalculated from steps."}
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
                  <label className={styles.field}>
                    <span>{uk ? "Кроки MS100 · необов’язково" : "MS100 steps · optional"}</span>
                    <input aria-label={uk ? "Кроки степера" : "Stepper steps"} type="number" min="0" step="1" value={stepperSteps} onChange={(event) => setStepperSteps(event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>{uk ? "Активні ккал · необов’язково" : "Active kcal · optional"}</span>
                    <input aria-label={uk ? "Активні ккал степера" : "Stepper active kcal"} type="number" min="0" step="1" value={stepperKcal} onChange={(event) => setStepperKcal(event.target.value)} />
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
          <TrainingStepperList
            uk={uk}
            intlLocale={intlLocale}
            refreshVersion={listsRevision}
            busy={stepperBusy}
            reconBusyId={reconBusyId}
            onEdit={openEditStepperForm}
            onDelete={(workout) => void deleteStepperWorkout(workout)}
            onConfirmReconciliation={(workout) => void confirmStepperReconciliation(workout)}
            onRejectReconciliation={(workout) => void rejectStepperReconciliation(workout)}
          />
          </div>
        </section>
        </div>

      </div>
    </main>
  );
}
