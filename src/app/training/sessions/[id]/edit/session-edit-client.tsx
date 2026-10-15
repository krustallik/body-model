"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import {
  recommendedResistanceTypeForCatalogStableKey,
  RESISTANCE,
  SESSION_STATUS,
  TRAINING_LIMITS,
  type ResistanceType,
} from "@/modules/training/training.constants";
import { parseTrainingDecimal } from "@/modules/training/parse-training-decimal";
import { setExecutionOverrideV1Schema } from "@/modules/training/load-accounting-v1";
import type {
  ExerciseCatalogDto,
  StrengthSessionDto,
  StrengthSessionExerciseDto,
  StrengthSetDto,
  TrainingProgramSummaryDto,
} from "@/modules/training/training.types";
import {
  exerciseSearchValue,
  indexOfExerciseId,
  neighborExerciseId,
  parseExerciseSearchParam,
  resolveFocusedExerciseId,
} from "../../../exercise-pager";
import { readApiError, resistanceLabel, trainingSessionTitle } from "../../../training-labels";
import {
  emptySetDraft,
  TrainingExerciseWorkspace,
} from "../../../training-exercise-workspace";
import { safeTrainingReturnHref } from "../../../training-url-state";
import styles from "../../../training.module.css";

type MenuPanel = "closed" | "root" | "program" | "add" | "editExercise" | "reorder";

