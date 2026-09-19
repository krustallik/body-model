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
  weightKg: string;
  bandNominalResistanceKg: string;
  rir: string;
  comment: string;
};

const CAROUSEL_MS = 220;

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
  error: string | null;
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
  onPrev: () => void;
  onNext: () => void;
  onDraftChange: (next: SetDraft) => void;
  onSaveSet: () => void;
  onBeginEditSet: (set: StrengthSetDto) => void;
  onCancelEditSet: () => void;
  onDeleteSet: (setId: number) => void;
  trailingAction?: ReactNode;
  finishDialog?: ReactNode;
};

export function emptySetDraft(): SetDraft {
  return { reps: "", weightKg: "", bandNominalResistanceKg: "", rir: "", comment: "" };
}

function elapsedMs(startedAt: string | null | undefined, endedAt: string | null | undefined, now: number): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return null;
  const end = endedAt ? new Date(endedAt).getTime() : now;
  if (!Number.isFinite(end)) return null;
  return end - start;
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
    error,
    menuOpen,
    clockStartedAt = null,
    clockEndedAt = null,
    clockTicking = false,
    onToggleMenu,
    onCloseMenu,
    menuContent,
    desktopPrimaryActions,
    desktopDangerActions,
    onPrev,
    onNext,
    onDraftChange,
    onSaveSet,
    onBeginEditSet,
    onCancelEditSet,
    onDeleteSet,
    trailingAction,
    finishDialog,
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
  const animatingRef = useRef(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [historyById, setHistoryById] = useState<Record<number, ExerciseHistoryEntryDto[]>>({});
  const [historyLoadingIds, setHistoryLoadingIds] = useState<Record<number, boolean>>({});
  const [infoExerciseId, setInfoExerciseId] = useState(exercise.id);
  const [dragPx, setDragPx] = useState(0);
  const [animating, setAnimating] = useState(false);
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

  const historyByIdRef = useRef(historyById);
  historyByIdRef.current = historyById;

  useEffect(() => {
    const ids = [previousExercise?.id, exercise.id, nextExercise?.id]
      .filter((id): id is number => id != null);
    let cancelled = false;
    void Promise.all(ids.map(async (id) => {
      if (historyByIdRef.current[id] !== undefined) return;
      setHistoryLoadingIds((current) => ({ ...current, [id]: true }));
      try {
        const response = await fetch(
          `/api/v1/training/sessions/${sessionId}/exercises/${id}/history`,
          { cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const body = await response.json() as { entries: ExerciseHistoryEntryDto[] };
        if (cancelled) return;
        setHistoryById((current) => ({
          ...current,
          [id]: Array.isArray(body.entries) ? body.entries : [],
        }));
      } catch {
        if (!cancelled) setHistoryById((current) => ({ ...current, [id]: [] }));
      } finally {
          setHistoryLoadingIds((current) => ({ ...current, [id]: false }));
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

  function animateTo(offset: number, then?: () => void) {
    animatingRef.current = true;
    setAnimating(true);
    setDragPx(offset);
    window.setTimeout(() => {
      then?.();
    }, CAROUSEL_MS);
  }

  function requestNeighbor(delta: -1 | 1) {
    if (animatingRef.current) return;
    if (delta < 0 && !canPrev) return;
    if (delta > 0 && !canNext) return;
    const width = paneWidth();
    animateTo(delta > 0 ? -width : width, () => finishCommit(delta > 0 ? "left" : "right"));
  }

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
      animateTo(0, () => {
        animatingRef.current = false;
        setAnimating(false);
        setDragPx(0);
      });
      return;
    }
    const width = paneWidth();
    animateTo(decision.direction === "left" ? -width : width, () => finishCommit(decision.direction));
  }

  function copyHistorySet(set: ExerciseHistorySetDto) {
    onDraftChange({
      ...draft,
      reps: String(set.reps),
      weightKg: set.weightKg == null ? draft.weightKg : String(set.weightKg),
      bandNominalResistanceKg: set.bandNominalResistanceKg == null
        ? draft.bandNominalResistanceKg
        : String(set.bandNominalResistanceKg),
      rir: set.rir == null ? "" : String(set.rir),
    });
    setCopiedHint(true);
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
          canPrev={canPrev}
          canNext={canNext}
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
        />
      </div>
    );
  }

  return (
    <main className={styles.workoutShell}>
      <div className={styles.workoutFrame}>
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

        {error && <div className={styles.errorBanner} role="alert">{error}</div>}

        <div className={styles.workoutWorkspace}>
          <button
            className={`${styles.workoutSideNav} ${!canPrev ? styles.workoutSideNavHidden : ""}`}
            type="button"
            aria-label={uk ? "Попередня вправа" : "Previous exercise"}
            disabled={!canPrev}
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
                transform: `translateX(calc(-33.333% + ${dragPx}px))`,
                transition: animating ? `transform ${CAROUSEL_MS}ms ease-out` : "none",
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
            disabled={!canNext}
            onClick={() => requestNeighbor(1)}
          >
            →
          </button>
        </div>
      </div>
      {finishDialog}
    </main>
  );
}
