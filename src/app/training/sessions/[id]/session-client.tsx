"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import {
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
} from "@/modules/training/training.constants";
import type {
  MatchCandidateDto,
  StrengthSessionDto,
  StrengthSetDto,
} from "@/modules/training/training.types";
import {
  indexOfExerciseId,
  neighborExerciseId,
  resolveFocusedExerciseId,
} from "../../exercise-pager";
import { shouldHandleKeyboardExerciseNav } from "../../horizontal-swipe";
import {
  formatClock,
  formatDateTime,
  formatDurationMinutes,
  matchStatusLabel,
  readApiError,
  resistanceLabel,
} from "../../training-labels";
import {
  emptySetDraft,
  TrainingExerciseWorkspace,
} from "../../training-exercise-workspace";
import styles from "../../training.module.css";

export function SessionClient({ sessionId }: { sessionId: number }) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const [session, setSession] = useState<StrengthSessionDto | null>(null);
  const [focusedExerciseId, setFocusedExerciseId] = useState<number | null>(null);
  const [draft, setDraft] = useState(emptySetDraft());
  const [editingSetId, setEditingSetId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidateDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [slideDir, setSlideDir] = useState<"none" | "left" | "right">("none");
  const slideTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (slideTimerRef.current != null) window.clearTimeout(slideTimerRef.current);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${sessionId}`, { cache: "no-store" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        setSession(null);
        return;
      }
      const body = await response.json() as { session: StrengthSessionDto };
      const ordered = body.session.exercises.slice().sort((a, b) => a.order - b.order);
      setSession(body.session);
      setFocusedExerciseId((current) => resolveFocusedExerciseId(ordered, current));
    } catch {
      setError(uk ? "Не вдалося завантажити сесію." : "Could not load the session.");
    } finally {
      setLoading(false);
    }
  }, [sessionId, uk]);

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

  const exercises = useMemo(
    () => (session?.exercises ?? []).slice().sort((a, b) => a.order - b.order),
    [session],
  );
  const exerciseIndex = indexOfExerciseId(exercises, focusedExerciseId);
  const current = exercises.find((exercise) => exercise.id === focusedExerciseId) ?? exercises[0] ?? null;

  function goToNeighbor(delta: -1 | 1) {
    const nextId = neighborExerciseId(exercises, focusedExerciseId, delta);
    if (nextId == null) return;
    setSlideDir(delta > 0 ? "left" : "right");
    setFocusedExerciseId(nextId);
    setEditingSetId(null);
    setDraft(emptySetDraft());
    setMenuOpen(false);
    setError(null);
    if (slideTimerRef.current != null) window.clearTimeout(slideTimerRef.current);
    slideTimerRef.current = window.setTimeout(() => setSlideDir("none"), 180);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!shouldHandleKeyboardExerciseNav(event.key, document.activeElement)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToNeighbor(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNeighbor(1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises, focusedExerciseId]);

  useEffect(() => {
    if (!session || session.status === SESSION_STATUS.ACTIVE) return;
    let cancelled = false;
    async function loadCandidates() {
      try {
        const response = await fetch(`/api/v1/training/sessions/${sessionId}/match-candidates`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const body = await response.json() as { candidates: MatchCandidateDto[] };
        if (!cancelled) setCandidates(body.candidates);
      } catch {
        // detail page can still render without candidates
      }
    }
    void loadCandidates();
    return () => {
      cancelled = true;
    };
  }, [session, sessionId]);

  async function saveSet() {
    if (!session || !current) return;
    const reps = Number(draft.reps);
    if (!Number.isFinite(reps) || reps < 1) {
      setError(uk ? "Вкажіть кількість повторень." : "Enter reps.");
      return;
    }
    const payload: Record<string, number | string | null> = {
      reps,
      comment: draft.comment.trim() ? draft.comment.trim() : null,
      rir: draft.rir.trim() === "" ? null : Number(draft.rir),
    };
    if (payload.rir !== null) {
      if (!Number.isInteger(payload.rir) || (payload.rir as number) < 0 || (payload.rir as number) > 10) {
        setError(uk ? "RIR має бути цілим числом від 0 до 10." : "RIR must be an integer from 0 to 10.");
        return;
      }
    }
    if (current.resistanceType === RESISTANCE.EXTERNAL_WEIGHT) {
      const weightKg = Number(draft.weightKg);
      if (!Number.isFinite(weightKg) || weightKg <= 0) {
        setError(uk ? "Вкажіть вагу (кг)." : "Enter weight (kg).");
        return;
      }
      payload.weightKg = weightKg;
      payload.bandNominalResistanceKg = null;
    } else if (current.resistanceType === RESISTANCE.RESISTANCE_BAND) {
      const band = Number(draft.bandNominalResistanceKg);
      if (!Number.isFinite(band) || band <= 0) {
        setError(uk ? "Вкажіть номінальний опір резинки (кг)." : "Enter band nominal resistance (kg).");
        return;
      }
      payload.bandNominalResistanceKg = band;
      payload.weightKg = null;
    } else {
      payload.weightKg = null;
      payload.bandNominalResistanceKg = null;
    }

    setBusy(true);
    setError(null);
    try {
      const response = editingSetId === null
        ? await fetch(`/api/v1/training/sessions/${session.id}/exercises/${current.id}/sets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        : await fetch(`/api/v1/training/sessions/${session.id}/sets/${editingSetId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      await load();
      setDraft(emptySetDraft());
      setEditingSetId(null);
    } catch {
      setError(uk ? "Не вдалося зберегти підхід." : "Could not save the set.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSet(setId: number) {
    if (!session) return;
    if (!window.confirm(uk ? "Видалити підхід?" : "Delete this set?")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${session.id}/sets/${setId}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      await load();
    } catch {
      setError(uk ? "Не вдалося видалити підхід." : "Could not delete the set.");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(set: StrengthSetDto) {
    setEditingSetId(set.id);
    setDraft({
      reps: String(set.reps),
      weightKg: set.weightKg === null ? "" : String(set.weightKg),
      bandNominalResistanceKg: set.bandNominalResistanceKg === null
        ? ""
        : String(set.bandNominalResistanceKg),
      rir: set.rir === null ? "" : String(set.rir),
      comment: set.comment ?? "",
    });
  }

  async function finishSession() {
    if (!session) return;
    if (!window.confirm(uk ? "Завершити тренування?" : "Finish this workout?")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${session.id}/finish`, { method: "POST" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      await load();
    } catch {
      setError(uk ? "Не вдалося завершити сесію." : "Could not finish the session.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession() {
    if (!session) return;
    if (!window.confirm(
      uk
        ? "Скасувати тренування? Програма залишиться, ACTIVE-сесію буде скасовано."
        : "Cancel this workout? The program stays; the ACTIVE session will be cancelled.",
    )) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${session.id}/cancel`, { method: "POST" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      router.push("/training");
    } catch {
      setError(uk ? "Не вдалося скасувати тренування." : "Could not cancel the workout.");
    } finally {
      setBusy(false);
    }
  }

  async function matchWorkout(workoutId: number | null) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${session.id}/match`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workoutId }),
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      await load();
    } catch {
      setError(uk ? "Не вдалося зіставити." : "Could not match.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.workoutShell}>
        <p className={styles.cardMeta}>{uk ? "Завантаження…" : "Loading…"}</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className={styles.page}>
        <div className={styles.navRow}>
          <strong>BodyCast</strong>
          <AppNav active="training" />
        </div>
        {error && <div className={styles.errorBanner} role="alert">{error}</div>}
        <Link className={styles.linkLike} href="/training">{uk ? "До тренувань" : "Back to training"}</Link>
      </main>
    );
  }

  if (session.status === SESSION_STATUS.ACTIVE && current) {
    const isLast = exerciseIndex >= exercises.length - 1;
    return (
      <TrainingExerciseWorkspace
        uk={uk}
        mode="live"
        sessionId={session.id}
        backHref="/training"
        programName={session.programName}
        exercise={current}
        exerciseIndex={exerciseIndex}
        exerciseCount={exercises.length}
        draft={draft}
        editingSetId={editingSetId}
        busy={busy}
        error={error}
        slideDir={slideDir}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((value) => !value)}
        onCloseMenu={() => setMenuOpen(false)}
        menuContent={(
          <div className={styles.editMenuList}>
            {isLast && (
              <button
                type="button"
                className={styles.editMenuItem}
                disabled={busy}
                onClick={() => void finishSession()}
              >
                {uk ? "Завершити тренування" : "Finish workout"}
              </button>
            )}
            <button
              type="button"
              className={styles.editMenuDanger}
              disabled={busy}
              onClick={() => void cancelSession()}
            >
              {uk ? "Скасувати тренування" : "Cancel workout"}
            </button>
          </div>
        )}
        desktopPrimaryActions={isLast ? (
          <button
            type="button"
            className={styles.workoutDesktopActionBtn}
            disabled={busy}
            onClick={() => void finishSession()}
          >
            {uk ? "Завершити тренування" : "Finish workout"}
          </button>
        ) : null}
        desktopDangerActions={(
          <button
            type="button"
            className={styles.workoutDesktopDangerBtn}
            disabled={busy}
            onClick={() => void cancelSession()}
          >
            {uk ? "Скасувати тренування" : "Cancel workout"}
          </button>
        )}
        onPrev={() => goToNeighbor(-1)}
        onNext={() => goToNeighbor(1)}
        onDraftChange={setDraft}
        onSaveSet={() => void saveSet()}
        onBeginEditSet={beginEdit}
        onCancelEditSet={() => {
          setEditingSetId(null);
          setDraft(emptySetDraft());
        }}
        onDeleteSet={(setId) => void deleteSet(setId)}
        trailingAction={isLast ? (
          <button
            className={styles.liveSecondary}
            type="button"
            disabled={busy}
            onClick={() => void finishSession()}
          >
            {uk ? "Завершити тренування" : "Finish workout"}
          </button>
        ) : null}
      />
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
          <p className={styles.eyebrow}>{uk ? "Сесія щоденника" : "Diary session"}</p>
          <h1>{session.programName}</h1>
          <p className={styles.intro}>
            {formatDateTime(session.matchedWorkout?.startAt ?? session.webStartedAt, intlLocale)}
            {" · "}
            {formatDurationMinutes(
              session.matchedWorkout?.startAt ?? session.webStartedAt,
              session.matchedWorkout?.endAt ?? session.webEndedAt,
              intlLocale,
              uk,
            )}
          </p>
        </div>
        <div className={styles.rowActions}>
          {session.status === SESSION_STATUS.COMPLETED && (
            <Link className={styles.secondaryButton} href={`/training/sessions/${session.id}/edit`}>
              {uk ? "Редагувати" : "Edit"}
            </Link>
          )}
          <Link className={styles.secondaryButton} href="/training">{uk ? "Назад" : "Back"}</Link>
        </div>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.stack}>
        <section className={`${styles.panel} ${styles.panelInfo}`}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Джерела" : "Sources"}</h2>
              <p>{uk ? "Щоденник і Garmin окремо" : "Diary and Garmin kept separate"}</p>
            </div>
            <span className={
              session.matchStatus === MATCH_STATUS.MATCHED ? styles.badgeSuccess
                : session.matchStatus === MATCH_STATUS.AMBIGUOUS ? styles.badgeWarning
                  : session.matchStatus === MATCH_STATUS.UNMATCHED ? styles.badgeWarning
                    : session.matchStatus === MATCH_STATUS.PENDING ? styles.badgeInfo
                      : styles.badgeMuted
            }>
              {matchStatusLabel(session.matchStatus, uk)}
            </span>
          </div>
          <div className={`${styles.panelBody} ${styles.sectionSplit}`}>
            <section>
              <h3>{uk ? "Запис щоденника (web)" : "Diary entry (web)"}</h3>
              <dl className={styles.metaGrid}>
                <div>
                  <dt>{uk ? "Статус" : "Status"}</dt>
                  <dd>{session.status}</dd>
                </div>
                <div>
                  <dt>{uk ? "Початок" : "Started"}</dt>
                  <dd>{formatClock(session.webStartedAt, intlLocale)}</dd>
                </div>
                <div>
                  <dt>{uk ? "Кінець" : "Ended"}</dt>
                  <dd>{session.webEndedAt ? formatClock(session.webEndedAt, intlLocale) : "—"}</dd>
                </div>
                <div>
                  <dt>{uk ? "Звичайний тоннаж" : "Ordinary tonnage"}</dt>
                  <dd>
                    {session.ordinaryTonnageKg === null
                      ? (uk ? "лише зовнішня вага" : "external weight only")
                      : `${session.ordinaryTonnageKg} kg`}
                  </dd>
                </div>
              </dl>
            </section>
            <section>
              <h3>{uk ? "Garmin / пристрій" : "Garmin / device"}</h3>
              {session.matchedWorkout ? (
                <dl className={styles.metaGrid}>
                  <div>
                    <dt>{uk ? "Тип" : "Type"}</dt>
                    <dd>{session.matchedWorkout.type}</dd>
                  </div>
                  <div>
                    <dt>{uk ? "Інтервал" : "Interval"}</dt>
                    <dd>
                      {formatClock(session.matchedWorkout.startAt, intlLocale)}
                      –
                      {formatClock(session.matchedWorkout.endAt, intlLocale)}
                    </dd>
                  </div>
                  <div>
                    <dt>{uk ? "Тривалість" : "Duration"}</dt>
                    <dd>
                      {session.matchedWorkout.durationMinutes === null
                        ? "—"
                        : `${session.matchedWorkout.durationMinutes} ${uk ? "хв" : "min"}`}
                    </dd>
                  </div>
                  <div>
                    <dt>{uk ? "Активні ккал (оцінка пристрою)" : "Active kcal (device estimate)"}</dt>
                    <dd>
                      {session.matchedWorkout.activeEnergyKcal === null
                        ? "—"
                        : `${session.matchedWorkout.activeEnergyKcal} ${uk ? "оцінка/пристрій" : "estimated/device"}`}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className={styles.cardMeta}>
                  {uk ? "Немає зіставленого workout з пристрою." : "No matched device workout."}
                </p>
              )}
            </section>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Ручне зіставлення" : "Manual match"}</h2>
              <p>{uk ? "Кандидати біля часу сесії" : "Candidates near the session window"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {candidates.length === 0 ? (
              <div className={styles.empty}>
                <span>{uk ? "Кандидатів немає." : "No candidates."}</span>
              </div>
            ) : (
              <div className={styles.candidateList}>
                {candidates.map((candidate) => (
                  <article className={styles.candidateCard} key={candidate.id}>
                    <div>
                      <strong>{candidate.type}</strong>
                      <p className={styles.cardMeta}>
                        {formatClock(candidate.startAt, intlLocale)}–{formatClock(candidate.endAt, intlLocale)}
                        {candidate.activeEnergyKcal !== null
                          ? ` · ${candidate.activeEnergyKcal} ${uk ? "ккал (оцінка)" : "kcal (estimate)"}`
                          : ""}
                        {candidate.alreadyMatched
                          ? (uk ? " · вже зіставлено" : " · already matched")
                          : ""}
                      </p>
                    </div>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={busy || candidate.alreadyMatched}
                      onClick={() => void matchWorkout(candidate.id)}
                    >
                      {uk ? "Зіставити" : "Match"}
                    </button>
                  </article>
                ))}
              </div>
            )}
            <div className={styles.formActions}>
              <button className={styles.textButton} type="button" disabled={busy} onClick={() => void matchWorkout(null)}>
                {uk ? "Позначити без зіставлення" : "Mark unmatched"}
              </button>
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Вправи та підходи" : "Exercises and sets"}</h2>
              <p>{uk ? "Знімок програми на момент старту" : "Program snapshot at start"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.list}>
              {exercises.map((exercise) => (
                <article className={styles.card} key={exercise.id}>
                  <div className={styles.cardTop}>
                    <div>
                      <strong>{exercise.snapshotExerciseName}</strong>
                      <p className={styles.cardMeta}>
                        {resistanceLabel(exercise.resistanceType, uk)}
                        {" · "}
                        {uk ? `план ${exercise.plannedSets}` : `planned ${exercise.plannedSets}`}
                        {" · "}
                        {uk ? `факт ${exercise.sets.length}` : `logged ${exercise.sets.length}`}
                      </p>
                    </div>
                  </div>
                  {exercise.sets.length > 0 && (
                    <p className={styles.cardMeta}>
                      {exercise.sets
                        .slice()
                        .sort((a, b) => a.setNumber - b.setNumber)
                        .map((set) => {
                          const load = exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && set.weightKg !== null
                            ? `${set.weightKg}kg`
                            : exercise.resistanceType === RESISTANCE.RESISTANCE_BAND && set.bandNominalResistanceKg !== null
                              ? `${set.bandNominalResistanceKg}kg band`
                              : "";
                          return `#${set.setNumber} ${set.reps}${load ? `×${load}` : ""}`;
                        })
                        .join(" · ")}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
