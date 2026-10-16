"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import {
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
  TRAINING_LIMITS,
  recommendedResistanceTypeForCatalogStableKey,
  type ResistanceType,
} from "@/modules/training/training.constants";
import { parseTrainingDecimal } from "@/modules/training/parse-training-decimal";
import { setExecutionOverrideV1Schema } from "@/modules/training/load-accounting-v1";
import { sessionPlanCompletion } from "@/modules/training/session-plan-completion";
import { shouldAutoAdvanceAfterSet } from "@/modules/training/auto-advance";
import type {
  ExerciseCatalogDto,
  MatchCandidateDto,
  StrengthSessionDto,
  StrengthSetDto,
} from "@/modules/training/training.types";
import {
  exerciseSearchValue,
  indexOfExerciseId,
  neighborExerciseId,
  parseExerciseSearchParam,
  resolveFocusedExerciseId,
} from "../../exercise-pager";
import {
  formatClock,
  formatDateTime,
  formatDurationMinutes,
  formatLoadKg,
  formatSelectedActiveEnergyText,
  formatTrainingKcal,
  formatSetCompletionClock,
  matchStatusLabel,
  planCompletionPillClass,
  readApiError,
  resistanceLabel,
  setCompletionTimestampIso,
  trainingSessionTitle,
} from "../../training-labels";
import {
  emptySetDraft,
  TrainingExerciseWorkspace,
} from "../../training-exercise-workspace";
import { SessionAccountingPanel } from "../../session-accounting-panel";
import { safeTrainingReturnHref } from "../../training-url-state";
import styles from "../../training.module.css";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + stableJson(item)).join(",") + "}";
  }
  return JSON.stringify(value) ?? "undefined";
}

function setMatchesSavePayload(set: StrengthSetDto, payload: Record<string, unknown>): boolean {
  const persisted = set as unknown as Record<string, unknown>;
  return Object.entries(payload).every(([key, value]) => stableJson(persisted[key]) === stableJson(value));
}

