"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import {
  RESISTANCE,
  SESSION_STATUS,
  type ResistanceType,
} from "@/modules/training/training.constants";
import type {
  ExerciseCatalogDto,
  StrengthSessionDto,
  StrengthSessionExerciseDto,
  StrengthSetDto,
  TrainingProgramSummaryDto,
} from "@/modules/training/training.types";
import {
  indexOfExerciseId,
  neighborExerciseId,
  resolveFocusedExerciseId,
} from "../../../exercise-pager";
import { shouldHandleKeyboardExerciseNav } from "../../../horizontal-swipe";
import { readApiError, resistanceLabel } from "../../../training-labels";
import {
  emptySetDraft,
  TrainingExerciseWorkspace,
} from "../../../training-exercise-workspace";
import styles from "../../../training.module.css";

type MenuPanel = "closed" | "root" | "program" | "add" | "editExercise" | "reorder";

export function SessionEditClient({ sessionId }: { sessionId: number }) {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const [session, setSession] = useState<StrengthSessionDto | null>(null);
  const [catalog, setCatalog] = useState<ExerciseCatalogDto[]>([]);
  const [programs, setPrograms] = useState<TrainingProgramSummaryDto[]>([]);
  const [focusedExerciseId, setFocusedExerciseId] = useState<number | null>(null);
  const [programId, setProgramId] = useState<number | "">("");
  const [menu, setMenu] = useState<MenuPanel>("closed");
  const [addCatalogId, setAddCatalogId] = useState<number | "">("");
  const [addResistance, setAddResistance] = useState<ResistanceType>(RESISTANCE.EXTERNAL_WEIGHT);
  const [editPlannedSets, setEditPlannedSets] = useState("3");
  const [editResistance, setEditResistance] = useState<ResistanceType>(RESISTANCE.EXTERNAL_WEIGHT);
  const [draft, setDraft] = useState(emptySetDraft());
  const [editingSet, setEditingSet] = useState<StrengthSetDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slideDir, setSlideDir] = useState<"none" | "left" | "right">("none");
  const slideTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (slideTimerRef.current != null) window.clearTimeout(slideTimerRef.current);
  }, []);

  const applySession = useCallback((next: StrengthSessionDto, preferId: number | null = focusedExerciseId) => {
    const ordered = next.exercises.slice().sort((a, b) => a.order - b.order);
    const nextFocus = resolveFocusedExerciseId(ordered, preferId);
    setSession(next);
    setProgramId(next.programId);
    setFocusedExerciseId(nextFocus);
    setEditingSet(null);
    setDraft(emptySetDraft());
  }, [focusedExerciseId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [sessionRes, catalogRes, programsRes] = await Promise.all([
        fetch(`/api/v1/training/sessions/${sessionId}`, { cache: "no-store" }),
        fetch("/api/v1/training/exercises", { cache: "no-store" }),
        fetch("/api/v1/training/programs", { cache: "no-store" }),
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
      setCatalog(catalogBody.exercises);
      setPrograms(programsBody.programs);
      applySession(sessionBody.session, focusedExerciseId);
    } catch {
      setError(uk ? "Не вдалося завантажити редактор." : "Could not load the editor.");
    } finally {
      setLoading(false);
    }
  }, [applySession, focusedExerciseId, sessionId, uk]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
    setEditingSet(null);
    setMenu("closed");
    setError(null);
    setDraft(emptySetDraft());
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
      applySession(body.session, focusedExerciseId);
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
    const next = await mutate(`/api/v1/training/sessions/${sessionId}/program`, {
      method: "POST",
      body: JSON.stringify({ programId }),
    });
    if (next) setMenu("closed");
  }

  async function deleteDiary() {
    const ok = window.confirm(
      uk
        ? "Видалити запис щоденника? Garmin workout залишиться без змін."
        : "Delete this diary entry? The Garmin workout will stay unchanged.",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${sessionId}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      router.push("/training/backfill");
    } catch {
      setError(uk ? "Не вдалося видалити запис." : "Could not delete the diary entry.");
    } finally {
      setBusy(false);
    }
  }

  async function addExercise() {
    if (typeof addCatalogId !== "number") return;
    const next = await mutate(`/api/v1/training/sessions/${sessionId}/exercises`, {
      method: "POST",
      body: JSON.stringify({
        catalogId: addCatalogId,
        plannedSets: 3,
        resistanceType: addResistance,
      }),
    });
    if (next) {
      const ordered = next.exercises.slice().sort((a, b) => a.order - b.order);
      const created = ordered[ordered.length - 1];
      if (created) {
        setFocusedExerciseId(created.id);
        setDraft(emptySetDraft());
      }
      setAddCatalogId("");
      setMenu("closed");
    }
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
    const next = await mutate(`/api/v1/training/sessions/${sessionId}/exercises/${exercise.id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm: hasSets }),
    });
    if (next) setMenu("closed");
  }

  async function saveExerciseMeta() {
    if (!current) return;
    const planned = Number(editPlannedSets);
    if (!Number.isFinite(planned) || planned < 1) {
      setError(uk ? "Вкажіть кількість підходів." : "Enter planned sets.");
      return;
    }
    const resistanceChanged = editResistance !== current.resistanceType;
    const next = await mutate(`/api/v1/training/sessions/${sessionId}/exercises/${current.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        plannedSets: planned,
        resistanceType: editResistance,
        ...(resistanceChanged && current.sets.length > 0
          ? { confirmResistanceChange: true }
          : {}),
      }),
    });
    if (next) setMenu("closed");
  }

  async function moveExercise(delta: -1 | 1) {
    if (!current || exercises.length < 2) return;
    const ids = exercises.map((exercise) => exercise.id);
    const index = ids.indexOf(current.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    const nextIds = ids.slice();
    const [moved] = nextIds.splice(index, 1);
    nextIds.splice(target, 0, moved!);
    await mutate(`/api/v1/training/sessions/${sessionId}/exercises`, {
      method: "PATCH",
      body: JSON.stringify({ exerciseIds: nextIds }),
    });
  }

  async function saveSet() {
    if (!current) return;
    const reps = Number(draft.reps);
    if (!Number.isFinite(reps) || reps < 1) {
      setError(uk ? "Вкажіть повторення." : "Enter reps.");
      return;
    }
    const payload: Record<string, unknown> = {
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
      const weight = Number(draft.weightKg);
      if (!Number.isFinite(weight) || weight <= 0) {
        setError(uk ? "Вкажіть вагу." : "Enter weight.");
        return;
      }
      payload.weightKg = weight;
    }
    if (current.resistanceType === RESISTANCE.RESISTANCE_BAND) {
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
      const response = editingSet
        ? await fetch(`/api/v1/training/sessions/${sessionId}/sets/${editingSet.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        : await fetch(`/api/v1/training/sessions/${sessionId}/exercises/${current.id}/sets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      const detail = await fetch(`/api/v1/training/sessions/${sessionId}`, { cache: "no-store" });
      if (detail.ok) {
        const body = await detail.json() as { session: StrengthSessionDto };
        applySession(body.session, current.id);
      }
      setEditingSet(null);
      setDraft(emptySetDraft());
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
      const detail = await fetch(`/api/v1/training/sessions/${sessionId}`, { cache: "no-store" });
      if (detail.ok) {
        const body = await detail.json() as { session: StrengthSessionDto };
        applySession(body.session, focusedExerciseId);
      }
    } catch {
      setError(uk ? "Не вдалося видалити підхід." : "Could not delete set.");
    } finally {
      setBusy(false);
    }
  }

  if (sessionId < 1 || loading) {
    return (
      <main className={styles.workoutShell}>
        <p className={styles.cardMeta}>{uk ? "Завантаження…" : "Loading…"}</p>
      </main>
    );
  }

  if (!session || !current) {
    return (
      <main className={styles.workoutShell}>
        {error && <div className={styles.errorBanner} role="alert">{error}</div>}
        <Link className={styles.liveBack} href="/training/backfill">{uk ? "← Назад" : "← Back"}</Link>
      </main>
    );
  }

  const canPrev = exerciseIndex > 0;
  const canNext = exerciseIndex < exercises.length - 1;

  const menuContent = (
    <>
      {menu === "root" && (
        <div className={styles.editMenuList}>
          <button type="button" className={styles.editMenuItem} onClick={() => setMenu("program")}>
            {uk ? "Змінити програму" : "Change program"}
          </button>
          <button
            type="button"
            className={styles.editMenuItem}
            onClick={() => {
              setAddCatalogId("");
              setAddResistance(RESISTANCE.EXTERNAL_WEIGHT);
              setMenu("add");
            }}
          >
            {uk ? "Додати вправу" : "Add exercise"}
          </button>
          <button
            type="button"
            className={styles.editMenuItem}
            onClick={() => {
              setEditPlannedSets(String(current.plannedSets));
              setEditResistance(current.resistanceType);
              setMenu("editExercise");
            }}
          >
            {uk ? "Редагувати вправу" : "Edit exercise"}
          </button>
          <button type="button" className={styles.editMenuItem} onClick={() => setMenu("reorder")}>
            {uk ? "Змінити порядок" : "Reorder"}
          </button>
          <Link className={styles.editMenuItem} href={`/training/sessions/${session.id}`}>
            {uk ? "Деталі сесії" : "Session details"}
          </Link>
          <button
            type="button"
            className={styles.editMenuDanger}
            disabled={busy}
            onClick={() => void removeExercise(current)}
          >
            {uk ? "Видалити вправу" : "Delete exercise"}
          </button>
          {session.status !== SESSION_STATUS.ACTIVE && (
            <button
              type="button"
              className={styles.editMenuDanger}
              disabled={busy}
              onClick={() => void deleteDiary()}
            >
              {uk ? "Видалити запис" : "Delete diary"}
            </button>
          )}
        </div>
      )}
      {menu === "program" && (
        <div className={styles.editMenuForm}>
          <label className={styles.liveField}>
            <span>{uk ? "Програма" : "Program"}</span>
            <select value={programId} onChange={(event) => setProgramId(Number(event.target.value))}>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>{program.name}</option>
              ))}
            </select>
          </label>
          <div className={styles.editMenuActions}>
            <button type="button" className={styles.liveSecondary} onClick={() => setMenu("root")}>
              {uk ? "Назад" : "Back"}
            </button>
            <button type="button" className={styles.liveSave} disabled={busy} onClick={() => void changeProgram()}>
              {uk ? "Застосувати" : "Apply"}
            </button>
          </div>
        </div>
      )}
      {menu === "add" && (
        <div className={styles.editMenuForm}>
          <label className={styles.liveField}>
            <span>{uk ? "З каталогу" : "From catalog"}</span>
            <select value={addCatalogId} onChange={(event) => setAddCatalogId(Number(event.target.value))}>
              <option value="">{uk ? "Оберіть…" : "Choose…"}</option>
              {catalog.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.liveField}>
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
          <div className={styles.editMenuActions}>
            <button type="button" className={styles.liveSecondary} onClick={() => setMenu("root")}>
              {uk ? "Назад" : "Back"}
            </button>
            <button
              type="button"
              className={styles.liveSave}
              disabled={busy || typeof addCatalogId !== "number"}
              onClick={() => void addExercise()}
            >
              {uk ? "Додати" : "Add"}
            </button>
          </div>
        </div>
      )}
      {menu === "editExercise" && (
        <div className={styles.editMenuForm}>
          <label className={styles.liveField}>
            <span>{uk ? "Заплановані підходи" : "Planned sets"}</span>
            <input inputMode="numeric" value={editPlannedSets} onChange={(event) => setEditPlannedSets(event.target.value)} />
          </label>
          <label className={styles.liveField}>
            <span>{uk ? "Тип опору" : "Resistance"}</span>
            <select
              value={editResistance}
              onChange={(event) => setEditResistance(event.target.value as ResistanceType)}
            >
              <option value={RESISTANCE.EXTERNAL_WEIGHT}>{resistanceLabel(RESISTANCE.EXTERNAL_WEIGHT, uk)}</option>
              <option value={RESISTANCE.RESISTANCE_BAND}>{resistanceLabel(RESISTANCE.RESISTANCE_BAND, uk)}</option>
              <option value={RESISTANCE.BODYWEIGHT}>{resistanceLabel(RESISTANCE.BODYWEIGHT, uk)}</option>
            </select>
          </label>
          <div className={styles.editMenuActions}>
            <button type="button" className={styles.liveSecondary} onClick={() => setMenu("root")}>
              {uk ? "Назад" : "Back"}
            </button>
            <button type="button" className={styles.liveSave} disabled={busy} onClick={() => void saveExerciseMeta()}>
              {uk ? "Зберегти" : "Save"}
            </button>
          </div>
        </div>
      )}
      {menu === "reorder" && (
        <div className={styles.editMenuForm}>
          <div className={styles.editMenuActions}>
            <button type="button" className={styles.liveSecondary} disabled={!canPrev || busy} onClick={() => void moveExercise(-1)}>
              {uk ? "← Вище" : "← Earlier"}
            </button>
            <button type="button" className={styles.liveSecondary} disabled={!canNext || busy} onClick={() => void moveExercise(1)}>
              {uk ? "Нижче →" : "Later →"}
            </button>
          </div>
          <button type="button" className={styles.liveSecondary} onClick={() => setMenu("root")}>
            {uk ? "Назад" : "Back"}
          </button>
        </div>
      )}
    </>
  );

  return (
    <TrainingExerciseWorkspace
      uk={uk}
      mode="edit"
      sessionId={sessionId}
      backHref="/training/backfill"
      programName={session.programName}
      exercise={current}
      exerciseIndex={exerciseIndex}
      exerciseCount={exercises.length}
      draft={draft}
      editingSetId={editingSet?.id ?? null}
      busy={busy}
      error={error}
      slideDir={slideDir}
      menuOpen={menu !== "closed"}
      onToggleMenu={() => setMenu((value) => (value === "closed" ? "root" : "closed"))}
      onCloseMenu={() => setMenu("closed")}
      menuContent={menuContent}
      desktopPrimaryActions={(
        <>
          <button type="button" className={styles.workoutDesktopActionBtn} onClick={() => setMenu("program")}>
            {uk ? "Змінити програму" : "Change program"}
          </button>
          <button
            type="button"
            className={styles.workoutDesktopActionBtn}
            onClick={() => {
              setAddCatalogId("");
              setAddResistance(RESISTANCE.EXTERNAL_WEIGHT);
              setMenu("add");
            }}
          >
            {uk ? "Додати вправу" : "Add exercise"}
          </button>
          <button
            type="button"
            className={styles.workoutDesktopActionBtn}
            onClick={() => {
              setEditPlannedSets(String(current.plannedSets));
              setEditResistance(current.resistanceType);
              setMenu("editExercise");
            }}
          >
            {uk ? "Редагувати вправу" : "Edit exercise"}
          </button>
          <button type="button" className={styles.workoutDesktopActionBtn} onClick={() => setMenu("reorder")}>
            {uk ? "Порядок" : "Reorder"}
          </button>
          <Link className={styles.workoutDesktopActionBtn} href={`/training/sessions/${session.id}`}>
            {uk ? "Деталі" : "Details"}
          </Link>
        </>
      )}
      desktopDangerActions={(
        <>
          <button
            type="button"
            className={styles.workoutDesktopDangerBtn}
            disabled={busy}
            onClick={() => void removeExercise(current)}
          >
            {uk ? "Видалити вправу" : "Delete exercise"}
          </button>
          {session.status !== SESSION_STATUS.ACTIVE && (
            <button
              type="button"
              className={styles.workoutDesktopDangerBtn}
              disabled={busy}
              onClick={() => void deleteDiary()}
            >
              {uk ? "Видалити запис" : "Delete diary"}
            </button>
          )}
        </>
      )}
      onPrev={() => goToNeighbor(-1)}
      onNext={() => goToNeighbor(1)}
      onDraftChange={setDraft}
      onSaveSet={() => void saveSet()}
      onBeginEditSet={(set) => {
        setEditingSet(set);
        setDraft({
          reps: String(set.reps),
          weightKg: set.weightKg == null ? "" : String(set.weightKg),
          bandNominalResistanceKg: set.bandNominalResistanceKg == null
            ? ""
            : String(set.bandNominalResistanceKg),
          rir: set.rir == null ? "" : String(set.rir),
          comment: set.comment ?? "",
        });
      }}
      onCancelEditSet={() => {
        setEditingSet(null);
        setDraft(emptySetDraft());
      }}
      onDeleteSet={(setId) => void deleteSet(setId)}
    />
  );
}
