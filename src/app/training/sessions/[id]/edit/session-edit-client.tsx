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
  type SetDraft,
} from "../../../training-exercise-workspace";
import { safeTrainingReturnHref } from "../../../training-url-state";
import styles from "../../../training.module.css";

type MenuPanel = "closed" | "root" | "program" | "add" | "editExercise" | "reorder";

type PendingSetVerification =
  | { kind: "create"; exerciseId: number; setNumber: number; payload: Record<string, unknown>; draft: SetDraft }
  | { kind: "update"; exerciseId: number; setId: number; original: StrengthSetDto; payload: Record<string, unknown>; draft: SetDraft }
  | { kind: "delete"; exerciseId: number; setId: number };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function setMatchesMutation(
  set: StrengthSetDto,
  payload: Record<string, unknown>,
  omittedOverrideMeansNull = false,
): boolean {
  if (payload.setNumber !== undefined && set.setNumber !== payload.setNumber) return false;
  if (payload.reps !== undefined && set.reps !== payload.reps) return false;
  if (payload.weightKg !== undefined) {
    const expected = payload.weightKg === null ? null : Math.round(Number(payload.weightKg) * 100) / 100;
    if (set.weightKg !== expected) return false;
  }
  if (payload.bandNominalResistanceKg !== undefined) {
    const expected = payload.bandNominalResistanceKg === null
      ? null
      : Math.round(Number(payload.bandNominalResistanceKg) * 100) / 100;
    if (set.bandNominalResistanceKg !== expected) return false;
  }
  if (payload.rir !== undefined && set.rir !== payload.rir) return false;
  if (payload.comment !== undefined && set.comment !== payload.comment) return false;
  if (payload.loadAccountingOverride !== undefined
      && stableJson(set.loadAccountingOverride ?? null) !== stableJson(payload.loadAccountingOverride)) return false;
  if (omittedOverrideMeansNull && payload.loadAccountingOverride === undefined
      && set.loadAccountingOverride !== null) return false;
  return true;
}

function pendingCreateStorageKey(sessionId: number): string {
  return `bodycast:pending-set-create:${sessionId}`;
}

function readPendingCreate(sessionId: number): PendingSetVerification | null {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(pendingCreateStorageKey(sessionId)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PendingSetVerification>;
    if (candidate.kind !== "create" || !Number.isInteger(candidate.exerciseId) || !Number.isInteger(candidate.setNumber)
        || candidate.setNumber! < 1 || !candidate.payload || typeof candidate.payload !== "object"
        || !candidate.draft || typeof candidate.draft !== "object") return null;
    return candidate as PendingSetVerification;
  } catch {
    return null;
  }
}

function storePendingCreate(sessionId: number, action: PendingSetVerification): boolean {
  if (action.kind !== "create") return true;
  try {
    window.sessionStorage.setItem(pendingCreateStorageKey(sessionId), JSON.stringify(action));
    return true;
  } catch {
    return false;
  }
}