export function SessionClient({ sessionId }: { sessionId: number }) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnHref = safeTrainingReturnHref(searchParams.get("returnTo"), "/training");
  const sessionContextHref = `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
  const [session, setSession] = useState<StrengthSessionDto | null>(null);
  const [focusedExerciseId, setFocusedExerciseId] = useState<number | null>(null);
  const [draft, setDraft] = useState(emptySetDraft());
  const [editingSetId, setEditingSetId] = useState<number | null>(null);
  const [additionalLoadDirtySetId, setAdditionalLoadDirtySetId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidateDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshingAccounting, setRefreshingAccounting] = useState(false);
  const [accountingError, setAccountingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exercisePickerOpen, setExercisePickerOpen] = useState(false);
  const [exercisePickerError, setExercisePickerError] = useState<string | null>(null);
  const [exerciseCatalog, setExerciseCatalog] = useState<ExerciseCatalogDto[]>([]);
  const [catalogExerciseId, setCatalogExerciseId] = useState<number | "">("");
  const [newExerciseResistance, setNewExerciseResistance] = useState<ResistanceType>(RESISTANCE.EXTERNAL_WEIGHT);
  const [loadingExerciseCatalog, setLoadingExerciseCatalog] = useState(false);
  const [finishOffer, setFinishOffer] = useState(false);
  const [autoAdvanceNonce, setAutoAdvanceNonce] = useState(0);
  const saveInFlightRef = useRef(false);
  const detailRequestIdRef = useRef(0);
  const finishInFlightRef = useRef(false);
  const finishOfferedRef = useRef(false);
  const exercisePickerRequestIdRef = useRef(0);
  const exercisePickerOpenerRef = useRef<HTMLButtonElement | null>(null);
  const exercisePickerDialogRef = useRef<HTMLDivElement | null>(null);
  const exercisePickerCancelRef = useRef<HTMLButtonElement | null>(null);
  const restoreExercisePickerFocusRef = useRef(false);

  const load = useCallback(async () => {
    if (saveInFlightRef.current) return;
    const requestId = ++detailRequestIdRef.current;
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${sessionId}`, { cache: "no-store" });
      if (!response.ok) {
        if (requestId !== detailRequestIdRef.current || saveInFlightRef.current) return;
        const apiError = await readApiError(response, uk);
        if (requestId !== detailRequestIdRef.current || saveInFlightRef.current) return;
        setError(apiError);
        setSession(null);
        return;
      }
      const body = await response.json() as { session: StrengthSessionDto };
      if (requestId !== detailRequestIdRef.current || saveInFlightRef.current) return;
      const ordered = body.session.exercises.slice().sort((a, b) => a.order - b.order);
      const urlIndex = parseExerciseSearchParam(searchParams.get("exercise"), ordered.length);
      setSession(body.session);
      setFocusedExerciseId((current) => resolveFocusedExerciseId(
        ordered,
        current ?? ordered[urlIndex]?.id ?? null,
      ));
    } catch {
      if (requestId === detailRequestIdRef.current && !saveInFlightRef.current) {
        setError(uk ? "Не вдалося завантажити сесію." : "Could not load the session.");
      }
    } finally {
      if (requestId === detailRequestIdRef.current && !saveInFlightRef.current) setLoading(false);
    }
  }, [searchParams, sessionId, uk]);

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
  const previousExercise = exerciseIndex > 0 ? exercises[exerciseIndex - 1] ?? null : null;
  const nextExercise = exerciseIndex < exercises.length - 1 ? exercises[exerciseIndex + 1] ?? null : null;
  const completion = sessionPlanCompletion(exercises);

  useEffect(() => {
    if (exercisePickerOpen) {
      restoreExercisePickerFocusRef.current = false;
      exercisePickerCancelRef.current?.focus();
      return;
    }
    if (restoreExercisePickerFocusRef.current) {
      restoreExercisePickerFocusRef.current = false;
      if (exercisePickerOpenerRef.current?.isConnected) exercisePickerOpenerRef.current.focus();
    }
  }, [exercisePickerOpen]);

  function goToNeighbor(delta: -1 | 1) {
    const nextId = neighborExerciseId(exercises, focusedExerciseId, delta);
    if (nextId == null) return;
    setFocusedExerciseId(nextId);
    setEditingSetId(null);
    setAdditionalLoadDirtySetId(null);
    setDraft(emptySetDraft());
    setMenuOpen(false);
    setError(null);
  }

  useEffect(() => {
    if (!session || session.status !== SESSION_STATUS.ACTIVE || exercises.length === 0) return;
    const next = exerciseSearchValue(exerciseIndex);
    if (searchParams.get("exercise") === next) return;
    const query = new URLSearchParams(searchParams.toString());
    query.set("exercise", next);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }, [exerciseIndex, exercises.length, pathname, router, searchParams, session]);

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
    if (!session || !current || saveInFlightRef.current) return;
    const reps = Number(draft.reps);
    if (!Number.isFinite(reps) || reps < 1) {
      setError(uk ? "Вкажіть кількість повторень." : "Enter reps.");
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
    const editingSet = current.sets.find((set) => set.id === editingSetId);
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
      additionalLoadChanged = (editingSetId === null || additionalLoadDirtySetId === editingSetId)
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
    if ((editingSetId !== null && parsedExistingOverride.success) || draft.asymmetricRepsEnabled || additionalLoadChanged) {
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
      const weightKg = parseTrainingDecimal(draft.weightKg);
      if (!Number.isFinite(weightKg) || weightKg <= 0) {
        setError(uk ? "Вкажіть вагу (кг)." : "Enter weight (kg).");
        return;
      }
      payload.weightKg = weightKg;
      payload.bandNominalResistanceKg = null;
    } else if (current.resistanceType === RESISTANCE.RESISTANCE_BAND) {
      const band = parseTrainingDecimal(draft.bandNominalResistanceKg);
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
    const adding = editingSetId === null;
    const nextSetNumber = adding
      ? Math.max(0, ...current.sets.map((set) => set.setNumber)) + 1
      : undefined;
    if (nextSetNumber !== undefined) payload.setNumber = nextSetNumber;
    const lastExercise = exerciseIndex >= exercises.length - 1;
    const completedPlannedExercise = adding
      && current.origin === "PLANNED"
      && current.plannedSets > 0
      && current.sets.length + 1 >= current.plannedSets
      && current.sets.length < current.plannedSets;

    saveInFlightRef.current = true;
    detailRequestIdRef.current += 1;
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
        const apiError = await readApiError(response, uk);
        if (response.status === 409 || response.status >= 500) {
          const detail = await fetch("/api/v1/training/sessions/" + session.id, { cache: "no-store" });
          if (detail.ok) {
            const body = await detail.json() as { session: StrengthSessionDto };
            setSession(body.session);
            const refreshedExercise = body.session.exercises.find((exercise) => exercise.id === current.id);
            const candidates = refreshedExercise?.sets ?? [];
            const persisted = adding
              ? candidates.find((set) => !current.sets.some((prior) => prior.id === set.id)
                && set.setNumber === nextSetNumber
                && setMatchesSavePayload(set, payload)) ?? null
              : candidates.find((set) => set.id === editingSetId
                && set.updatedAt !== editingSet?.updatedAt
                && setMatchesSavePayload(set, payload)) ?? null;
            if (persisted) {
              setDraft(emptySetDraft());
              setEditingSetId(null);
              setAdditionalLoadDirtySetId(null);
              if (shouldAutoAdvanceAfterSet({ enabled: session.autoAdvanceExercises === true, adding, exerciseOrigin: current.origin, plannedSets: current.plannedSets, previousSetCount: current.sets.length, isLastExercise: lastExercise })) {
                setAutoAdvanceNonce((value) => value + 1);
              } else if (completedPlannedExercise && lastExercise && !finishOfferedRef.current) {
                finishOfferedRef.current = true;
                setFinishOffer(true);
              }
              return;
            }
          }
        }
        setError(apiError);
        return;
      }
      const body = await response.json() as {
        set: StrengthSetDto;
      };
      if (!body.set || !Number.isSafeInteger(body.set.id)) throw new Error("training_set_response_missing");
      setSession((previous) => previous ? {
        ...previous,
        exercises: previous.exercises.map((exercise) => exercise.id !== current.id ? exercise : {
          ...exercise,
          sets: adding
            ? [...exercise.sets.filter((set) => set.id !== body.set.id), body.set]
            : exercise.sets.map((set) => set.id === body.set.id ? body.set : set),
        }),
      } : previous);
      setDraft(emptySetDraft());
      setEditingSetId(null);
      setAdditionalLoadDirtySetId(null);
      if (shouldAutoAdvanceAfterSet({ enabled: session.autoAdvanceExercises === true, adding, exerciseOrigin: current.origin, plannedSets: current.plannedSets, previousSetCount: current.sets.length, isLastExercise: lastExercise })) {
        setAutoAdvanceNonce((value) => value + 1);
      } else if (completedPlannedExercise && lastExercise && !finishOfferedRef.current) {
        finishOfferedRef.current = true;
        setFinishOffer(true);
      }
    } catch {
      try {
        const detail = await fetch("/api/v1/training/sessions/" + session.id, { cache: "no-store" });
        if (detail.ok) {
          const body = await detail.json() as { session: StrengthSessionDto };
          setSession(body.session);
          const refreshedExercise = body.session.exercises.find((exercise) => exercise.id === current.id);
          const candidates = refreshedExercise?.sets ?? [];
          const persisted = adding
            ? candidates.find((set) => !current.sets.some((prior) => prior.id === set.id)
              && set.setNumber === nextSetNumber
              && setMatchesSavePayload(set, payload)) ?? null
            : candidates.find((set) => set.id === editingSetId
              && set.updatedAt !== editingSet?.updatedAt
              && setMatchesSavePayload(set, payload)) ?? null;
          if (persisted) {
            setDraft(emptySetDraft());
            setEditingSetId(null);
            setAdditionalLoadDirtySetId(null);
            if (shouldAutoAdvanceAfterSet({ enabled: session.autoAdvanceExercises === true, adding, exerciseOrigin: current.origin, plannedSets: current.plannedSets, previousSetCount: current.sets.length, isLastExercise: lastExercise })) {
              setAutoAdvanceNonce((value) => value + 1);
            } else if (completedPlannedExercise && lastExercise && !finishOfferedRef.current) {
              finishOfferedRef.current = true;
              setFinishOffer(true);
            }
            return;
          }
        }
      } catch {
        // Keep the draft and never repeat the mutation automatically.
      }
      setError(uk
        ? "Не вдалося підтвердити збереження підходу. Перевірте сесію перед повторною спробою."
        : "Could not confirm the set save. Check the session before trying again.");
    } finally {
      setBusy(false);
      saveInFlightRef.current = false;
    }
  }

  function closeExercisePicker() {
    exercisePickerRequestIdRef.current += 1;
    restoreExercisePickerFocusRef.current = true;
    setExercisePickerOpen(false);
    setLoadingExerciseCatalog(false);
    setExercisePickerError(null);
  }

  async function openExercisePicker(opener: HTMLButtonElement) {
    exercisePickerOpenerRef.current = opener;
    restoreExercisePickerFocusRef.current = false;
    setExercisePickerOpen(true);
    setExercisePickerError(null);
    const requestId = ++exercisePickerRequestIdRef.current;
    if (exerciseCatalog.length > 0) {
      setLoadingExerciseCatalog(false);
      return;
    }
    setLoadingExerciseCatalog(true);
    try {
      const response = await fetch("/api/v1/training/exercises", { cache: "no-store" });
      if (!response.ok) {
        const message = await readApiError(response, uk);
        if (requestId !== exercisePickerRequestIdRef.current) return;
        setExercisePickerError(message);
        return;
      }
      const body = await response.json() as { exercises: ExerciseCatalogDto[] };
      if (requestId !== exercisePickerRequestIdRef.current) return;
      setExerciseCatalog(body.exercises);
    } catch {
      if (requestId !== exercisePickerRequestIdRef.current) return;
      setExercisePickerError(uk ? "Не вдалося завантажити каталог вправ." : "Could not load the exercise catalog.");
    } finally {
      if (requestId === exercisePickerRequestIdRef.current) setLoadingExerciseCatalog(false);
    }
  }

  function handleExercisePickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeExercisePicker();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.closest("[hidden]"));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  async function addCatalogExercise() {
    if (!session || typeof catalogExerciseId !== "number") return;
    setBusy(true);
    setError(null);
    try {
      const before = new Set(session.exercises.map((exercise) => exercise.id));
      const response = await fetch(`/api/v1/training/sessions/${session.id}/exercises`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          catalogId: catalogExerciseId,
          plannedSets: session.programId === null ? 0 : 3,
          resistanceType: newExerciseResistance,
        }),
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      const body = await response.json() as { session: StrengthSessionDto };
      setSession(body.session);
      const added = body.session.exercises.find((exercise) => !before.has(exercise.id));
      setFocusedExerciseId(added?.id ?? body.session.exercises[0]?.id ?? null);
      closeExercisePicker();
      setCatalogExerciseId("");
    } catch {
      setError(uk ? "Не вдалося додати вправу." : "Could not add the exercise.");
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
    const parsedOverride = setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
    const asymmetricReps = parsedOverride.success ? parsedOverride.data.reps : undefined;
    setAdditionalLoadDirtySetId(null);
    setEditingSetId(set.id);
    setDraft({
      reps: String(set.reps),
      asymmetricRepsEnabled: asymmetricReps !== undefined,
      leftReps: asymmetricReps ? String(asymmetricReps.left) : "",
      rightReps: asymmetricReps ? String(asymmetricReps.right) : "",
      weightKg: set.weightKg === null ? "" : String(set.weightKg),
      additionalLoadKg: parsedOverride.success && (parsedOverride.data.additionalLoadKg ?? 0) > 0
        ? String(parsedOverride.data.additionalLoadKg)
        : "",
      bandNominalResistanceKg: set.bandNominalResistanceKg === null
        ? ""
        : String(set.bandNominalResistanceKg),
      rir: set.rir === null ? "" : String(set.rir),
      comment: set.comment ?? "",
    });
  }

  async function finishSession(skipConfirm = false) {
    if (!session || finishInFlightRef.current) return;
    if (!skipConfirm && !window.confirm(uk ? "Завершити тренування?" : "Finish this workout?")) return;
    finishInFlightRef.current = true;
    setFinishOffer(false);
    setBusy(true);
    setError(null);
    const completedReturnHref = (publicationStatus?: string): string => {
      const destination = new URL(returnHref, window.location.origin);
      destination.searchParams.delete("finishPublication");
      if (destination.pathname === "/training") {
        destination.searchParams.set("programsRefresh", String(Date.now()));
      }
      if (publicationStatus === "stale" || publicationStatus === "not-run") {
        destination.searchParams.set("finishPublication", "stale");
      } else if (publicationStatus === "unknown") {
        destination.searchParams.set("finishPublication", "unknown");
      }
      return `${destination.pathname}${destination.search}${destination.hash}`;
    };
    const routeToCompletedSession = (completed: StrengthSessionDto, publicationStatus?: string): boolean => {
      if (completed.status !== SESSION_STATUS.COMPLETED) return false;
      setSession(completed);
      router.push(completedReturnHref(publicationStatus));
      return true;
    };
    const readCompletedSession = async (publicationStatus?: string): Promise<boolean> => {
      const detail = await fetch(`/api/v1/training/sessions/${session.id}`, { cache: "no-store" });
      if (!detail.ok) return false;
      const body = await detail.json() as { session?: StrengthSessionDto; modelPublicationStatus?: string };
      return body.session ? routeToCompletedSession(body.session, publicationStatus ?? body.modelPublicationStatus ?? "unknown") : false;
    };
    try {
      const response = await fetch(`/api/v1/training/sessions/${session.id}/finish`, { method: "POST" });
      if (!response.ok) {
        const errorBody = await response.clone().json().catch(() => null) as { modelPublicationStatus?: string } | null;
        const apiError = await readApiError(response, uk);
        if (response.status === 409 || response.status >= 500) {
          try {
            if (await readCompletedSession(errorBody?.modelPublicationStatus)) return;
          } catch {
            // A read failure cannot establish that the finish committed.
          }
        }
        setError(apiError);
        return;
      }
      const body = await response.json() as { session?: StrengthSessionDto; modelPublicationStatus?: string };
      if (body.session && routeToCompletedSession(body.session, body.modelPublicationStatus ?? "unknown")) return;
      if (await readCompletedSession()) return;
      setError(uk
        ? "Не вдалося підтвердити завершення. Перевірте стан тренування перед повторною спробою."
        : "Could not confirm that the workout finished. Check its status before trying again.");
    } catch {
      try {
        if (await readCompletedSession()) return;
      } catch {
        // Keep the outcome unknown and never repeat the finish mutation.
      }
      setError(uk
        ? "Не вдалося підтвердити завершення. Перевірте стан тренування перед повторною спробою."
        : "Could not confirm that the workout finished. Check its status before trying again.");
    } finally {
      setBusy(false);
      finishInFlightRef.current = false;
    }
  }

  async function runAccountingAction(mode: "materialize" | "refresh") {
    if (!session) return;
    setRefreshingAccounting(true);
    setAccountingError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${session.id}/accounting/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `ui-${mode}-${session.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }),
      });
      if (!response.ok) {
        setAccountingError(await readApiError(response, uk));
        return;
      }
      const body = await response.json() as { session: StrengthSessionDto };
      setSession(body.session);
      setError(null);
    } catch {
      setAccountingError(mode === "refresh"
        ? (uk ? "Не вдалося оновити облік." : "Could not refresh accounting.")
        : (uk ? "Не вдалося створити знімок обліку." : "Could not create accounting snapshot."));
    } finally {
      setRefreshingAccounting(false);
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
      router.push(returnHref);
    } catch {
      setError(uk ? "Не вдалося скасувати тренування." : "Could not cancel the workout.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCancelledSession() {
    if (!session || session.status !== SESSION_STATUS.CANCELLED) return;
    if (!window.confirm(
      uk
        ? "Назавжди видалити запис BodyCast разом із вправами, підходами та знімками обліку? Зіставлені записи тренувань Garmin та Apple Health залишаться без змін."
        : "Permanently delete this BodyCast diary session, including its exercises, sets, and accounting snapshots? Matched Garmin and Apple Health workout records will remain unchanged.",
    )) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/sessions/${session.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      router.push(returnHref);
    } catch {
      setError(uk ? "Не вдалося видалити скасоване тренування." : "Could not delete the cancelled workout.");
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
      <main className={`${styles.page} ${styles.sessionDetailPage}`}>
        <p className={styles.cardMeta}>{uk ? "Завантаження…" : "Loading…"}</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className={`${styles.page} ${styles.sessionDetailPage}`}>
        <div className={styles.navRow}>
          <strong>BodyCast</strong>
          <AppNav active="training" />
        </div>
        {error && <div className={styles.errorBanner} role="alert">{error}</div>}
        <Link className={styles.linkLike} href={returnHref}>{uk ? "До тренувань" : "Back to training"}</Link>
      </main>
    );
  }

  if (session.status === SESSION_STATUS.ACTIVE && !current) {
    return (
      <main className={`${styles.page} ${styles.sessionDetailPage} ${styles.workoutShell}`}>
        <div className={styles.navRow} inert={exercisePickerOpen}>
          <strong>BodyCast</strong>
          <AppNav active="training" />
        </div>
        <header className={styles.header} inert={exercisePickerOpen}>
          <div>
            <p className={styles.eyebrow}>{uk ? "Активне тренування" : "Active workout"}</p>
            <h1>{trainingSessionTitle(session.programName, uk)}</h1>
            <p className={styles.intro}>
              {uk ? "Додавайте вправи з каталогу — тренування збережеться автоматично." : "Add exercises from the catalog — the workout is saved automatically."}
            </p>
          </div>
          <Link className={styles.secondaryButton} href={returnHref}>{uk ? "Назад" : "Back"}</Link>
        </header>
        {error && <div className={styles.errorBanner} role="alert" inert={exercisePickerOpen}>{error}</div>}
        <section className={styles.panel}>
          <div className={styles.panelBody}>
            <div className={styles.denseCardActions} inert={exercisePickerOpen}>
              <button className={styles.liveSave} type="button" disabled={busy} onClick={(event) => void openExercisePicker(event.currentTarget)}>
                {uk ? "Додати вправу" : "Add exercise"}
              </button>
              <button className={styles.liveSecondary} type="button" disabled={busy} onClick={() => void finishSession()}>
                {uk ? "Завершити тренування" : "Finish workout"}
              </button>
              <button className={styles.editMenuDanger} type="button" disabled={busy} onClick={() => void cancelSession()}>
                {uk ? "Скасувати тренування" : "Cancel workout"}
              </button>
            </div>
            {exercisePickerOpen && (
              <div
                className={styles.workoutFinishDialog}
                role="presentation"
                onKeyDown={handleExercisePickerKeyDown}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div ref={exercisePickerDialogRef} className={styles.workoutFinishCard} role="dialog" aria-modal="true" aria-labelledby="add-exercise-title" tabIndex={-1}>
                  <h2 id="add-exercise-title">{uk ? "Додати вправу" : "Add exercise"}</h2>
                  {loadingExerciseCatalog ? (
                    <p role="status">{uk ? "Завантаження каталогу…" : "Loading catalog…"}</p>
                  ) : (
                    <div className={styles.editMenuForm}>
                      <label className={styles.liveField}>
                        <span>{uk ? "Вправа з каталогу" : "Catalog exercise"}</span>
                        <select
                          value={catalogExerciseId}
                          onChange={(event) => {
                            const nextId = event.target.value === "" ? "" : Number(event.target.value);
                            setCatalogExerciseId(nextId);
                            const selected = exerciseCatalog.find((item) => item.id === nextId);
                            setNewExerciseResistance(recommendedResistanceTypeForCatalogStableKey(selected?.stableKey));
                          }}
                        >
                          <option value="">{uk ? "Оберіть вправу…" : "Choose an exercise…"}</option>
                          {exerciseCatalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                      </label>
                      <label className={styles.liveField}>
                        <span>{uk ? "Тип опору" : "Resistance type"}</span>
                        <select value={newExerciseResistance} onChange={(event) => setNewExerciseResistance(event.target.value as ResistanceType)}>
                          <option value={RESISTANCE.EXTERNAL_WEIGHT}>{resistanceLabel(RESISTANCE.EXTERNAL_WEIGHT, uk)}</option>
                          <option value={RESISTANCE.RESISTANCE_BAND}>{resistanceLabel(RESISTANCE.RESISTANCE_BAND, uk)}</option>
                          <option value={RESISTANCE.BODYWEIGHT}>{resistanceLabel(RESISTANCE.BODYWEIGHT, uk)}</option>
                        </select>
                      </label>
                    </div>
                  )}
                  {exercisePickerError && <p role="alert">{exercisePickerError}</p>}
                  <div className={styles.denseCardActions}>
                    <button ref={exercisePickerCancelRef} className={styles.liveSecondary} type="button" onClick={closeExercisePicker}>
                      {uk ? "Скасувати" : "Cancel"}
                    </button>
                    {!loadingExerciseCatalog && (
                      <button className={styles.liveSave} type="button" disabled={busy || typeof catalogExerciseId !== "number"} onClick={() => void addCatalogExercise()}>
                        {uk ? "Додати вправу" : "Add exercise"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
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
        backHref={returnHref}
        programName={trainingSessionTitle(session.programName, uk)}
        exercise={current}
        previousExercise={previousExercise}
        nextExercise={nextExercise}
        exerciseIndex={exerciseIndex}
        exerciseCount={exercises.length}
        draft={draft}
        editingSetId={editingSetId}
        busy={busy}
        error={error}
        clockStartedAt={session.webStartedAt}
        clockEndedAt={session.webEndedAt}
        clockTicking
        autoAdvanceNonce={autoAdvanceNonce}
        inertBackground={exercisePickerOpen}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((value) => !value)}
        onCloseMenu={() => setMenuOpen(false)}
        menuContent={(
          <div className={styles.editMenuList}>
            <button
              type="button"
              className={styles.editMenuItem}
              disabled={busy}
              onClick={(event) => void openExercisePicker(event.currentTarget)}
            >
              {uk ? "Додати вправу" : "Add exercise"}
            </button>
            <button
              type="button"
              className={styles.editMenuItem}
              disabled={busy}
              onClick={() => void finishSession()}
            >
              {uk ? "Завершити тренування" : "Finish workout"}
            </button>
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
        onDraftChange={(nextDraft) => {
          if (editingSetId !== null && nextDraft.additionalLoadKg !== draft.additionalLoadKg) {
            setAdditionalLoadDirtySetId(editingSetId);
          }
          setDraft(nextDraft);
        }}
        onSaveSet={() => void saveSet()}
        onBeginEditSet={beginEdit}
        onCancelEditSet={() => {
          setEditingSetId(null);
          setAdditionalLoadDirtySetId(null);
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
        finishDialog={(
          <>
          {exercisePickerOpen && (
            <div
              className={styles.workoutFinishDialog}
              role="presentation"
              onKeyDown={handleExercisePickerKeyDown}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div ref={exercisePickerDialogRef} className={styles.workoutFinishCard} role="dialog" aria-modal="true" aria-labelledby="add-exercise-title" tabIndex={-1}>
                <h2 id="add-exercise-title">{uk ? "Додати вправу" : "Add exercise"}</h2>
                {loadingExerciseCatalog ? (
                  <p role="status">{uk ? "Завантаження каталогу…" : "Loading catalog…"}</p>
                ) : (
                  <div className={styles.editMenuForm}>
                    <label className={styles.liveField}>
                      <span>{uk ? "Вправа з каталогу" : "Catalog exercise"}</span>
                      <select
                        value={catalogExerciseId}
                        onChange={(event) => {
                          const nextId = event.target.value === "" ? "" : Number(event.target.value);
                          setCatalogExerciseId(nextId);
                          const selected = exerciseCatalog.find((item) => item.id === nextId);
                          setNewExerciseResistance(recommendedResistanceTypeForCatalogStableKey(selected?.stableKey));
                        }}
                      >
                        <option value="">{uk ? "Оберіть вправу…" : "Choose an exercise…"}</option>
                        {exerciseCatalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                    <label className={styles.liveField}>
                      <span>{uk ? "Тип опору" : "Resistance type"}</span>
                      <select value={newExerciseResistance} onChange={(event) => setNewExerciseResistance(event.target.value as ResistanceType)}>
                        <option value={RESISTANCE.EXTERNAL_WEIGHT}>{resistanceLabel(RESISTANCE.EXTERNAL_WEIGHT, uk)}</option>
                        <option value={RESISTANCE.RESISTANCE_BAND}>{resistanceLabel(RESISTANCE.RESISTANCE_BAND, uk)}</option>
                        <option value={RESISTANCE.BODYWEIGHT}>{resistanceLabel(RESISTANCE.BODYWEIGHT, uk)}</option>
                      </select>
                    </label>
                  </div>
                )}
                {exercisePickerError && <p role="alert">{exercisePickerError}</p>}
                <div className={styles.workoutFinishActions}>
                  <button ref={exercisePickerCancelRef} className={styles.liveSecondary} type="button" onClick={closeExercisePicker}>
                    {uk ? "Скасувати" : "Cancel"}
                  </button>
                  {!loadingExerciseCatalog && (
                    <button className={styles.liveSave} type="button" disabled={busy || typeof catalogExerciseId !== "number"} onClick={() => void addCatalogExercise()}>
                      {uk ? "Додати" : "Add"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {finishOffer && (
          <div className={styles.workoutFinishDialog} role="presentation">
            <div className={styles.workoutFinishCard} role="dialog" aria-labelledby="finish-offer-title">
              <h2 id="finish-offer-title">
                {uk ? "Завершити тренування?" : "Finish this workout?"}
              </h2>
              <p>
                {completion.percent == null
                  ? (uk ? "Немає запланованих підходів." : "No planned sets.")
                  : (uk
                    ? `Виконано ${completion.percent}% плану (${completion.loggedSets} / ${completion.plannedSets} підходів).`
                    : `${completion.percent}% of the plan (${completion.loggedSets} / ${completion.plannedSets} sets).`)}
              </p>
              {completion.incompleteExercises.length > 0 && (
                <>
                  <p>{uk ? "Є вправи з меншою кількістю підходів, ніж у плані:" : "Some exercises have fewer sets than planned:"}</p>
                  <ul>
                    {completion.incompleteExercises.map((item) => (
                      <li key={item.name}>{item.name}: {item.loggedSets}/{item.plannedSets}</li>
                    ))}
                  </ul>
                </>
              )}
              <div className={styles.workoutFinishActions}>
                <button
                  className={styles.liveSecondary}
                  type="button"
                  onClick={() => setFinishOffer(false)}
                >
                  {uk ? "Ще потренуюсь" : "Keep training"}
                </button>
                <button
                  className={styles.liveSave}
                  type="button"
                  disabled={busy}
                  onClick={() => void finishSession(true)}
                >
                  {uk ? "Завершити" : "Finish"}
                </button>
              </div>
            </div>
          </div>
          )}
          </>
        )}
      />
    );
  }

  return (
    <main className={`${styles.page} ${styles.sessionDetailPage}`}>
      <div className={styles.navRow}>
        <strong>BodyCast</strong>
        <AppNav active="training" />
      </div>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Сесія щоденника" : "Diary session"}</p>
          <h1>{trainingSessionTitle(session.programName, uk)}</h1>
          <p className={styles.intro}>
            <span>
              {formatDateTime(session.matchedWorkout?.startAt ?? session.webStartedAt, intlLocale)}
              {" · "}
              {formatDurationMinutes(
                session.matchedWorkout?.startAt ?? session.webStartedAt,
                session.matchedWorkout?.endAt ?? session.webEndedAt,
                intlLocale,
                uk,
              )}
            </span>
            {completion.percent != null && (
              <span className={planCompletionPillClass(completion.percent, styles)}>
                {uk
                  ? `${completion.percent}% плану (${completion.loggedSets}/${completion.plannedSets})`
                  : `${completion.percent}% of plan (${completion.loggedSets}/${completion.plannedSets})`}
              </span>
            )}
          </p>
        </div>
        <div className={styles.rowActions}>
          {(session.status === SESSION_STATUS.COMPLETED || session.status === SESSION_STATUS.CANCELLED) && (
            <Link className={styles.secondaryButton} href={`/training/sessions/${session.id}/edit?exercise=${exerciseIndex + 1}&returnTo=${encodeURIComponent(sessionContextHref)}`}>
              {uk ? "Редагувати" : "Edit"}
            </Link>
          )}
          {session.status === SESSION_STATUS.CANCELLED && (
            <button
              className={styles.dangerButton}
              type="button"
              disabled={busy}
              onClick={() => void deleteCancelledSession()}
            >
              {uk ? "Видалити" : "Delete"}
            </button>
          )}
          <Link className={styles.secondaryButton} href={returnHref}>{uk ? "Назад" : "Back"}</Link>
        </div>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={`${styles.stack} ${styles.sessionDetailStack}`}>
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
                <div>
                  <dt>{uk ? "Обрана активна енергія" : "Selected active energy"}</dt>
                  <dd>
                    {session.selectedActiveEnergy === undefined
                      ? "—"
                      : formatSelectedActiveEnergyText({
                        kcal: session.selectedActiveEnergy.kcal,
                        source: session.selectedActiveEnergy.source,
                        fullCoverage: session.selectedActiveEnergy.fullCoverage,
                        uk,
                      })}
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
                        : `${formatTrainingKcal(session.matchedWorkout.activeEnergyKcal, intlLocale)} ${uk ? "оцінка/пристрій" : "estimated/device"}`}
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

        <div className={styles.sessionDetailBody}>
        <section className={`${styles.panel} ${styles.sessionMatchPanel}`}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Ручне зіставлення" : "Manual match"}</h2>
              <p>{uk ? "Кандидати біля часу сесії" : "Candidates near the session window"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {session.matchStatus === MATCH_STATUS.MATCHED ? (
              <p className={styles.cardMeta}>
                {uk ? "Garmin уже зіставлено з цим записом." : "Garmin is already matched to this entry."}
              </p>
            ) : candidates.length === 0 ? (
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
                          ? ` · ${formatTrainingKcal(candidate.activeEnergyKcal, intlLocale)} ${uk ? "ккал (оцінка)" : "kcal (estimate)"}`
                          : ""}
                      </p>
                    </div>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={busy}
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

        <section className={`${styles.panel} ${styles.sessionExercisesPanel}`}>
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
                    <ul className={styles.historicalSetList}>
                      {exercise.sets
                        .slice()
                        .sort((a, b) => a.setNumber - b.setNumber)
                        .map((set) => {
                          const parsedOverride = setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
                          const additionalLoadKg = parsedOverride.success
                            ? parsedOverride.data.additionalLoadKg
                            : undefined;
                          const load = exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && set.weightKg !== null
                            ? `${set.weightKg}kg`
                            : exercise.resistanceType === RESISTANCE.RESISTANCE_BAND && set.bandNominalResistanceKg !== null
                              ? `${set.bandNominalResistanceKg}kg band`
                              : exercise.resistanceType === RESISTANCE.BODYWEIGHT
                                ? additionalLoadKg !== undefined && additionalLoadKg > 0
                                  ? `${uk ? "власна вага" : "bodyweight"} +${formatLoadKg(additionalLoadKg, intlLocale)} ${uk ? "кг" : "kg"}`
                                  : (uk ? "власна вага" : "bodyweight")
                                : "";
                          const clockIso = setCompletionTimestampIso(set);
                          return (
                            <li className={styles.historicalSetRow} key={set.id}>
                              <span>
                                {`#${set.setNumber} ${set.reps}${load ? `×${load}` : ""}`}
                              </span>
                              {clockIso ? (
                                <time className={styles.liveSetClock} dateTime={clockIso}>
                                  {formatSetCompletionClock(set, intlLocale)}
                                </time>
                              ) : (
                                <span className={styles.liveSetClock}>
                                  {uk ? "час недоступний" : "time unavailable"}
                                </span>
                              )}
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
        </div>
        <SessionAccountingPanel
          session={session}
          uk={uk}
          onMaterialize={() => void runAccountingAction("materialize")}
          onRefresh={() => void runAccountingAction("refresh")}
          refreshing={refreshingAccounting}
          error={accountingError}
        />
      </div>
    </main>
  );
}
