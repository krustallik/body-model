"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import {
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
  type ResistanceType,
} from "@/modules/training/training.constants";
import type {
  MatchCandidateDto,
  StrengthSessionDto,
  StrengthSetDto,
} from "@/modules/training/training.types";
import {
  formatClock,
  formatDateTime,
  formatDurationMinutes,
  matchStatusLabel,
  readApiError,
  resistanceLabel,
} from "../../training-labels";
import styles from "../../training.module.css";

function emptyDraft(resistance: ResistanceType): { reps: string; weightKg: string; bandNominalResistanceKg: string } {
  return {
    reps: "",
    weightKg: resistance === RESISTANCE.EXTERNAL_WEIGHT ? "" : "",
    bandNominalResistanceKg: resistance === RESISTANCE.RESISTANCE_BAND ? "" : "",
  };
}

export function SessionClient({ sessionId }: { sessionId: number }) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const [session, setSession] = useState<StrengthSessionDto | null>(null);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [draft, setDraft] = useState(emptyDraft(RESISTANCE.EXTERNAL_WEIGHT));
  const [editingSetId, setEditingSetId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidateDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

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
      setSession(body.session);
      setExerciseIndex((current) => {
        const max = Math.max(0, body.session.exercises.length - 1);
        return Math.min(current, max);
      });
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
  const current = exercises[exerciseIndex] ?? null;

  function goToExercise(index: number) {
    const next = exercises[index];
    setExerciseIndex(index);
    if (next) {
      setDraft(emptyDraft(next.resistanceType));
      setEditingSetId(null);
    }
  }

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
    const payload: Record<string, number | null> = { reps };
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
      setDraft(emptyDraft(current.resistanceType));
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
      bandNominalResistanceKg: set.bandNominalResistanceKg === null ? "" : String(set.bandNominalResistanceKg),
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
      <main className={styles.page}>
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
    const sets = current.sets.slice().sort((a, b) => a.setNumber - b.setNumber);
    const repsOk = Number.isFinite(Number(draft.reps)) && Number(draft.reps) >= 1;
    const weightOk = current.resistanceType !== RESISTANCE.EXTERNAL_WEIGHT
      || (Number.isFinite(Number(draft.weightKg)) && Number(draft.weightKg) > 0);
    const bandOk = current.resistanceType !== RESISTANCE.RESISTANCE_BAND
      || (Number.isFinite(Number(draft.bandNominalResistanceKg)) && Number(draft.bandNominalResistanceKg) > 0);
    const canSave = !busy && repsOk && weightOk && bandOk;

    function switchExercise(index: number) {
      goToExercise(index);
      try {
        window.scrollTo(0, 0);
      } catch {
        // jsdom may not implement scrollTo
      }
    }

    return (
      <main className={styles.liveShell}>
        <header className={styles.liveTop}>
          <Link className={styles.liveBack} href="/training">
            {uk ? "← Тренування" : "← Training"}
          </Link>
          <p className={styles.liveProgram}>{session.programName}</p>
          <p className={styles.liveProgress}>
            {uk
              ? `${exerciseIndex + 1} / ${exercises.length} вправ`
              : `${exerciseIndex + 1} / ${exercises.length} exercises`}
          </p>
        </header>

        {error && <div className={styles.errorBanner} role="alert">{error}</div>}

        <section className={styles.liveExercise} aria-labelledby="live-exercise-title">
          <h1 id="live-exercise-title" className={styles.liveExerciseTitle}>
            {current.snapshotExerciseName}
          </h1>
          <p className={styles.liveExerciseMeta}>
            <span className={styles.liveBadge}>{resistanceLabel(current.resistanceType, uk)}</span>
            <span>
              {uk
                ? `${current.plannedSets} заплановані підходи`
                : `${current.plannedSets} planned sets`}
            </span>
          </p>
        </section>

        <section className={styles.liveSets} aria-label={uk ? "Підходи" : "Sets"}>
          <h2 className={styles.liveSectionTitle}>{uk ? "Підходи" : "Sets"}</h2>
          {sets.length === 0 ? (
            <p className={styles.liveEmptySets}>
              {uk ? "Ще немає записаних підходів." : "No sets logged yet."}
            </p>
          ) : (
            <ul className={styles.liveSetTable}>
              {sets.map((set) => (
                <li className={styles.liveSetRow} key={set.id}>
                  <span className={styles.liveSetNum}>{set.setNumber}</span>
                  <span className={styles.liveSetLoad}>
                    {current.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && set.weightKg !== null
                      ? `${set.weightKg} ${uk ? "кг" : "kg"}`
                      : current.resistanceType === RESISTANCE.RESISTANCE_BAND
                        && set.bandNominalResistanceKg !== null
                        ? `${set.bandNominalResistanceKg} ${uk ? "кг резинки" : "kg band"}`
                        : (uk ? "власна вага" : "bodyweight")}
                  </span>
                  <span className={styles.liveSetReps}>
                    {set.reps} {uk ? "повт." : "reps"}
                  </span>
                  <span className={styles.liveSetActions}>
                    <button
                      className={styles.textButton}
                      type="button"
                      onClick={() => beginEdit(set)}
                    >
                      {uk ? "Змінити" : "Edit"}
                    </button>
                    <button
                      className={styles.textButton}
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteSet(set.id)}
                    >
                      {uk ? "Видалити" : "Delete"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.liveEntry} aria-label={uk ? "Новий підхід" : "New set"}>
          <h2 className={styles.liveSectionTitle}>
            {editingSetId === null ? (uk ? "Новий підхід" : "New set") : (uk ? "Редагувати підхід" : "Edit set")}
          </h2>
          <div className={styles.liveFields}>
            {current.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && (
              <label className={styles.liveField}>
                <span>{uk ? "Вага, кг" : "Weight, kg"}</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.weightKg}
                  onChange={(event) => setDraft((value) => ({ ...value, weightKg: event.target.value }))}
                />
              </label>
            )}
            {current.resistanceType === RESISTANCE.RESISTANCE_BAND && (
              <label className={styles.liveField}>
                <span>{uk ? "Опір резинки, кг" : "Band resistance, kg"}</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.bandNominalResistanceKg}
                  onChange={(event) => setDraft((value) => ({
                    ...value,
                    bandNominalResistanceKg: event.target.value,
                  }))}
                />
              </label>
            )}
            <label className={styles.liveField}>
              <span>{uk ? "Повтори" : "Reps"}</span>
              <input
                inputMode="numeric"
                autoComplete="off"
                value={draft.reps}
                onChange={(event) => setDraft((value) => ({ ...value, reps: event.target.value }))}
              />
            </label>
          </div>
          <div className={styles.liveSaveRow}>
            {editingSetId !== null && (
              <button
                className={styles.liveSecondary}
                type="button"
                onClick={() => {
                  setEditingSetId(null);
                  setDraft(emptyDraft(current.resistanceType));
                }}
              >
                {uk ? "Скасувати" : "Cancel"}
              </button>
            )}
            <button
              className={styles.liveSave}
              type="button"
              disabled={!canSave}
              onClick={() => void saveSet()}
            >
              {busy
                ? (uk ? "Збереження…" : "Saving…")
                : (uk ? "Зберегти підхід" : "Save set")}
            </button>
          </div>
        </section>

        <nav className={styles.liveNav} aria-label={uk ? "Навігація вправ" : "Exercise navigation"}>
          <button
            className={styles.liveNavBtn}
            type="button"
            disabled={exerciseIndex === 0}
            onClick={() => switchExercise(Math.max(0, exerciseIndex - 1))}
          >
            {uk ? "← Попередня" : "← Previous"}
          </button>
          {exerciseIndex < exercises.length - 1 ? (
            <button
              className={styles.liveNavBtnNext}
              type="button"
              onClick={() => switchExercise(Math.min(exercises.length - 1, exerciseIndex + 1))}
            >
              {uk ? "Наступна →" : "Next →"}
            </button>
          ) : (
            <button
              className={styles.liveNavBtnNext}
              type="button"
              disabled={busy}
              onClick={() => void finishSession()}
            >
              {uk ? "Завершити" : "Finish"}
            </button>
          )}
        </nav>
      </main>
    );
  }

  // Completed / cancelled detail + match UI
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
        <Link className={styles.secondaryButton} href="/training">{uk ? "Назад" : "Back"}</Link>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.stack}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Джерела" : "Sources"}</h2>
              <p>{uk ? "Щоденник і Garmin окремо" : "Diary and Garmin kept separate"}</p>
            </div>
            <span className={
              session.matchStatus === MATCH_STATUS.MATCHED ? styles.badge
                : session.matchStatus === MATCH_STATUS.AMBIGUOUS ? styles.badgeWarn
                  : session.matchStatus === MATCH_STATUS.UNMATCHED ? styles.badgeDanger
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
                  {uk
                    ? "Немає зіставленого workout з пристрою."
                    : "No matched device workout."}
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