export function SessionEditClient({ sessionId }: { sessionId: number }) {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedReturnHref = searchParams.get("returnTo");
  const [session, setSession] = useState<StrengthSessionDto | null>(null);
  const [catalog, setCatalog] = useState<ExerciseCatalogDto[]>([]);
  const [programs, setPrograms] = useState<TrainingProgramSummaryDto[]>([]);
  const [focusedExerciseId, setFocusedExerciseId] = useState<number | null>(null);
  const [programId, setProgramId] = useState<number | "" | null>("");
  const [menu, setMenu] = useState<MenuPanel>("closed");
  const [addCatalogId, setAddCatalogId] = useState<number | "">("");
  const [addResistance, setAddResistance] = useState<ResistanceType>(RESISTANCE.EXTERNAL_WEIGHT);
  const [editPlannedSets, setEditPlannedSets] = useState("3");
  const [editResistance, setEditResistance] = useState<ResistanceType>(RESISTANCE.EXTERNAL_WEIGHT);
  const [draft, setDraft] = useState(emptySetDraft());
  const [editingSet, setEditingSet] = useState<StrengthSetDto | null>(null);
  const [additionalLoadDirtySetId, setAdditionalLoadDirtySetId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((next: StrengthSessionDto, preferId: number | null = focusedExerciseId) => {
    const ordered = next.exercises.slice().sort((a, b) => a.order - b.order);
    const urlIndex = parseExerciseSearchParam(searchParams.get("exercise"), ordered.length);
    const nextFocus = resolveFocusedExerciseId(
      ordered,
      preferId ?? ordered[urlIndex]?.id ?? null,
    );
    setSession(next);
    setProgramId(next.programId);
    setFocusedExerciseId(nextFocus);
    setEditingSet(null);
    setAdditionalLoadDirtySetId(null);
    setDraft(emptySetDraft());
  }, [focusedExerciseId, searchParams, setProgramId, setFocusedExerciseId, setEditingSet, setAdditionalLoadDirtySetId, setDraft]);

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
  }, [applySession, focusedExerciseId, sessionId, uk, setError, setSession, setCatalog, setPrograms, setLoading]);

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
  const previousExercise = exerciseIndex > 0 ? exercises[exerciseIndex - 1] ?? null : null;
  const nextExercise = exerciseIndex < exercises.length - 1 ? exercises[exerciseIndex + 1] ?? null : null;
  const backfillHref = session
    ? `/training/backfill?refresh=${session.revision}-${encodeURIComponent(session.updatedAt)}`
    : "/training/backfill";
  const returnHref = safeTrainingReturnHref(requestedReturnHref, backfillHref);
  const sessionDetailHref = session
    ? `/training/sessions/${session.id}?exercise=${exerciseIndex + 1}&returnTo=${encodeURIComponent(returnHref)}`
    : "/training";

  function goToNeighbor(delta: -1 | 1) {
    const nextId = neighborExerciseId(exercises, focusedExerciseId, delta);
    if (nextId == null) return;
    setFocusedExerciseId(nextId);
    setEditingSet(null);
    setAdditionalLoadDirtySetId(null);
    setMenu("closed");
    setError(null);
    setDraft(emptySetDraft());
  }

  useEffect(() => {
    if (!session || exercises.length === 0) return;
    const next = exerciseSearchValue(exerciseIndex);
    if (searchParams.get("exercise") === next) return;
    const query = new URLSearchParams(searchParams.toString());
    query.set("exercise", next);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }, [exerciseIndex, exercises.length, pathname, router, searchParams, session]);

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
      router.push(`/training/backfill?refresh=${Date.now()}`);
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
        plannedSets: session?.programId === null ? 0 : 3,
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

  function selectCatalogExercise(catalogId: number | "") {
    setAddCatalogId(catalogId);
    const selected = catalog.find((item) => item.id === catalogId);
    setAddResistance(recommendedResistanceTypeForCatalogStableKey(selected?.stableKey));
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
    const minimumPlannedSets = session?.programId === null ? 0 : 1;
    if (!Number.isFinite(planned) || planned < minimumPlannedSets) {
      setError(uk ? "Вкажіть кількість підходів." : "Enter planned sets.");
      return;
    }
    if (session?.programId === null && planned !== 0) {
      setError(uk ? "У вільному тренуванні кількість підходів не планується." : "Free workouts do not use planned set counts.");
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
    if (draft.asymmetricRepsEnabled) {
      const left = Number(draft.leftReps);
      const right = Number(draft.rightReps);
      if (!Number.isInteger(left) || left < 0 || !Number.isInteger(right) || right < 0 || left + right === 0) {
        setError(uk ? "Вкажіть цілі повтори для обох сторін." : "Enter whole-number reps for each side.");
        return;
      }
    }
    const parsedExistingOverride = setExecutionOverrideV1Schema.safeParse(editingSet?.loadAccountingOverride);
    const originalOverride = parsedExistingOverride.success ? parsedExistingOverride.data : null;
    const originalAdditionalLoadKg = originalOverride?.additionalLoadKg;
    let additionalLoadKg: number | undefined;
    let additionalLoadChanged = false;
    if (current.resistanceType === RESISTANCE.BODYWEIGHT) {
      let requestedAdditionalLoadKg: number | undefined;
      if (draft.additionalLoadKg.trim() !== "") {
        const parsedAdditionalLoadKg = parseTrainingDecimal(draft.additionalLoadKg);
        if (!Number.isFinite(parsedAdditionalLoadKg) || parsedAdditionalLoadKg < 0) {
          setError(uk
            ? "Додаткове обтяження має бути скінченним невід’ємним числом."
            : "Additional load must be a finite non-negative number.");
          return;
        }
        if (parsedAdditionalLoadKg > 0) requestedAdditionalLoadKg = parsedAdditionalLoadKg;
      }
      additionalLoadChanged = (editingSet === null || additionalLoadDirtySetId === editingSet.id)
        && requestedAdditionalLoadKg !== originalAdditionalLoadKg;
      if (additionalLoadChanged && requestedAdditionalLoadKg !== undefined
          && requestedAdditionalLoadKg > TRAINING_LIMITS.maxLoadKg) {
        setError(uk
          ? `Максимальне додаткове обтяження — ${TRAINING_LIMITS.maxLoadKg} кг.`
          : `Maximum additional load is ${TRAINING_LIMITS.maxLoadKg} kg.`);
        return;
      }
      if (additionalLoadChanged) additionalLoadKg = requestedAdditionalLoadKg;
    }
    if (additionalLoadChanged && editingSet?.loadAccountingOverride != null && !parsedExistingOverride.success) {
      setError(uk
        ? "Не вдалося безпечно зберегти попередні налаштування цього підходу."
        : "Could not safely preserve this set's existing accounting settings.");
      return;
    }
    if (draft.asymmetricRepsEnabled && editingSet && editingSet.loadAccountingOverride != null && !parsedExistingOverride.success) {
      setError(uk ? "Не вдалося безпечно зберегти попередні налаштування цього підходу." : "Could not safely preserve this set's existing accounting settings.");
      return;
    }
    if ((editingSet !== null && parsedExistingOverride.success) || draft.asymmetricRepsEnabled || additionalLoadChanged) {
      const override = originalOverride ? { ...originalOverride } : {};
      if (draft.asymmetricRepsEnabled) {
        override.reps = {
          kind: "asymmetric-per-side",
          left: Number(draft.leftReps),
          right: Number(draft.rightReps),
        };
      } else {
        delete override.reps;
      }
      if (current.resistanceType === RESISTANCE.BODYWEIGHT) {
        if (additionalLoadChanged) {
          if (additionalLoadKg !== undefined) override.additionalLoadKg = additionalLoadKg;
          else delete override.additionalLoadKg;
        }
      }
      const validatedOverride = setExecutionOverrideV1Schema.safeParse(override);
      if (!validatedOverride.success) {
        const assistanceConflict = validatedOverride.error.issues.some((issue) => issue.path.includes("assistanceLoadKg"));
        setError(assistanceConflict
          ? (uk
            ? "Підхід не може одночасно мати додаткове обтяження та допомогу."
            : "A set cannot have both additional load and assistance.")
          : (uk
            ? "Не вдалося перевірити налаштування обліку цього підходу."
            : "Could not validate this set's accounting settings."));
        return;
      }
      const nextOverrideValue = Object.keys(validatedOverride.data).length > 0 ? validatedOverride.data : null;
      const originalOverrideValue = originalOverride && Object.keys(originalOverride).length > 0 ? originalOverride : null;
      if (JSON.stringify(nextOverrideValue) !== JSON.stringify(originalOverrideValue)) {
        payload.loadAccountingOverride = nextOverrideValue;
      }
    }
    if (payload.rir !== null) {
      if (!Number.isInteger(payload.rir) || (payload.rir as number) < 0 || (payload.rir as number) > 10) {
        setError(uk ? "RIR має бути цілим числом від 0 до 10." : "RIR must be an integer from 0 to 10.");
        return;
      }
    }
    if (current.resistanceType === RESISTANCE.EXTERNAL_WEIGHT) {
      const weight = parseTrainingDecimal(draft.weightKg);
      if (!Number.isFinite(weight) || weight <= 0) {
        setError(uk ? "Вкажіть вагу." : "Enter weight.");
        return;
      }
      payload.weightKg = weight;
    }
    if (current.resistanceType === RESISTANCE.RESISTANCE_BAND) {
      const band = parseTrainingDecimal(draft.bandNominalResistanceKg);
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
      setAdditionalLoadDirtySetId(null);
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

  if (!session) {
    return (
      <main className={styles.workoutShell}>
        {error && <div className={styles.errorBanner} role="alert">{error}</div>}
        <Link className={styles.liveBack} href="/training/backfill">{uk ? "← Назад" : "← Back"}</Link>
      </main>
    );
  }

  if (!current) {
    if (session.programId !== null) {
      return (
        <main className={styles.workoutShell}>
          {error && <div className={styles.errorBanner} role="alert">{error}</div>}
          <Link className={styles.liveBack} href={sessionDetailHref}>
            {uk ? "← До сесії" : "← Session details"}
          </Link>
        </main>
      );
    }
    return (
      <main className={`${styles.page} ${styles.sessionDetailPage} ${styles.workoutShell}`}>
        <div className={styles.navRow}><strong>BodyCast</strong><Link className={styles.linkLike} href={sessionDetailHref}>{uk ? "До сесії" : "Session details"}</Link></div>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{uk ? "Редагування вільного тренування" : "Edit free workout"}</p>
            <h1>{trainingSessionTitle(session.programName, uk)}</h1>
          </div>
        </header>
        {error && <div className={styles.errorBanner} role="alert">{error}</div>}
        <section className={styles.panel}>
          <div className={styles.panelBody}>
            <div className={styles.editMenuForm}>
              <label className={styles.liveField}>
                <span>{uk ? "Вправа з каталогу" : "Catalog exercise"}</span>
                <select value={addCatalogId} onChange={(event) => selectCatalogExercise(event.target.value === "" ? "" : Number(event.target.value))}>
                  <option value="">{uk ? "Оберіть…" : "Choose…"}</option>
                  {catalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className={styles.liveField}>
                <span>{uk ? "Тип опору" : "Resistance type"}</span>
                <select value={addResistance} onChange={(event) => setAddResistance(event.target.value as ResistanceType)}>
                  <option value={RESISTANCE.EXTERNAL_WEIGHT}>{resistanceLabel(RESISTANCE.EXTERNAL_WEIGHT, uk)}</option>
                  <option value={RESISTANCE.RESISTANCE_BAND}>{resistanceLabel(RESISTANCE.RESISTANCE_BAND, uk)}</option>
                  <option value={RESISTANCE.BODYWEIGHT}>{resistanceLabel(RESISTANCE.BODYWEIGHT, uk)}</option>
                </select>
              </label>
              <div className={styles.denseCardActions}>
                <button type="button" className={styles.liveSave} disabled={busy || typeof addCatalogId !== "number"} onClick={() => void addExercise()}>
                  {uk ? "Додати вправу" : "Add exercise"}
                </button>
                <Link className={styles.liveSecondary} href={sessionDetailHref}>
                  {uk ? "Скасувати" : "Cancel"}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const canPrev = exerciseIndex > 0;
  const canNext = exerciseIndex < exercises.length - 1;
  const menuContent = (
    <>
      {menu === "root" && (
        <div className={styles.editMenuList}>
          {session.programId !== null && (
            <button type="button" className={styles.editMenuItem} onClick={() => setMenu("program")}>
              {uk ? "Змінити програму" : "Change program"}
            </button>
          )}
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
          <Link className={styles.editMenuItem} href={sessionDetailHref}>
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
            <select value={programId ?? ""} onChange={(event) => setProgramId(Number(event.target.value))}>
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
            <select
              value={addCatalogId}
              onChange={(event) => selectCatalogExercise(
                event.target.value === "" ? "" : Number(event.target.value),
              )}
            >
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
            <span>{session.programId === null ? (uk ? "Підходи не плануються" : "No planned set count") : (uk ? "Заплановані підходи" : "Planned sets")}</span>
            <input inputMode="numeric" min={session.programId === null ? 0 : 1} value={editPlannedSets} onChange={(event) => setEditPlannedSets(event.target.value)} disabled={session.programId === null} />
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
      backHref={returnHref}
      programName={trainingSessionTitle(session.programName, uk)}
      exercise={current}
      previousExercise={previousExercise}
      nextExercise={nextExercise}
      exerciseIndex={exerciseIndex}
      exerciseCount={exercises.length}
      draft={draft}
      editingSetId={editingSet?.id ?? null}
      busy={busy}
      error={error}
      clockStartedAt={session.webStartedAt ?? session.matchedWorkout?.startAt ?? null}
      clockEndedAt={session.webEndedAt ?? session.matchedWorkout?.endAt ?? null}
      clockTicking={false}
      menuOpen={menu !== "closed"}
      onToggleMenu={() => setMenu((value) => (value === "closed" ? "root" : "closed"))}
      onCloseMenu={() => setMenu("closed")}
      menuContent={menuContent}
      desktopPrimaryActions={(
        <>
          {session.programId !== null && (
            <button type="button" className={styles.workoutDesktopActionBtn} onClick={() => setMenu("program")}>
              {uk ? "Змінити програму" : "Change program"}
            </button>
          )}
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
          <Link className={styles.workoutDesktopActionBtn} href={sessionDetailHref}>
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
      onDraftChange={(nextDraft) => {
        if (editingSet !== null && nextDraft.additionalLoadKg !== draft.additionalLoadKg) {
          setAdditionalLoadDirtySetId(editingSet.id);
        }
        setDraft(nextDraft);
      }}
      onSaveSet={() => void saveSet()}
      onBeginEditSet={(set) => {
        const parsedOverride = setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
        const asymmetricReps = parsedOverride.success ? parsedOverride.data.reps : undefined;
        setAdditionalLoadDirtySetId(null);
        setEditingSet(set);
        setDraft({
          reps: String(set.reps),
          asymmetricRepsEnabled: asymmetricReps !== undefined,
          leftReps: asymmetricReps ? String(asymmetricReps.left) : "",
          rightReps: asymmetricReps ? String(asymmetricReps.right) : "",
          weightKg: set.weightKg == null ? "" : String(set.weightKg),
          additionalLoadKg: parsedOverride.success && (parsedOverride.data.additionalLoadKg ?? 0) > 0
            ? String(parsedOverride.data.additionalLoadKg)
            : "",
          bandNominalResistanceKg: set.bandNominalResistanceKg == null
            ? ""
            : String(set.bandNominalResistanceKg),
          rir: set.rir == null ? "" : String(set.rir),
          comment: set.comment ?? "",
        });
      }}
      onCancelEditSet={() => {
        setEditingSet(null);
        setAdditionalLoadDirtySetId(null);
        setDraft(emptySetDraft());
      }}
      onDeleteSet={(setId) => void deleteSet(setId)}
    />
  );
}
