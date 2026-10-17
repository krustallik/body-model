"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type {
  ExerciseHistoryEntryDto,
  ExerciseHistorySetDto,
  StrengthSessionExerciseDto,
  StrengthSetDto,
} from "@/modules/training/training.types";
import type { UpdateSetInput } from "@/modules/training/training.schema";
import { setExecutionOverrideV1Schema } from "@/modules/training/load-accounting-v1";
import { RESISTANCE } from "@/modules/training/training.constants";
import { ExercisePane } from "./training-exercise-pane";
import {
  classifyCarouselRelease,
  isEditableSwipeTarget,
  shouldHandleKeyboardExerciseNav,
} from "./horizontal-swipe";
import { formatElapsedClock } from "./training-labels";
import styles from "./training.module.css";

export type SetDraft = {
  reps: string;
  asymmetricRepsEnabled: boolean;
  leftReps: string;
  rightReps: string;
  weightKg: string;
  additionalLoadKg: string;
  bandNominalResistanceKg: string;
  rir: string;
  comment: string;
};

export const CAROUSEL_MANUAL_MS = 220;
export const CAROUSEL_AUTOMATIC_MS = 440;
const TRAINING_HISTORY_REQUEST_TIMEOUT_MS = 8_000;

async function fetchWithHistoryTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  let rejectDeadline!: (reason: Error) => void;
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const timeout = window.setTimeout(() => {
    controller.abort();
    rejectDeadline(new Error("Training history request timed out"));
  }, TRAINING_HISTORY_REQUEST_TIMEOUT_MS);
  try {
    const response = await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      deadline,
    ]);
    const readJson = response.json.bind(response);
    Object.defineProperty(response, "json", {
      configurable: true,
      value: () => Promise.race([readJson(), deadline]).finally(() => window.clearTimeout(timeout)),
    });
    return response;
  } catch (error) {
    window.clearTimeout(timeout);
    throw error;
  }
}

/** Manual=220ms, automatic=440ms; reduced-motion disables movement (0ms). */
export function carouselDurationMs(
  mode: "manual" | "automatic",
  media: Pick<MediaQueryList, "matches"> | null = typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia("(prefers-reduced-motion: reduce)"),
): number {
  if (media?.matches === true) return 0;
  return mode === "automatic" ? CAROUSEL_AUTOMATIC_MS : CAROUSEL_MANUAL_MS;
}

type TrainingExerciseWorkspaceProps = {
  uk: boolean;
  mode: "live" | "edit";
  sessionId: number;
  backHref: string;
  programName: string;
  exercise: StrengthSessionExerciseDto;
  previousExercise?: StrengthSessionExerciseDto | null;
  nextExercise?: StrengthSessionExerciseDto | null;
  exerciseIndex: number;
  exerciseCount: number;
  draft: SetDraft;
  editingSetId: number | null;
  busy: boolean;
  busyLabel?: string;
  error: string | null;
  notice?: string | null;
  mutationUncertain?: boolean;
  mutationActionLabel?: string;
  onVerifyPendingMutation?: () => void;
  menuOpen: boolean;
  clockStartedAt?: string | null;
  clockEndedAt?: string | null;
  clockTicking?: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  /** Mobile kebab popover / desktop form panels. */
  menuContent: ReactNode;
  /** Compact primary actions shown inline on desktop (>=1024). */
  desktopPrimaryActions?: ReactNode;
  /** Destructive / rare actions shown inline (or compact group) on desktop. */
  desktopDangerActions?: ReactNode;
  /** Persisted session information rendered below the live/edit exercise carousel. */
  footerContent?: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onDraftChange: (next: SetDraft) => void;
  onSaveSet: () => void;
  onBeginEditSet: (set: StrengthSetDto) => void;
  onCancelEditSet: () => void;
  onDeleteSet: (setId: number) => void;
  trailingAction?: ReactNode;
  finishDialog?: ReactNode;
  inertBackground?: boolean;
  autoAdvanceNonce?: number;
};

export function emptySetDraft(): SetDraft {
  return {
    reps: "",
    asymmetricRepsEnabled: false,
    leftReps: "",
    rightReps: "",
    weightKg: "",
    additionalLoadKg: "",
    bandNominalResistanceKg: "",
    rir: "",
    comment: "",
  };
}