function clearPendingCreate(sessionId: number): void {
  try {
    window.sessionStorage.removeItem(pendingCreateStorageKey(sessionId));
  } catch {
    // Storage can be unavailable in private or restricted browsing contexts.
  }
}

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
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingSetVerification, setPendingSetVerification] = useState<PendingSetVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [setMutationRevision, setSetMutationRevision] = useState(0);
  const [setMutationPersisted, setSetMutationPersisted] = useState(false);
  const sessionActionsBlocked = busy || pendingSetVerification !== null;

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
  }, [focusedExerciseId, searchParams, setSession, setProgramId, setFocusedExerciseId, setEditingSet, setAdditionalLoadDirtySetId, setDraft]);

  const load = useCallback(async () => {
    const pendingCreate = readPendingCreate(sessionId);
    if (!pendingCreate) setError(null);
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
      if (!pendingCreate) setError(null);
    } catch {
      setError(uk ? "Не вдалося завантажити редактор." : "Could not load the editor.");
    } finally {
      setLoading(false);
    }
  }, [applySession, focusedExerciseId, sessionId, uk, setError, setSession, setCatalog, setPrograms, setLoading]);

  useEffect(() => {
    const pending = readPendingCreate(sessionId);
    if (!pending) return;
    // Restore the durable ambiguous-create marker before re-enabling session writes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingSetVerification(pending);
    setError(uk
      ? "Попереднє додавання підходу не підтверджене. Перевірте його стан перед новим записом."
      : "A previous set addition is unconfirmed. Check its status before creating another set.");
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
    ? `/training/backfill?refresh=${session.revision}-${encodeURIComponent(session.updatedAt)}-${setMutationRevision}`
    : "/training/backfill";
  const returnHref = safeTrainingReturnHref(requestedReturnHref, backfillHref);
  const sessionDetailHref = session
    ? `/training/sessions/${session.id}?exercise=${exerciseIndex + 1}&returnTo=${encodeURIComponent(returnHref)}`
    : "/training";

  function goToNeighbor(delta: -1 | 1) {
    if (busy || pendingSetVerification) return;
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
    if (sessionActionsBlocked) return null;
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
    if (sessionActionsBlocked) return;
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
    if (sessionActionsBlocked) return;
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
    if (sessionActionsBlocked) return;
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
    if (sessionActionsBlocked) return;
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
    if (sessionActionsBlocked) return;
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

  async function readCurrentSession(): Promise<StrengthSessionDto> {
    const response = await fetch(`/api/v1/training/sessions/${sessionId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not verify the saved session.");
    const body = await response.json() as { session?: StrengthSessionDto };
    if (!body.session || body.session.id !== sessionId) throw new Error("The session verification response was invalid.");
    return body.session;
  }

  function observePersistedMutation(action: PendingSetVerification): () => void {
    if (session?.status !== SESSION_STATUS.COMPLETED) return () => undefined;
    let cancelled = false;
    void (async () => {
      for (const delayMs of [180, 420, 900]) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        if (cancelled) return;
        let fresh: StrengthSessionDto;
        try {
          fresh = await readCurrentSession();
        } catch {
          continue;
        }
        if (cancelled) return;
        const exercise = fresh.exercises.find((candidate) => candidate.id === action.exerciseId);
        let committed = false;
        if (action.kind === "create") {
          const saved = exercise?.sets.find((set) => set.setNumber === action.setNumber);
          committed = saved !== undefined && setMatchesMutation(saved, action.payload, true);
        } else if (action.kind === "update") {
          const saved = exercise?.sets.find((set) => set.id === action.setId);
          committed = saved !== undefined
            && stableJson(saved) !== stableJson(action.original)
            && setMatchesMutation(saved, action.payload);
        } else {
          committed = !exercise?.sets.some((set) => set.id === action.setId);
        }
        if (!committed) continue;
        setSession(fresh);
        setProgramId(fresh.programId);
        setSetMutationRevision((revision) => revision + 1);
        setSetMutationPersisted(true);
        const verb = action.kind === "delete"
          ? (uk ? "Підхід видалено" : "Set deleted")
          : (uk ? "Підхід збережено" : "Set saved");
        setNotice(uk
          ? `${verb}. Чекаємо на підтвердження оновлення моделі.`
          : `${verb}. Waiting for model refresh confirmation.`);
        if (action.kind === "create" || action.kind === "update") {
          setDraft(emptySetDraft());
          setEditingSet(null);
          setAdditionalLoadDirtySetId(null);
        }
        return;
      }
    })();
    return () => { cancelled = true; };
  }

  async function responsePublicationStatus(response: Response): Promise<string | undefined> {
    try {
      const body = await response.clone().json() as { modelPublicationStatus?: unknown };
      return typeof body.modelPublicationStatus === "string" ? body.modelPublicationStatus : undefined;
    } catch {
      return undefined;
    }
  }

  function showMutationNotice(status: string | undefined, requestFailed = false, action: "saved" | "deleted" | "present" = "saved") {
    const verb = action === "deleted"
      ? (uk ? "Підхід видалено" : "Set deleted")
      : action === "present"
        ? (uk ? "Підхід уже є в історії" : "The set is already present")
        : (uk ? "Підхід збережено" : "Set saved");
    setNotice(status === "stale" || status === "not-run"
      ? `${verb}${uk ? ", але публікація моделі ще не актуальна." : ", but model publication is not current yet."}`
      : requestFailed
        ? `${verb}${uk ? ". Стан публікації моделі не вдалося підтвердити." : ". Model publication status could not be confirmed."}`
        : null);
  }

  async function reconcileSetMutation(
    action: PendingSetVerification,
    publicationStatus?: string,
    requestSucceeded = false,
  ): Promise<"satisfied" | "not-committed" | "unknown"> {
    let fresh: StrengthSessionDto;
    try {
      fresh = await readCurrentSession();
    } catch {
      setNotice(null);
      if (action.kind === "update") {
        setEditingSet(action.original);
        setDraft(action.draft);
      }
      setPendingSetVerification(action);
      setError(uk
        ? "Не вдалося підтвердити збереження. Перевірте стан перед повторною спробою."
        : "Could not confirm the save. Check its status before trying again.");
      return "unknown";
    }

    setSession(fresh);
    setProgramId(fresh.programId);
    const exercise = fresh.exercises.find((candidate) => candidate.id === action.exerciseId);
    let outcome: "satisfied" | "not-committed" | "unknown" = "unknown";
    if (action.kind === "create") {
      const existing = exercise?.sets.find((set) => set.setNumber === action.setNumber);
      if (existing && setMatchesMutation(existing, action.payload, true)) outcome = "satisfied";
      else if (existing) outcome = "unknown";
      else if (exercise) outcome = "not-committed";
    } else {
      const saved = exercise?.sets.find((set) => set.id === action.setId);
      if (action.kind === "update") {
        if (saved && setMatchesMutation(saved, action.payload)) {
          outcome = "satisfied";
        } else if (saved && stableJson(saved) === stableJson(action.original)) {
          outcome = "not-committed";
        }
      } else if (!saved) {
        outcome = "satisfied";
      } else {
        outcome = "not-committed";
      }
    }

    if (outcome === "satisfied") {
      setSetMutationRevision((revision) => revision + 1);
      applySession(fresh, action.exerciseId);
      setPendingSetVerification(null);
      if (action.kind === "create") clearPendingCreate(sessionId);
      setError(null);
      showMutationNotice(
        publicationStatus,
        publicationStatus === undefined,
        action.kind === "delete" ? "deleted" : action.kind === "create" && !requestSucceeded ? "present" : "saved",
      );
      return outcome;
    }
    if (outcome === "not-committed") {
      setPendingSetVerification(null);
      if (action.kind === "create") {
        clearPendingCreate(sessionId);
        setDraft(action.draft);
      } else if (action.kind === "update") {
        setEditingSet(action.original);
        setDraft(action.draft);
      }
      setNotice(null);
      return outcome;
    }
    if (action.kind === "update") {
      // Keep submitted values available if another writer changed this row
      // after an early read observed our update.
      setEditingSet(action.original);
      setDraft(action.draft);
    }
    setPendingSetVerification(action);
    setError(uk
      ? "Стан підходу змінився паралельно або результат невідомий. Перевірте стан перед повторною спробою."
      : "The set changed concurrently or its outcome is unknown. Check its status before trying again.");
    return outcome;
  }

  async function verifyPendingSetMutation() {
    if (!pendingSetVerification || busy) return;
    setBusy(true);
    try {
      const status = await reconcileSetMutation(pendingSetVerification);
      if (status === "not-committed") {
        setError(uk ? "Зміни не збережено. Чернетку залишено для повторної спроби." : "The change was not saved. Your draft is ready to retry.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveSet() {
    if (!current || pendingSetVerification || busy) return;
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
    if (!editingSet) {
      payload.setNumber = current.sets.reduce((max, set) => Math.max(max, set.setNumber), 0) + 1;
    }

    setSetMutationPersisted(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    const action: PendingSetVerification = editingSet
      ? { kind: "update", exerciseId: current.id, setId: editingSet.id, original: editingSet, payload, draft: { ...draft } }
      : { kind: "create", exerciseId: current.id, setNumber: payload.setNumber as number, payload, draft: { ...draft } };
    if (action.kind === "create" && !storePendingCreate(sessionId, action)) {
      setBusy(false);
      setError(uk
        ? "Не вдалося безпечно зберегти стан запиту в цій вкладці. Підхід не відправлено."
        : "Could not safely retain this request state in the tab. The set was not sent.");
      return;
    }
    const stopPersistedObserver = observePersistedMutation(action);
    try {
      const response = await (editingSet
        ? fetch(`/api/v1/training/sessions/${sessionId}/sets/${editingSet.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        : fetch(`/api/v1/training/sessions/${sessionId}/exercises/${current.id}/sets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }));
      stopPersistedObserver();
      const publicationStatus = await responsePublicationStatus(response);
      if (!response.ok) {
        const apiError = await readApiError(response, uk);
        const outcome = await reconcileSetMutation(action, publicationStatus);
        if (outcome === "not-committed") setError(apiError);
        return;
      }
      const outcome = await reconcileSetMutation(action, publicationStatus, true);
      if (outcome === "not-committed") {
        setError(uk
          ? "Сервер підтвердив запит, але не вдалося підтвердити збереження. Чернетку залишено."
          : "The server accepted the request, but the saved state could not be confirmed. Your draft was kept.");
      }
    } catch {
      stopPersistedObserver();
      const outcome = await reconcileSetMutation(action);
      if (outcome === "not-committed") {
        setError(uk ? "Не вдалося зберегти підхід." : "Could not save set.");
      }
    } finally {
      stopPersistedObserver();
      setBusy(false);
      setSetMutationPersisted(false);
    }
  }

  async function deleteSet(setId: number) {
    if (pendingSetVerification || !current || busy) return;
    if (!window.confirm(uk ? "Видалити підхід?" : "Delete this set?")) return;
    const action: PendingSetVerification = { kind: "delete", exerciseId: current.id, setId };
    setSetMutationPersisted(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    const stopPersistedObserver = observePersistedMutation(action);
    try {
      const response = await fetch(`/api/v1/training/sessions/${sessionId}/sets/${setId}`, {
        method: "DELETE",
      });
      stopPersistedObserver();
      const publicationStatus = await responsePublicationStatus(response);
      if (!response.ok) {
        const apiError = await readApiError(response, uk);
        const outcome = await reconcileSetMutation(action, publicationStatus);
        if (outcome === "not-committed") setError(apiError);
        return;
      }
      const outcome = await reconcileSetMutation(action, publicationStatus, true);
      if (outcome === "not-committed") {
        setError(uk ? "Підхід не видалено." : "The set was not deleted.");
      }
    } catch {
      stopPersistedObserver();
      const outcome = await reconcileSetMutation(action);
      if (outcome === "not-committed") {
        setError(uk ? "Не вдалося видалити підхід." : "Could not delete set.");
      }
    } finally {
      stopPersistedObserver();
      setBusy(false);
      setSetMutationPersisted(false);
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
                <button type="button" className={styles.liveSave} disabled={sessionActionsBlocked || typeof addCatalogId !== "number"} onClick={() => void addExercise()}>
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

  const canNavigateExercises = !busy && pendingSetVerification === null;
  const canPrev = exerciseIndex > 0 && canNavigateExercises;
  const canNext = exerciseIndex < exercises.length - 1 && canNavigateExercises;
  const menuContent = (
    <>
      {menu === "root" && (
        <div className={styles.editMenuList}>
          {session.programId !== null && (
            <button type="button" className={styles.editMenuItem} disabled={sessionActionsBlocked} onClick={() => setMenu("program")}>
              {uk ? "Змінити програму" : "Change program"}
            </button>
          )}
          <button
            type="button"
            className={styles.editMenuItem}
            disabled={sessionActionsBlocked}
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
            disabled={sessionActionsBlocked}
            onClick={() => {
              setEditPlannedSets(String(current.plannedSets));
              setEditResistance(current.resistanceType);
              setMenu("editExercise");
            }}
          >
            {uk ? "Редагувати вправу" : "Edit exercise"}
          </button>
          <button type="button" className={styles.editMenuItem} disabled={sessionActionsBlocked} onClick={() => setMenu("reorder")}>
            {uk ? "Змінити порядок" : "Reorder"}
          </button>
          <Link className={styles.editMenuItem} href={sessionDetailHref}>
            {uk ? "Деталі сесії" : "Session details"}
          </Link>
          <button
            type="button"
            className={styles.editMenuDanger}
            disabled={sessionActionsBlocked}
            onClick={() => void removeExercise(current)}
          >
            {uk ? "Видалити вправу" : "Delete exercise"}
          </button>
          {session.status !== SESSION_STATUS.ACTIVE && (
            <button
              type="button"
              className={styles.editMenuDanger}
              disabled={sessionActionsBlocked}
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
            <select value={programId ?? ""} onChange={(event) => setProgramId(Number(event.target.value))} disabled={sessionActionsBlocked}>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>{program.name}</option>
              ))}
            </select>
          </label>
          <div className={styles.editMenuActions}>
            <button type="button" className={styles.liveSecondary} onClick={() => setMenu("root")}>
              {uk ? "Назад" : "Back"}
            </button>
            <button type="button" className={styles.liveSave} disabled={sessionActionsBlocked} onClick={() => void changeProgram()}>
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
              disabled={sessionActionsBlocked}
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
              disabled={sessionActionsBlocked}
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
              disabled={sessionActionsBlocked || typeof addCatalogId !== "number"}
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
            <input inputMode="numeric" min={session.programId === null ? 0 : 1} value={editPlannedSets} onChange={(event) => setEditPlannedSets(event.target.value)} disabled={session.programId === null || sessionActionsBlocked} />
          </label>
          <label className={styles.liveField}>
            <span>{uk ? "Тип опору" : "Resistance"}</span>
            <select
              value={editResistance}
              disabled={sessionActionsBlocked}
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
            <button type="button" className={styles.liveSave} disabled={sessionActionsBlocked} onClick={() => void saveExerciseMeta()}>
              {uk ? "Зберегти" : "Save"}
            </button>
          </div>
        </div>
      )}
      {menu === "reorder" && (
        <div className={styles.editMenuForm}>
          <div className={styles.editMenuActions}>
            <button type="button" className={styles.liveSecondary} disabled={!canPrev || sessionActionsBlocked} onClick={() => void moveExercise(-1)}>
              {uk ? "← Вище" : "← Earlier"}
            </button>
            <button type="button" className={styles.liveSecondary} disabled={!canNext || sessionActionsBlocked} onClick={() => void moveExercise(1)}>
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
      busyLabel={setMutationPersisted
        ? (uk ? "Зміни збережено · чекаємо модель…" : "Change saved · waiting for model…")
        : undefined}
      error={error}
      notice={notice}
      mutationUncertain={pendingSetVerification !== null}
      onVerifyPendingMutation={() => void verifyPendingSetMutation()}
      clockStartedAt={session.webStartedAt ?? session.matchedWorkout?.startAt ?? null}
      clockEndedAt={session.webEndedAt ?? session.matchedWorkout?.endAt ?? null}
      clockTicking={false}
      menuOpen={menu !== "closed"}
      onToggleMenu={() => { if (!sessionActionsBlocked) setMenu((value) => (value === "closed" ? "root" : "closed")); }}
      onCloseMenu={() => setMenu("closed")}
      menuContent={menuContent}
      desktopPrimaryActions={(
        <>
          {session.programId !== null && (
            <button type="button" className={styles.workoutDesktopActionBtn} disabled={sessionActionsBlocked} onClick={() => setMenu("program")}>
              {uk ? "Змінити програму" : "Change program"}
            </button>
          )}
          <button
            type="button"
            className={styles.workoutDesktopActionBtn}
              disabled={sessionActionsBlocked}
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
            <button type="button" className={styles.workoutDesktopActionBtn} disabled={sessionActionsBlocked} onClick={() => setMenu("reorder")}>
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
            disabled={sessionActionsBlocked}
            onClick={() => void removeExercise(current)}
          >
            {uk ? "Видалити вправу" : "Delete exercise"}
          </button>
          {session.status !== SESSION_STATUS.ACTIVE && (
            <button
              type="button"
              className={styles.workoutDesktopDangerBtn}
              disabled={sessionActionsBlocked}
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
