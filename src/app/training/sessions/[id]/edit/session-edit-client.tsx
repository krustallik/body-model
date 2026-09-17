"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import {
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  RESISTANCE,
  SESSION_STATUS,
  type ResistanceType,
} from "@/modules/training/training.constants";
import type {
  ExerciseCatalogDto,
  ProgramVersionSummaryDto,
  StrengthSessionDto,
  StrengthSessionExerciseDto,
  StrengthSetDto,
  TrainingProgramSummaryDto,
} from "@/modules/training/training.types";
import {
  formatClock,
  formatDateTime,
  readApiError,
  resistanceLabel,
} from "../../../training-labels";
import styles from "../../../training.module.css";

function emptyDraft(resistance: ResistanceType) {
  return {
    reps: "",
    weightKg: resistance === RESISTANCE.EXTERNAL_WEIGHT ? "" : "",
    bandNominalResistanceKg: resistance === RESISTANCE.RESISTANCE_BAND ? "" : "",
  };
}

export function SessionEditClient({ sessionId }: { sessionId: number }) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const [session, setSession] = useState<StrengthSessionDto | null>(null);
  const [catalog, setCatalog] = useState<ExerciseCatalogDto[]>([]);
  const [programs, setPrograms] = useState<TrainingProgramSummaryDto[]>([]);
  const [versions, setVersions] = useState<ProgramVersionSummaryDto[]>([]);
  const [programId, setProgramId] = useState<number | "">("");
  const [versionId, setVersionId] = useState<number | "">("");
  const [showProgramPicker, setShowProgramPicker] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [addCatalogId, setAddCatalogId] = useState<number | "">("");
  const [addResistance, setAddResistance] = useState<ResistanceType>(RESISTANCE.EXTERNAL_WEIGHT);
  const [draftByExercise, setDraftByExercise] = useState<Record<number, ReturnType<typeof emptyDraft>>>({});
  const [editingSet, setEditingSet] = useState<{ exerciseId: number; set: StrengthSetDto } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [sessionRes, catalogRes, programsRes] = await Promise.all([
        fetch(`/api/v1/training/sessions/${sessionId}`, { cache: "no-store" }),
        fetch("/api/v1/training/exercises", { cache: "no-store" }),
        fetch(`/api/v1/training/programs${showArchived ? "?includeArchived=true" : ""}`, { cache: "no-store" }),
      ]);
      if (!sessionRes.ok) {
        setError(await readApiError(sessionRes, uk));
        setSession(null);
        return;
      }
      const sessionBody = await sessionRes.json() as { session: StrengthSessionDto };
      const catalogBody = catalogRes.ok
        ? await catalogRes.json() as { exercises: ExerciseCatalogDto[] }
        : { exercises: [] };
      const programsBody = programsRes.ok
        ? await programsRes.json() as { programs: TrainingProgramSummaryDto[] }
        : { programs: [] };
      setSession(sessionBody.session);
      setCatalog(catalogBody.exercises);
      setPrograms(programsBody.programs);
      setProgramId(sessionBody.session.programId);
      setVersionId(sessionBody.session.programVersionId);
    } catch {
      setError(uk ? "Не вдалося завантажити редактор." : "Could not load the editor.");
    } finally {
      setLoading(false);
    }
  }, [sessionId, showArchived, uk]);

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

  useEffect(() => {
    if (!showProgramPicker || typeof programId !== "number") return;
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/v1/training/programs/${programId}/versions`, { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const body = await response.json() as { versions: ProgramVersionSummaryDto[] };
      if (!cancelled) setVersions(body.versions ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [programId, showProgramPicker]);

  const exercises = useMemo(
    () => (session?.exercises ?? []).slice().sort((a, b) => a.order - b.order),
    [session],
  );

  function draftFor(exercise: StrengthSessionExerciseDto) {
    return draftByExercise[exercise.id] ?? emptyDraft(exercise.resistanceType);
  }

  async function mutate(path: string, init: RequestInit): Promise<StrengthSessionDto | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return null;
      }
      const body = await response.json() as { session: StrengthSessionDto };
      setSession(body.session);
      return body.session;
    } catch {
      setError(uk ? "Не вдалося зберегти." : "Could not save.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function changeProgram() {
    if (typeof programId !== "number") return;
    await mutate(`/api/v1/training/sessions/${sessionId}/program`, {
      method: "POST",
      body: JSON.stringify({
        programId,
        ...(typeof versionId === "number" ? { programVersionId: versionId } : {}),
      }),
    });
    setShowProgramPicker(false);
  }

  async function addExercise() {
    if (typeof addCatalogId !== "number") return;
    await mutate(`/api/v1/training/sessions/${sessionId}/exercises`, {
      method: "POST",
      body: JSON.stringify({
        catalogId: addCatalogId,
        plannedSets: 3,
        resistanceType: addResistance,
      }),
    });
    setAddCatalogId("");
  }

  async function removeExercise(exercise: StrengthSessionExerciseDto) {
    const hasSets = exercise.sets.length > 0;
    if (hasSets) {
      const ok = window.confirm(
        uk
          ? "У цієї вправи є підходи. Видалити її разом із підходами?"
          : "This exercise has sets. Delete it and its sets?",
      );
      if (!ok) return;
    }
    await mutate(`/api/v1/training/sessions/${sessionId}/exercises/${exercise.id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm: hasSets }),
    });
  }

  async function saveSet(exercise: StrengthSessionExerciseDto) {
    const draft = draftFor(exercise);
    const reps = Number(draft.reps);
    if (!Number.isFinite(reps) || reps < 1) {
      setError(uk ? "Вкажіть повторення." : "Enter reps.");
      return;
    }
    const payload: Record<string, unknown> = { reps };
    if (exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT) {
      const weight = Number(draft.weightKg);
      if (!Number.isFinite(weight) || weight <= 0) {
        setError(uk ? "Вкажіть вагу." : "Enter weight.");
        return;
      }
      payload.weightKg = weight;
    }
    if (exercise.resistanceType === RESISTANCE.RESISTANCE_BAND) {
      const band = Number(draft.bandNominalResistanceKg);
      if (!Number.isFinite(band) || band <= 0) {
        setError(uk ? "Вкажіть опір резинки." : "Enter band resistance.");
        return;
      }
      payload.bandNominalResistanceKg = band;
    }

    setBusy(true);
    setError(null);
    try {
      const editing = editingSet?.exerciseId === exercise.id ? editingSet.set : null;
      const response = editing
        ? await fetch(`/api/v1/training/sessions/${sessionId}/sets/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        : await fetch(`/api/v1/training/sessions/${sessionId}/exercises/${exercise.id}/sets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      setEditingSet(null);
      setDraftByExercise((current) => ({ ...current, [exercise.id]: emptyDraft(exercise.resistanceType) }));
      await load();
    } catch {
      setError(uk ? "Не вдалося зберегти підхід." : "Could not save set.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSet(setId: number) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${sessionId}/sets/${setId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      await load();
    } catch {
      setError(uk ? "Не вдалося видалити підхід." : "Could not delete set.");
    } finally {
      setBusy(false);
    }
  }

  if (sessionId < 1) {
    return (
      <main className={styles.page}>
        <p className={styles.errorBanner}>{uk ? "Невірна сесія." : "Invalid session."}</p>
      </main>
    );
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
        {error && <div className={styles.errorBanner} role="alert">{error}</div>}
        <Link href="/training">{uk ? "Назад" : "Back"}</Link>
      </main>
    );
  }

  const occurrence = session.matchedWorkout?.startAt ?? session.webStartedAt;

  return (
    <main className={styles.page}>
      <div className={styles.navRow}>
        <strong>BodyCast</strong>
        <AppNav active="training" />
      </div>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            {session.entryMode === ENTRY_MODE.RETROSPECTIVE
              ? (uk ? "Історичний запис" : "Historical diary")
              : (uk ? "Завершена сесія" : "Completed session")}
          </p>
          <h1>{session.programName}</h1>
          <p className={styles.intro}>
            {formatDateTime(occurrence, intlLocale)}
            {" · "}
            {uk ? `ревізія ${session.revision}` : `revision ${session.revision}`}
            {session.status !== SESSION_STATUS.COMPLETED
              ? ` · ${session.status}`
              : ""}
          </p>
        </div>
        <div className={styles.rowActions}>
          <Link className={styles.secondaryButton} href={`/training/sessions/${session.id}`}>
            {uk ? "Деталі" : "Details"}
          </Link>
          <Link className={styles.secondaryButton} href="/training/backfill">
            {uk ? "Історія" : "History"}
          </Link>
        </div>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.stack}>
        {session.matchedWorkout && (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>{uk ? "Garmin (без змін)" : "Garmin (read-only)"}</h2>
                <p>{uk ? "Час, тривалість, ккал залишаються з пристрою" : "Time, duration, kcal stay from device"}</p>
              </div>
            </div>
            <div className={styles.panelBody}>
              <dl className={styles.metaGrid}>
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
                    {session.matchedWorkout.durationMinutes == null
                      ? "—"
                      : `${session.matchedWorkout.durationMinutes} ${uk ? "хв" : "min"}`}
                  </dd>
                </div>
                <div>
                  <dt>{uk ? "Активні ккал" : "Active kcal"}</dt>
                  <dd>{session.matchedWorkout.activeEnergyKcal ?? "—"}</dd>
                </div>
                <div>
                  <dt>{uk ? "Тоннаж" : "Tonnage"}</dt>
                  <dd>
                    {session.ordinaryTonnageKg == null
                      ? (uk ? "лише зовнішня вага" : "external weight only")
                      : `${session.ordinaryTonnageKg} kg`}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        )}

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Програма" : "Program"}</h2>
              <p>
                {uk
                  ? "Зміна програми — історична корекція, шаблон не змінюється"
                  : "Changing program is a historical correction; templates stay intact"}
              </p>
            </div>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => setShowProgramPicker((value) => !value)}
            >
              {uk ? "Змінити програму" : "Change program"}
            </button>
          </div>
          {showProgramPicker && (
            <div className={styles.panelBody}>
              <label className={styles.field}>
                <span>
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(event) => setShowArchived(event.target.checked)}
                  />
                  {" "}
                  {uk ? "Показати архівні" : "Show archived"}
                </span>
              </label>
              <div className={styles.setFields}>
                <label className={styles.field}>
                  <span>{uk ? "Програма" : "Program"}</span>
                  <select value={programId} onChange={(event) => setProgramId(Number(event.target.value))}>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.name}
                        {program.archivedAt ? (uk ? " (архів)" : " (archived)") : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>{uk ? "Версія" : "Version"}</span>
                  <select value={versionId} onChange={(event) => setVersionId(Number(event.target.value))}>
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        v{version.versionNumber}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className={styles.formActions}>
                <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void changeProgram()}>
                  {uk ? "Застосувати" : "Apply"}
                </button>
              </div>
            </div>
          )}
        </section>

        {exercises.map((exercise) => {
          const draft = draftFor(exercise);
          const sets = exercise.sets.slice().sort((a, b) => a.setNumber - b.setNumber);
          return (
            <section className={styles.panel} key={exercise.id}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>{exercise.snapshotExerciseName}</h2>
                  <p>
                    {resistanceLabel(exercise.resistanceType, uk)}
                    {" · "}
                    {uk ? `план ${exercise.plannedSets}` : `planned ${exercise.plannedSets}`}
                    {exercise.origin === EXERCISE_ORIGIN.EXTRA
                      ? (uk ? " · додаткова" : " · extra")
                      : ""}
                  </p>
                </div>
                <button
                  className={styles.textButton}
                  type="button"
                  disabled={busy}
                  onClick={() => void removeExercise(exercise)}
                >
                  {uk ? "Видалити" : "Remove"}
                </button>
              </div>
              <div className={styles.panelBody}>
                <div className={styles.setList}>
                  {sets.length === 0 ? (
                    <div className={styles.empty}>
                      <span>{uk ? "Підходів ще немає." : "No sets yet."}</span>
                    </div>
                  ) : sets.map((set) => (
                    <article className={styles.setCard} key={set.id}>
                      <header>
                        <strong>{uk ? `Підхід ${set.setNumber}` : `Set ${set.setNumber}`}</strong>
                        <div className={styles.rowActions}>
                          <button
                            className={styles.textButton}
                            type="button"
                            onClick={() => {
                              setEditingSet({ exerciseId: exercise.id, set });
                              setDraftByExercise((current) => ({
                                ...current,
                                [exercise.id]: {
                                  reps: String(set.reps),
                                  weightKg: set.weightKg == null ? "" : String(set.weightKg),
                                  bandNominalResistanceKg: set.bandNominalResistanceKg == null
                                    ? ""
                                    : String(set.bandNominalResistanceKg),
                                },
                              }));
                            }}
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
                        </div>
                      </header>
                      <p className={styles.cardMeta}>
                        {set.reps} {uk ? "повт." : "reps"}
                        {exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && set.weightKg != null
                          ? ` · ${set.weightKg} kg`
                          : null}
                        {exercise.resistanceType === RESISTANCE.RESISTANCE_BAND
                          && set.bandNominalResistanceKg != null
                          ? ` · ${set.bandNominalResistanceKg} ${uk ? "кг резинки" : "kg band"}`
                          : null}
                      </p>
                    </article>
                  ))}
                </div>

                <div className={styles.setFields}>
                  <label className={styles.field}>
                    <span>{uk ? "Повторення" : "Reps"}</span>
                    <input
                      inputMode="numeric"
                      value={draft.reps}
                      onChange={(event) => setDraftByExercise((current) => ({
                        ...current,
                        [exercise.id]: { ...draft, reps: event.target.value },
                      }))}
                    />
                  </label>
                  {exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && (
                    <label className={styles.field}>
                      <span>{uk ? "Вага, кг" : "Weight, kg"}</span>
                      <input
                        inputMode="decimal"
                        value={draft.weightKg}
                        onChange={(event) => setDraftByExercise((current) => ({
                          ...current,
                          [exercise.id]: { ...draft, weightKg: event.target.value },
                        }))}
                      />
                    </label>
                  )}
                  {exercise.resistanceType === RESISTANCE.RESISTANCE_BAND && (
                    <label className={styles.field}>
                      <span>{uk ? "Опір резинки, кг" : "Band resistance, kg"}</span>
                      <input
                        inputMode="decimal"
                        value={draft.bandNominalResistanceKg}
                        onChange={(event) => setDraftByExercise((current) => ({
                          ...current,
                          [exercise.id]: { ...draft, bandNominalResistanceKg: event.target.value },
                        }))}
                      />
                    </label>
                  )}
                </div>
                <div className={styles.formActions}>
                  {editingSet?.exerciseId === exercise.id && (
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() => {
                        setEditingSet(null);
                        setDraftByExercise((current) => ({
                          ...current,
                          [exercise.id]: emptyDraft(exercise.resistanceType),
                        }));
                      }}
                    >
                      {uk ? "Скасувати" : "Cancel"}
                    </button>
                  )}
                  <button
                    className={styles.primaryButton}
                    type="button"
                    disabled={busy}
                    onClick={() => void saveSet(exercise)}
                  >
                    {editingSet?.exerciseId === exercise.id
                      ? (uk ? "Оновити підхід" : "Update set")
                      : (uk ? "Додати підхід" : "Add set")}
                  </button>
                </div>
              </div>
            </section>
          );
        })}

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Додати вправу" : "Add exercise"}</h2>
              <p>{uk ? "Лише до цієї сесії, шаблон програми не змінюється" : "Session-only; program template unchanged"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.setFields}>
              <label className={styles.field}>
                <span>{uk ? "З каталогу" : "From catalog"}</span>
                <select
                  value={addCatalogId}
                  onChange={(event) => setAddCatalogId(Number(event.target.value))}
                >
                  <option value="">{uk ? "Оберіть…" : "Choose…"}</option>
                  {catalog.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>{uk ? "Опір" : "Resistance"}</span>
                <select
                  value={addResistance}
                  onChange={(event) => setAddResistance(event.target.value as ResistanceType)}
                >
                  <option value={RESISTANCE.EXTERNAL_WEIGHT}>{resistanceLabel(RESISTANCE.EXTERNAL_WEIGHT, uk)}</option>
                  <option value={RESISTANCE.RESISTANCE_BAND}>{resistanceLabel(RESISTANCE.RESISTANCE_BAND, uk)}</option>
                  <option value={RESISTANCE.BODYWEIGHT}>{resistanceLabel(RESISTANCE.BODYWEIGHT, uk)}</option>
                </select>
              </label>
            </div>
            <div className={styles.formActions}>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={busy || typeof addCatalogId !== "number"}
                onClick={() => void addExercise()}
              >
                {uk ? "Додати вправу" : "Add exercise"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