function elapsedMs(startedAt: string | null | undefined, endedAt: string | null | undefined, now: number): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return null;
  const end = endedAt ? new Date(endedAt).getTime() : now;
  if (!Number.isFinite(end)) return null;
  return end - start;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function roundLoadToDatabasePrecision(value: number): number {
  if (!Number.isFinite(value)) return value;
  const [mantissa, rawExponent] = Math.abs(value).toString().toLowerCase().split("e");
  const exponent = Number(rawExponent ?? 0);
  const [integerPart, fractionalPart = ""] = mantissa!.split(".");
  const digits = `${integerPart}${fractionalPart}`;
  const centsIndex = integerPart.length + exponent + 2;
  let cents = centsIndex <= 0
    ? "0"
    : centsIndex >= digits.length
      ? `${digits}${"0".repeat(centsIndex - digits.length)}`
      : digits.slice(0, centsIndex);
  const roundUp = centsIndex === 0
    ? (digits[0] ?? "0") >= "5"
    : centsIndex > 0 && centsIndex < digits.length && digits[centsIndex]! >= "5";
  if (roundUp) {
    const chars = cents.split("");
    let index = chars.length - 1;
    while (index >= 0 && chars[index] === "9") chars[index--] = "0";
    if (index >= 0) chars[index] = String(Number(chars[index]) + 1);
    else chars.unshift("1");
    cents = chars.join("");
  }
  const rounded = Number(cents) / 100;
  return value < 0 ? -rounded : rounded;
}

export function TrainingExerciseWorkspace(props: TrainingExerciseWorkspaceProps) {
  const {
    uk,
    sessionId,
    backHref,
    programName,
    exercise,
    previousExercise = null,
    nextExercise = null,
    exerciseIndex,
    exerciseCount,
    draft,
    editingSetId,
    busy,
    busyLabel,
    error,
    notice = null,
    mutationUncertain = false,
    mutationActionLabel,
    onVerifyPendingMutation,
    menuOpen,
    clockStartedAt = null,
    clockEndedAt = null,
    clockTicking = false,
    onToggleMenu,
    onCloseMenu,
    menuContent,
    desktopPrimaryActions,
    desktopDangerActions,
    footerContent,
    onPrev,
    onNext,
    onDraftChange,
    onSaveSet,
    onBeginEditSet,
    onCancelEditSet,
    onDeleteSet,
    trailingAction,
    finishDialog,
    inertBackground = false,
    autoAdvanceNonce = 0,
  } = props;

  const pointerStart = useRef<{
    x: number;
    y: number;
    id: number;
    at: number;
    locked: boolean;
  } | null>(null);
  const menuButtonRef = useRef<HTMLDivElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const historyAnnouncementRef = useRef<HTMLParagraphElement | null>(null);
  const animatingRef = useRef(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [historyById, setHistoryById] = useState<Record<number, ExerciseHistoryEntryDto[]>>({});
  const historyByIdRef = useRef<Record<number, ExerciseHistoryEntryDto[]>>({});
  const [historyAnnouncement, setHistoryAnnouncement] = useState("");
  const [infoExerciseId, setInfoExerciseId] = useState(exercise.id);
  const [dragPx, setDragPx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [transitionMs, setTransitionMs] = useState(CAROUSEL_MANUAL_MS);
  const lastAutoAdvance = useRef(0);
  const [copiedHint, setCopiedHint] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  if (exercise.id !== infoExerciseId) {
    setInfoExerciseId(exercise.id);
    setInfoOpen(false);
    setCommentOpen(false);
    setCopiedHint(false);
  }

  const showCommentField = commentOpen || draft.comment.trim().length > 0;

  const canPrev = exerciseIndex > 0;
  const canNext = exerciseIndex < exerciseCount - 1;
  const manualNavigationBlocked = busy || mutationUncertain;
  const clockMs = elapsedMs(clockStartedAt, clockTicking ? null : clockEndedAt, nowMs);

  useEffect(() => {
    if (!clockTicking || !clockStartedAt) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [clockTicking, clockStartedAt]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDownDoc(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuButtonRef.current?.contains(target)) return;
      if (menuPanelRef.current?.contains(target)) return;
      onCloseMenu();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseMenu();
    }
    document.addEventListener("pointerdown", onPointerDownDoc);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownDoc);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, onCloseMenu]);

  useEffect(() => {
    const ids = [previousExercise?.id, exercise.id, nextExercise?.id]
      .filter((id): id is number => id != null);
    let cancelled = false;
    void Promise.all(ids.map(async (id) => {
      if (historyByIdRef.current[id] !== undefined) return;
      try {
        const response = await fetch(
          `/api/v1/training/sessions/${sessionId}/exercises/${id}/history`,
          { cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const body = await response.json() as { entries: ExerciseHistoryEntryDto[] };
        if (cancelled) return;
        const entries = Array.isArray(body.entries) ? body.entries : [];
        historyByIdRef.current = { ...historyByIdRef.current, [id]: entries };
        setHistoryById((current) => ({ ...current, [id]: entries }));
      } catch {
        if (cancelled) return;
        historyByIdRef.current = { ...historyByIdRef.current, [id]: [] };
        setHistoryById((current) => ({ ...current, [id]: [] }));
      }
    }));
    return () => {
      cancelled = true;
    };
  }, [sessionId, exercise.id, previousExercise?.id, nextExercise?.id]);

  function paneWidth(): number {
    const width = viewportRef.current?.clientWidth ?? 0;
    return width > 0 ? width : (typeof window !== "undefined" ? window.innerWidth : 320);
  }

  function finishCommit(direction: "left" | "right") {
    animatingRef.current = false;
    setAnimating(false);
    setDragPx(0);
    if (direction === "left") onNext();
    else onPrev();
  }

  function animateTo(offset: number, durationMs: number, then?: () => void) {
    animatingRef.current = true;
    setAnimating(true);
    setDragPx(offset);
    window.setTimeout(() => {
      then?.();
    }, durationMs);
  }

  function requestNeighbor(delta: -1 | 1, mode: "manual" | "automatic" = "manual") {
    if (mutationUncertain || (mode === "manual" && busy)) return;
    if (animatingRef.current) return;
    if (delta < 0 && !canPrev) return;
    if (delta > 0 && !canNext) return;
    const width = paneWidth();
    const durationMs = carouselDurationMs(mode);
    setTransitionMs(durationMs);
    animateTo(delta > 0 ? -width : width, durationMs, () => finishCommit(delta > 0 ? "left" : "right"));
  }

  useEffect(() => {
    if (!autoAdvanceNonce || autoAdvanceNonce === lastAutoAdvance.current) return;
    lastAutoAdvance.current = autoAdvanceNonce;
    requestNeighbor(1, "automatic");
    // The nonce is the trigger. requestNeighbor closes over the current neighbors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvanceNonce]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!shouldHandleKeyboardExerciseNav(event.key, document.activeElement)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        requestNeighbor(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        requestNeighbor(1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPrev, canNext, exercise.id]);

  function clampDrag(dx: number): number {
    if (dx > 0 && !canPrev) return 0;
    if (dx < 0 && !canNext) return 0;
    const width = paneWidth();
    return Math.max(-width, Math.min(width, dx));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse") return;
    if (manualNavigationBlocked) return;
    if (animatingRef.current) return;
    if (isEditableSwipeTarget(event.target)) return;
    pointerStart.current = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      at: Date.now(),
      locked: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and some browsers reject capture on non-pointer targets
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        pointerStart.current = null;
        setDragPx(0);
        return;
      }
      start.locked = true;
    }
    event.preventDefault();
    setDragPx(clampDrag(dx));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    if (isEditableSwipeTarget(event.target) && !start.locked) return;
    const decision = classifyCarouselRelease({
      startX: start.x,
      startY: start.y,
      endX: event.clientX,
      endY: event.clientY,
      durationMs: Date.now() - start.at,
      paneWidth: paneWidth(),
      canPrev,
      canNext,
      viewportWidth: typeof window !== "undefined" ? window.innerWidth : undefined,
    });
    if (decision.type === "ignore") {
      setDragPx(0);
      return;
    }
    if (decision.type === "snap-back") {
      const durationMs = carouselDurationMs("manual");
      setTransitionMs(durationMs);
      animateTo(0, durationMs, () => {
        animatingRef.current = false;
        setAnimating(false);
        setDragPx(0);
      });
      return;
    }
    const width = paneWidth();
    const durationMs = carouselDurationMs("manual");
    setTransitionMs(durationMs);
    animateTo(decision.direction === "left" ? -width : width, durationMs, () => finishCommit(decision.direction));
  }

  function copyHistorySet(set: ExerciseHistorySetDto) {
    if (busy || mutationUncertain) return;
    const parsedOverride = setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
    onDraftChange({
      ...draft,
      reps: String(set.reps),
      additionalLoadKg: exercise.resistanceType === RESISTANCE.BODYWEIGHT
        && parsedOverride.success
        && (parsedOverride.data.additionalLoadKg ?? 0) > 0
        ? String(parsedOverride.data.additionalLoadKg)
        : "",
      weightKg: set.weightKg == null ? draft.weightKg : String(set.weightKg),
      bandNominalResistanceKg: set.bandNominalResistanceKg == null
        ? draft.bandNominalResistanceKg
        : String(set.bandNominalResistanceKg),
      asymmetricRepsEnabled: false,
      leftReps: "",
      rightReps: "",
      rir: set.rir == null ? "" : String(set.rir),
    });
    setCopiedHint(true);
  }

  function replaceCachedHistorySet(exerciseId: number, entry: ExerciseHistoryEntryDto, nextSet: ExerciseHistorySetDto) {
    const cached = historyByIdRef.current[exerciseId] ?? [];
    const next = cached.flatMap((candidate) => {
      if (candidate.sessionId !== entry.sessionId) return [candidate];
      const sets = candidate.sets.map((set) => set.id === nextSet.id ? nextSet : set);
      return sets.length > 0 ? [{ ...candidate, sets }] : [];
    });
    historyByIdRef.current = { ...historyByIdRef.current, [exerciseId]: next };
    setHistoryById((current) => ({ ...current, [exerciseId]: next }));
  }

  function removeCachedHistorySet(exerciseId: number, entry: ExerciseHistoryEntryDto, setId: number) {
    const cached = historyByIdRef.current[exerciseId] ?? [];
    const next = cached.flatMap((candidate) => {
      if (candidate.sessionId !== entry.sessionId) return [candidate];
      const sets = candidate.sets.filter((set) => set.id !== setId);
      return sets.length > 0 ? [{ ...candidate, sets }] : [];
    });
    historyByIdRef.current = { ...historyByIdRef.current, [exerciseId]: next };
    setHistoryById((current) => ({ ...current, [exerciseId]: next }));
  }

  async function readHistoricalSet(sessionId: number, setId: number): Promise<StrengthSetDto | null> {
    const response = await fetchWithHistoryTimeout(`/api/v1/training/sessions/${sessionId}/sets/${setId}`, { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("historical session verification failed");
    const body = await response.json() as { set?: StrengthSetDto };
    if (!body.set || body.set.id !== setId) throw new Error("historical set verification response was invalid");
    return body.set;
  }

  function historySetMatchesPayload(set: ExerciseHistorySetDto, payload: UpdateSetInput): boolean {
    if (payload.reps !== undefined && set.reps !== payload.reps) return false;
    if (payload.weightKg !== undefined
        && set.weightKg !== (payload.weightKg === null ? null : roundLoadToDatabasePrecision(payload.weightKg))) return false;
    if (payload.bandNominalResistanceKg !== undefined
        && set.bandNominalResistanceKg !== (payload.bandNominalResistanceKg === null ? null : roundLoadToDatabasePrecision(payload.bandNominalResistanceKg))) return false;
    if (payload.rir !== undefined && set.rir !== payload.rir) return false;
    if (payload.comment !== undefined && set.comment !== payload.comment) return false;
    if (payload.loadAccountingOverride !== undefined
        && stableJson(set.loadAccountingOverride ?? null) !== stableJson(payload.loadAccountingOverride)) return false;
    return true;
  }

  function storeVerifiedHistorySet(exerciseId: number, entry: ExerciseHistoryEntryDto, set: StrengthSetDto) {
    replaceCachedHistorySet(exerciseId, entry, {
      id: set.id,
      setNumber: set.setNumber,
      reps: set.reps,
      weightKg: set.weightKg,
      bandNominalResistanceKg: set.bandNominalResistanceKg,
      rir: set.rir,
      comment: set.comment,
      completedAt: set.completedAt,
      loadAccountingOverride: set.loadAccountingOverride ?? null,
    });
  }

  async function reconcileHistoricalUpdate(
    exerciseId: number,
    entry: ExerciseHistoryEntryDto,
    original: ExerciseHistorySetDto,
    payload: UpdateSetInput,
  ): Promise<void> {
    const refreshedSet = await readHistoricalSet(entry.sessionId, original.id);
    if (!refreshedSet || !historySetMatchesPayload(refreshedSet, payload)) {
      throw new Error("historical set update could not be confirmed");
    }
    storeVerifiedHistorySet(exerciseId, entry, refreshedSet);
    const alreadyCurrent = historySetMatchesPayload(original, payload);
    announceHistory(alreadyCurrent
      ? (uk ? "Підхід уже має ці значення; показано актуальний запис." : "The set already had these values; the current record is shown.")
      : (uk ? "Підхід збережено." : "Set saved."));
  }

  function announceHistory(message: string, focus = false) {
    setHistoryAnnouncement(message);
    if (focus) window.requestAnimationFrame(() => historyAnnouncementRef.current?.focus());
  }

  async function updateHistoricalSet(exerciseId: number, entry: ExerciseHistoryEntryDto, set: ExerciseHistorySetDto, payload: UpdateSetInput): Promise<void> {
    if (busy || mutationUncertain) throw new Error("set mutations are blocked until the pending write is verified");
    try {
      await fetchWithHistoryTimeout(`/api/v1/training/sessions/${entry.sessionId}/sets/${set.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // A transport error can arrive after the server has committed the edit.
    }
    await reconcileHistoricalUpdate(exerciseId, entry, set, payload);
  }

  async function deleteHistoricalSet(exerciseId: number, entry: ExerciseHistoryEntryDto, set: ExerciseHistorySetDto): Promise<void> {
    if (busy || mutationUncertain) throw new Error("set mutations are blocked until the pending write is verified");
    let response: Response | null = null;
    try {
      response = await fetchWithHistoryTimeout(`/api/v1/training/sessions/${entry.sessionId}/sets/${set.id}`, { method: "DELETE" });
    } catch {
      // Reconcile the postcondition before telling the user to retry a timed-out mutation.
    }
    const refreshedSet = await readHistoricalSet(entry.sessionId, set.id);
    if (refreshedSet !== null) throw new Error("historical set deletion could not be confirmed");
    removeCachedHistorySet(exerciseId, entry, set.id);
    announceHistory(response?.ok
      ? (uk ? "Підхід видалено." : "Set deleted.")
      : (uk ? "Підхід відсутній; показано актуальну історію." : "The set is absent; the current history is shown."), true);
  }

  const exerciseCountLabel = uk
    ? `${exerciseIndex + 1} / ${exerciseCount} вправ`
    : `${exerciseIndex + 1} / ${exerciseCount} exercises`;

  function renderCarouselPane(
    target: StrengthSessionExerciseDto | null,
    interactive: boolean,
  ) {
    if (!target) {
      return <div className={styles.workoutCarouselPane} aria-hidden="true" />;
    }
    return (
      <div
        className={styles.workoutCarouselPane}
        aria-hidden={interactive ? undefined : true}
        inert={interactive ? undefined : true}
        data-testid={interactive ? "active-exercise-pane" : "peek-exercise-pane"}
      >
        <ExercisePane
          uk={uk}
          exercise={target}
          interactive={interactive}
          draft={interactive ? draft : emptySetDraft()}
          editingSetId={interactive ? editingSetId : null}
          busy={interactive && busy}
          busyLabel={interactive ? busyLabel : undefined}
          mutationUncertain={interactive && mutationUncertain}
          historyMutationBlocked={interactive && manualNavigationBlocked}
          canPrev={canPrev && !manualNavigationBlocked}
          canNext={canNext && !manualNavigationBlocked}
          infoOpen={interactive && infoOpen}
          showCommentField={interactive && showCommentField}
          onToggleInfo={() => setInfoOpen((value) => !value)}
          onOpenComment={() => setCommentOpen(true)}
          onPrev={() => requestNeighbor(-1)}
          onNext={() => requestNeighbor(1)}
          onDraftChange={interactive ? onDraftChange : () => undefined}
          onSaveSet={interactive ? onSaveSet : () => undefined}
          onBeginEditSet={interactive ? onBeginEditSet : () => undefined}
          onCancelEditSet={interactive ? onCancelEditSet : () => undefined}
          onDeleteSet={interactive ? onDeleteSet : () => undefined}
          trailingAction={interactive ? trailingAction : undefined}
          history={historyById[target.id] ?? []}
          historyLoading={historyById[target.id] === undefined}
          copiedHint={interactive && copiedHint}
          onCopyHistorySet={copyHistorySet}
          onUpdateHistoricalSet={(entry, set, payload) => updateHistoricalSet(target.id, entry, set, payload)}
          onDeleteHistoricalSet={(entry, set) => deleteHistoricalSet(target.id, entry, set)}
        />
      </div>
    );
  }

  return (
    <main className={styles.workoutShell}>
      <div className={styles.workoutFrame} inert={inertBackground}>
        <header className={styles.workoutTop}>
          <div className={styles.workoutChrome}>
            <Link className={`${styles.liveBack} ${styles.workoutChromeBack}`} href={backHref}>
              {uk ? "← Назад" : "← Back"}
            </Link>
            {clockMs != null && (
              <time className={styles.workoutTimer} dateTime={`${Math.floor(clockMs / 1000)}s`}>
                {formatElapsedClock(clockMs)}
              </time>
            )}
            <div className={styles.workoutChromeMenu} ref={menuButtonRef}>
              <button
                className={styles.editMenuBtn}
                type="button"
                aria-expanded={menuOpen}
                aria-haspopup="dialog"
                aria-label={uk ? "Меню сесії" : "Session menu"}
                disabled={busy || mutationUncertain}
                onClick={onToggleMenu}
              >
                ⋯
              </button>
            </div>
          </div>

          <div className={styles.workoutHero}>
            <p className={styles.liveProgram}>{programName}</p>
            <p className={styles.liveProgress} aria-live="polite">{exerciseCountLabel}</p>
          </div>

          {(desktopPrimaryActions || desktopDangerActions) && (
            <div className={styles.workoutDesktopActions} aria-label={uk ? "Дії сесії" : "Session actions"}>
              {desktopPrimaryActions ? (
                <div className={styles.workoutDesktopPrimary}>{desktopPrimaryActions}</div>
              ) : null}
              {desktopDangerActions ? (
                <div className={styles.workoutDesktopDanger}>{desktopDangerActions}</div>
              ) : null}
            </div>
          )}

          {menuOpen && (
            <>
              <button
                type="button"
                className={styles.workoutMenuBackdrop}
                aria-label={uk ? "Закрити меню" : "Close menu"}
                onClick={onCloseMenu}
              />
              <div
                ref={menuPanelRef}
                className={styles.workoutActionPanel}
                role="dialog"
                aria-label={uk ? "Дії" : "Actions"}
              >
                {menuContent}
              </div>
            </>
          )}
        </header>

        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
            {mutationUncertain && onVerifyPendingMutation && (
              <button type="button" className={styles.liveSecondary} disabled={busy} onClick={onVerifyPendingMutation}>
                {mutationActionLabel ?? (uk ? "Перевірити стан" : "Check status")}
              </button>
            )}
          </div>
        )}
        {notice && <p className={styles.liveProgress} role="status" aria-live="polite">{notice}</p>}
        {historyAnnouncement && <p ref={historyAnnouncementRef} className={styles.liveProgress} role="status" aria-live="polite" tabIndex={-1}>{historyAnnouncement}</p>}

        <div className={styles.workoutWorkspace}>
          <button
            className={`${styles.workoutSideNav} ${!canPrev ? styles.workoutSideNavHidden : ""}`}
            type="button"
            aria-label={uk ? "Попередня вправа" : "Previous exercise"}
            disabled={!canPrev || manualNavigationBlocked}
            onClick={() => requestNeighbor(-1)}
          >
            ←
          </button>

          <div
            ref={viewportRef}
            className={styles.workoutCarouselViewport}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              pointerStart.current = null;
              if (!animatingRef.current) setDragPx(0);
            }}
          >
            <div
              className={styles.workoutCarouselTrack}
              style={{
                transform: `translateX(calc(-33.333333333333336% + ${dragPx}px))`,
                transition: animating ? `transform ${transitionMs}ms ease-out` : "none",
              }}
            >
              {renderCarouselPane(previousExercise, false)}
              {renderCarouselPane(exercise, true)}
              {renderCarouselPane(nextExercise, false)}
            </div>
          </div>

          <button
            className={`${styles.workoutSideNav} ${!canNext ? styles.workoutSideNavHidden : ""}`}
            type="button"
            aria-label={uk ? "Наступна вправа" : "Next exercise"}
            disabled={!canNext || manualNavigationBlocked}
            onClick={() => requestNeighbor(1)}
          >
            →
          </button>
        </div>
      </div>
      {footerContent && (
        <div inert={inertBackground} style={{ display: "contents" }}>
          {footerContent}
        </div>
      )}
      {finishDialog}
    </main>
  );
}
